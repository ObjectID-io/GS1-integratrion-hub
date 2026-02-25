"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const config_1 = require("./config");
const logger_1 = require("./logger");
const iotaEnv_1 = require("./services/iotaEnv");
async function main() {
    (0, config_1.requireConfig)();
    // Fail-fast: validate signer can be initialized (seed, credits, controller cap, policy)
    await (0, iotaEnv_1.getHubSignerEnv)();
    const app = (0, server_1.buildApp)();
    app.listen(config_1.config.port, () => {
        logger_1.logger.info({ port: config_1.config.port, network: config_1.config.oidNetwork }, "integration-hub-gs1 listening");
    });
}
main().catch((err) => {
    logger_1.logger.error({ err }, "Fatal startup error");
    process.exit(1);
});
//# sourceMappingURL=index.js.map