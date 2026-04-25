const { doubleCsrf } = require("csrf-csrf");
const { env } = require("../config/env");

const csrfEnabled = env.isProd || env.csrfEnabled;

const csrfMw = csrfEnabled
  ? doubleCsrf({
      getSecret: () => env.cookieSecret,
      getSessionIdentifier: (req) => req.sessionID || req.ip || "anonymous",
      cookieName: "zando243.csrf-token",
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.isProd
      },
      ignoredMethods: ["GET", "HEAD", "OPTIONS"],
      getCsrfTokenFromRequest: (req) => req.body?._csrf || req.headers["x-csrf-token"],
      errorConfig: {
        statusCode: 403,
        message: "Token CSRF invalide",
        code: "EBADCSRFTOKEN"
      }
    }).doubleCsrfProtection
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
