const { AppError } = require("../utils/AppError");

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError("Authentification requise", 401, "AUTH_REQUIRED"));
    if (!roles.includes(req.user.role)) {
      return next(new AppError("Accès refusé", 403, "FORBIDDEN"));
    }
    next();
  };
}

module.exports = { requireRole };
