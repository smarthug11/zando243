const express = require("express");
const { requireGuest } = require("../middlewares/auth");
const { loginRateLimit, registerRateLimit, resetPasswordRateLimit } = require("../middlewares/rateLimit");
const ctrl = require("../controllers/auth2Controller");

const router = express.Router();

router.get("/register", requireGuest, ctrl.showRegister);
router.post("/register", requireGuest, registerRateLimit, ctrl.register);
router.get("/login", requireGuest, ctrl.showLogin);
router.post("/login", requireGuest, loginRateLimit, ctrl.login);
router.post("/logout", ctrl.logout);
router.get("/forgot-password", requireGuest, ctrl.showForgotPassword);
router.post("/forgot-password", requireGuest, resetPasswordRateLimit, ctrl.requestPasswordReset);
router.get("/reset-password", requireGuest, ctrl.showResetPassword);
router.post("/reset-password", requireGuest, resetPasswordRateLimit, ctrl.resetPassword);

module.exports = router;
