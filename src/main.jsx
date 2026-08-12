import React, {useState, useEffect} from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import {Header, IconStyles, ThemeProvider} from './ui_components.jsx';
import {ContextProvider} from './contexts.jsx';
import {DependencyGraphPage} from './DependencyGraphPage.jsx';

// Not using 'bootstrap/dist/js/bootstrap.min.js' here, because it breaks dropdown-list
import 'bootstrap';

import 'bootstrap/scss/bootstrap.scss';
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
const STORAGE_KEY_NEEDS = 'dsp-calc-needs-list';

function RootApp() {
    const [page, setPage] = useState('calculator'); // 'calculator' | 'dependency-graph'
    const [newTabData, setNewTabData] = useState(null);
    const [needs_list, set_needs_list] = useState(() => {
        try {
            // 检查是否有新标签页数据
            const saved = localStorage.getItem('dsp-calc-new-tab-data');
            if (saved) {
                const data = JSON.parse(saved);
                localStorage.removeItem('dsp-calc-new-tab-data');
                // 延迟设置newTabData，避免在useState initializer中调用setState
                setTimeout(() => setNewTabData(data), 0);
                // 返回包含新物品的需求表
                return { [data.item]: data.count };
            }
        } catch {}
        try {
            const saved = localStorage.getItem(STORAGE_KEY_NEEDS);
            if (saved) return JSON.parse(saved);
        } catch {}
        return {};
    });

    // 需求表变更时持久化
    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY_NEEDS, JSON.stringify(needs_list)); } catch {}
    }, [needs_list]);

    // 使用 CSS display 切换而非条件渲染，避免切换页面时卸载/重挂组件导致 useMemo 重复计算
    // display: contents 让子组件像直接子元素一样布局，display: none 保持挂载但隐藏
    return <ThemeProvider>
        <ContextProvider>
            <Header onNavigate={setPage} currentPage={page}/>
            <div style={{display: page === 'calculator' ? 'contents' : 'none'}}>
                <App needs_list={needs_list} set_needs_list={set_needs_list} newTabData={newTabData}/>
            </div>
            <div style={{display: page === 'dependency-graph' ? 'contents' : 'none'}}>
                <DependencyGraphPage onBack={() => setPage('calculator')} needs_list={needs_list} isActive={page === 'dependency-graph'}/>
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
