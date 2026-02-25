const pino = require("pino");
const pinoHttp = require("pino-http");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: true }
        }
      : undefined
});

const pinoHttpLogger = pinoHttp({
  logger,
  customProps: (req) => ({ requestId: req.requestId })
});

module.exports = { logger, pinoHttpLogger };
