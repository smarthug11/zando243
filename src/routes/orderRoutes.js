const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/orderController");

const router = express.Router();
router.use(requireAuth);
router.get("/", ctrl.listOrders);
router.get("/:id", ctrl.orderDetail);
router.get("/:id/invoice", ctrl.downloadInvoice);
router.post("/:id/return-request", ctrl.returnRequest);

module.exports = router;
