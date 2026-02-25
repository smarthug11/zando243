const { verifyAccessToken } = require("../config/jwt");
const { AppError } = require("../utils/AppError");
const { defineModels } = require("../models");

defineModels();

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

module.exports = { loadCurrentUser, requireAuth, requireGuest };
