const path = require("path");

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

const isProd = (process.env.NODE_ENV || "development") === "production";
const PROD_SECRET_NAMES = new Set(["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "COOKIE_SECRET", "SESSION_SECRET"]);
const FORBIDDEN_SECRET_FRAGMENTS = ["change_me", "unsafe", "secret"];

function validateProductionSecret(name, value) {
  if (!isProd || !PROD_SECRET_NAMES.has(name)) return;

  const normalized = String(value).toLowerCase();
  const forbidden = FORBIDDEN_SECRET_FRAGMENTS.find((fragment) => normalized.includes(fragment));
  if (String(value).length < 32 || forbidden) {
    throw new Error(
      `Variable d'environnement ${name} invalide en production : utilisez une valeur aléatoire d'au moins 32 caractères sans placeholder.`
    );
  }
}

function requireSecret(name, devFallback) {
  const value = process.env[name];
  if (!value) {
    if (isProd) throw new Error(`Variable d'environnement manquante en production : ${name}`);
    return devFallback;
  }
  validateProductionSecret(name, value);
  return value;
}

const isTest = (process.env.NODE_ENV || "development") === "test";

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd,
  port: Number(process.env.PORT || 3000),
  appName: process.env.APP_NAME || "Zando243",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  db: {
    dialect: "postgres",
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    name: process.env.DB_NAME || (isTest ? "zando243_test" : "zando243_db"),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    logging: toBool(process.env.DB_LOG, false)
  },
  cookieSecret: requireSecret("COOKIE_SECRET", "cookie_secret_UNSAFE"),
  sessionSecret: requireSecret("SESSION_SECRET", "session_secret_UNSAFE"),
  csrfEnabled: toBool(process.env.CSRF_ENABLED, true),
  betterAuthEnabled: toBool(process.env.BETTER_AUTH_ENABLED, true),
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || (isProd ? null : "dev_betterauth_secret_UNSAFE_changeme_xxxxxxxxxxxxxxxx"),
  betterAuthUrl: process.env.BETTER_AUTH_URL || process.env.APP_URL || "http://localhost:3000",
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
  },
  devEmailSink: process.env.DEV_EMAIL_SINK || null,
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    baseUrl: process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com",
    webhookId: process.env.PAYPAL_WEBHOOK_ID || ""
  },
  pickupOfficeAddress: {
    label: process.env.PICKUP_OFFICE_LABEL || "Bureau Zando243 Kinshasa",
    number: process.env.PICKUP_OFFICE_NUMBER || "17B",
    street: process.env.PICKUP_OFFICE_STREET || "Avenue Colonel Ebeya",
    neighborhood: process.env.PICKUP_OFFICE_NEIGHBORHOOD || "Gombe",
    municipality: process.env.PICKUP_OFFICE_MUNICIPALITY || "Gombe",
    city: process.env.PICKUP_OFFICE_CITY || "Kinshasa",
    country: process.env.PICKUP_OFFICE_COUNTRY || "RDC"
  }
};

module.exports = { env };
