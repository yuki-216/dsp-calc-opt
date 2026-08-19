let modulePromise;
let assetBaseUrl;

function getAssetUrl(name, baseUrl = assetBaseUrl) {
    const base = baseUrl || new URL(import.meta.env.BASE_URL, self.location.origin).href;
    return new URL(name, base).href;
}

async function getModule(baseUrl) {
    if (!modulePromise) {
        assetBaseUrl = baseUrl;
        modulePromise = (async () => {
            const moduleUrl = getAssetUrl('search_seed.js');
            const wasmUrl = getAssetUrl('search_seed.wasm');
            const { default: createModule } = await import(moduleUrl);
            const wasmBinary = await fetch(wasmUrl).then(response => {
                if (!response.ok) throw new Error(`WASM 请求失败 (${response.status})`);
                return response.arrayBuffer();
            });
            const module = await createModule({
                instantiateWasm(imports, receiveInstance) {
                    WebAssembly.instantiate(wasmBinary, imports).then(result => {
                        receiveInstance(result.instance);
                    });
                    return {};
                },
            });
            module._init();
            return module;
        })();
    }
    return modulePromise;
}

self.onmessage = async ({ data }) => {
    const { requestId, seedId, starNum, resourceIndex, baseUrl } = data;
    try {
        const module = await getModule(baseUrl);
        const raw = module.ccall(
            'getSeedData',
            'string',
            ['number', 'number', 'number'],
            [seedId, starNum, resourceIndex],
        );
        const result = JSON.parse(raw);
        if (result.error) throw new Error(result.error);
        self.postMessage({ requestId, result });
    } catch (error) {
        self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
    }
};
