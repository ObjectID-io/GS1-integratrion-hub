import { buildApp } from "./server";
import { config, requireConfig } from "./config";
import { logger } from "./logger";
import { getHubSignerEnv } from "./services/iotaEnv";

async function main() {
  requireConfig();

  // Fail-fast: validate signer can be initialized (seed, credits, controller cap, policy)
  await getHubSignerEnv();

  const app = buildApp();

  app.listen(config.port, () => {
    logger.info({ port: config.port, network: config.oidNetwork }, "integration-hub-gs1 listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
