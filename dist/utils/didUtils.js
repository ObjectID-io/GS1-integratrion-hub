"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.norm = norm;
exports.checkNetwork = checkNetwork;
exports.getNetworkFromDIDstr = getNetworkFromDIDstr;
exports.getObjectFromDIDstr = getObjectFromDIDstr;
exports.loadIdentityWasmModule = loadIdentityWasmModule;
exports.initIdentityWasm = initIdentityWasm;
function norm(v) {
    return String(v ?? "").trim();
}
function checkNetwork(n) {
    const s = norm(n).toLowerCase();
    if (s !== "mainnet" && s !== "testnet") {
        throw new Error(`Invalid network: ${n}`);
    }
}
/**
 * Best-effort network extraction from a DID string.
 * Supports:
 * - did:iota:0x...
 * - did:iota:mainnet:0x...
 * - did:iota:testnet:0x...
 */
function getNetworkFromDIDstr(did) {
    const s = norm(did);
    const parts = s.split(":");
    // did:iota:testnet:0x...
    if (parts.length >= 4 && parts[0] === "did" && parts[1] === "iota") {
        const maybeNet = parts[2];
        if (maybeNet === "testnet" || maybeNet === "mainnet")
            return maybeNet;
    }
    // did:iota:0x... (no explicit net)
    if (parts.length >= 3 && parts[0] === "did" && parts[1] === "iota")
        return "mainnet";
    return "";
}
/** Extract the object id portion from a DID string. */
function getObjectFromDIDstr(did) {
    const s = norm(did);
    const last = s.split(":").pop() ?? "";
    const hex = last.startsWith("0x") ? last : `0x${last}`;
    return hex;
}
let _wasmInitP = null;
let _wasmModP = null;
/**
 * Load identity-wasm module.
 * - In Node, prefer `@iota/identity-wasm/node`
 * - Fallback to `@iota/identity-wasm/web`
 */
async function loadIdentityWasmModule() {
    if (_wasmModP)
        return _wasmModP;
    _wasmModP = (async () => {
        return await Promise.resolve().then(() => __importStar(require("@iota/identity-wasm/node")));
    })();
    return _wasmModP;
}
/**
 * Identity wasm init helper. Some builds require an explicit init(); others are fine.
 * Safe to call multiple times.
 */
async function initIdentityWasm() {
    if (_wasmInitP)
        return _wasmInitP;
    _wasmInitP = (async () => {
        const m = await loadIdentityWasmModule();
        const init = m?.init ?? m?.default?.init;
        if (typeof init === "function") {
            try {
                await init();
            }
            catch {
                // ignore: some builds are already initialized or don't need init
            }
        }
    })();
    return _wasmInitP;
}
//# sourceMappingURL=didUtils.js.map