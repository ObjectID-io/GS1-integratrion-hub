import { Router, type Request, type Response } from "express";
import { z } from "zod";

export const gs1Router = Router();

// Placeholder endpoints for GS1 Registry Platform / Verified by GS1 integration.
// Implement real calls when you have credentials.

const VerifyReq = z.object({ value: z.string().min(1) });

gs1Router.post("/gs1/verify/gtin", (req: Request, res: Response) => {
  const r = VerifyReq.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: "invalid_body" });

  const gtin = r.data.value.trim();
  res.json({
    gtin,
    verified: false,
    reason: "not_configured",
    hint: "Integrate GS1 Verified by GS1 / GRP here (credentials + endpoints).",
  });
});

gs1Router.post("/gs1/verify/gln", (req: Request, res: Response) => {
  const r = VerifyReq.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: "invalid_body" });

  const gln = r.data.value.trim();
  res.json({
    gln,
    verified: false,
    reason: "not_configured",
    hint: "Integrate GS1 Verified by GS1 / GRP here (credentials + endpoints).",
  });
});
