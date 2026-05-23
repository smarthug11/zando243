const { doubleCsrf } = require("csrf-csrf");
const { randomUUID } = require("crypto");
const { env } = require("../config/env");

const csrfEnabled = env.isProd || env.csrfEnabled;
const CSRF_ID_COOKIE = "zando243.csrf-id";

function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    signed: true,
    maxAge: 1000 * 60 * 60 * 4
  };
}

function getStableCsrfIdentifier(req, res) {
  const signedValue = req.signedCookies?.[CSRF_ID_COOKIE];
  const existing = typeof signedValue === "string" && signedValue ? signedValue : null;
  if (existing) return existing;

  const created = randomUUID();
  if (req.signedCookies) req.signedCookies[CSRF_ID_COOKIE] = created;
  res.cookie(CSRF_ID_COOKIE, created, csrfCookieOptions());
  return created;
}

const csrfMw = csrfEnabled
  ? doubleCsrf({
      getSecret: () => env.cookieSecret,
      getSessionIdentifier: (req) => req.csrfStableIdentifier || req.ip || "anonymous",
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
  const exemptPaths = ["/payments/paypal/webhook", "/api/auth/"];
  const currentPath = req.originalUrl || req.path || "";
  if (exemptPaths.some((p) => currentPath.startsWith(p))) return next();
  if (csrfEnabled) req.csrfStableIdentifier = getStableCsrfIdentifier(req, res);
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
