const { env } = require("../config/env");
const { AppError } = require("../utils/AppError");
const { defineModels } = require("../models");
const { getBetterAuthModule } = require("../utils/betterAuthBridge");
const { setFlash } = require("./viewLocals");

defineModels();

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function clearBaCookies(res) {
  const opts = { path: "/", httpOnly: true, sameSite: "lax", secure: env.isProd };
  res.clearCookie("better-auth.session_token", opts);
  res.clearCookie("better-auth.session_data", opts);
}

async function loadFromBetterAuth(req) {
  const cookieHeader = req.headers.cookie || "";
  if (!cookieHeader.includes("better-auth.")) return null;
  try {
    const mod = await getBetterAuthModule();
    const auth = mod.getAuth();
    const session = await auth.api.getSession({ headers: mod.fromNodeHeaders(req.headers) });
    if (!session?.user?.id) return null;
    const models = defineModels();
    const user = await models.User.findByPk(session.user.id);
    return user && user.isActive ? user : null;
  } catch (_err) {
    return null;
  }
}

async function loadCurrentUser(req, _res, next) {
  try {
    const user = await loadFromBetterAuth(req);
    if (user) req.user = user;
    return next();
  } catch (_err) {
    return next();
  }
}

function getHeader(req, name) {
  const lowerName = name.toLowerCase();
  if (typeof req.get === "function") {
    const value = req.get(name) || req.get(lowerName);
    if (value) return value;
  }
  return req.headers?.[lowerName] || req.headers?.[name] || "";
}

function isJsonOrApiRequest(req) {
  const accept = String(getHeader(req, "accept")).toLowerCase();
  const contentType = String(getHeader(req, "content-type")).toLowerCase();
  return Boolean(
    req.path?.startsWith("/api") ||
    req.originalUrl?.startsWith("/api") ||
    req.xhr ||
    accept.includes("application/json") ||
    contentType.includes("application/json")
  );
}

function isHtmlNavigationRequest(req) {
  if (isJsonOrApiRequest(req)) return false;
  return String(getHeader(req, "accept")).toLowerCase().includes("text/html");
}

function requireAuth(req, res, next) {
  if (!req.user && isHtmlNavigationRequest(req)) {
    if (req.session) setFlash(req, "error", "Connectez-vous pour continuer.");
    return res.redirect("/auth2/login");
  }
  if (!req.user) return next(new AppError("Authentification requise", 401, "AUTH_REQUIRED"));
  next();
}

function requireGuest(req, _res, next) {
  if (req.user) return next(new AppError("Déjà connecté", 400, "ALREADY_AUTHENTICATED"));
  next();
}

function requireFreshAdminSession(req, res, next) {
  if (req.user?.role !== "ADMIN") return next();

  const now = Date.now();
  const lastSeenAt = Number(req.session?.adminLastSeenAt || 0);
  if (lastSeenAt && now - lastSeenAt > ADMIN_IDLE_TIMEOUT_MS) {
    if (req.session) delete req.session.adminLastSeenAt;
    clearBaCookies(res);
    return next(new AppError("Session administrateur expirée", 401, "ADMIN_SESSION_EXPIRED"));
  }

  if (req.session) req.session.adminLastSeenAt = now;
  next();
}

module.exports = { loadCurrentUser, requireAuth, requireGuest, requireFreshAdminSession };
