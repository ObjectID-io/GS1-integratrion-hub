export function norm(v: any): string {
  return String(v ?? "").trim();
}

export function checkNetwork(n: string) {
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
export function getNetworkFromDIDstr(did: string): string {
  const s = norm(did);
  const parts = s.split(":");
  // did:iota:testnet:0x...
  if (parts.length >= 4 && parts[0] === "did" && parts[1] === "iota") {
    const maybeNet = parts[2];
    if (maybeNet === "testnet" || maybeNet === "mainnet") return maybeNet;
  }
  // did:iota:0x... (no explicit net)
  if (parts.length >= 3 && parts[0] === "did" && parts[1] === "iota") return "mainnet";
  return "";
}

/** Extract the object id portion from a DID string. */
export function getObjectFromDIDstr(did: string): string {
  const s = norm(did);
  const last = s.split(":").pop() ?? "";
  const hex = last.startsWith("0x") ? last : `0x${last}`;
  return hex;
}

let _wasmInitP: Promise<void> | null = null;
let _wasmModP: Promise<any> | null = null;

/**
 * Load identity-wasm module.
 * - In Node, prefer `@iota/identity-wasm/node`
 * - Fallback to `@iota/identity-wasm/web`
 */
export async function loadIdentityWasmModule(): Promise<any> {
  if (_wasmModP) return _wasmModP;
  _wasmModP = (async () => {
    return await import("@iota/identity-wasm/node");
  })();
  return _wasmModP;
}

/**
 * Identity wasm init helper. Some builds require an explicit init(); others are fine.
 * Safe to call multiple times.
 */
export async function initIdentityWasm() {
  if (_wasmInitP) return _wasmInitP;
  _wasmInitP = (async () => {
    const m: any = await loadIdentityWasmModule();
    const init = m?.init ?? m?.default?.init;
    if (typeof init === "function") {
      try {
        await init();
      } catch {
        // ignore: some builds are already initialized or don't need init
      }
    }
  })();
  return _wasmInitP;
}
