import express, { type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { healthRouter } from "./routes/health";
import { epcisRouter } from "./routes/epcis";
import { gs1Router } from "./routes/gs1";
import { twinRouter } from "./routes/twin";
import { debugRouter } from "./routes/debug";
import { config } from "./config";

export function buildApp() {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
    })
  );

  // Basic CORS (adjust as needed)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-captured-by-did");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).send();
    next();
  });

  app.use(express.json({ limit: "10mb" }));

  // Public health
  app.use(healthRouter);

  if (config.enableDebugEndpoints) {
    app.use(debugRouter);
  }

  // No auth (mono-tenant hub assumed in VPN/private network)
  app.use(twinRouter);
  app.use(epcisRouter);
  app.use(gs1Router);

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled error");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "internal_error", message: msg });
  });

  return app;
}
