import { betterAuth } from "better-auth";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { memoryAdapter } from "better-auth/adapters/memory";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { beforeHook, afterHook } from "./hooks.mjs";

const require = createRequire(import.meta.url);
const emailService = require("../services/emailService.js");

function buildPool() {
  if (process.env.DATABASE_URL) {
    return new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return new pg.Pool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "zando243_db"
  });
}

let _auth = null;

export function resetAuthForTests() {
  _auth = null;
}

// Origines de confiance pour la validation CSRF/Origin de Better Auth.
// Dérivées de l'environnement (jamais codées en dur) : domaine(s) de prod via
// BETTER_AUTH_URL / APP_URL / ALLOWED_ORIGINS, + repères localhost hors production.
function buildTrustedOrigins() {
  const origins = new Set();
  const addAll = (value) => {
    if (!value) return;
    String(value)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  };
  addAll(process.env.BETTER_AUTH_URL);
  addAll(process.env.APP_URL);
  addAll(process.env.ALLOWED_ORIGINS);
  if (process.env.NODE_ENV !== "production") {
    ["http://127.0.0.1", "http://localhost", "http://127.0.0.1:3000", "http://localhost:3000"].forEach((o) =>
      origins.add(o)
    );
  }
  return Array.from(origins);
}

export function getAuth() {
  if (_auth) return _auth;

  const useMemory = process.env.NODE_ENV === "test" || process.env.BETTER_AUTH_MEMORY === "true";
  const database = useMemory
    ? memoryAdapter({ auth_user: [], auth_session: [], auth_account: [], auth_verification: [] })
    : buildPool();

  _auth = betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || process.env.APP_URL || "http://localhost:3000",
    logger: { level: process.env.BETTER_AUTH_LOG_LEVEL || "error" },
    trustedOrigins: buildTrustedOrigins(),
    advanced: {
      database: { generateId: () => randomUUID() },
      cookiePrefix: "better-auth"
    },
    user: {
      modelName: "auth_user",
      additionalFields: {
        role:      { type: "string", defaultValue: "CUSTOMER", input: false, returned: true },
        firstName: { type: "string", required: true,  input: true,  returned: true },
        lastName:  { type: "string", required: true,  input: true,  returned: true },
        phone:     { type: "string", required: false, input: true,  returned: true }
      }
    },
    session:      { modelName: "auth_session" },
    account:      { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 72,
      requireEmailVerification: false,
      // Révoque TOUTES les sessions existantes lors d'une réinitialisation de mot de passe :
      // un reset signifie « compte peut-être compromis » → on éjecte un éventuel attaquant
      // déjà connecté. Mécanisme natif Better Auth (api/routes/password -> deleteSessions).
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        try { await emailService.sendResetPasswordEmail(user.email, url); }
        catch (e) { console.error("[BetterAuth] sendResetPasswordEmail failed:", e?.message); }
      }
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        try { await emailService.sendVerificationEmail(user.email, url); }
        catch (e) { console.error("[BetterAuth] sendVerificationEmail failed:", e?.message); }
      },
      sendOnSignUp: true,
      autoSignInAfterVerification: true
    },
    hooks: { before: beforeHook, after: afterHook }
  });

  return _auth;
}

export { toNodeHandler, fromNodeHeaders };
