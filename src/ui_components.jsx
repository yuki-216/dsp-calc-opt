import {createContext, useContext, useState, useEffect} from 'react';
import {Nav, Navbar, OverlayTrigger, Tooltip} from 'react-bootstrap';
import {FaMoon, FaProjectDiagram, FaQq, FaReact, FaSun} from 'react-icons/fa';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {default_game_data, vanilla_game_version} from './game_data';

// ========== ThemeContext ==========

const ThemeContext = createContext(undefined);

export function ThemeProvider({children}) {
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved || 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-bs-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{theme, toggleTheme}}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

// ========== Icon ==========

const image_index_modules = import.meta.glob('../icon/*.json', {
    import: 'default',
    eager: true,
});

/** {[game_name: string]: {[item: string]: image_props}}} */
const image_indices = Object.fromEntries(
    Object.entries(image_index_modules)
        .map(([module, icons]) =>
            [module.replace(/^\.\.\/icon\/(.+)\.json/, "$1"), icons]
        ))

export function IconStyles() {
    function get_icon_style(mod_name) {
        return `
.icon-${mod_name} {
    vertical-align: bottom;
    display: inline-block;
    background-image: url('icon/${mod_name}.png');
    @supports (background-image: url('icon/${mod_name}.webp')) {
        background-image: url('icon/${mod_name}.webp');
    }
}`;
    }

    const styles = Object.keys(image_indices).map(get_icon_style).join("\n");
    return <style>{styles}</style>;
}

function Icon({icon, size}) {
    try {
        const {x, y, height, total_width, total_height} = image_indices["Vanilla"][icon];
        const scale = size / height;

        const tw = total_width * scale, th = total_height * scale;
        const bgx = -x * scale, bgy = -y * scale;

        return <>
            <div className={`icon-Vanilla`}
                 style={{
                     width: size, height: size,
                     backgroundPosition: `${bgx}px ${bgy}px`,
                     backgroundSize: `${tw}px ${th}px`,
                 }}
            />
        </>;
    } catch {
        return <><span
            style={{
                width: size, height: size,
                display: "inline-block",
                fontSize: 10,
                textWrap: "pretty",
                overflow: "hidden",
            }}
        >? {icon}</span></>
    }
}

function get_icon_by_item(item) {
    return default_game_data.item_icon_name[item];
}

export function ItemIcon({item, size, tooltip}) {
    size = size || 40;

    const icon = get_icon_by_item(item);

    let img = <Icon icon={icon} size={size}/>;

    tooltip = tooltip === undefined ? true : tooltip;
    if (tooltip) {
        let fontSize = Math.min(size / 2, 16);
        return <span data-tooltip={item} className="fast-tooltip"
                     style={{fontSize: fontSize}}>
            {img}
        </span>;
    } else {
        return img;
    }
}

// ========== Header ==========

export function Header({onNavigate, currentPage}) {
    const version = import.meta.env.VITE_APP_VERSION;
    const {theme, toggleTheme} = useTheme();
    const renderTooltip = (props) => (
        <Tooltip id="qq-tooltip" {...props}>
            QQ:1610241445<br/>
            QQ群:暂无
        </Tooltip>
    );

    function handle_dependency_graph(e) {
        e.preventDefault();
        if (onNavigate) {
            onNavigate(currentPage === 'dependency-graph' ? 'calculator' : 'dependency-graph');
        }
    }

    return (
        <Navbar className="px-3 text-nowrap" bg="body-tertiary" expand="lg">
            <Navbar.Brand href="#" className="d-inline-flex align-items-baseline"
                          onClick={(e) => { e.preventDefault(); onNavigate && onNavigate('calculator'); }}>
                <FaReact className="me-2 align-self-center"/>
                <span className="me-1">戴森球计划量化计算器</span>
                <span className="text-muted ssmall">v{version}</span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="navbarNav"/>
            <Navbar.Collapse id="navbarNav">
                <Nav>
                    <Nav.Link
                        href="#"
                        className={`d-inline-flex align-items-center gap-1 ${currentPage === 'dependency-graph' ? 'active' : ''}`}
                        onClick={handle_dependency_graph}
                        title="查看依赖关系图"
                    >
                        <FaProjectDiagram/>
                        <span>依赖图</span>
                    </Nav.Link>
                    {/* <Nav.Link href="https://github.com/DSPCalculator/dsp-calc">开源仓库</Nav.Link> */}
                    {/* <Nav.Link href="https://www.bilibili.com/read/readlist/rl630834" target="_blank">逻辑原理</Nav.Link> */}
                    {/* <Nav.Link href="https://space.bilibili.com/16051534">联系作者</Nav.Link> */}
                </Nav>
                <Nav>
                    <OverlayTrigger
                        placement="bottom"
                        delay={{show: 250, hide: 400}}
                        overlay={renderTooltip}
                    >
                        <Nav.Link href="#" className="d-flex align-items-center">
                            <FaQq className="mr-1"/> QQ
                        </Nav.Link>
                    </OverlayTrigger>
                </Nav>

                <span className="navbar-text ms-auto small me-3">
                    游戏版本 v{vanilla_game_version}
                </span>
                <Nav>
                    <Nav.Link
                        href="#"
                        className="d-flex align-items-center"
                        onClick={toggleTheme}
                        title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
                    >
                        {theme === 'light' ? <FaMoon/> : <FaSun/>}
                    </Nav.Link>
                </Nav>
            </Navbar.Collapse>
        </Navbar>
    );
}

// ========== ReloadPrompt ==========

const TOAST_STYLE = {
    position: 'fixed',
    bottom: '1rem',
    right: '1rem',
    zIndex: 9999,
    maxWidth: '360px',
};

export function ReloadPrompt() {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('SW registered:', r);
        },
        onRegisterError(error) {
            console.error('SW registration error:', error);
        },
    });

    const dismiss = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    if (!offlineReady && !needRefresh) return null;

    return (
        <div className="alert alert-info shadow d-flex align-items-center gap-2 mb-0" style={TOAST_STYLE} role="alert">
            <span className="flex-grow-1">
                {offlineReady
                    ? '应用已可离线使用'
                    : '发现新版本，点击刷新以更新'}
            </span>
            {needRefresh && (
                <button
                    className="btn btn-primary btn-sm"
                    onClick={() => updateServiceWorker(true)}
                >
                    刷新
                </button>
            )}
            <button
                className="btn btn-outline-secondary btn-sm"
                onClick={dismiss}
            >
                关闭
            </button>
        </div>
    );
}
