"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twinRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const gs1_1 = require("../utils/gs1");
const objectid_1 = require("../services/objectid");
const registryLookup_1 = require("../services/registryLookup");
exports.twinRouter = (0, express_1.Router)();
const CreateTwinReq = zod_1.z.object({
    epcUri: zod_1.z.string().min(1),
    immutable: zod_1.z.record(zod_1.z.any()).optional(),
    mutablePatch: zod_1.z.record(zod_1.z.any()).optional(),
});
function baseObjectImmutable(epcUri) {
    const parsed = (0, gs1_1.parseEpcUrn)(epcUri);
    const gtin = parsed.scheme === "sgtin" ? parsed.gtin14 : undefined;
    const serial = parsed.scheme === "sgtin" ? parsed.serial : undefined;
    return {
        key: { epcUri, gtin, serial },
        immutable: {
            gtin: gtin ?? "",
            serial_number: serial ?? "",
            lot_number: "",
            expiry_date: "",
            brand_owner_gln: "",
            manufacturing_location_gln: "",
            digital_link_uri: "",
            epc_uri: epcUri,
            data_carrier: "",
        },
    };
}
// Create / register a GS1 twin explicitly
// Aliases: POST /twin, POST /gs1/twin
exports.twinRouter.options(["/twin", "/gs1/twin"], (_req, res) => {
    res
        .setHeader("Allow", "OPTIONS, POST")
        .setHeader("Access-Control-Allow-Methods", "OPTIONS, POST")
        .setHeader("Access-Control-Allow-Headers", "content-type")
        .status(204)
        .send();
});
exports.twinRouter.post(["/twin", "/gs1/twin"], async (req, res) => {
    const r = CreateTwinReq.safeParse(req.body);
    if (!r.success) {
        res.status(400).json({ error: "invalid_body" });
        return;
    }
    const epcUri = r.data.epcUri.trim();
    const { key, immutable } = baseObjectImmutable(epcUri);
    // Idempotent (on-chain): resolve via GS1Registry (canonical_id is epcUri).
    try {
        const existing = await (0, registryLookup_1.resolveResourceIdByCanonicalId)(epcUri);
        if (existing) {
            res.status(200).json({ objectId: existing, alreadyRegistered: true, key });
            return;
        }
    }
    catch (e) {
        console.error("[/twin] Registry lookup failed:", e?.stack ?? e);
        res.status(502).json({ error: "registry_lookup_failed", message: (e?.message ?? String(e)).toString() });
        return;
    }
    // Merge client-provided metadata.
    // This Move package stores strongly-typed GS1 fields + extensions; unknown fields become extensions.
    const mergedImmutable = { ...immutable, ...(r.data.immutable ?? {}) };
    // ignore legacy ObjectID fields if present
    delete mergedImmutable.creator_url;
    delete mergedImmutable.product_url;
    try {
        const created = await (0, objectid_1.ensureGs1Twin)({
            objectType: "gs1_serialized_trade_item",
            key,
            immutable: mergedImmutable,
            mutablePatch: r.data.mutablePatch ?? {},
        });
        res.status(201).json({ objectId: created.objectId, alreadyRegistered: false, key });
    }
    catch (e) {
        // expose useful diagnostics in server logs
        // (client still only gets message)
        console.error("[/twin] ObjectID create failed:", e?.stack ?? e);
        res.status(502).json({ error: "objectid_create_failed", message: (e?.message ?? String(e)).toString() });
    }
});
//# sourceMappingURL=twin.js.map