"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugRouter = void 0;
const express_1 = require("express");
const iotaEnv_1 = require("../services/iotaEnv");
exports.debugRouter = (0, express_1.Router)();
exports.debugRouter.get("/debug/signer", async (_req, res) => {
    const env = await (0, iotaEnv_1.getHubSignerEnv)();
    res.json({
        network: env.network,
        address: env.address,
        oidCreditPackageId: env.oidCreditPackageId,
        oidGs1PackageId: env.oidGs1PackageId,
        gs1RegistryId: env.gs1RegistryId,
        creditTokenId: env.creditTokenId,
        controllerCapId: env.controllerCapId,
        creditPolicyId: env.creditPolicyId,
    });
});
exports.debugRouter.get("/debug/owned-objects", async (_req, res) => {
    const snap = await (0, iotaEnv_1.debugListOwnedObjects)();
    res.json(snap);
});
//# sourceMappingURL=debug.js.map