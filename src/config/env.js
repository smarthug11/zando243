const path = require("path");

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",
  port: Number(process.env.PORT || 3000),
  appName: process.env.APP_NAME || "Zando243",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  db: {
    dialect: (process.env.NODE_ENV || "development") === "production" ? "postgres" : "sqlite",
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    name: process.env.DB_NAME || "zando243_db",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    logging: toBool(process.env.DB_LOG, false),
    sqliteStorage: process.env.SQLITE_STORAGE || "./storage/dev.sqlite"
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || "dev_access_secret",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "dev_refresh_secret",
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "7d"
  },
  cookieSecret: process.env.COOKIE_SECRET || "cookie_secret",
  sessionSecret: process.env.SESSION_SECRET || "session_secret",
  csrfEnabled: toBool(process.env.CSRF_ENABLED, true),
  loyaltyPointsPerDollar: Number(process.env.LOYALTY_POINTS_PER_DOLLAR || 1),
  loyaltyMinOrderForPoints: Number(process.env.LOYALTY_MIN_ORDER_FOR_POINTS || 10),
  invoiceDir: path.resolve("storage/invoices"),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Zando243 <no-reply@zando243.local>"
  }
};

module.exports = { env };
