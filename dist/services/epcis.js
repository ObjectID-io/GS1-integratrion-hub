"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEpcisEvent = normalizeEpcisEvent;
const uuid_1 = require("uuid");
const gs1_1 = require("../utils/gs1");
const json_1 = require("../utils/json");
function pickEventType(e) {
    const t = (e.type ?? e.eventType ?? "").toString();
    if (t === "ObjectEvent")
        return "ObjectEvent";
    if (t === "AggregationEvent")
        return "AggregationEvent";
    if (t === "TransformationEvent")
        return "TransformationEvent";
    if (t === "AssociationEvent")
        return "AssociationEvent";
    return null;
}
function mapToObjectIdEventType(t) {
    switch (t) {
        case "ObjectEvent":
            return "epcis_object_event";
        case "AggregationEvent":
            return "epcis_aggregation_event";
        case "TransformationEvent":
            return "epcis_transformation_event";
        case "AssociationEvent":
            return "epcis_association_event";
    }
}
function firstEpc(e) {
    const list = Array.isArray(e.epcList) ? e.epcList : undefined;
    if (list && list.length > 0)
        return list[0];
    const child = e.childEPCs ?? e.childEPCList ?? e.childEpcList ?? e.childIDs;
    if (Array.isArray(child) && child.length > 0)
        return String(child[0] ?? "");
    if (typeof e.parentID === "string" && e.parentID)
        return e.parentID;
    return undefined;
}
function fallbackGtinSerial(e) {
    const candGtin = e?.gtin ??
        e?.GTIN ??
        e?.ilmd?.gtin ??
        e?.ilmd?.GTIN ??
        e?.ilmd?.tradeItemIdentification ??
        e?.extension?.gtin ??
        e?.extensions?.gtin;
    const candSerial = e?.serial ??
        e?.serialNumber ??
        e?.ilmd?.serial ??
        e?.ilmd?.serialNumber ??
        e?.extension?.serial ??
        e?.extension?.serialNumber ??
        e?.extensions?.serial ??
        e?.extensions?.serialNumber;
    const gtin = typeof candGtin === "string" || typeof candGtin === "number" ? String(candGtin).trim() : "";
    const serial = typeof candSerial === "string" || typeof candSerial === "number" ? String(candSerial).trim() : "";
    return { gtin: gtin || undefined, serial: serial || undefined };
}
function extractGln(id) {
    if (!id)
        return undefined;
    // If it is an SGLN URN, compute GLN13
    const parsed = (0, gs1_1.parseEpcUrn)(id);
    if (parsed.scheme === "sgln")
        return parsed.gln13;
    // If it is already a numeric GLN
    if (/^\d{13}$/.test(id))
        return id;
    return undefined;
}
function normalizeEpcisEvent(e, ctx) {
    const eventType = pickEventType(e);
    if (!eventType) {
        throw new Error(`Unsupported EPCIS event type: ${String(e.type ?? e.eventType ?? "")}`);
    }
    const epcUri = firstEpc(e);
    const parsedEpc = epcUri ? (0, gs1_1.parseEpcUrn)(epcUri) : { scheme: "unknown", raw: "" };
    let gtin = parsedEpc.scheme === "sgtin" ? parsedEpc.gtin14 : undefined;
    let serial = parsedEpc.scheme === "sgtin" ? parsedEpc.serial : undefined;
    if (!epcUri && !(gtin && serial)) {
        const fb = fallbackGtinSerial(e);
        gtin = fb.gtin;
        serial = fb.serial;
    }
    const eventId = (e.eventID ?? e.eventId ?? e.eventID ?? "").toString().trim() || (0, uuid_1.v4)();
    const eventTime = (e.eventTime ?? "").toString().trim() || new Date().toISOString();
    const readPointGln = extractGln(e.readPoint?.id);
    const bizLocationGln = extractGln(e.bizLocation?.id);
    const oidEventType = mapToObjectIdEventType(eventType);
    const immutable = {
        event_id: eventId,
        event_time: eventTime,
        event_timezone_offset: (e.eventTimeZoneOffset ?? "+00:00").toString(),
        action: (e.action ?? "OBSERVE").toString(),
        biz_step_uri: (e.bizStep ?? "").toString(),
        disposition_uri: (e.disposition ?? "").toString(),
        read_point_gln: readPointGln ?? "",
        biz_location_gln: bizLocationGln ?? "",
        biz_transactions_json: (0, json_1.safeJsonStringify)(e.bizTransactionList ?? null),
        source_list_json: (0, json_1.safeJsonStringify)(e.sourceList ?? null),
        destination_list_json: (0, json_1.safeJsonStringify)(e.destinationList ?? null),
        capture_system: ctx.captureSystem ?? "integration-hub-gs1",
        captured_by_did: ctx.capturedByDid ?? "",
        epcis_document_ref: ctx.epcisDocumentRef ?? ""
    };
    // Event-type specific immutable fields
    if (oidEventType === "epcis_aggregation_event" || oidEventType === "epcis_association_event") {
        immutable.parent_id = (e.parentID ?? "").toString();
        immutable.child_ids_json = (0, json_1.safeJsonStringify)(e.childEPCs ?? e.childEPCList ?? e.childEpcList ?? e.childIDs ?? []);
    }
    if (oidEventType === "epcis_transformation_event") {
        immutable.transformation_id = (e.transformationID ?? e.transformationId ?? "").toString();
        immutable.input_ids_json = (0, json_1.safeJsonStringify)(e.inputEPCList ?? e.inputQuantityList ?? []);
        immutable.output_ids_json = (0, json_1.safeJsonStringify)(e.outputEPCList ?? e.outputQuantityList ?? []);
    }
    if (oidEventType === "epcis_association_event") {
        immutable.association_type = (e.associationType ?? "").toString();
    }
    const mutable = {
        ilmd_json: (0, json_1.safeJsonStringify)(e.ilmd ?? null),
        sensor_elements_json: (0, json_1.safeJsonStringify)(e.sensorElementList ?? null),
        error_declaration_json: (0, json_1.safeJsonStringify)(e.errorDeclaration ?? null),
        extensions_json: (0, json_1.safeJsonStringify)({
            // preserve original event for forensic/debug/audit, but keep it mutable/off-chain friendly
            original: e
        })
    };
    const objectImmutable = {
        gtin: gtin ?? "",
        serial_number: serial ?? "",
        lot_number: (e.ilmd?.lotNumber ?? e.ilmd?.lot ?? "").toString(),
        expiry_date: (e.ilmd?.expiryDate ?? e.ilmd?.expirationDate ?? "").toString(),
        brand_owner_gln: "",
        manufacturing_location_gln: "",
        digital_link_uri: "",
        epc_uri: epcUri ?? "",
        data_carrier: ""
    };
    const objectMutablePatch = {
        current_biz_step_uri: immutable.biz_step_uri,
        current_disposition_uri: immutable.disposition_uri,
        current_read_point_gln: immutable.read_point_gln,
        current_biz_location_gln: immutable.biz_location_gln,
        last_event_time: immutable.event_time,
        last_event_id: immutable.event_id
    };
    return {
        objectKey: {
            epcUri,
            gtin,
            serial,
            lot: objectImmutable.lot_number,
            expiry: objectImmutable.expiry_date,
            brandOwnerGln: objectImmutable.brand_owner_gln,
            manufacturingLocationGln: objectImmutable.manufacturing_location_gln,
            digitalLinkUri: objectImmutable.digital_link_uri,
            dataCarrier: objectImmutable.data_carrier
        },
        objectType: "gs1_serialized_trade_item",
        objectImmutable,
        objectMutablePatch,
        eventType: oidEventType,
        eventImmutable: immutable,
        eventMutable: mutable
    };
}
//# sourceMappingURL=epcis.js.map