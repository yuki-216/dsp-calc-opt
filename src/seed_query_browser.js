let worker;
let nextRequestId = 1;
const pendingRequests = new Map();

function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./seed_query_worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            const pending = pendingRequests.get(data.requestId);
            if (!pending) return;
            pendingRequests.delete(data.requestId);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(data.result);
        };
        worker.onerror = (event) => {
            const error = new Error(event.message || '浏览器种子计算线程启动失败');
            for (const pending of pendingRequests.values()) pending.reject(error);
            pendingRequests.clear();
            worker = null;
        };
    }
    return worker;
}

export function getBrowserSeedData(seedId, starNum, resourceIndex) {
    return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        pendingRequests.set(requestId, { resolve, reject });
        const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href;
        getWorker().postMessage({ requestId, seedId, starNum, resourceIndex, baseUrl });
    });
}

export function disposeBrowserSeedWorker() {
    worker?.terminate();
    worker = null;
    for (const pending of pendingRequests.values()) {
        pending.reject(new Error('浏览器种子计算线程已关闭'));
    }
    pendingRequests.clear();
}
