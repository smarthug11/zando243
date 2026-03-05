const csurf = require("csurf");
const { env } = require("../config/env");

const csrfMw = env.csrfEnabled
  ? csurf({
      cookie: false,
      ignoreMethods: ["GET", "HEAD", "OPTIONS"]
    })
  : (req, res, next) => next();

function csrfProtection(req, res, next) {
  const exemptPaths = ["/auth/refresh", "/payments/paypal/webhook"];
  const currentPath = req.originalUrl || req.path || "";
  if (exemptPaths.some((p) => currentPath.startsWith(p))) return next();
  return csrfMw(req, res, next);
}

function exposeCsrfToken(req, res, next) {
  try {
    res.locals.csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : "";
  } catch (_err) {
    res.locals.csrfToken = "";
  }
  next();
}

module.exports = { csrfProtection, exposeCsrfToken };
