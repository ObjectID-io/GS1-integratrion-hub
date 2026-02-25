import { v4 as uuidv4 } from "uuid";
import type { EpcisEvent, EpcisEventType } from "../types";
import { parseEpcUrn } from "../utils/gs1";
import { safeJsonStringify } from "../utils/json";

export type NormalizedEvent = {
  objectKey: {
    epcUri?: string;
    gtin?: string;
    serial?: string;
    lot?: string;
    expiry?: string;
    brandOwnerGln?: string;
    manufacturingLocationGln?: string;
    dataCarrier?: string;
    digitalLinkUri?: string;
  };
  objectType: "gs1_serialized_trade_item";
  objectImmutable: Record<string, any>;
  objectMutablePatch: Record<string, any>;

  eventType:
    | "epcis_object_event"
    | "epcis_aggregation_event"
    | "epcis_transformation_event"
    | "epcis_association_event";

  eventImmutable: Record<string, any>;
  eventMutable: Record<string, any>;
};

function pickEventType(e: EpcisEvent): EpcisEventType | null {
  const t = (e.type ?? e.eventType ?? "").toString();
  if (t === "ObjectEvent") return "ObjectEvent";
  if (t === "AggregationEvent") return "AggregationEvent";
  if (t === "TransformationEvent") return "TransformationEvent";
  if (t === "AssociationEvent") return "AssociationEvent";
  return null;
}

function mapToObjectIdEventType(t: EpcisEventType): NormalizedEvent["eventType"] {
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

function firstEpc(e: EpcisEvent): string | undefined {
  const list = Array.isArray(e.epcList) ? e.epcList : undefined;
  if (list && list.length > 0) return list[0];
  const child = (e as any).childEPCs ?? (e as any).childEPCList ?? (e as any).childEpcList ?? (e as any).childIDs;
  if (Array.isArray(child) && child.length > 0) return String(child[0] ?? "");
  if (typeof e.parentID === "string" && e.parentID) return e.parentID;
  return undefined;
}

function fallbackGtinSerial(e: any): { gtin?: string; serial?: string } {
  const candGtin =
    e?.gtin ??
    e?.GTIN ??
    e?.ilmd?.gtin ??
    e?.ilmd?.GTIN ??
    e?.ilmd?.tradeItemIdentification ??
    e?.extension?.gtin ??
    e?.extensions?.gtin;

  const candSerial =
    e?.serial ??
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

function extractGln(id?: string): string | undefined {
  if (!id) return undefined;
  // If it is an SGLN URN, compute GLN13
  const parsed = parseEpcUrn(id);
  if (parsed.scheme === "sgln") return parsed.gln13;
  // If it is already a numeric GLN
  if (/^\d{13}$/.test(id)) return id;
  return undefined;
}

export function normalizeEpcisEvent(e: EpcisEvent, ctx: { capturedByDid?: string; captureSystem?: string; epcisDocumentRef?: string }): NormalizedEvent {
  const eventType = pickEventType(e);
  if (!eventType) {
    throw new Error(`Unsupported EPCIS event type: ${String(e.type ?? e.eventType ?? "")}`);
  }

  const epcUri = firstEpc(e);
  const parsedEpc = epcUri ? parseEpcUrn(epcUri) : { scheme: "unknown" as const, raw: "" };

  let gtin = parsedEpc.scheme === "sgtin" ? parsedEpc.gtin14 : undefined;
  let serial = parsedEpc.scheme === "sgtin" ? parsedEpc.serial : undefined;
  if (!epcUri && !(gtin && serial)) {
    const fb = fallbackGtinSerial(e);
    gtin = fb.gtin;
    serial = fb.serial;
  }

  const eventId = (e.eventID ?? e.eventId ?? e.eventID ?? "").toString().trim() || uuidv4();
  const eventTime = (e.eventTime ?? "").toString().trim() || new Date().toISOString();

  const readPointGln = extractGln(e.readPoint?.id);
  const bizLocationGln = extractGln(e.bizLocation?.id);

  const oidEventType = mapToObjectIdEventType(eventType);

  const immutable: Record<string, any> = {
    event_id: eventId,
    event_time: eventTime,
    event_timezone_offset: (e.eventTimeZoneOffset ?? "+00:00").toString(),
    action: (e.action ?? "OBSERVE").toString(),
    biz_step_uri: (e.bizStep ?? "").toString(),
    disposition_uri: (e.disposition ?? "").toString(),
    read_point_gln: readPointGln ?? "",
    biz_location_gln: bizLocationGln ?? "",
    biz_transactions_json: safeJsonStringify(e.bizTransactionList ?? null),
    source_list_json: safeJsonStringify(e.sourceList ?? null),
    destination_list_json: safeJsonStringify(e.destinationList ?? null),
    capture_system: ctx.captureSystem ?? "integration-hub-gs1",
    captured_by_did: ctx.capturedByDid ?? "",
    epcis_document_ref: ctx.epcisDocumentRef ?? ""
  };

  // Event-type specific immutable fields
  if (oidEventType === "epcis_aggregation_event" || oidEventType === "epcis_association_event") {
    immutable.parent_id = (e.parentID ?? "").toString();
    immutable.child_ids_json = safeJsonStringify(e.childEPCs ?? e.childEPCList ?? e.childEpcList ?? e.childIDs ?? []);
  }
  if (oidEventType === "epcis_transformation_event") {
    immutable.transformation_id = (e.transformationID ?? e.transformationId ?? "").toString();
    immutable.input_ids_json = safeJsonStringify(e.inputEPCList ?? e.inputQuantityList ?? []);
    immutable.output_ids_json = safeJsonStringify(e.outputEPCList ?? e.outputQuantityList ?? []);
  }
  if (oidEventType === "epcis_association_event") {
    immutable.association_type = (e.associationType ?? "").toString();
  }

  const mutable: Record<string, any> = {
    ilmd_json: safeJsonStringify(e.ilmd ?? null),
    sensor_elements_json: safeJsonStringify(e.sensorElementList ?? null),
    error_declaration_json: safeJsonStringify(e.errorDeclaration ?? null),
    extensions_json: safeJsonStringify({
      // preserve original event for forensic/debug/audit, but keep it mutable/off-chain friendly
      original: e
    })
  };

  const objectImmutable: Record<string, any> = {
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

  const objectMutablePatch: Record<string, any> = {
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
