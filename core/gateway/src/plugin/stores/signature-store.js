"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSignatureStore = void 0;
exports.createSignatureStore = createSignatureStore;
exports.createThoughtBuffer = createThoughtBuffer;
function createSignatureStore() {
    const MAX_ENTRIES = 500;
    const store = new Map();
    return {
        get: (key) => store.get(key),
        set: (key, value) => {
            // Evict oldest if full (FIFO-ish since Map iterates in insertion order)
            if (store.size >= MAX_ENTRIES && !store.has(key)) {
                const firstKey = store.keys().next().value;
                if (firstKey !== undefined) {
                    store.delete(firstKey);
                }
            }
            store.set(key, value);
        },
        has: (key) => store.has(key),
        delete: (key) => {
            store.delete(key);
        },
    };
}
function createThoughtBuffer() {
    const buffer = new Map();
    return {
        get: (index) => buffer.get(index),
        set: (index, text) => {
            buffer.set(index, text);
        },
        clear: () => buffer.clear(),
    };
}
exports.defaultSignatureStore = createSignatureStore();
//# sourceMappingURL=signature-store.js.map