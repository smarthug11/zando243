const { asyncHandler } = require("../utils/asyncHandler");
const { setFlash } = require("../middlewares/viewLocals");
const { getBetterAuthModule } = require("../utils/betterAuthBridge");
const { mergeGuestCartIntoUser } = require("../services/cartService");
const { defineModels } = require("../models");
const { env } = require("../config/env");
const emailService = require("../services/emailService");

function clearBaCookies(res) {
  const opts = { path: "/", httpOnly: true, sameSite: "lax", secure: env.isProd };
  res.clearCookie("better-auth.session_token", opts);
  res.clearCookie("better-auth.session_data", opts);
}

defineModels();

function buildHeaders(req) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    if (k.toLowerCase() === "origin") continue;
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.append(k, String(v));
  }
  h.set("origin", process.env.BETTER_AUTH_URL || process.env.APP_URL || "http://localhost:3000");
  return h;
}

async function propagateSetCookie(authResponse, res) {
  if (!authResponse?.headers) return;
  const setCookies = typeof authResponse.headers.getSetCookie === "function"
    ? authResponse.headers.getSetCookie()
    : (authResponse.headers.get("set-cookie") ? [authResponse.headers.get("set-cookie")] : []);
  for (const c of setCookies) if (c) res.append("Set-Cookie", c);
}

async function readJsonSafely(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

const showRegister = (_req, res) => res.render("pages/auth2/register", { title: "Inscription" });
const showLogin = (_req, res) => res.render("pages/auth2/login", { title: "Connexion" });
const showForgotPassword = (_req, res) => res.render("pages/auth2/forgot-password", { title: "Mot de passe oublié" });
const showResetPassword = (req, res) =>
  res.render("pages/auth2/reset-password", { title: "Réinitialiser", token: req.query.token || "" });

const register = asyncHandler(async (req, res) => {
  const { getAuth } = await getBetterAuthModule();
  const auth = getAuth();
  const headers = buildHeaders(req);

  try {
    const response = await auth.handler(new Request(`${process.env.BETTER_AUTH_URL || "http://localhost"}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({
        email: String(req.body.email || "").toLowerCase(),
        password: String(req.body.password || ""),
        name: `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim() || "User",
        firstName: String(req.body.firstName || ""),
        lastName: String(req.body.lastName || ""),
        phone: req.body.phone ? String(req.body.phone) : undefined
      })
    }));
    await propagateSetCookie(response, res);
    const payload = await readJsonSafely(response);

    if (!response.ok) {
      // Anti-énumération (ASVS) : si l'email est déjà utilisé, on répond exactement
      // comme pour une inscription réussie afin de ne pas révéler l'existence du compte.
      // Les autres erreurs (mot de passe faible, email invalide…) ne divulguent rien
      // et restent affichées telles quelles pour aider l'utilisateur légitime.
      const code = String(payload?.code || "");
      const message = String(payload?.message || "");
      const accountAlreadyExists =
        /USER_ALREADY_EXISTS|EXISTING_EMAIL|ALREADY_REGISTERED/i.test(code) ||
        /already\s*exist|already\s*registered|existe\s*déjà|déjà\s*utilis|déjà\s*enregistr/i.test(message);
      if (accountAlreadyExists) {
        // On prévient le titulaire réel hors-bande (fire-and-forget : ne pas await pour
        // ne pas créer de différence de timing exploitable côté énumération).
        emailService
          .sendExistingAccountNotice(String(req.body.email || "").toLowerCase())
          .catch(() => {});
        setFlash(req, "success", "Compte créé. Un email de vérification vous a été envoyé.");
        return res.redirect("/");
      }
      setFlash(req, "error", message || "Inscription impossible.");
      return res.redirect("/auth2/register");
    }
    if (payload?.user?.id) {
      try { await mergeGuestCartIntoUser(req, payload.user.id); } catch (_e) { /* ignore */ }
    }
    setFlash(req, "success", "Compte créé. Un email de vérification vous a été envoyé.");
    return res.redirect("/");
  } catch (err) {
    setFlash(req, "error", "Inscription impossible.");
    return res.redirect("/auth2/register");
  }
});

const login = asyncHandler(async (req, res) => {
  const { getAuth } = await getBetterAuthModule();
  const auth = getAuth();
  const headers = buildHeaders(req);
  const emailLower = String(req.body.email || "").toLowerCase();

  try {
    const response = await auth.handler(new Request(`${process.env.BETTER_AUTH_URL || "http://localhost"}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({
        email: emailLower,
        password: String(req.body.password || "")
      })
    }));
    await propagateSetCookie(response, res);
    const payload = await readJsonSafely(response);

    if (!response.ok) {
      setFlash(req, "error", payload?.message || "Identifiants invalides.");
      return res.redirect("/auth2/login");
    }
    if (payload?.user?.id) {
      try { await mergeGuestCartIntoUser(req, payload.user.id); } catch (_e) { /* ignore */ }
      const models = defineModels();
      const dbUser = await models.User.findByPk(payload.user.id);
      setFlash(req, "success", "Connexion réussie.");
      return res.redirect(dbUser?.role === "ADMIN" ? "/admin" : "/");
    }
    return res.redirect("/");
  } catch (err) {
    setFlash(req, "error", "Connexion impossible.");
    return res.redirect("/auth2/login");
  }
});

const logout = asyncHandler(async (req, res) => {
  try {
    const { getAuth } = await getBetterAuthModule();
    const auth = getAuth();
    const headers = buildHeaders(req);
    const response = await auth.handler(new Request(`${process.env.BETTER_AUTH_URL || "http://localhost"}/api/auth/sign-out`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({})
    }));
    await propagateSetCookie(response, res);
  } catch (_e) { /* ignore */ }

  clearBaCookies(res);
  setFlash(req, "success", "Déconnecté.");
  return res.redirect("/");
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  const { getAuth } = await getBetterAuthModule();
  const auth = getAuth();
  const headers = buildHeaders(req);

  try {
    await auth.handler(new Request(`${process.env.BETTER_AUTH_URL || "http://localhost"}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({
        email: String(req.body.email || "").toLowerCase(),
        redirectTo: "/auth2/reset-password"
      })
    }));
  } catch (_e) { /* always opaque */ }
  setFlash(req, "success", "Si ce compte existe, un email de réinitialisation a été envoyé.");
  return res.redirect("/auth2/login");
});

const resetPassword = asyncHandler(async (req, res) => {
  const { getAuth } = await getBetterAuthModule();
  const auth = getAuth();
  const headers = buildHeaders(req);

  try {
    const response = await auth.handler(new Request(`${process.env.BETTER_AUTH_URL || "http://localhost"}/api/auth/reset-password`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({
        token: String(req.body.token || ""),
        newPassword: String(req.body.password || "")
      })
    }));
    await propagateSetCookie(response, res);
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      setFlash(req, "error", payload?.message || "Réinitialisation impossible.");
      return res.redirect(`/auth2/reset-password?token=${encodeURIComponent(req.body.token || "")}`);
    }
    setFlash(req, "success", "Mot de passe mis à jour.");
    return res.redirect("/auth2/login");
  } catch (err) {
    setFlash(req, "error", "Réinitialisation impossible.");
    return res.redirect("/auth2/login");
  }
});

module.exports = {
  showRegister,
  showLogin,
  showForgotPassword,
  showResetPassword,
  register,
  login,
  logout,
  requestPasswordReset,
  resetPassword
};
