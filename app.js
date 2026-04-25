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

const app = express();
app.set("trust proxy", 1);

initDatabase();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));

app.use(requestIdMiddleware);
app.use(pinoHttpLogger);
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
// /invoices supprimé — les factures sont servies via GET /orders/:id/invoice (authentifié)

app.use(loadCurrentUser);
app.use(csrfProtection);
app.use(exposeCsrfToken);
app.use(attachViewLocals);

registerRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
