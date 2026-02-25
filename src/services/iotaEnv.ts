import { getFullnodeUrl, IotaClient } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";

import { config } from "../config";
import { logger } from "../logger";

export type HubSignerEnv = {
  network: string;
  client: IotaClient;
  keypair: Ed25519Keypair;
  address: string;

  // Core ObjectID package (Move package id)
  oidCreditPackageId: string;
  // GS1 helper package (Move package id)
  oidGs1PackageId: string;

  // Shared GS1Registry object id
  gs1RegistryId: string;

  // Move module name that hosts the GS1 structs/functions (derived from GS1Registry type)
  // Examples: "gs1_registry" or "OIDGs1IHub" (depending on the deployed package)
  gs1ModuleName: string;

  // On-chain objects the hub needs to spend credits and authorize operations
  creditTokenId: string;
  controllerCapId: string;
  creditPolicyId: string;
};

const DEFAULTS = {
  testnet: {
    oidCreditPackageId: "0x79857c1738f31d70165149678ae051d5bffbaa26dbb66a25ad835e09f2180ae5",
  },
  mainnet: {
    oidCreditPackageId: "0xc6b77b8ab151fda5c98b544bda1f769e259146dc4388324e6737ecb9ab1a7465",
  },
} as const;

function strip0x(s: string): string {
  const t = String(s ?? "").trim();
  return t.toLowerCase().startsWith("0x") ? t.slice(2) : t;
}

export function normalizeSeedHex(seedHex: string): string {
  const t = String(seedHex ?? "").trim();
  const s = strip0x(t);
  if (!/^[0-9a-f]{64}$/i.test(s)) throw new Error("OID_SEED_HEX must be a 32-byte hex string (64 hex chars)");

  // iota-sdk expects the seed as a string (same as the stateless server code).
  // Preserve 0x prefix if the user provided it.
  const normalized = s.toLowerCase();
  return t.toLowerCase().startsWith("0x") ? `0x${normalized}` : normalized;
}

function normalizePackageId(id: string): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  return s.startsWith("0x") ? s : `0x${s}`;
}

function normalizeObjectId(id: string): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  return s.startsWith("0x") ? s : `0x${s}`;
}

function guessOidCreditPackageId(network: string): string {
  const n = network === "testnet" ? "testnet" : "mainnet";
  return DEFAULTS[n].oidCreditPackageId;
}

function asObjectId(row: any): string | null {
  return row?.data?.objectId || row?.data?.object_id || row?.node?.address || row?.address || row?.objectId || null;
}

function asType(row: any): string {
  return (
    row?.data?.type ||
    row?.data?.type?.repr ||
    row?.data?.content?.type ||
    row?.data?.content?.type?.repr ||
    row?.node?.asMoveObject?.contents?.type?.repr ||
    ""
  ).toString();
}

function extractGs1ModuleNameFromType(typeStr: string): string | null {
  const t = String(typeStr ?? "").trim();
  // Typical fully-qualified Move type: 0x<package>::<module>::GS1Registry
  const m = t.match(/::([A-Za-z0-9_]+)::GS1Registry\b/);
  return m?.[1] ?? null;
}

async function listOwnedObjects(client: IotaClient, owner: string, limit = 50): Promise<any[]> {
  const out: any[] = [];
  let cursor: any = null;

  // We keep paging a few times to be robust, but stop early.
  for (let i = 0; i < 10; i++) {
    const r = await (client as any).getOwnedObjects?.({
      owner,
      cursor,
      limit,
      options: { showType: true, showContent: false, showOwner: false },
    });
    const data: any[] = r?.data ?? r?.objects ?? [];
    out.push(...data);
    cursor = r?.nextCursor ?? r?.pageInfo?.endCursor ?? null;
    const hasNext = !!(r?.hasNextPage ?? r?.pageInfo?.hasNextPage);
    if (!hasNext || !cursor) break;
  }
  return out;
}

async function mustMatchObjectType(client: IotaClient, id: string, expected: RegExp, label: string) {
  const r: any = await (client as any).getObject?.({ id, options: { showType: true } });
  const t = (r?.data?.type ?? r?.data?.content?.type ?? "").toString();
  if (!t || !expected.test(t)) {
    throw new Error(`${label} has unexpected type: ${t || "<empty>"}`);
  }
}

let _envP: Promise<HubSignerEnv> | null = null;

/**
 * Bootstraps the mono-tenant signer env.
 * - Derives keypair from OID_SEED_HEX
 * - Auto-discovers credit token + controller cap owned by the signer
 * - Discovers the credit policy object via GraphQL (or uses override)
 */
export async function getHubSignerEnv(): Promise<HubSignerEnv> {
  if (_envP) return _envP;

  _envP = (async () => {
    const network = (config.oidNetwork || "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet";

    // No discovery: core package id MUST be explicit, but keep a safe fallback for dev.
    const oidCreditPackageId = normalizePackageId(config.oidCreditPackageId) || guessOidCreditPackageId(network);
    const oidGs1PackageId = normalizePackageId(config.oidGs1PackageId);
    if (!oidGs1PackageId) throw new Error("Missing OID_GS1_PACKAGE_ID");

    const gs1RegistryId = normalizeObjectId(config.oidGs1RegistryId);
    if (!gs1RegistryId) throw new Error("Missing OID_GS1_REGISTRY_ID");

    const rpcUrl = (config.oidRpcUrl || "").trim() || getFullnodeUrl(network);
    const client = new IotaClient({ url: rpcUrl });

    const seedHex = normalizeSeedHex(config.oidSeedHex);
    const keypair = Ed25519Keypair.deriveKeypairFromSeed(seedHex);
    const address = keypair.toIotaAddress();

    // No auto-discovery: these MUST come from env.
    const creditTokenId = normalizeObjectId(config.oidCreditTokenId);
    const controllerCapId = normalizeObjectId(config.oidControllerCapId);
    const creditPolicyId = normalizeObjectId(config.oidCreditPolicyId);

    if (!creditTokenId) throw new Error("Missing OID_CREDIT_TOKEN_ID");
    if (!controllerCapId) throw new Error("Missing OID_CONTROLLER_CAP_ID");
    if (!creditPolicyId) throw new Error("Missing OID_CREDIT_POLICY_ID");

    // Resolve the GS1 Move module name from the registry object type.
    // This makes the hub resilient to Move module renames (e.g. gs1_registry vs OIDGs1IHub).
    let gs1ModuleName = "";
    try {
      const reg: any = await (client as any).getObject?.({ id: gs1RegistryId, options: { showType: true } });
      const t = (reg?.data?.type ?? reg?.data?.content?.type ?? "").toString();
      gs1ModuleName = extractGs1ModuleNameFromType(t) ?? "";
      if (!gs1ModuleName) {
        logger.warn({ gs1RegistryId, type: t }, "Cannot infer GS1 module name from registry type; will default later");
      }
    } catch (e: any) {
      logger.warn({ gs1RegistryId, err: e?.message ?? e }, "Unable to fetch GS1 registry object type");
    }

    // Safe fallback (legacy default)
    if (!gs1ModuleName) gs1ModuleName = "gs1_registry";

    // Type safety: ensure the 3 critical objects match the same ObjectID core package.
    await mustMatchObjectType(
      client,
      creditTokenId,
      new RegExp(`^0x2::token::Token<${oidCreditPackageId}::oid_credit::OID_CREDIT>$`, "i"),
      "OID_CREDIT_TOKEN_ID",
    );

    await mustMatchObjectType(
      client,
      creditPolicyId,
      new RegExp(`^0x2::token::TokenPolicy<${oidCreditPackageId}::oid_credit::OID_CREDIT>$`, "i"),
      "OID_CREDIT_POLICY_ID",
    );

    await mustMatchObjectType(
      client,
      controllerCapId,
      new RegExp(`^${oidCreditPackageId}::oid_identity::ControllerCap$`, "i"),
      "OID_CONTROLLER_CAP_ID",
    );

    logger.info(
      {
        network,
        rpcUrl,
        address,
        oidCreditPackageId,
        oidGs1PackageId,
        gs1RegistryId,
        gs1ModuleName,
        creditTokenId,
        controllerCapId,
        creditPolicyId,
      },
      "Hub signer initialized",
    );

    return {
      network,
      client,
      keypair,
      address,
      oidCreditPackageId,
      oidGs1PackageId,
      gs1RegistryId,
      gs1ModuleName,
      creditTokenId,
      controllerCapId,
      creditPolicyId,
    };
  })();

  return _envP;
}

/**
 * Useful for runtime troubleshooting.
 */
export async function debugListOwnedObjects(): Promise<{ address: string; objects: { id: string; type: string }[] }> {
  const env = await getHubSignerEnv();
  const list = await listOwnedObjects(env.client, env.address);
  const objects = list.map((row) => ({ id: String(asObjectId(row) ?? ""), type: asType(row) })).filter((x) => x.id);
  return { address: env.address, objects };
}
