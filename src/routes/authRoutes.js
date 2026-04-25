const express = require("express");
const { requireGuest } = require("../middlewares/auth");
const { loginRateLimit, registerRateLimit, resetPasswordRateLimit } = require("../middlewares/rateLimit");
const ctrl = require("../controllers/authController");

const router = express.Router();
router.get("/register", requireGuest, ctrl.showRegister);
router.post("/register", requireGuest, registerRateLimit, ...ctrl.registerValidators, ctrl.register);
router.get("/login", requireGuest, ctrl.showLogin);
router.post("/login", requireGuest, loginRateLimit, ...ctrl.loginValidators, ctrl.login);
router.post("/refresh", ctrl.refresh);
router.post("/logout", ctrl.logout);
router.get("/verify-email/:token", ctrl.verifyEmail);
router.get("/forgot-password", requireGuest, ctrl.showForgotPassword);
router.post("/forgot-password", requireGuest, resetPasswordRateLimit, ...ctrl.resetReqValidators, ctrl.requestPasswordReset);
router.get("/reset-password/:token", requireGuest, ctrl.showResetPassword);
router.post("/reset-password/:token", requireGuest, resetPasswordRateLimit, ...ctrl.resetValidators, ctrl.resetPassword);

module.exports = router;
