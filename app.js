require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const helmet = require("helmet");
const { pinoHttpLogger } = require("./src/utils/logger");
const { env } = require("./src/config/env");
const { initDatabase } = require("./src/models");
const { requestIdMiddleware } = require("./src/utils/requestId");
const { applySecurityMiddlewares } = require("./src/middlewares/security");
const { csrfProtection, exposeCsrfToken } = require("./src/middlewares/csrf");
const { attachViewLocals } = require("./src/middlewares/viewLocals");
const { loadCurrentUser } = require("./src/middlewares/auth");
const { registerRoutes } = require("./src/routes");
const { notFoundHandler } = require("./src/middlewares/notFound");
const { errorHandler } = require("./src/middlewares/errorHandler");
const { AppError } = require("./src/utils/AppError");
const { getBetterAuthModule } = require("./src/utils/betterAuthBridge");

const app = express();
app.set("trust proxy", 1);

initDatabase();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));

app.use(requestIdMiddleware);
app.use(pinoHttpLogger);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: env.isProd ? [] : null
      }
    }
  })
);

const BODY_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const ACCEPTED_BODY_TYPES = ["application/x-www-form-urlencoded", "application/json", "multipart/form-data"];

function validateContentType(req, _res, next) {
  if (!BODY_METHODS.has(req.method)) return next();
  const currentPath = req.originalUrl || req.path || "";
  if (currentPath.startsWith("/payments/paypal/webhook")) return next();

  if (!req.headers["content-type"]) return next();
  if (req.is(ACCEPTED_BODY_TYPES)) return next();

  return next(new AppError("Content-Type non supporté.", 415, "UNSUPPORTED_CONTENT_TYPE"));
}

app.use(validateContentType);

if (env.betterAuthEnabled) {
  app.all("/api/auth/*", async (req, res, next) => {
    try {
      const mod = await getBetterAuthModule();
      const auth = mod.getAuth();
      return mod.toNodeHandler(auth)(req, res);
    } catch (err) {
      return next(err);
    }
  });
}

app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.json({ limit: "64kb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || env.appUrl)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true
  })
);

app.use(cookieParser(env.cookieSecret));
app.use(
  session({
    name: "zando243.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProd,
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

applySecurityMiddlewares(app);

app.use("/public", express.static(path.join(__dirname, "src/public")));
app.use("/.well-known", express.static(path.join(__dirname, "src/public/.well-known")));
// /invoices supprimé — les factures sont servies via GET /orders/:id/invoice (authentifié)

app.use(loadCurrentUser);
app.use(csrfProtection);
app.use(exposeCsrfToken);
app.use(attachViewLocals);

registerRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
