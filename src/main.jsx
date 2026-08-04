import React, {useState} from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import {Header, IconStyles, ThemeProvider} from './ui_components.jsx';
import {ContextProvider} from './contexts.jsx';
import {DependencyGraphPage} from './DependencyGraphPage.jsx';

// Not using 'bootstrap/dist/js/bootstrap.min.js' here, because it breaks dropdown-list
import 'bootstrap';

import '../css/styles.scss';
// app-specific CSS
import '../css/App.css';

ReactDOM.createRoot(document.getElementById('icon-styles')).render(
    <IconStyles/>
)

// 隐藏原始 header div，使用 RootApp 内的 header
document.getElementById('header').style.display = 'none';

/**
 * 根应用组件，包含页面切换逻辑
 * ContextProvider 和 Header 在此组件内渲染，确保切换页面时 context 不丢失
 * needs_list 状态提升到此处，确保切换页面时需求列表不丢失
 */
function RootApp() {
    const [page, setPage] = useState('calculator'); // 'calculator' | 'dependency-graph'
    const [needs_list, set_needs_list] = useState({});

    // 使用 CSS display 切换而非条件渲染，避免切换页面时卸载/重挂组件导致 useMemo 重复计算
    // display: contents 让子组件像直接子元素一样布局，display: none 保持挂载但隐藏
    return <ThemeProvider>
        <ContextProvider>
            <Header onNavigate={setPage} currentPage={page}/>
            <div style={{display: page === 'calculator' ? 'contents' : 'none'}}>
                <App needs_list={needs_list} set_needs_list={set_needs_list}/>
            </div>
            <div style={{display: page === 'dependency-graph' ? 'contents' : 'none'}}>
                <DependencyGraphPage onBack={() => setPage('calculator')} needs_list={needs_list}/>
            </div>
        </ContextProvider>
    </ThemeProvider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <RootApp/>
)

// PWA registration requires Service Worker support — skip entirely on legacy
// browsers (e.g. IE11) so the rest of the app still renders.
if ('serviceWorker' in navigator) {
    import('./ui_components.jsx').then(({ReloadPrompt}) => {
        ReactDOM.createRoot(document.getElementById('pwa-prompt')).render(
            <ThemeProvider>
                <ReloadPrompt/>
            </ThemeProvider>
        )
    }).catch(e => {
        console.warn('PWA registration unavailable:', e);
    });
}
