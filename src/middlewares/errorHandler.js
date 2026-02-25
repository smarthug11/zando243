const { logger } = require("../utils/logger");
const { createAuditLog } = require("../services/auditLogService");

function errorHandler(err, req, res, _next) {
  const status = err.statusCode || err.status || 500;
  logger.error(
    { err, requestId: req.requestId, path: req.originalUrl, body: req.body },
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

  if (req.accepts("html")) {
    return res.status(status).render("pages/errors/error", {
      title: "Erreur",
      error: err,
      status
    });
  }

  return res.status(status).json({
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "Erreur interne"
    },
    requestId: req.requestId
  });
}

module.exports = { errorHandler };
