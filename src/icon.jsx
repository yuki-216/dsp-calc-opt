import {useContext} from 'react';
import {GlobalStateContext} from './contexts';
import {get_icon_by_item} from "./GameData.jsx";

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
