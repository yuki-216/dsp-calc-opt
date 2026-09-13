/**
 * 从 dsp-calc 仓库(multi-mods 分支)下载「星环」(OrbitalRing) mod 的数据文件和图标
 *
 * - data/OrbitalRing.json        → 游戏数据(物品+配方)
 * - icon/OrbitalRing/*.png       → 新增物品图标(文件名 = 物品的 IconName)
 *
 * 与创世之书脚本的两点差别：
 *  1. 数据在 multi-mods 分支的 src/engine/data/raw/ 下，且文件名带版本号；
 *  2. 图标在 src/ui/components/icons/assets/<Mod>/ 下，不是仓库根的 icon/ 目录。
 * 共享物品沿用原版拉丁 IconName(如 iron-plate)，不重复下载——Icon 组件有原版回退链。
 *
 * 运行: node scripts/download_orbitalring.cjs
 */
const fs = require('fs');
const path = require('path');

const REPO = 'DSPCalculator/dsp-calc';
const BRANCH = 'multi-mods';
const MOD = 'OrbitalRing';
const VERSION = '1.0.7';
const REMOTE_DATA = `src/engine/data/raw/${MOD}${VERSION}.json`;
const REMOTE_ICON_DIR = `src/ui/components/icons/assets/${MOD}`;
const LOCAL_ICON_DIR = `icon/${MOD}`;
const DATA_DIR = 'data';

// 并发下载数量
const CONCURRENCY = 8;

async function fetchJson(url) {
    const res = await fetch(url, {headers: {'User-Agent': 'dsp-calc-opt'}});
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
}

async function fetchBuffer(url, retries = 2) {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {headers: {'User-Agent': 'dsp-calc-opt'}});
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        if (attempt >= retries) throw new Error(`HTTP ${res.status}: ${url}`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
}

async function listIconFiles() {
    // 一次 Trees API 请求列出全部文件,避免逐文件调目录 API 触发未认证限流
    const tree = await fetchJson(
        `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    return (tree.tree || [])
        .filter(e => e.type === 'blob'
            && e.path.startsWith(REMOTE_ICON_DIR + '/')
            && e.path.endsWith('.png'))
        .map(e => path.basename(e.path));
}

async function downloadWithLimit(urls, destDir) {
    fs.mkdirSync(destDir, {recursive: true});
    let done = 0, failed = 0;
    const queue = [...urls];
    async function worker() {
        while (queue.length > 0) {
            const {url, name} = queue.shift();
            try {
                const buf = await fetchBuffer(url);
                if (buf.length < 100) throw new Error('too small, likely an error page');
                fs.writeFileSync(path.join(destDir, name), buf);
                done++;
            } catch (e) {
                failed++;
                console.error(`  ✗ ${name}: ${e.message}`);
            }
        }
    }
    await Promise.all(Array.from({length: CONCURRENCY}, worker));
    return {done, failed};
}

async function main() {
    console.log(`[1/3] 列出 ${REMOTE_ICON_DIR}/ 下的图标文件...`);
    const iconNames = await listIconFiles();
    console.log(`  找到 ${iconNames.length} 个 PNG`);

    console.log('[2/3] 下载图标...');
    const iconUrls = iconNames.map(name => ({
        url: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${REMOTE_ICON_DIR}/${encodeURIComponent(name)}`,
        name,
    }));
    const {done, failed} = await downloadWithLimit(iconUrls, path.join(__dirname, '..', LOCAL_ICON_DIR));
    console.log(`  完成 ${done} 个,失败 ${failed} 个`);

    console.log(`[3/3] 下载数据文件 data/${MOD}.json ...`);
    const jsonBuf = await fetchBuffer(
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${REMOTE_DATA}`);
    let jsonText = jsonBuf.toString('utf8');
    // 去 BOM
    if (jsonText.charCodeAt(0) === 0xFEFF) jsonText = jsonText.slice(1);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
        console.log(`  items=${parsed.items?.length ?? '?'}, recipes=${parsed.recipes?.length ?? '?'}`);
    } catch (e) {
        console.error('  ✗ 数据文件不是合法 JSON:', e.message);
        process.exit(1);
    }
    // 自洽性:配方引用的物品 ID 必须都能在 items 里找到
    const ids = new Set(parsed.items.map(i => i.ID));
    const missing = new Set();
    for (const r of parsed.recipes) {
        for (const id of [...r.Items, ...r.Results]) if (!ids.has(id)) missing.add(id);
    }
    if (missing.size > 0) {
        console.error(`  ✗ 有 ${missing.size} 个物品 ID 被配方引用但不在 items 中:`, [...missing].slice(0, 10));
        process.exit(1);
    }
    console.log('  自洽性检查通过(配方引用的物品 ID 均存在)');
    fs.writeFileSync(path.join(__dirname, '..', DATA_DIR, `${MOD}.json`), jsonText, 'utf8');

    console.log('\n完成。若图标有失败项,请重跑本脚本。');
}

main().catch(e => {
    console.error('运行失败:', e.message);
    process.exit(1);
});
