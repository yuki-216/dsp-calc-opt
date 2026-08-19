const {spawnSync} = require('node:child_process');
const path = require('node:path');
const process = require('node:process');

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'dsp_search_seed', 'cpp_source_code');
const glmRoot = process.env.GLM_ROOT;

if (!glmRoot) {
    process.stderr.write('缺少 GLM_ROOT 环境变量，请将 GLM 源码目录设置为 GLM_ROOT。\n');
    process.exit(1);
}

const sources = [
    'wasm_api.cpp',
    'check_seed.cpp',
    'check_seed_util.cpp',
    'astro_class.cpp',
    'static_value.cpp',
    'wasm_opencl_stub.cpp',
].map(file => path.join(sourceRoot, file));

const args = [
    ...sources,
    '-I', sourceRoot,
    '-I', glmRoot,
    '-DGLM_ENABLE_EXPERIMENTAL',
    '-std=c++20',
    '-O2',
    '-s', 'MODULARIZE=1',
    '-s', 'EXPORT_ES6=1',
    '-s', 'ENVIRONMENT=web,worker',
    '-s', 'ALLOW_MEMORY_GROWTH=1',
    '-s', "EXPORTED_FUNCTIONS=['_init','_getSeedData','_formatAmount','_getVeinName','_getStarTypeName','_getPlanetTypeName','_getResourceRate','_isSeedDataValid']",
    '-s', "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']",
    '-o', path.join(projectRoot, 'public', 'search_seed.js'),
];

const result = spawnSync('em++', args, {stdio: 'inherit', shell: process.platform === 'win32'});
if (result.error) {
    process.stderr.write(`无法启动 em++：${result.error.message}\n`);
    process.exit(1);
}
process.exit(result.status ?? 1);
