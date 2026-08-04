import {Nav, Navbar, OverlayTrigger, Tooltip} from 'react-bootstrap';
import {FaInfoCircle, FaMoon, FaProjectDiagram, FaQq, FaReact, FaSun} from 'react-icons/fa';
import {useTheme} from './ThemeContext.jsx';

export function Header({onNavigate, currentPage}) {
    const version = import.meta.env.VITE_APP_VERSION;
    const {theme, toggleTheme} = useTheme();
    const renderTooltip = (props) => (
        <Tooltip id="qq-tooltip" {...props}>
            联系作者QQ:653524123<br/>
            加入QQ群反馈:816367922
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
                    <Nav.Link href="https://github.com/DSPCalculator/dsp-calc">开源仓库</Nav.Link>
                    <Nav.Link href="https://www.bilibili.com/read/readlist/rl630834" target="_blank">逻辑原理</Nav.Link>
                    <Nav.Link href="https://space.bilibili.com/16051534">联系作者</Nav.Link>
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
                    <FaInfoCircle/> 若无法加载，尝试切换浏览器为Chrome/Edge
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