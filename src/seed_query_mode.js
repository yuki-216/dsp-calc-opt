const STORAGE_KEY = 'seed-query-mode';
const VALID_MODES = new Set(['browser', 'backend', 'auto']);

function getStorage(storage) {
    if (storage) return storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
}

function readValue(storage) {
    if (!storage) return null;
    if (typeof storage.getItem === 'function') return storage.getItem(STORAGE_KEY);
    return storage.get(STORAGE_KEY) ?? null;
}

function writeValue(storage, value) {
    if (!storage) return;
    if (typeof storage.setItem === 'function') {
        storage.setItem(STORAGE_KEY, value);
    } else {
        storage.set(STORAGE_KEY, value);
    }
}

function removeValue(storage) {
    if (!storage) return;
    if (typeof storage.removeItem === 'function') {
        storage.removeItem(STORAGE_KEY);
    } else {
        storage.delete(STORAGE_KEY);
    }
}

export function getSeedQueryMode(storage) {
    const value = readValue(getStorage(storage));
    return VALID_MODES.has(value) ? value : 'browser';
}

export function setSeedQueryMode(mode, storage) {
    if (!VALID_MODES.has(mode)) {
        throw new Error(`Invalid seed query mode: ${mode}`);
    }
    writeValue(getStorage(storage), mode);
    return mode;
}

export function resetSeedQueryMode(storage) {
    removeValue(getStorage(storage));
    return 'browser';
}

if (typeof window !== 'undefined') {
    window.setSeedQueryMode = (mode) => {
        const nextMode = setSeedQueryMode(mode);
        console.info(`Seed query mode: ${nextMode}`);
        return nextMode;
    };
    window.resetSeedQueryMode = () => {
        const nextMode = resetSeedQueryMode();
        console.info(`Seed query mode: ${nextMode}`);
        return nextMode;
    };
}

