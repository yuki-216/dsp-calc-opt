import {useContext, useEffect, useRef, useState} from 'react';
import {FaTrash, FaPlusCircle, FaGem, FaIndustry} from 'react-icons/fa';
import {GameInfoContext, GlobalStateContext} from './contexts';
import {ItemIcon} from './ui_components';
import {ItemSelect} from './item_select';

function NeedItem({item, count, needs_list, set_needs_list}) {
    const [editing, setEditing] = useState(null);

    function edit_count(e) {
        let str = e.target.value;
        setEditing(str);
        let val = Number(str);
        if (!isNaN(val)) {
            set_needs_list(prev => ({...prev, [item]: val}));
        }
    }

    function blur_count() {
        setEditing(null);
    }

    function remove() {
        set_needs_list(prev => {
            const new_list = {...prev};
            delete new_list[item];
            return new_list;
        });
    }

    return <div className="d-inline-flex align-items-center">
        <ItemIcon item={item}/>
        <span className="ms-1 me-2">x</span>
        <div className="input-group input-group-sm w-fit d-inline-flex">
            <input type="text" className="form-control" style={{width: "6em", color: count < 0 ? 'green' : 'inherit'}}
                   value={editing !== null ? editing : count}
                   onChange={edit_count} onBlur={blur_count}/>
            <button className="btn btn-outline-danger d-inline-flex align-items-center" onClick={remove}>
                <FaTrash/>
            </button>
        </div>
    </div>;
}

export function NeedsList({needs_list, set_needs_list, set_show_ore_popup, set_show_building_popup}) {
    const global_state = useContext(GlobalStateContext);
    const count_ref = useRef(60);
    let item_data = global_state.item_data;
    let needs_doms = Object.entries(needs_list).map(([item, count]) => {
        return <NeedItem key={item} item={item} count={count} needs_list={needs_list} set_needs_list={set_needs_list}/>;
    });

    function add_need(item) {
        if (!(item in item_data)) {
            alert("请输入或选择正确的物品名字！");
            return;
        }
        let count = Number(count_ref.current.value);
        set_needs_list(prev => ({...prev, [item]: (prev[item] || 0) + count}));
    }

    const is_min = global_state.settings.is_time_unit_minute;

    return <>
        <div className="mt-3 d-flex align-items-center row-gap-1 flex-wrap">
            <small className="me-3 fw-bold text-nowrap">添加</small>
            <div className="input-group input-group-sm w-fit d-inline-flex">
                <input type="text" className="form-control" style={{width: "6em"}} ref={count_ref} defaultValue={60}/>
                <span className="input-group-text">/{is_min ? "min" : "sec"}</span>
                <ItemSelect text="添加" set_item={add_need}
                            icon={<FaPlusCircle className="compact-show"/>}/>
                <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 text-nowrap"
                        onClick={() => set_needs_list({})} title="清空">
                    <FaTrash/>
                    <span className="compact-hide-text">清空</span>
                </button>
            </div>
            <small className="text-muted ms-2">负数需求表示外部供给</small>

            {Object.keys(needs_list).length == 0 ||
                <div className="d-inline-flex flex-wrap gap-4 row-gap-0 align-items-center flex-grow-1">
                    {needs_doms}
                </div>
            }

            {/* 弹出面板按钮（narrow/mobile 下显示，compact/full 下 CSS 隐藏） */}
            <div className="summary-popup-btn ms-auto d-inline-flex gap-1">
                <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 summary-popup-btn-item"
                        onClick={() => set_show_ore_popup(s => !s)}
                        title="原矿化列表 & 多余产物">
                    <FaGem/>
                </button>
                <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 summary-popup-btn-item"
                        onClick={() => set_show_building_popup(s => !s)}
                        title="建筑统计 & 预估电力">
                    <FaIndustry/>
                </button>
            </div>
        </div>
    </>;
}

