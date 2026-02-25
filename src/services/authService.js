const bcrypt = require("bcrypt");
const { createHash, randomBytes } = require("crypto");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../config/jwt");
const { defineModels } = require("../models");
const { AppError } = require("../utils/AppError");

defineModels();

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.app.get("env") === "production"
  };
}

function setAuthCookies(req, res, user) {
  res.cookie("accessToken", signAccessToken(user), { ...cookieOptions(req), maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", signRefreshToken(user), { ...cookieOptions(req), maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearAuthCookies(req, res) {
  res.clearCookie("accessToken", cookieOptions(req));
  res.clearCookie("refreshToken", cookieOptions(req));
}

async function registerUser(payload) {
  const models = defineModels();
  const exists = await models.User.findOne({ where: { email: payload.email.toLowerCase() } });
  if (exists) throw new AppError("Email déjà utilisé", 409, "EMAIL_EXISTS");
  const emailVerificationToken = randomBytes(20).toString("hex");
  const user = await models.User.create({
    role: "CUSTOMER",
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email.toLowerCase(),
    phone: payload.phone || null,
    passwordHash: await bcrypt.hash(payload.password, 10),
    emailVerificationTokenHash: createHash("sha256").update(emailVerificationToken).digest("hex"),
    loyaltyPoints: 0,
    isActive: true
  });
  return { user, emailVerificationToken };
}

async function loginUser({ email, password }) {
  const models = defineModels();
  const user = await models.User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError("Identifiants invalides", 401, "BAD_CREDENTIALS");
  if (!user.isActive) throw new AppError("Compte bloqué", 403, "ACCOUNT_BLOCKED");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError("Identifiants invalides", 401, "BAD_CREDENTIALS");
  return user;
}

async function refreshSession(token) {
  const models = defineModels();
  if (!token) throw new AppError("Refresh token manquant", 401, "REFRESH_MISSING");
  const payload = verifyRefreshToken(token);
  const user = await models.User.findByPk(payload.sub);
  if (!user || !user.isActive) throw new AppError("Session invalide", 401, "REFRESH_INVALID");
  if ((user.refreshTokenVersion || 0) !== payload.version) throw new AppError("Session expirée", 401, "REFRESH_REVOKED");
  return user;
}

async function logoutUser(userId) {
  const models = defineModels();
  if (!userId) return;
  await models.User.increment({ refreshTokenVersion: 1 }, { where: { id: userId } });
}

async function verifyEmailToken(token) {
  const models = defineModels();
  const hash = createHash("sha256").update(token).digest("hex");
  const user = await models.User.findOne({ where: { emailVerificationTokenHash: hash } });
  if (!user) throw new AppError("Token invalide", 400, "VERIFY_TOKEN_INVALID");
  user.emailVerifiedAt = new Date();
  user.emailVerificationTokenHash = null;
  await user.save();
  return user;
}

async function createResetToken(email) {
  const models = defineModels();
  const user = await models.User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) return null;
  const token = randomBytes(20).toString("hex");
  user.resetPasswordTokenHash = createHash("sha256").update(token).digest("hex");
  user.resetPasswordExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  return { user, token };
}

async function resetPassword(token, password) {
  const models = defineModels();
  const hash = createHash("sha256").update(token).digest("hex");
  const user = await models.User.findOne({ where: { resetPasswordTokenHash: hash } });
  if (!user || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
    throw new AppError("Token de réinitialisation invalide/expiré", 400, "RESET_INVALID");
  }
  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpiresAt = null;
  user.refreshTokenVersion += 1;
  await user.save();
  return user;
}

module.exports = {
  setAuthCookies,
  clearAuthCookies,
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  verifyEmailToken,
  createResetToken,
  resetPassword
};
