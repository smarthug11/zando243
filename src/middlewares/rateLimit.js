const rateLimit = require("express-rate-limit");

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Trop de tentatives. Réessayez dans 15 minutes." } }
});

const resetPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { loginRateLimit, resetPasswordRateLimit };
