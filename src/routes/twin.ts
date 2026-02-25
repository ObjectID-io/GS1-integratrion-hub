import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { parseEpcUrn } from "../utils/gs1";
import { ensureGs1Twin } from "../services/objectid";
import { resolveResourceIdByCanonicalId } from "../services/registryLookup";

export const twinRouter = Router();

const CreateTwinReq = z.object({
  epcUri: z.string().min(1),
  immutable: z.record(z.any()).optional(),
  mutablePatch: z.record(z.any()).optional(),
});

function baseObjectImmutable(
  epcUri: string,
): { key: { epcUri: string; gtin?: string; serial?: string }; immutable: Record<string, any> } {
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

// Create / register a GS1 twin explicitly
// Aliases: POST /twin, POST /gs1/twin

twinRouter.options(["/twin", "/gs1/twin"], (_req: Request, res: Response) => {
  res
    .setHeader("Allow", "OPTIONS, POST")
    .setHeader("Access-Control-Allow-Methods", "OPTIONS, POST")
    .setHeader("Access-Control-Allow-Headers", "content-type")
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
    // expose useful diagnostics in server logs
    // (client still only gets message)
    console.error("[/twin] ObjectID create failed:", e?.stack ?? e);
    res.status(502).json({ error: "objectid_create_failed", message: (e?.message ?? String(e)).toString() });
  }
});
