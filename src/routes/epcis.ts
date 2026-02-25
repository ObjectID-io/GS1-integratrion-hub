import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { normalizeEpcisEvent } from "../services/epcis";
import type { CaptureRequest, EpcisDocument, EpcisEvent } from "../types";
import { appendGs1Event } from "../services/objectid";
import { config } from "../config";
import { resolveResourceIdByKey } from "../services/registryLookup";

export const epcisRouter = Router();

const CaptureReqSchema = z.any(); // we validate structurally at runtime

function extractEventList(body: CaptureRequest): { events: EpcisEvent[]; docRef?: string } {
  if (Array.isArray(body)) return { events: body };
  const doc = body as EpcisDocument;
  const docRef = (doc.eventID ?? (doc as any).id ?? (doc as any).documentId ?? "").toString() || undefined;

  const candidates: any[] = [
    doc.eventList,
    (doc as any).epcisBody?.eventList,
    (doc as any).epcisBody?.eventList?.eventList,
    (doc as any).epcisBody?.eventList?.events,
    (doc as any).epcisBody?.events,
  ].filter(Boolean);

  for (const c of candidates) {
    if (Array.isArray(c)) return { events: c as EpcisEvent[], docRef };
  }

  // Some producers wrap as { epcisBody: { eventList: { objectEvent:[], ... } } }
  const byType = (doc as any).epcisBody?.eventList;
  if (byType && typeof byType === "object") {
    const flat: EpcisEvent[] = [];
    for (const v of Object.values(byType)) {
      if (Array.isArray(v)) flat.push(...(v as EpcisEvent[]));
    }
    if (flat.length) return { events: flat, docRef };
  }

  return { events: [], docRef };
}

function getCapturedByDid(req: Request): string | undefined {
  if (!config.allowCallerDidHeader) return undefined;
  const v = req.header("x-captured-by-did");
  if (!v) return undefined;
  return v.toString().trim() || undefined;
}

// ===== EPCIS-like endpoints =====

// Discovery for /capture (EPCIS 2.0 style)
epcisRouter.options(["/capture", "/epcis/capture"], (_req: Request, res: Response) => {
  res
    .setHeader("Allow", "OPTIONS, POST")
    .setHeader("Access-Control-Allow-Methods", "OPTIONS, POST")
    .setHeader("Access-Control-Allow-Headers", "content-type, x-captured-by-did")
    .setHeader("GS1-EPCIS-Version", "2.0")
    .setHeader("GS1-CBV-Version", "2.0")
    .setHeader("GS1-EPCIS-Capture-Limit", "1000")
    .setHeader("GS1-Capture-Error-Behaviour", "ROLLBACK")
    .status(204)
    .send();
});

epcisRouter.post(["/capture", "/epcis/capture"], async (req: Request, res: Response) => {
  const parsed = CaptureReqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const { events, docRef } = extractEventList(parsed.data as CaptureRequest);
  if (!events.length) {
    res.status(400).json({ error: "no_events_found" });
    return;
  }
  if (events.length > 1000) {
    res.status(413).json({ error: "too_many_events", limit: 1000 });
    return;
  }

  const capturedByDid = getCapturedByDid(req);

  // Pre-validate: all events must refer to a previously-registered twin
  // (create twins via POST /twin or POST /gs1/twin)
  const normalized = events.map((e) =>
    normalizeEpcisEvent(e, {
      capturedByDid,
      captureSystem: "integration-hub-gs1",
      epcisDocumentRef: docRef,
    })
  );

  const results: any[] = [];

  for (const norm of normalized) {
    if (!norm.objectKey.epcUri && !(norm.objectKey.gtin && norm.objectKey.serial)) {
      res.status(400).json({
        error: "cannot_identify_object",
        hint: "Provide epcList/childEPCs/parentID or GTIN+serial so the hub can resolve via GS1Registry",
      });
      return;
    }

    let objectId: string | null = null;
    try {
      objectId = await resolveResourceIdByKey({
        epcUri: norm.objectKey.epcUri,
        gtin: norm.objectKey.gtin,
        serial: norm.objectKey.serial,
      });
    } catch (e: any) {
      res.status(502).json({
        error: "registry_lookup_failed",
        message: (e?.message ?? String(e)).toString(),
        key: {
          epcUri: norm.objectKey.epcUri ?? "",
          gtin: norm.objectKey.gtin ?? "",
          serial: norm.objectKey.serial ?? "",
        },
      });
      return;
    }

    if (!objectId) {
      res.status(404).json({
        error: "twin_not_registered",
        hint: "Create the twin first via POST /twin (or /gs1/twin).",
        key: {
          epcUri: norm.objectKey.epcUri ?? "",
          gtin: norm.objectKey.gtin ?? "",
          serial: norm.objectKey.serial ?? "",
        },
      });
      return;
    }

    try {
      const tx = await appendGs1Event({
        objectId,
        eventType: norm.eventType,
        immutable: norm.eventImmutable,
        mutable: norm.eventMutable,
      });

      results.push({
        objectId,
        txId: tx.txId,
        eventId: norm.eventImmutable.event_id,
        eventObjectId: (tx as any).eventObjectId ?? null,
      });
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).toString();
      const isNotFound = /not\s*found|does\s*not\s*exist|unknown\s*object|object.*missing/i.test(msg);
      res.status(isNotFound ? 404 : 502).json({
        error: isNotFound ? "object_not_found" : "objectid_append_failed",
        message: msg,
        objectId,
        eventId: norm.eventImmutable.event_id,
      });
      return;
    }
  }

  res.status(200).json({ captured: results.length, results });
});

// Query interface intentionally not implemented in this mono-tenant strict mode.
epcisRouter.get(["/events", "/epcis/events"], async (_req: Request, res: Response) => {
  res.status(501).json({
    error: "not_implemented",
    hint: "Use your ObjectID indexer/DB for EPCIS Query. This hub only captures events.",
  });
});
