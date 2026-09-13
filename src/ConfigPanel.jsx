import {useRef, useState} from 'react';
import {FaFileExport, FaFileImport} from 'react-icons/fa';
import {GAME_DATA_SOURCES, get_game_data} from './game_data.jsx';
import {safe_parse_json} from './contexts.jsx';
import {isSandbox, persistGet, persistSet} from './sandbox.js';
import {buildExportPayload, parseImportFile, validateImport, applyImport} from './config_transfer.js';

/**
 * 配置管理面板：把「打开时恢复的本地缓存」导出到文件 / 从文件导入。
 *
 * 导出范围与导入语义见 config_transfer.js；面板只负责交互与提示。
 * 导入、导出都以 persistGet 为读取源——沙盒子窗口里它会读到本窗口自己的
 * sessionStorage，于是子窗口导出的是"它自己看到的配置"。
 */
export function ConfigPanel() {
    const [msg, set_msg] = useState(null);   // {type: 'success'|'danger'|'warning', text}
    const file_ref = useRef(null);
    const sandbox = isSandbox();

    /** 当前数据源（非法/缺失回退原版，与 contexts.jsx 的 getInitialSourceName 一致） */
    function current_source() {
        const saved = persistGet('game_source');
        return (saved && GAME_DATA_SOURCES[saved]) ? saved : 'Vanilla';
    }

    function export_config() {
        try {
            const payload = buildExportPayload({
                storage: {getItem: persistGet},
                version: import.meta.env.VITE_APP_VERSION,
            });
            const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            const a = document.createElement('a');
            a.href = url;
            a.download = `dsp-calc-config-${stamp}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            set_msg({type: 'success', text: `已导出 ${Object.keys(payload.data).length} 项配置。`});
        } catch {
            set_msg({type: 'danger', text: '导出失败，请重试。'});
        }
    }

    async function import_config(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';   // 清空 value，允许重复选择同一个文件
        if (!file) return;
        if (sandbox) {
            set_msg({type: 'danger', text: '子窗口不支持导入配置，请在主窗口操作。'});
            return;
        }
        let text;
        try {
            text = await file.text();
        } catch {
            set_msg({type: 'danger', text: '文件读取失败，导入已取消。'});
            return;
        }
        const parsed = parseImportFile(text);
        if (!parsed.ok) {
            set_msg({type: 'danger', text: parsed.error});
            return;
        }

        const result = validateImport(parsed.payload, {
            current_source: current_source(),
            recipe_count_of: (name) => (GAME_DATA_SOURCES[name]
                ? get_game_data(name).recipe_data.length : undefined),
            item_names_of: (name) => (GAME_DATA_SOURCES[name]
                ? new Set(Object.keys(get_game_data(name).item_icon_name)) : undefined),
            current_auto_scheme: safe_parse_json(persistGet('auto_scheme')) || {},
        });
        if (!result.ok) {
            set_msg({type: 'danger', text: result.error});
            return;
        }
        if (result.warnings.length > 0
            && !confirm(`导入提示：\n\n${result.warnings.join('\n')}\n\n是否继续导入其余项目？`)) {
            return;
        }
        const list = result.entries.map(([key]) => key).join('、');
        if (!confirm(`即将导入：${list}\n\n按配置项合并——文件里有哪项就替换哪项，其余保持不变。`
            + `导入后页面会刷新，是否继续？`)) {
            return;
        }
        applyImport(result.entries, persistSet);
        window.location.reload();
    }

    return <div className="d-flex flex-wrap align-items-center gap-2 py-1">
        <button className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
                onClick={export_config}
                title="导出需求表 / 方案 / 设置 / 矿物可用量 / 原矿化 / 数据源 / 优化策略为 JSON 文件">
            <FaFileExport/>
            <span>导出配置</span>
        </button>
        <button className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
                onClick={() => file_ref.current && file_ref.current.click()}
                disabled={sandbox}
                title={sandbox ? '子窗口不支持导入配置，请在主窗口操作'
                    : '从 JSON 文件导入配置（按配置项合并，导入后自动刷新）'}>
            <FaFileImport/>
            <span>导入配置</span>
        </button>
        <input ref={file_ref} type="file" accept=".json,application/json"
               className="d-none" onChange={import_config}/>
        <small className="text-muted">
            导入按配置项合并；不含主题、依赖图位置、种子查看缓存
        </small>
        {msg && <small className={msg.type === 'danger' ? 'text-danger' : 'text-success'}>{msg.text}</small>}
    </div>;
}
