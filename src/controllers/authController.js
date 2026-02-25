const { body } = require("express-validator");
const { handleValidation } = require("../middlewares/validators");
const { asyncHandler } = require("../utils/asyncHandler");
const authService = require("../services/authService");
const { setFlash } = require("../middlewares/viewLocals");
const { mergeGuestCartIntoUser } = require("../services/cartService");
const { createAuditLog } = require("../services/auditLogService");

const registerValidators = [
  body("firstName").isLength({ min: 2 }),
  body("lastName").isLength({ min: 2 }),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  handleValidation
];

const loginValidators = [body("email").isEmail(), body("password").isLength({ min: 6 }), handleValidation];
const resetReqValidators = [body("email").isEmail(), handleValidation];
const resetValidators = [body("password").isLength({ min: 8 }), handleValidation];

const showRegister = (_req, res) => res.render("pages/auth/register", { title: "Inscription" });
const showLogin = (_req, res) => res.render("pages/auth/login", { title: "Connexion" });
const showForgotPassword = (_req, res) => res.render("pages/auth/forgot-password", { title: "Mot de passe oublié" });
const showResetPassword = (req, res) => res.render("pages/auth/reset-password", { title: "Réinitialiser", token: req.params.token });

const register = asyncHandler(async (req, res) => {
  const { user, emailVerificationToken } = await authService.registerUser(req.body);
  await createAuditLog({
    category: "AUTH",
    action: "USER_REGISTER",
    message: `Inscription utilisateur ${user.email}`,
    actorUserId: user.id,
    actorEmail: user.email,
    requestId: req.requestId,
    req,
    meta: { role: user.role }
  });
  authService.setAuthCookies(req, res, user);
  await mergeGuestCartIntoUser(req, user.id);
  setFlash(req, "success", `Compte créé. Token vérification (démo): ${emailVerificationToken}`);
  res.redirect("/");
});

const login = asyncHandler(async (req, res) => {
  const user = await authService.loginUser(req.body);
  await createAuditLog({
    category: "AUTH",
    action: "USER_LOGIN",
    message: `Connexion utilisateur ${user.email}`,
    actorUserId: user.id,
    actorEmail: user.email,
    requestId: req.requestId,
    req
  });
  authService.setAuthCookies(req, res, user);
  await mergeGuestCartIntoUser(req, user.id);
  setFlash(req, "success", "Connexion réussie.");
  res.redirect(user.role === "ADMIN" ? "/admin" : "/");
});

const refresh = asyncHandler(async (req, res) => {
  const user = await authService.refreshSession(req.cookies.refreshToken);
  authService.setAuthCookies(req, res, user);
  res.json({ ok: true });
});

const logout = asyncHandler(async (req, res) => {
  const actor = req.user;
  if (req.user) await authService.logoutUser(req.user.id);
  if (actor) {
    await createAuditLog({
      category: "AUTH",
      action: "USER_LOGOUT",
      message: `Déconnexion utilisateur ${actor.email}`,
      actorUserId: actor.id,
      actorEmail: actor.email,
      requestId: req.requestId,
      req
    });
  }
  authService.clearAuthCookies(req, res);
  setFlash(req, "success", "Déconnecté.");
  res.redirect("/");
});

const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmailToken(req.params.token);
  setFlash(req, "success", "Email vérifié.");
  res.redirect("/account/profile");
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  const result = await authService.createResetToken(req.body.email);
  setFlash(req, "success", result ? `Token reset (démo): ${result.token}` : "Si le compte existe, un email a été envoyé.");
  res.redirect("/auth/login");
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.params.token, req.body.password);
  setFlash(req, "success", "Mot de passe mis à jour.");
  res.redirect("/auth/login");
});

module.exports = {
  registerValidators,
  loginValidators,
  resetReqValidators,
  resetValidators,
  showRegister,
  showLogin,
  showForgotPassword,
  showResetPassword,
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  requestPasswordReset,
  resetPassword
};
