// src/routes/twin.ts
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { parseEpcUrn } from "../utils/gs1";
import { ensureGs1Twin } from "../services/objectid";
import { resolveResourceIdByCanonicalId } from "../services/registryLookup";
import { getHubSignerEnv } from "../services/iotaEnv";

export const twinRouter = Router();

const CreateTwinReq = z.object({
  epcUri: z.string().min(1),
  immutable: z.record(z.any()).optional(),
  mutablePatch: z.record(z.any()).optional(),
});

function baseObjectImmutable(epcUri: string): {
  key: { epcUri: string; gtin?: string; serial?: string };
  immutable: Record<string, any>;
} {
  const parsed = parseEpcUrn(epcUri);
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

async function getObjectFull(client: any, id: string) {
  return await client.getObject({
    id,
    options: { showType: true, showOwner: true, showContent: true, showDisplay: true },
  });
}

async function listOwnedObjects(client: any, owner: string, limit = 50): Promise<any[]> {
  const out: any[] = [];
  let cursor: any = null;

  for (let i = 0; i < 20; i++) {
    const r = await client.getOwnedObjects({
      owner,
      cursor,
      limit,
      options: { showType: true },
    });

    const data: any[] = r?.data ?? r?.objects ?? [];
    out.push(...data);

    cursor = r?.nextCursor ?? r?.pageInfo?.endCursor ?? null;
    const hasNext = !!(r?.hasNextPage ?? r?.pageInfo?.hasNextPage);
    if (!hasNext || !cursor) break;
  }

  return out;
}

function safeDecodeParam(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

function isObjectIdLike(s: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(String(s ?? "").trim());
}

async function resolveTwinRefToObjectId(refRaw: string): Promise<{ objectId: string; gs1Id?: string }> {
  const ref = safeDecodeParam(refRaw);
  if (!ref) return { objectId: "" };

  if (isObjectIdLike(ref)) return { objectId: ref };

  // treat as GS1 canonical_id (EPC URI)
  const existing = await resolveResourceIdByCanonicalId(ref);
  return existing ? { objectId: existing, gs1Id: ref } : { objectId: "" };
}

// ---------------------------------------------------------------------
// Create / register a GS1 twin explicitly
// Aliases: POST /twin, POST /gs1/twin
// ---------------------------------------------------------------------

twinRouter.options(["/twin", "/gs1/twin"], (_req: Request, res: Response) => {
  res
    .setHeader("Allow", "OPTIONS, GET, POST")
    .setHeader("Access-Control-Allow-Methods", "OPTIONS, GET, POST")
    .setHeader("Access-Control-Allow-Headers", "content-type, x-captured-by-did")
    .status(204)
    .send();
});

twinRouter.post(["/twin", "/gs1/twin"], async (req: Request, res: Response) => {
  const r = CreateTwinReq.safeParse(req.body);
  if (!r.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const epcUri = r.data.epcUri.trim();
  const { key, immutable } = baseObjectImmutable(epcUri);

  // Idempotent (on-chain): resolve via GS1Registry (canonical_id is epcUri).
  try {
    const existing = await resolveResourceIdByCanonicalId(epcUri);
    if (existing) {
      res.status(200).json({ objectId: existing, alreadyRegistered: true, key });
      return;
    }
  } catch (e: any) {
    console.error("[/twin] Registry lookup failed:", e?.stack ?? e);
    res.status(502).json({ error: "registry_lookup_failed", message: (e?.message ?? String(e)).toString() });
    return;
  }

  // Merge client-provided metadata.
  // This Move package stores strongly-typed GS1 fields + extensions; unknown fields become extensions.
  const mergedImmutable: Record<string, any> = { ...immutable, ...(r.data.immutable ?? {}) };
  // ignore legacy ObjectID fields if present
  delete mergedImmutable.creator_url;
  delete mergedImmutable.product_url;

  try {
    const created = await ensureGs1Twin({
      objectType: "gs1_serialized_trade_item",
      key,
      immutable: mergedImmutable,
      mutablePatch: r.data.mutablePatch ?? {},
    });

    res.status(201).json({ objectId: created.objectId, alreadyRegistered: false, key });
  } catch (e: any) {
    console.error("[/twin] ObjectID create failed:", e?.stack ?? e);
    res.status(502).json({ error: "objectid_create_failed", message: (e?.message ?? String(e)).toString() });
  }
});

// ---------------------------------------------------------------------
// Read routes (RPC passthrough)
// ---------------------------------------------------------------------

// Resolve GS1 resource id from canonical id (EPC URI)
// Get resource by objectId OR by GS1 canonical id (epcUri)
twinRouter.get(["/twin/:id", "/gs1/twin/:id", "/event/:id", "/gs1/event/:id"], async (req: Request, res: Response) => {
  const ref = String(req.params.id ?? "").trim();
  if (!ref) {
    res.status(400).json({ error: "missing_id" });
    return;
  }

  try {
    const env = await getHubSignerEnv();
    const { objectId, gs1Id } = await resolveTwinRefToObjectId(ref);

    if (!objectId) {
      res.status(404).json({ error: "not_found", ref: safeDecodeParam(ref) });
      return;
    }

    const obj = await getObjectFull(env.client as any, objectId);
    res.status(200).json({ objectId, gs1Id, obj });
  } catch (e: any) {
    const msg = (e?.message ?? String(e)).toString();
    res.status(502).json({ error: "rpc_failed", message: msg });
  }
});

// Get resource (or any object) by objectId
twinRouter.get(["/twin/:id", "/gs1/twin/:id", "/event/:id", "/gs1/event/:id"], async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "missing_id" });
    return;
  }

  try {
    const env = await getHubSignerEnv();
    const obj = await getObjectFull(env.client as any, id);
    res.status(200).json(obj);
  } catch (e: any) {
    const msg = (e?.message ?? String(e)).toString();
    // iota client errors are usually 4xx-like; keep a simple mapping
    const status = msg.toLowerCase().includes("not exist") || msg.toLowerCase().includes("not found") ? 404 : 502;
    res.status(status).json({ error: status === 404 ? "not_found" : "rpc_failed", message: msg });
  }
});

// Get GS1Event objects owned by a GS1Resource (object-owned)
// - full=1 returns full objects, otherwise only ids
twinRouter.get(["/twin/:id/events", "/gs1/twin/:id/events"], async (req: Request, res: Response) => {
  const ref = String(req.params.id ?? "").trim();
  if (!ref) {
    res.status(400).json({ error: "missing_id" });
    return;
  }

  const full = String(req.query.full ?? "") === "1" || String(req.query.full ?? "") === "true";

  try {
    const env = await getHubSignerEnv();
    const { objectId: owner, gs1Id } = await resolveTwinRefToObjectId(ref);

    if (!owner) {
      res.status(404).json({ error: "not_found", ref: safeDecodeParam(ref) });
      return;
    }

    const owned = await listOwnedObjects(env.client as any, owner);
    const gs1EventSuffix = `::${env.gs1ModuleName}::GS1Event`;

    const ids = owned
      .map((row) => ({ id: asObjectId(row), type: asType(row) }))
      .filter((x) => x.id && (x.type.includes(gs1EventSuffix) || x.type.includes("::OIDGs1IHub::GS1Event")))
      .map((x) => String(x.id));

    const uniq = Array.from(new Set(ids));

    if (!full) {
      res.status(200).json({ owner, gs1Id, eventObjectIds: uniq });
      return;
    }

    const events: any[] = [];
    for (const id of uniq) {
      try {
        events.push(await getObjectFull(env.client as any, id));
      } catch (e: any) {
        events.push({ id, error: (e?.message ?? String(e)).toString() });
      }
    }

    res.status(200).json({ owner, gs1Id, eventObjectIds: uniq, events });
  } catch (e: any) {
    console.error("[/twin/:id/events] RPC failed:", e?.stack ?? e);
    res.status(502).json({ error: "rpc_failed", message: (e?.message ?? String(e)).toString() });
  }
});
