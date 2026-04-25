const { verifyAccessToken } = require("../config/jwt");
const { AppError } = require("../utils/AppError");
const { defineModels } = require("../models");

defineModels();

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

async function loadCurrentUser(req, _res, next) {
  try {
    const models = defineModels();
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);
    if (!token) return next();
    const payload = verifyAccessToken(token);
    const user = await models.User.findByPk(payload.sub);
    if (user && user.isActive) req.user = user;
    return next();
  } catch (_err) {
    return next();
  }
}

function requireAuth(req, _res, next) {
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
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return next(new AppError("Session administrateur expirée", 401, "ADMIN_SESSION_EXPIRED"));
  }

  if (req.session) req.session.adminLastSeenAt = now;
  next();
}

module.exports = { loadCurrentUser, requireAuth, requireGuest, requireFreshAdminSession };
