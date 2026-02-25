"use strict";
/**
 * BCS encoder for the exact Move structs used by:
 *   0x...::OIDGs1IHub
 *
 * Passing a struct by-value to a Move call requires the argument to be BCS-encoded
 * exactly as the chain expects. Even tiny divergences lead to runtime errors like:
 *   "Invalid command argument ... cannot be instantiated from raw bytes".
 *
 * IMPORTANT:
 * Move std::string::String is NOT necessarily encoded like "bcs.string()" in every SDK flavor.
 * In Move it's a struct wrapper around UTF-8 bytes: { bytes: vector<u8> }.
 * We encode it explicitly as that struct to match on-chain layout.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeGS1ResourceCreate = encodeGS1ResourceCreate;
exports.encodeKeyValueStruct = encodeKeyValueStruct;
const bcs_1 = require("@iota/iota-sdk/bcs");
const te = new TextEncoder();
// ---- BCS Schemas (FIELD ORDER MUST MATCH MOVE DEFINITIONS) ----
// std::string::String { bytes: vector<u8> }
const MoveStringBcs = bcs_1.bcs.struct("std::string::String", {
    bytes: bcs_1.bcs.vector(bcs_1.bcs.u8()),
});
// KeyValue { key: String, value: String }
const KeyValueBcs = bcs_1.bcs.struct("KeyValue", {
    key: MoveStringBcs,
    value: MoveStringBcs,
});
// GS1ResourceCreate { ... }
const GS1ResourceCreateBcs = bcs_1.bcs.struct("GS1ResourceCreate", {
    canonical_id: MoveStringBcs,
    id_level: bcs_1.bcs.u8(),
    primary_key_type: bcs_1.bcs.u8(),
    gtin: MoveStringBcs,
    serial: MoveStringBcs,
    lot: MoveStringBcs,
    expiry_date: MoveStringBcs,
    brand_owner_gln: MoveStringBcs,
    manufacturing_location_gln: MoveStringBcs,
    digital_link_uri: MoveStringBcs,
    epc_uri: MoveStringBcs,
    data_carrier: MoveStringBcs,
    extensions: bcs_1.bcs.vector(KeyValueBcs),
});
function S(v) {
    // encode as { bytes: vector<u8> } with UTF-8 bytes
    const s = String(v ?? "");
    return { bytes: Array.from(te.encode(s)) };
}
/**
 * Encode `oid_gs1::OIDGs1IHub::GS1ResourceCreate`.
 * Returns a SerializedBcs instance (accepted by tx.pure).
 */
function encodeGS1ResourceCreate(args) {
    const idLevel = Number(args.id_level);
    const pk = Number(args.primary_key_type);
    if (!Number.isFinite(idLevel) || idLevel < 0 || idLevel > 255) {
        throw new Error(`id_level out of u8 range: ${args.id_level}`);
    }
    if (!Number.isFinite(pk) || pk < 0 || pk > 255) {
        throw new Error(`primary_key_type out of u8 range: ${args.primary_key_type}`);
    }
    return GS1ResourceCreateBcs.serialize({
        canonical_id: S(args.canonical_id),
        id_level: idLevel,
        primary_key_type: pk,
        gtin: S(args.gtin),
        serial: S(args.serial),
        lot: S(args.lot),
        expiry_date: S(args.expiry_date),
        brand_owner_gln: S(args.brand_owner_gln),
        manufacturing_location_gln: S(args.manufacturing_location_gln),
        digital_link_uri: S(args.digital_link_uri),
        epc_uri: S(args.epc_uri),
        data_carrier: S(args.data_carrier),
        extensions: (args.extensions ?? []).map((kv) => ({
            key: S(kv?.key),
            value: S(kv?.value),
        })),
    });
}
/** Encode `oid_gs1::OIDGs1IHub::KeyValue` */
function encodeKeyValueStruct(kv) {
    return KeyValueBcs.serialize({
        key: S(kv?.key),
        value: S(kv?.value),
    });
}
//# sourceMappingURL=moveBcs.js.map