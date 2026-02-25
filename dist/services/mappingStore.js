"use strict";
/**
 * DEPRECATED: local mapping store removed.
 *
 * The hub now resolves GS1Resource IDs on-chain via GS1Registry (by_gs1 / by_alt).
 * This file is kept only to avoid build failures in case older code paths still
 * reference it. All functions are no-ops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMappingStore = initMappingStore;
exports.resolveTwinObjectId = resolveTwinObjectId;
exports.registerTwinMapping = registerTwinMapping;
async function initMappingStore() {
    // no-op
}
function resolveTwinObjectId(_key) {
    // Always resolve on-chain now.
    return null;
}
async function registerTwinMapping(_key, _objectId) {
    // no-op
}
//# sourceMappingURL=mappingStore.js.map