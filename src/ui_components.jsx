import {createContext, useContext, useState, useEffect} from 'react';
import {Dropdown, Nav, Navbar, OverlayTrigger, Tooltip} from 'react-bootstrap';
import {FaMoon, FaProjectDiagram, FaQq, FaReact, FaSearch, FaSun} from 'react-icons/fa';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {GAME_DATA_SOURCES, get_game_data} from './game_data';
import {GameInfoContext, GameInfoSetterContext} from './contexts.jsx';

// ========== ThemeContext ==========

const ThemeContext = createContext(undefined);

export function ThemeProvider({children}) {
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved || 'dark';
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

function Icon({icon, size, mod}) {
    let style = null;
    let usedMod = null;
    // 回退链:先在当前数据源(mod)雪碧图找,未命中回退 Vanilla
    // (mod 数据中共享物品沿用原版拉丁 IconName,如 iron-plate,只在原版雪碧图;新增物品用中文 IconName 命中 mod 雪碧图)
    for (const m of [mod, 'Vanilla']) {
        try {
            const {x, y, height, total_width, total_height} = image_indices[m][icon];
            const scale = size / height;

            const tw = total_width * scale, th = total_height * scale;
            const bgx = -x * scale, bgy = -y * scale;

            style = {
                width: size, height: size,
                backgroundPosition: `${bgx}px ${bgy}px`,
                backgroundSize: `${tw}px ${th}px`,
            };
            usedMod = m;
            break;
        } catch {
            style = null;
        }
    }

    if (style) {
        return <div className={`icon-${usedMod}`} style={style}/>;
    }
    return <span
        style={{
            width: size, height: size,
            display: "inline-block",
            fontSize: 10,
            textWrap: "pretty",
            overflow: "hidden",
        }}
    >? {icon}</span>;
}

export function ItemIcon({item, size, tooltip}) {
    size = size || 40;

    const game_info = useContext(GameInfoContext);
    const game_data = game_info?.game_data;
    const icon = game_data?.item_icon_name?.[item];
    const mod = game_data?.game_name ?? 'Vanilla';

    let img = <Icon icon={icon} size={size} mod={mod}/>;

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
    const game_info = useContext(GameInfoContext);
    const set_game_data = useContext(GameInfoSetterContext);
    const gameVersion = game_info?.game_data?.game_version ?? '?';
    const gameName = game_info?.game_data?.game_name ?? 'Vanilla';
    const renderTooltip = (props) => (
        <Tooltip id="qq-tooltip" {...props}>
            QQ:1610241445<br/>
            QQ群:暂无
        </Tooltip>
    );

    // 数据源(mod)切换
    function switchSource(name) {
        if (name === gameName) return;
        set_game_data(get_game_data(name));
    }

    function handle_dependency_graph(e) {
        e.preventDefault();
        if (onNavigate) {
            onNavigate(currentPage === 'dependency-graph' ? 'calculator' : 'dependency-graph');
        }
    }

    function handle_seed_viewer(e) {
        e.preventDefault();
        if (onNavigate) {
            onNavigate(currentPage === 'seed-viewer' ? 'calculator' : 'seed-viewer');
        }
    }

    return (
        <Navbar className="px-3 text-nowrap" bg="body-tertiary">
            <Navbar.Brand href="#" className="d-inline-flex align-items-baseline"
                          onClick={(e) => { e.preventDefault(); onNavigate && onNavigate('calculator'); }}>
                <FaReact className="me-2 align-self-center"/>
                <span className="me-1">戴森球计划量化计算器</span>
                <span className="text-muted ssmall">v{version}</span>
            </Navbar.Brand>
            {/* 无 expand/toggle:导航栏始终展开,无汉堡菜单 */}
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
                    <Nav.Link
                        href="#"
                        className={`d-inline-flex align-items-center gap-1 ${currentPage === 'seed-viewer' ? 'active' : ''}`}
                        onClick={handle_seed_viewer}
                        title="查看种子资源分布"
                    >
                        <FaSearch/>
                        <span>种子查看</span>
                    </Nav.Link>
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

                {/* 右簇:github/版本+mod切换/主题,整体 ms-auto 推到最右并紧贴(github/版本不再各自 ms-auto) */}
                <div className="ms-auto d-inline-flex align-items-center gap-2">
                    <span className="navbar-text small header-github">
                        <a href="https://github.com/yuki-216/dsp-calc-opt" target="_blank" rel="noopener noreferrer"
                           className="text-primary text-decoration-underline">
                            github: 若对您有帮助，不妨来点个免费的star吧
                        </a>
                    </span>
                    <span className="navbar-text small header-version">
                        游戏版本 v{gameVersion}
                    </span>
                    {/* onSelect 必须设在 Dropdown 上(react-bootstrap 2.x 的 DropdownItem 不接收 onSelect prop,
                        它经 SelectableContext 从 Dropdown 触发,且依赖 Item 的 eventKey)——否则点击只关闭菜单不切换 */}
                    <Dropdown align="end" className="header-mod-switch"
                              onSelect={(eventKey) => switchSource(eventKey)}>
                        <Dropdown.Toggle variant="outline-secondary" size="sm">
                            {GAME_DATA_SOURCES[gameName]?.display ?? gameName}
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                            {Object.entries(GAME_DATA_SOURCES).map(([key, s]) => (
                                <Dropdown.Item key={key} eventKey={key} active={gameName === key}>
                                    {s.display}
                                </Dropdown.Item>
                            ))}
                        </Dropdown.Menu>
                    </Dropdown>
                    <Nav className="align-items-center">
                        <Nav.Link
                            href="#"
                            className="d-flex align-items-center"
                            onClick={toggleTheme}
                            title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
                        >
                            {theme === 'light' ? <FaMoon/> : <FaSun/>}
                        </Nav.Link>
                    </Nav>
                </div>
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

// ========== AutoSizedInput ==========

/** When `delayed` is `true`, validation (number) is also enabled. */
export const AutoSizedInput = ({value, onChange, className, delayed}) => {
    const [disp_value, set_disp_value] = useState(null);

    let valid_class = "";
    if (disp_value) {
        valid_class = isNaN(disp_value) ? "invalid" : "valid";
    }

    function commit(new_value) {
        onChange(isNaN(new_value) ? value : new_value);
    }

    return (
        <label className={`auto-sized-input ${className || ""}`}>
            <span>{disp_value || value}</span>
            {delayed
                ? <input
                    className={(className || "") + " " + valid_class}
                    type="text"
                    value={disp_value || value}
                    onBlur={e => {
                        commit(e.target.value);
                        set_disp_value(null);
                    }}
                    onChange={e => set_disp_value(e.target.value)}
                    onKeyDown={e => {
                        if (e.key == "Enter") commit(e.target.value);
                    }}
                />
                : <input type="text" value={value} onChange={onChange}/>
            }
        </label>
    )
}
