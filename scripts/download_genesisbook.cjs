/**
 * 从 dsp-calc 仓库下载创世之书(GenesisBook)mod 的数据文件和图标
 *
 * - data/GenesisBook.json   → 游戏数据(物品+配方)
 * - icon/GenesisBook/*.png  → 新增物品图标(中文文件名,约100个)
 *
 * 运行: node scripts/download_genesisbook.cjs
 */
const fs = require('fs');
const path = require('path');

const REPO = 'DSPCalculator/dsp-calc';
const BRANCH = 'main';
const ICON_DIR = 'icon/GenesisBook';
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
        .filter(e => e.type === 'blob' && e.path.startsWith(ICON_DIR + '/') && e.path.endsWith('.png'))
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
    console.log(`[1/3] 列出 ${ICON_DIR}/ 下的图标文件...`);
    const iconNames = await listIconFiles();
    console.log(`  找到 ${iconNames.length} 个 PNG`);

    console.log('[2/3] 下载图标...');
    const iconUrls = iconNames.map(name => ({
        url: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ICON_DIR}/${encodeURIComponent(name)}`,
        name,
    }));
    const {done, failed} = await downloadWithLimit(iconUrls, path.join(__dirname, '..', ICON_DIR));
    console.log(`  完成 ${done} 个,失败 ${failed} 个`);

    console.log('[3/3] 下载数据文件 data/GenesisBook.json ...');
    const jsonBuf = await fetchBuffer(
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/GenesisBook.json`);
    let jsonText = jsonBuf.toString('utf8');
    // 去 BOM
    if (jsonText.charCodeAt(0) === 0xFEFF) jsonText = jsonText.slice(1);
    // 校验 JSON 合法性
    try {
        const parsed = JSON.parse(jsonText);
        console.log(`  items=${parsed.items?.length ?? '?'}, recipes=${parsed.recipes?.length ?? '?'}`);
    } catch (e) {
        console.error('  ✗ 数据文件不是合法 JSON:', e.message);
        process.exit(1);
    }
    fs.writeFileSync(path.join(__dirname, '..', DATA_DIR, 'GenesisBook.json'), jsonText, 'utf8');

    console.log('\n完成。若图标有失败项,请重跑本脚本。');
}

main().catch(e => {
    console.error('运行失败:', e.message);
    process.exit(1);
});
