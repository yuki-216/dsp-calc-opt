import { getSeedQueryMode } from './seed_query_mode.js';

export function createSeedQueryService({storage, browserQuery, backendQuery}) {
    if (typeof browserQuery !== 'function' || typeof backendQuery !== 'function') {
        throw new TypeError('Seed query service requires browserQuery and backendQuery functions');
    }

    return {
        async querySeed(seedId, starNum, resourceIndex) {
            const mode = getSeedQueryMode(storage);
            if (mode === 'backend') {
                return backendQuery(seedId, starNum, resourceIndex);
            }
            if (mode === 'auto') {
                try {
                    return await backendQuery(seedId, starNum, resourceIndex);
                } catch {
                    return browserQuery(seedId, starNum, resourceIndex);
                }
            }
            return browserQuery(seedId, starNum, resourceIndex);
        },
    };
}
