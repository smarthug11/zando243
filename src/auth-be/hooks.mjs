import { createAuthMiddleware, APIError } from "better-auth/api";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { defineModels } = require("../models/index.js");
const { createAuditLog } = require("../services/auditLogService.js");
const { validatePasswordPolicy } = require("../utils/passwordPolicy.js");

function enforcePasswordPolicy(password) {
  if (!password) return;
  const msg = validatePasswordPolicy(password);
  if (msg) throw new APIError("BAD_REQUEST", { message: msg, code: "WEAK_PASSWORD" });
}

async function getSessionFromContext(ctx) {
  if (ctx.context?.session?.user) return ctx.context.session;
  if (ctx.context?.session?.session?.user) return ctx.context.session.session;
  try {
    const headers = ctx.headers || ctx.request?.headers || null;
    if (headers) {
      const session = await ctx.context?.getSession?.({ headers });
      if (session?.user) return session;
    }
  } catch (_e) { /* fallthrough */ }
  try {
    const cookieHeader =
      (typeof ctx.headers?.get === "function" ? ctx.headers.get("cookie") : null) ||
      (typeof ctx.request?.headers?.get === "function" ? ctx.request.headers.get("cookie") : null) ||
      "";
    const m = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
    if (!m) return null;
    const raw = decodeURIComponent(m[1]);
    const token = raw.includes(".") ? raw.split(".")[0] : raw;
    const internal = ctx.context?.internalAdapter;
    if (internal?.findSession) {
      const s = await internal.findSession(token);
      if (s?.user) return s;
      if (s?.session) {
        const user = await internal.findUserById?.(s.session.userId);
        if (user) return { session: s.session, user };
      }
    }
  } catch (_e) { /* swallow */ }
  return null;
}

export const beforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    enforcePasswordPolicy(ctx.body?.password);
  }
  if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
    enforcePasswordPolicy(ctx.body?.newPassword || ctx.body?.password);
  }
  if (ctx.path === "/sign-out") {
    const session = await getSessionFromContext(ctx);
    const u = session?.user || null;
    await createAuditLog({
      category: "AUTH",
      action: "USER_LOGOUT",
      message: u?.email ? `Déconnexion utilisateur ${u.email}` : "Déconnexion utilisateur (session inconnue)",
      actorUserId: u?.id || null,
      actorEmail: u?.email || null
    });
  }
});

async function mirrorUserToSequelize({ id, email, firstName, lastName, phone, emailVerified }) {
  const models = defineModels();
  const existing = await models.User.findByPk(id);
  if (existing) {
    const updates = {};
    if (email && existing.email !== email) updates.email = email;
    if (emailVerified && !existing.emailVerifiedAt) updates.emailVerifiedAt = new Date();
    if (Object.keys(updates).length) await existing.update(updates);
    return existing;
  }
  return models.User.create({
    id,
    email,
    firstName: firstName || "",
    lastName: lastName || "",
    phone: phone || null,
    role: "CUSTOMER",
    isActive: true,
    emailVerifiedAt: emailVerified ? new Date() : null,
    loyaltyPoints: 0
  });
}

export const afterHook = createAuthMiddleware(async (ctx) => {
  const models = defineModels();

  if (ctx.path === "/sign-up/email" && ctx.context?.newSession?.user) {
    const u = ctx.context.newSession.user;
    await mirrorUserToSequelize(u);
    await createAuditLog({
      category: "AUTH",
      action: "USER_REGISTER",
      message: `Inscription utilisateur ${u.email}`,
      actorUserId: u.id,
      actorEmail: u.email
    });
    return;
  }

  if (ctx.path === "/sign-in/email" && ctx.context?.newSession?.user) {
    const u = ctx.context.newSession.user;
    await mirrorUserToSequelize(u);
    await createAuditLog({
      category: "AUTH",
      action: "USER_LOGIN",
      message: `Connexion utilisateur ${u.email}`,
      actorUserId: u.id,
      actorEmail: u.email
    });
    return;
  }


  if (ctx.path === "/verify-email") {
    const userId = ctx.context?.newSession?.user?.id || ctx.context?.session?.user?.id;
    const email = ctx.context?.newSession?.user?.email || ctx.context?.session?.user?.email;
    if (userId) {
      await models.User.update({ emailVerifiedAt: new Date() }, { where: { id: userId } });
      await createAuditLog({
        category: "AUTH",
        action: "EMAIL_VERIFIED",
        message: `Email vérifié ${email || ""}`.trim(),
        actorUserId: userId,
        actorEmail: email
      });
    }
    return;
  }

  if (ctx.path === "/reset-password") {
    // La révocation effective des sessions est assurée nativement par Better Auth
    // (option revokeSessionsOnPasswordReset). Ici on ne fait plus que tracer l'événement.
    const userId = ctx.context?.session?.user?.id || ctx.context?.newSession?.user?.id;
    if (userId) {
      await createAuditLog({
        category: "AUTH",
        action: "PASSWORD_RESET",
        message: `Réinitialisation mot de passe`,
        actorUserId: userId
      });
    }
    return;
  }
});
