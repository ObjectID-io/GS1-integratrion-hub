"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gs1Router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
exports.gs1Router = (0, express_1.Router)();
// Placeholder endpoints for GS1 Registry Platform / Verified by GS1 integration.
// Implement real calls when you have credentials.
const VerifyReq = zod_1.z.object({ value: zod_1.z.string().min(1) });
exports.gs1Router.post("/gs1/verify/gtin", (req, res) => {
    const r = VerifyReq.safeParse(req.body);
    if (!r.success)
        return res.status(400).json({ error: "invalid_body" });
    const gtin = r.data.value.trim();
    res.json({
        gtin,
        verified: false,
        reason: "not_configured",
        hint: "Integrate GS1 Verified by GS1 / GRP here (credentials + endpoints).",
    });
});
exports.gs1Router.post("/gs1/verify/gln", (req, res) => {
    const r = VerifyReq.safeParse(req.body);
    if (!r.success)
        return res.status(400).json({ error: "invalid_body" });
    const gln = r.data.value.trim();
    res.json({
        gln,
        verified: false,
        reason: "not_configured",
        hint: "Integrate GS1 Verified by GS1 / GRP here (credentials + endpoints).",
    });
});
//# sourceMappingURL=gs1.js.map