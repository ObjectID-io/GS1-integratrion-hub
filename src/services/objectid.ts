import { Transaction } from "@iota/iota-sdk/transactions";
import type { ExecutionStatus } from "@iota/iota-sdk/client";

import { getHubSignerEnv } from "./iotaEnv";
import { USE_GAS_STATION, getGasStationCfg } from "./confGasStation";
import { singAndExecTx } from "./signAndExecTx";
import { parseEpcUrn } from "../utils/gs1";

// ---- public types ----

export type EnsureGs1TwinInput = {
  objectType: "gs1_serialized_trade_item"; // kept for API compatibility
  key: {
    epcUri?: string;
    gtin?: string;
    serial?: string;
  };
  immutable: Record<string, any>;
  mutablePatch?: Record<string, any>; // ignored in this Move package (kept for API compatibility)
};

export type AppendGs1EventInput = {
  objectId: string; // actually GS1Resource object id
  eventType:
    | "epcis_object_event"
    | "epcis_aggregation_event"
    | "epcis_transformation_event"
    | "epcis_association_event";
  immutable: Record<string, any>;
  mutable: Record<string, any>; // ignored (kept for API compatibility)
};

export type EnsureGs1TwinResult = { objectId: string };
export type AppendGs1EventResult = { txId: string; eventObjectId?: string | null };

// ---- helpers ----

function safeString(v: any): string {
  return String(v ?? "").trim();
}

function toMillis(isoOrMs: any): bigint {
  if (typeof isoOrMs === "number" && Number.isFinite(isoOrMs)) return BigInt(Math.trunc(isoOrMs));
  const s = safeString(isoOrMs);
  if (!s) return BigInt(Date.now());
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 0) return BigInt(Math.trunc(asNum));
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return BigInt(Date.now());
  return BigInt(ms);
}

function asStringValue(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function signAndExec(tx: Transaction): Promise<{ digest: string; effects: any }> {
  const env = await getHubSignerEnv();

  const gasStation = getGasStationCfg(env.network);
  const useGasStation = USE_GAS_STATION;

  // Keep the old default budget when the hub pays gas directly.
  // NOTE: a too-high budget can fail if the selected gas coin doesn't cover it.
  if (!useGasStation) {
    tx.setSender(env.address);
    tx.setGasBudget(10_000_000);
  }

  return await new Promise((resolve, reject) => {
    void singAndExecTx(env.network, env.client, gasStation, useGasStation, env.keypair, tx, {
      onSuccess: (result) =>
        resolve({ digest: String((result as any)?.digest ?? ""), effects: (result as any)?.effects }),
      onError: (err) => reject(err),
      onSettled: () => {},
    });
  });
}

function readExecutionStatus(effects: any): ExecutionStatus | undefined {
  return (effects?.status ?? effects?.effects?.status) as ExecutionStatus | undefined;
}

function listCreatedIds(effects: any): string[] {
  const created = effects?.created ?? effects?.effects?.created ?? [];
  const out: string[] = [];
  for (const c of created) {
    const id = c?.reference?.objectId || c?.reference?.object_id || c?.reference?.objectID || c?.objectId;
    if (id) out.push(String(id));
  }
  return out;
}

async function pickCreatedObjectIdByType(typeSuffix: string, effects: any): Promise<string | null> {
  const env = await getHubSignerEnv();
  const ids = listCreatedIds(effects);
  for (const id of ids) {
    try {
      const o: any = await (env.client as any).getObject?.({ id, options: { showType: true } });
      const t = (o?.data?.type ?? o?.data?.content?.type ?? "").toString();
      if (t.endsWith(typeSuffix)) return id;
    } catch {
      // ignore
    }
  }
  return ids.length ? ids[0] : null;
}

function buildExtensionVectors(immutable: Record<string, any>): { keys: string[]; values: string[] } {
  const known = new Set([
    "canonical_id",
    "id_level",
    "primary_key_type",
    "gtin",
    "serial",
    "serial_number",
    "lot",
    "lot_number",
    "expiry_date",
    "brand_owner_gln",
    "manufacturing_location_gln",
    "digital_link_uri",
    "epc_uri",
    "epcUri",
    "data_carrier",
    "dataCarrier",
  ]);

  const keys: string[] = [];
  const values: string[] = [];
  for (const [k, v] of Object.entries(immutable ?? {})) {
    if (known.has(k)) continue;
    keys.push(String(k));
    values.push(asStringValue(v));
  }
  return { keys, values };
}

function makeStringVec(tx: Transaction, values: string[]) {
  // Always provide the type so empty vectors are supported.
  const elements = (values ?? []).map((v) => tx.pure.string(String(v ?? "")));
  return (tx as any).makeMoveVec({ type: "0x1::string::String", elements });
}

// ---- constants (match Move module) ----

const KEY_UNKNOWN = 0;
const KEY_GTIN = 1;
const KEY_SGTIN = 2;
const KEY_SSCC = 3;
const KEY_GLN = 4;
const KEY_GIAI = 5;
const KEY_GRAI = 6;

const ID_LEVEL_CLASS = 0;
const ID_LEVEL_INSTANCE = 1;
const ID_LEVEL_LOT = 2;

// ---- public API ----

/**
 * Creates and registers a GS1Resource in oid_gs1::OIDGs1IHub.
 * This uses the field-based Move signature (no struct args):
 *   create_resource_registered(reg, credit_token, policy, controller_cap,
 *     canonical_id, id_level, primary_key_type,
 *     gtin, serial, lot, expiry_date,
 *     brand_owner_gln, manufacturing_location_gln,
 *     digital_link_uri, epc_uri, data_carrier,
 *     extension_keys, extension_values,
 *     clock)
 */
export async function ensureGs1Twin(input: EnsureGs1TwinInput): Promise<EnsureGs1TwinResult> {
  const env = await getHubSignerEnv();

  const epcUri = safeString(input.key.epcUri || input.immutable?.epc_uri);
  if (!epcUri) throw new Error("Missing epcUri");

  const parsed = parseEpcUrn(epcUri);

  const gtin = safeString(input.key.gtin ?? input.immutable?.gtin ?? (parsed.scheme === "sgtin" ? parsed.gtin14 : ""));
  const serial = safeString(
    input.key.serial ??
      input.immutable?.serial_number ??
      input.immutable?.serial ??
      (parsed.scheme === "sgtin" ? parsed.serial : ""),
  );

  const lot = safeString(input.immutable?.lot_number ?? input.immutable?.lot ?? "");
  const expiry = safeString(input.immutable?.expiry_date ?? input.immutable?.expiry ?? "");

  const brandOwnerGln = safeString(input.immutable?.brand_owner_gln ?? "");
  const mfgGln = safeString(input.immutable?.manufacturing_location_gln ?? "");
  const digitalLinkUri = safeString(input.immutable?.digital_link_uri ?? "");
  const dataCarrier = safeString(input.immutable?.data_carrier ?? input.immutable?.dataCarrier ?? "");

  // canonical_id is the registry key: choose epcUri for deterministic uniqueness.
  const canonicalId = safeString(input.immutable?.canonical_id ?? epcUri);

  // Heuristic classification
  const idLevel = serial ? ID_LEVEL_INSTANCE : gtin ? ID_LEVEL_CLASS : ID_LEVEL_CLASS;

  // Primary key type
  let primaryKeyType = KEY_UNKNOWN;
  if (parsed.scheme === "sgtin") primaryKeyType = KEY_SGTIN;
  else if (gtin) primaryKeyType = KEY_GTIN;
  else if (parsed.scheme === "sscc") primaryKeyType = KEY_SSCC;
  else if (parsed.scheme === "sgln") primaryKeyType = KEY_GLN;

  const { keys: extKeys, values: extValues } = buildExtensionVectors(input.immutable);

  const tx = new Transaction();
  const mod = `${env.oidGs1PackageId}::${env.gs1ModuleName}`;
  const target = `${mod}::create_resource_registered`;

  const extKeysVec = makeStringVec(tx, extKeys);
  const extValuesVec = makeStringVec(tx, extValues);

  tx.moveCall({
    target,
    arguments: [
      tx.object(env.gs1RegistryId),
      tx.object(env.creditTokenId),
      tx.object(env.creditPolicyId),
      tx.object(env.controllerCapId),
      tx.pure.string(canonicalId),
      tx.pure.u8(idLevel),
      tx.pure.u8(primaryKeyType),
      tx.pure.string(gtin),
      tx.pure.string(serial),
      tx.pure.string(lot),
      tx.pure.string(expiry),
      tx.pure.string(brandOwnerGln),
      tx.pure.string(mfgGln),
      tx.pure.string(digitalLinkUri),
      tx.pure.string(epcUri),
      tx.pure.string(dataCarrier),
      extKeysVec,
      extValuesVec,
      tx.object("0x6"),
    ],
  });

  const { effects } = await signAndExec(tx);
  const status = readExecutionStatus(effects);
  if (status && status.status !== "success") {
    throw new Error(String((status as any).error ?? "Transaction failed"));
  }

  // Multiple objects may be created (dynamic fields). Pick the GS1Resource by type.
  const resourceId = await pickCreatedObjectIdByType(`::${env.gs1ModuleName}::GS1Resource`, effects);
  if (!resourceId) throw new Error("GS1Resource created but resourceId not found in tx effects");

  return { objectId: resourceId };
}

/**
 * Appends an EPCIS event ON-CHAIN.
 * Exact Move signature used:
 *   append_event(credit_token, policy, controller_cap, res,
 *     event_time, event_id, event_type, action,
 *     biz_step_uri, disposition_uri, read_point_gln, biz_location_gln, parent_sscc,
 *     payload,
 *     clock)
 *
 * The Move function:
 * - updates the resource snapshot (current context + last event pointer)
 * - creates a GS1Event object and transfers it to the resource address (object-owned)
 */
export async function appendGs1Event(input: AppendGs1EventInput): Promise<AppendGs1EventResult> {
  const env = await getHubSignerEnv();

  // Optional sanity-check: ensure resource exists.
  const obj = await (env.client as any).getObject?.({ id: input.objectId, options: { showType: true } });
  if (!obj?.data?.type) {
    const err: any = new Error("GS1Resource not found");
    err.code = "object_not_found";
    throw err;
  }

  const mod = `${env.oidGs1PackageId}::${env.gs1ModuleName}`;

  const eventId = safeString(input.immutable?.event_id || input.immutable?.eventId || "");
  const eventTime = toMillis(input.immutable?.event_time || input.immutable?.eventTime);

  const action = safeString(input.immutable?.action || "OBSERVE");
  const bizStep = safeString(input.immutable?.biz_step_uri || input.immutable?.bizStep || "");
  const disposition = safeString(input.immutable?.disposition_uri || input.immutable?.disposition || "");
  const readPointGln = safeString(input.immutable?.read_point_gln || "");
  const bizLocationGln = safeString(input.immutable?.biz_location_gln || "");
  const parent = safeString(input.immutable?.parent_sscc || input.immutable?.parent_id || "");

  // Store the full event payload on-chain.
  // Keep it deterministic and JSON-encoded.
  const payload = JSON.stringify({ eventType: input.eventType, immutable: input.immutable, mutable: input.mutable });

  // Use a readable event_type on-chain.
  const eventTypeString =
    input.eventType === "epcis_object_event"
      ? "ObjectEvent"
      : input.eventType === "epcis_aggregation_event"
        ? "AggregationEvent"
        : input.eventType === "epcis_transformation_event"
          ? "TransformationEvent"
          : "AssociationEvent";

  const tx = new Transaction();
  tx.moveCall({
    target: `${mod}::append_event`,
    arguments: [
      tx.object(env.creditTokenId),
      tx.object(env.creditPolicyId),
      tx.object(env.controllerCapId),
      tx.object(input.objectId),
      tx.pure.u64(eventTime),
      tx.pure.string(eventId),
      tx.pure.string(eventTypeString),
      tx.pure.string(action),
      tx.pure.string(bizStep),
      tx.pure.string(disposition),
      tx.pure.string(readPointGln),
      tx.pure.string(bizLocationGln),
      tx.pure.string(parent),
      tx.pure.string(payload),
      tx.object("0x6"),
    ],
  });

  const { digest, effects } = await signAndExec(tx);
  const status = readExecutionStatus(effects);
  if (status && status.status !== "success") {
    throw new Error(String((status as any).error ?? "Transaction failed"));
  }

  const eventObjectId = await pickCreatedObjectIdByType(`::${env.gs1ModuleName}::GS1Event`, effects);
  return { txId: digest, eventObjectId };
}
