"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.requireConfig = requireConfig;
// Load runtime configuration from .env (if present).
require("dotenv/config");
exports.config = {
    port: Number(process.env.PORT ?? "8080"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    // Mono-tenant signer config (hub signs all ObjectID ops)
    oidNetwork: process.env.OID_NETWORK ?? "mainnet",
    oidRpcUrl: process.env.OID_RPC_URL ?? "",
    oidSeedHex: process.env.OID_SEED_HEX ?? "",
    oidDid: process.env.OID_DID ?? "",
    // On-chain package that implements GS1 helpers (Move package id)
    oidGs1PackageId: process.env.OID_GS1_PACKAGE_ID ?? "",
    // Shared GS1Registry object id (created on publish via init)
    oidGs1RegistryId: process.env.OID_GS1_REGISTRY_ID ?? "",
    // Core ObjectID Move package id (dependency of OIDgs1)
    oidCreditPackageId: process.env.OID_CREDIT_PACKAGE ?? "",
    // REQUIRED: on-chain objects used by the hub signer
    oidControllerCapId: process.env.OID_CONTROLLER_CAP_ID ?? "",
    oidCreditTokenId: process.env.OID_CREDIT_TOKEN_ID ?? "",
    oidCreditPolicyId: process.env.OID_CREDIT_POLICY_ID ?? "",
    // Optional (legacy): Linked Domain origin you expect for the signer DID.
    // Not used to build txs (the smart contract checks DLVC via ControllerCap).
    oidLinkedDomainOrigin: process.env.OID_LINKED_DOMAIN_ORIGIN ?? "",
    // Optional: map EPCIS callers to DID (simple example)
    // If true, hub will accept header X-Captured-By-DID and store it in event immutable metadata.
    allowCallerDidHeader: (process.env.ALLOW_CALLER_DID_HEADER ?? "true").toLowerCase() === "true",
    enableDebugEndpoints: (process.env.ENABLE_DEBUG_ENDPOINTS ?? "false").toLowerCase() === "true",
};
function requireConfig() {
    if (!exports.config.oidSeedHex)
        throw new Error("Missing OID_SEED_HEX in environment");
    if (!exports.config.oidDid)
        throw new Error("Missing OID_DID in environment");
    if (!exports.config.oidGs1PackageId)
        throw new Error("Missing OID_GS1_PACKAGE_ID in environment");
    if (!exports.config.oidGs1RegistryId)
        throw new Error("Missing OID_GS1_REGISTRY_ID in environment");
    // No auto-discovery: these MUST be provided explicitly.
    if (!exports.config.oidCreditPackageId)
        throw new Error("Missing OID_CREDIT_PACKAGE in environment");
    if (!exports.config.oidCreditPolicyId)
        throw new Error("Missing OID_CREDIT_POLICY_ID in environment");
    if (!exports.config.oidCreditTokenId)
        throw new Error("Missing OID_CREDIT_TOKEN_ID in environment");
    if (!exports.config.oidControllerCapId)
        throw new Error("Missing OID_CONTROLLER_CAP_ID in environment");
}
//# sourceMappingURL=config.js.map