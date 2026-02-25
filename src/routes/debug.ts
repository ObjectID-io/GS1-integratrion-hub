import { Router, type Request, type Response } from "express";
import { getHubSignerEnv, debugListOwnedObjects } from "../services/iotaEnv";

export const debugRouter = Router();

debugRouter.get("/debug/signer", async (_req: Request, res: Response) => {
  const env = await getHubSignerEnv();
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

debugRouter.get("/debug/owned-objects", async (_req: Request, res: Response) => {
  const snap = await debugListOwnedObjects();
  res.json(snap);
});
