const { logger } = require("../utils/logger");
const { createAuditLog } = require("../services/auditLogService");

const SENSITIVE_FIELDS = [
  "password", "passwordHash", "token", "secret",
  "refreshToken", "_csrf", "authorization",
  "emailVerificationToken", "resetPasswordToken"
];

function redactBody(body) {
  if (!body || typeof body !== "object") return body;
  const safe = { ...body };
  for (const field of SENSITIVE_FIELDS) {
    if (safe[field] !== undefined) safe[field] = "[REDACTED]";
  }
  return safe;
}

function errorHandler(err, req, res, _next) {
  const status = err.statusCode || err.status || 500;
  logger.error(
    { err: { message: err.message, code: err.code }, requestId: req.requestId, path: req.originalUrl, body: redactBody(req.body) },
    "Erreur HTTP"
  );
  createAuditLog({
    category: "SYSTEM",
    level: status >= 500 ? "ERROR" : "WARN",
    action: "HTTP_ERROR",
    message: err.message || "Erreur HTTP",
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: {
      status,
      code: err.code || null,
      path: req.originalUrl,
      method: req.method
    }
  }).catch(() => {});

  const { env } = require("../config/env");
  const userFacingError = env.isProd
    ? { message: "Une erreur interne s'est produite.", code: err.code || "INTERNAL_ERROR" }
    : err;

  if (req.accepts("html")) {
    return res.status(status).render("pages/errors/error", {
      title: "Erreur",
      error: userFacingError,
      status
    });
  }

  return res.status(status).json({
    error: {
      code: userFacingError.code || "INTERNAL_ERROR",
      message: userFacingError.message || "Erreur interne"
    },
    requestId: req.requestId
  });
}

module.exports = { errorHandler };
