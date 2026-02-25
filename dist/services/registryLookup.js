"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSgtinAltKey = makeSgtinAltKey;
exports.resolveResourceIdByCanonicalId = resolveResourceIdByCanonicalId;
exports.resolveResourceIdByAltKey = resolveResourceIdByAltKey;
exports.resolveResourceIdByKey = resolveResourceIdByKey;
const iotaEnv_1 = require("./iotaEnv");
const logger_1 = require("../logger");
let _tablesP = null;
function normalizeObjectId(id) {
    const s = String(id ?? "").trim();
    if (!s)
        return "";
    return s.startsWith("0x") ? s : `0x${s}`;
}
function extractTableId(regObj, fieldName) {
    const fields = regObj?.data?.content?.fields ?? regObj?.content?.fields;
    const table = fields?.[fieldName];
    const id = table?.fields?.id?.id ||
        table?.fields?.id?.fields?.id ||
        table?.id?.id ||
        table?.id;
    return normalizeObjectId(String(id ?? ""));
}
async function getRegistryTables() {
    if (_tablesP)
        return _tablesP;
    _tablesP = (async () => {
        const env = await (0, iotaEnv_1.getHubSignerEnv)();
        const reg = await env.client.getObject?.({
            id: env.gs1RegistryId,
            options: { showContent: true },
        });
        const byGs1TableId = extractTableId(reg, "by_gs1");
        const byAltTableId = extractTableId(reg, "by_alt");
        if (!byGs1TableId)
            throw new Error("Cannot extract by_gs1 table id from GS1Registry");
        if (!byAltTableId) {
            // Older packages may not have by_alt yet; keep empty string, caller will handle.
            logger_1.logger.warn({ gs1RegistryId: env.gs1RegistryId }, "GS1Registry has no by_alt table id (old package?)");
        }
        return { byGs1TableId, byAltTableId };
    })();
    return _tablesP;
}
function extractIdFromTableEntry(obj) {
    const v = obj?.data?.content?.fields?.value ?? obj?.content?.fields?.value;
    if (!v)
        return null;
    if (typeof v === "string")
        return normalizeObjectId(v);
    // Common shapes: { id: '0x..' } or { id: { id: '0x..' } }
    if (typeof v?.id === "string")
        return normalizeObjectId(v.id);
    if (typeof v?.id?.id === "string")
        return normalizeObjectId(v.id.id);
    // Sometimes nested under fields
    if (typeof v?.fields?.id === "string")
        return normalizeObjectId(v.fields.id);
    if (typeof v?.fields?.id?.id === "string")
        return normalizeObjectId(v.fields.id.id);
    return null;
}
async function tableGetStringToId(tableId, key) {
    const env = await (0, iotaEnv_1.getHubSignerEnv)();
    const k = String(key ?? "").trim();
    if (!k)
        return null;
    const client = env.client;
    // NOTE: IOTA RPC/SDK versions differ on how they expect Move `0x1::string::String`
    // for dynamic field names. We try multiple encodings and call signatures.
    const namePlain = { type: "0x1::string::String", value: k };
    const bytesArr = Array.from(Buffer.from(k, "utf8"));
    const nameStruct = { type: "0x1::string::String", value: { bytes: bytesArr } };
    async function tryGetDynamicFieldObject(name) {
        // Most recent SDKs use an object parameter.
        try {
            return await client.getDynamicFieldObject({ parentId: tableId, name });
        }
        catch (e) {
            const msg = (e?.message ?? String(e)).toString();
            // Some SDKs use positional args.
            if (/invalid\s*params/i.test(msg) || /expected\s*array|expected\s*object/i.test(msg)) {
                // keep trying below
            }
            else {
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
                if (id1)
                    return id1;
            }
            catch (e) {
                const msg = (e?.message ?? String(e)).toString();
                // If encoding mismatch, try the struct representation.
                if (!/invalid\s*params/i.test(msg))
                    throw e;
            }
            try {
                const r2 = await tryGetDynamicFieldObject(nameStruct);
                const id2 = extractIdFromTableEntry(r2);
                if (id2)
                    return id2;
            }
            catch (e) {
                const msg = (e?.message ?? String(e)).toString();
                // If still invalid params, fall back to listing dynamic fields.
                if (!/invalid\s*params/i.test(msg))
                    throw e;
            }
        }
        // Fallback: list dynamic fields and match name value (slower)
        if (typeof client.getDynamicFields === "function") {
            async function tryGetDynamicFields(cursor) {
                try {
                    return await client.getDynamicFields({ parentId: tableId, cursor, limit: 100 });
                }
                catch (e) {
                    const msg = (e?.message ?? String(e)).toString();
                    if (/invalid\s*params/i.test(msg) || /expected\s*array|expected\s*object/i.test(msg)) {
                        // positional-args fallback (best-effort)
                        return await client.getDynamicFields(tableId, cursor, 100);
                    }
                    throw e;
                }
            }
            let cursor = null;
            for (let i = 0; i < 10; i++) {
                const page = await tryGetDynamicFields(cursor);
                const data = page?.data ?? [];
                const hit = data.find((x) => x?.name?.value === k);
                if (hit?.objectId) {
                    const obj = await client.getObject({ id: hit.objectId, options: { showContent: true } });
                    return extractIdFromTableEntry(obj);
                }
                const hasNext = !!page?.hasNextPage;
                cursor = page?.nextCursor ?? null;
                if (!hasNext || !cursor)
                    break;
            }
            return null;
        }
        throw new Error("IotaClient does not expose getDynamicFieldObject/getDynamicFields");
    }
    catch (e) {
        // Not found errors are expected; return null.
        const msg = (e?.message ?? String(e)).toString();
        const notFound = /not\s*found|does\s*not\s*exist|unknown\s*object|dynamic\s*field/i.test(msg);
        if (notFound)
            return null;
        throw e;
    }
}
function makeSgtinAltKey(gtin, serial) {
    return `sgtin:${String(gtin ?? "").trim()}.${String(serial ?? "").trim()}`;
}
async function resolveResourceIdByCanonicalId(canonicalId) {
    const { byGs1TableId } = await getRegistryTables();
    return tableGetStringToId(byGs1TableId, canonicalId);
}
async function resolveResourceIdByAltKey(altKey) {
    const { byAltTableId } = await getRegistryTables();
    if (!byAltTableId)
        return null;
    return tableGetStringToId(byAltTableId, altKey);
}
async function resolveResourceIdByKey(key) {
    if (key.epcUri) {
        const r = await resolveResourceIdByCanonicalId(key.epcUri);
        if (r)
            return r;
    }
    if (key.gtin && key.serial) {
        const altKey = makeSgtinAltKey(key.gtin, key.serial);
        const r = await resolveResourceIdByAltKey(altKey);
        if (r)
            return r;
    }
    return null;
}
//# sourceMappingURL=registryLookup.js.map