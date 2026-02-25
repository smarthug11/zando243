require("dotenv").config();
const http = require("http");
const app = require("./app");
const { env } = require("./src/config/env");
const { logger } = require("./src/utils/logger");

const server = http.createServer(app);

server.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, "Serveur demarre");
});

server.on("error", (error) => {
  logger.error({ err: error }, "Erreur serveur");
  process.exit(1);
});
