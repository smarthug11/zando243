const { validationResult } = require("express-validator");
const { AppError } = require("../utils/AppError");

function sanitizeValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(/[<>]/g, "").trim();
}

function deepSanitize(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) {
      obj[key] = obj[key].map((v) => (typeof v === "object" ? (deepSanitize(v), v) : sanitizeValue(v)));
    } else if (obj[key] && typeof obj[key] === "object") {
      deepSanitize(obj[key]);
    } else {
      obj[key] = sanitizeValue(obj[key]);
    }
  }
}

function sanitizeBody(req) {
  deepSanitize(req.body);
}

function sanitizeQuery(req) {
  deepSanitize(req.query);
}

function handleValidation(req, _res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError("Validation invalide", 422, "VALIDATION_ERROR", errors.array()));
  }
  next();
}

module.exports = { sanitizeBody, sanitizeQuery, handleValidation };
