const rateLimit = require("express-rate-limit");
const { sanitizeBody, sanitizeQuery } = require("./validators");

function applySecurityMiddlewares(app) {
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use((req, res, next) => {
    sanitizeQuery(req);
    sanitizeBody(req);
    next();
  });
}

module.exports = { applySecurityMiddlewares };
