import { getHubSignerEnv } from "./iotaEnv";
import { logger } from "../logger";

type RegistryTables = {
  byGs1TableId: string;
  byAltTableId: string;
};

let _tablesP: Promise<RegistryTables> | null = null;

function normalizeObjectId(id: string): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  return s.startsWith("0x") ? s : `0x${s}`;
}

function extractTableId(regObj: any, fieldName: "by_gs1" | "by_alt"): string {
  const fields = regObj?.data?.content?.fields ?? regObj?.content?.fields;
  const table = fields?.[fieldName];
  const id =
    table?.fields?.id?.id ||
    table?.fields?.id?.fields?.id ||
    table?.id?.id ||
    table?.id;
  return normalizeObjectId(String(id ?? ""));
}

async function getRegistryTables(): Promise<RegistryTables> {
  if (_tablesP) return _tablesP;

  _tablesP = (async () => {
    const env = await getHubSignerEnv();
    const reg: any = await (env.client as any).getObject?.({
      id: env.gs1RegistryId,
      options: { showContent: true },
    });

    const byGs1TableId = extractTableId(reg, "by_gs1");
    const byAltTableId = extractTableId(reg, "by_alt");

    if (!byGs1TableId) throw new Error("Cannot extract by_gs1 table id from GS1Registry");
    if (!byAltTableId) {
      // Older packages may not have by_alt yet; keep empty string, caller will handle.
      logger.warn({ gs1RegistryId: env.gs1RegistryId }, "GS1Registry has no by_alt table id (old package?)");
    }

    return { byGs1TableId, byAltTableId };
  })();

  return _tablesP;
}

function extractIdFromTableEntry(obj: any): string | null {
  const v = obj?.data?.content?.fields?.value ?? obj?.content?.fields?.value;
  if (!v) return null;
  if (typeof v === "string") return normalizeObjectId(v);

  // Common shapes: { id: '0x..' } or { id: { id: '0x..' } }
  if (typeof v?.id === "string") return normalizeObjectId(v.id);
  if (typeof v?.id?.id === "string") return normalizeObjectId(v.id.id);

  // Sometimes nested under fields
  if (typeof v?.fields?.id === "string") return normalizeObjectId(v.fields.id);
  if (typeof v?.fields?.id?.id === "string") return normalizeObjectId(v.fields.id.id);

  return null;
}

async function tableGetStringToId(tableId: string, key: string): Promise<string | null> {
  const env = await getHubSignerEnv();
  const k = String(key ?? "").trim();
  if (!k) return null;

  const client: any = env.client as any;
  // NOTE: IOTA RPC/SDK versions differ on how they expect Move `0x1::string::String`
  // for dynamic field names. We try multiple encodings and call signatures.
  const namePlain = { type: "0x1::string::String", value: k };
  const bytesArr = Array.from(Buffer.from(k, "utf8"));
  const nameStruct = { type: "0x1::string::String", value: { bytes: bytesArr } };

  async function tryGetDynamicFieldObject(name: any): Promise<any> {
    // Most recent SDKs use an object parameter.
    try {
      return await client.getDynamicFieldObject({ parentId: tableId, name });
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).toString();
      // Some SDKs use positional args.
      if (/invalid\s*params/i.test(msg) || /expected\s*array|expected\s*object/i.test(msg)) {
        // keep trying below
      } else {
        throw e;
      }
    }

    // Positional-args fallback.
    return await client.getDynamicFieldObject(tableId, name);
  }

  try {
    if (typeof client.getDynamicFieldObject === "function") {
      try {
        const r1 = await tryGetDynamicFieldObject(namePlain);
        const id1 = extractIdFromTableEntry(r1);
        if (id1) return id1;
      } catch (e: any) {
        const msg = (e?.message ?? String(e)).toString();
        // If encoding mismatch, try the struct representation.
        if (!/invalid\s*params/i.test(msg)) throw e;
      }

      try {
        const r2 = await tryGetDynamicFieldObject(nameStruct);
        const id2 = extractIdFromTableEntry(r2);
        if (id2) return id2;
      } catch (e: any) {
        const msg = (e?.message ?? String(e)).toString();
        // If still invalid params, fall back to listing dynamic fields.
        if (!/invalid\s*params/i.test(msg)) throw e;
      }
    }

    // Fallback: list dynamic fields and match name value (slower)
    if (typeof client.getDynamicFields === "function") {
      async function tryGetDynamicFields(cursor: any) {
        try {
          return await client.getDynamicFields({ parentId: tableId, cursor, limit: 100 });
        } catch (e: any) {
          const msg = (e?.message ?? String(e)).toString();
          if (/invalid\s*params/i.test(msg) || /expected\s*array|expected\s*object/i.test(msg)) {
            // positional-args fallback (best-effort)
            return await client.getDynamicFields(tableId, cursor, 100);
          }
          throw e;
        }
      }
      let cursor: any = null;
      for (let i = 0; i < 10; i++) {
        const page = await tryGetDynamicFields(cursor);
        const data: any[] = page?.data ?? [];
        const hit = data.find((x) => x?.name?.value === k);
        if (hit?.objectId) {
          const obj = await client.getObject({ id: hit.objectId, options: { showContent: true } });
          return extractIdFromTableEntry(obj);
        }
        const hasNext = !!page?.hasNextPage;
        cursor = page?.nextCursor ?? null;
        if (!hasNext || !cursor) break;
      }
      return null;
    }

    throw new Error("IotaClient does not expose getDynamicFieldObject/getDynamicFields");
  } catch (e: any) {
    // Not found errors are expected; return null.
    const msg = (e?.message ?? String(e)).toString();
    const notFound = /not\s*found|does\s*not\s*exist|unknown\s*object|dynamic\s*field/i.test(msg);
    if (notFound) return null;
    throw e;
  }
}

export function makeSgtinAltKey(gtin: string, serial: string): string {
  return `sgtin:${String(gtin ?? "").trim()}.${String(serial ?? "").trim()}`;
}

export async function resolveResourceIdByCanonicalId(canonicalId: string): Promise<string | null> {
  const { byGs1TableId } = await getRegistryTables();
  return tableGetStringToId(byGs1TableId, canonicalId);
}

export async function resolveResourceIdByAltKey(altKey: string): Promise<string | null> {
  const { byAltTableId } = await getRegistryTables();
  if (!byAltTableId) return null;
  return tableGetStringToId(byAltTableId, altKey);
}

export async function resolveResourceIdByKey(key: { epcUri?: string; gtin?: string; serial?: string }): Promise<string | null> {
  if (key.epcUri) {
    const r = await resolveResourceIdByCanonicalId(key.epcUri);
    if (r) return r;
  }
  if (key.gtin && key.serial) {
    const altKey = makeSgtinAltKey(key.gtin, key.serial);
    const r = await resolveResourceIdByAltKey(altKey);
    if (r) return r;
  }
  return null;
}
