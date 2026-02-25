"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const express_1 = __importDefault(require("express"));
const pino_http_1 = __importDefault(require("pino-http"));
const logger_1 = require("./logger");
const health_1 = require("./routes/health");
const epcis_1 = require("./routes/epcis");
const gs1_1 = require("./routes/gs1");
const twin_1 = require("./routes/twin");
const debug_1 = require("./routes/debug");
const config_1 = require("./config");
function buildApp() {
    const app = (0, express_1.default)();
    app.use((0, pino_http_1.default)({
        logger: logger_1.logger,
        quietReqLogger: true,
    }));
    // Basic CORS (adjust as needed)
    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "content-type, x-captured-by-did");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        if (req.method === "OPTIONS")
            return res.status(204).send();
        next();
    });
    app.use(express_1.default.json({ limit: "10mb" }));
    // Public health
    app.use(health_1.healthRouter);
    if (config_1.config.enableDebugEndpoints) {
        app.use(debug_1.debugRouter);
    }
    // No auth (mono-tenant hub assumed in VPN/private network)
    app.use(twin_1.twinRouter);
    app.use(epcis_1.epcisRouter);
    app.use(gs1_1.gs1Router);
    // Error handler
    app.use((err, _req, res, _next) => {
        logger_1.logger.error({ err }, "Unhandled error");
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "internal_error", message: msg });
    });
    return app;
}
//# sourceMappingURL=server.js.map