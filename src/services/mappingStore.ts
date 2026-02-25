/**
 * DEPRECATED: local mapping store removed.
 *
 * The hub now resolves GS1Resource IDs on-chain via GS1Registry (by_gs1 / by_alt).
 * This file is kept only to avoid build failures in case older code paths still
 * reference it. All functions are no-ops.
 */

export async function initMappingStore(): Promise<void> {
  // no-op
}

export type TwinKey = { epcUri?: string; gtin?: string; serial?: string };

export function resolveTwinObjectId(_key: TwinKey): string | null {
  // Always resolve on-chain now.
  return null;
}

export async function registerTwinMapping(_key: TwinKey, _objectId: string): Promise<void> {
  // no-op
}
