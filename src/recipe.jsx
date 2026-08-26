import React from 'react';
import {ItemIcon} from './ui_components';

export function Recipe({recipe, compact}) {
    function findNonZeroPosition(num) {
        const numStr = num.toString();
        const dotIndex = numStr.indexOf('.');//1
        if (dotIndex === -1) {
            // 没有小数点，返回undefined
            return undefined;
        }
        // 寻找第一个不为0的数字的位置
        for (let i = dotIndex + 1; i < numStr.length; i++) {
            if (numStr[i] !== '0') {
                return i - dotIndex; // 返回小数点后的位置
            }
        }
        // 所有小数位都是0，返回undefined
        return undefined;
    }

    function item_to_doms([item, count]) {
        const count_used = count >= 1
            ? Math.round(count * 100) / 100
            : count.toFixed(findNonZeroPosition(count) + 2).replace(/\.?0+$/, '');
        return <React.Fragment key={item}>
            <ItemIcon item={item} size={28}/>
            <span className="me-1 ssmall align-self-end">{count_used}</span>
        </React.Fragment>;
    }

    const input_entries = Object.entries(recipe["原料"]);
    const input_doms = input_entries.map(item_to_doms);
    const output_doms = Object.entries(recipe["产物"]).map(item_to_doms);
    //时间向上取整，因为工厂也是向上取整
    const time = Math.ceil(recipe["时间"] * 100) / 100;

    // 精简模式(mobile/narrow/compact)统一:第一个原料图标 + 配方时间(裸数字,无 +N、无括号/秒)
    if (compact !== "full") {
        const icon_size = compact === "mobile" ? 20 : compact === "narrow" ? 22 : 24;
        if (input_entries.length === 0) {
            return <small className="text-recipe-time">{time}</small>;
        }
        return <span className="d-inline-flex align-items-center gap-1">
            <ItemIcon item={input_entries[0][0]} size={icon_size}/>
            <small className="text-recipe-time ssmall" style={{flexShrink: 0}}>{time}</small>
        </span>;
    }

    // full 模式：完整显示
    return <span className="d-inline-flex">
        {input_doms.length > 0 && <>
            {input_doms}
            <span className="me-1 position-relative"
                  style={{fontSize: "32px", lineHeight: "20px"}}>
                &#10230;
                <span className="position-absolute text-center text-recipe-time"
                      style={{left: 0, width: "100%", top: "50%", fontSize: "12px"}}>
                    {time}s
                </span>
            </span>
        </>}
        {output_doms}

        {input_doms.length === 0 && <small className="ms-1 align-self-end text-recipe-time">
            ({time}s)
        </small>}
    </span>;
}

export function HorizontalMultiButtonSelect({choice, options, onChange, no_gap, className, icon_size, rounded}) {
    let gap_class = no_gap ? "" : "gap-1";
    let resolved_icon_size = icon_size || 32;
    let option_doms = options.map(({value, label, item_icon, className: optClass}) => {
        let selected = choice == value;
        let selected_class = selected ? "bg-selected" : "bg-unselected";
        // insert 1px border if [no_gap == true]
        let gap_class = no_gap ? "border-between border-body" : "";
        let rounded_class = rounded ? "border rounded" : "";
        let bg_class = rounded ? (selected ? "bg-success text-white" : "bg-secondary text-white-50") : "";
        return <div key={value}
                    className={`py-1 px-1 text-nowrap d-flex align-items-center justify-content-center cursor-pointer small
                ${selected_class} ${gap_class} ${rounded_class} ${bg_class} ${optClass || ""}`}
                    style={rounded && label && !item_icon ? {minWidth: `${resolved_icon_size + 8}px`} : {}}
                    onClick={() => onChange(value)}
        >{item_icon && <ItemIcon item={item_icon} size={resolved_icon_size}/>}
            {label && (typeof label === 'string' ? <span className="mx-1">{label}</span> : label)}
        </div>;
    })

    return <div className={`d-flex ${gap_class} ${className || ""}`}>{option_doms}</div>;
}
