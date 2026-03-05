const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/paymentController");

const router = express.Router();

router.get("/paypal/start", requireAuth, ctrl.startPayPal);
router.get("/paypal/return", requireAuth, ctrl.paypalReturn);
router.post("/paypal/webhook", ctrl.paypalWebhook);

module.exports = router;
