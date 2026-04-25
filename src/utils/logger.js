const pino = require("pino");
const pinoHttp = require("pino-http");

const isProd = (process.env.NODE_ENV || "development") === "production";

// Dev : tout visible, coloré, niveau info
// Prod : niveau warn (plus de logs HTTP de routine), headers sensibles masqués
const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "warn" : "info"),
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'req.headers["set-cookie"]'
    ],
    censor: "[REDACTED]"
  },
  transport: !isProd
    ? { target: "pino-pretty", options: { colorize: true, translateTime: true } }
    : undefined
});

// Dev : logs HTTP complets
// Prod : uniquement method, url, statusCode, responseTime
const pinoHttpLogger = pinoHttp({
  logger,
  customProps: (req) => ({ requestId: req.requestId }),
  serializers: isProd
    ? {
        req(req) {
          return { method: req.method, url: req.url, id: req.id };
        },
        res(res) {
          return { statusCode: res.statusCode };
        }
      }
    : undefined
});

module.exports = { logger, pinoHttpLogger };
