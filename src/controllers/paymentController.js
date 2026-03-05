const { asyncHandler } = require("../utils/asyncHandler");
const { setFlash } = require("../middlewares/viewLocals");
const { defineModels } = require("../models");
const { env } = require("../config/env");
const { createCheckoutOrder, captureCheckoutOrder, verifyWebhookSignature } = require("../services/paypalService");
const { markOrderAsPaid } = require("../services/orderService");
const { createAuditLog } = require("../services/auditLogService");

defineModels();

const startPayPal = asyncHandler(async (req, res) => {
  const models = defineModels();
  if (!env.paypal.clientId || !env.paypal.clientSecret) {
    setFlash(req, "error", "PayPal n'est pas configure sur le serveur.");
    return res.redirect("/cart");
  }
  const order = await models.Order.findOne({ where: { id: req.query.orderId, userId: req.user.id } });
  if (!order) {
    setFlash(req, "error", "Commande introuvable.");
    return res.redirect("/orders");
  }
  if (order.paymentMethod !== "PAYPAL") {
    setFlash(req, "error", "Cette commande n'utilise pas PayPal.");
    return res.redirect(`/orders/${order.id}`);
  }
  if (order.paymentStatus === "PAID") {
    setFlash(req, "success", "Cette commande est deja payee.");
    return res.redirect(`/orders/${order.id}`);
  }

  const returnUrl = `${env.appUrl}/payments/paypal/return`;
  const cancelUrl = `${env.appUrl}/orders/${order.id}`;
  const { paypalOrderId, approveUrl } = await createCheckoutOrder({ localOrder: order, returnUrl, cancelUrl });

  await order.update({
    paymentProvider: "PAYPAL",
    paymentReference: paypalOrderId
  });

  await createAuditLog({
    category: "PAYMENT",
    action: "PAYPAL_ORDER_CREATED",
    message: `Demarrage paiement PayPal pour ${order.orderNumber}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { orderId: order.id, paypalOrderId }
  });

  res.redirect(approveUrl);
});

const paypalReturn = asyncHandler(async (req, res) => {
  const models = defineModels();
  const paypalOrderId = req.query.token;
  if (!paypalOrderId) {
    setFlash(req, "error", "Retour PayPal invalide.");
    return res.redirect("/orders");
  }
  const existing = await models.Order.findOne({ where: { paymentReference: paypalOrderId, userId: req.user.id } });
  if (existing && existing.paymentStatus === "PAID") {
    setFlash(req, "success", "Paiement PayPal deja confirme.");
    return res.redirect(`/orders/${existing.id}`);
  }

  let captured;
  try {
    captured = await captureCheckoutOrder(paypalOrderId);
  } catch (_err) {
    setFlash(req, "error", "Le paiement PayPal a echoue ou a ete annule.");
    return res.redirect("/orders");
  }
  const localOrderId = captured?.purchase_units?.[0]?.reference_id || existing?.id;
  if (!localOrderId) {
    setFlash(req, "error", "Impossible de rattacher ce paiement a une commande.");
    return res.redirect("/orders");
  }

  const order = await models.Order.findOne({ where: { id: localOrderId, userId: req.user.id } });
  if (!order) {
    setFlash(req, "error", "Commande introuvable.");
    return res.redirect("/orders");
  }

  const isCompleted = captured?.status === "COMPLETED";
  if (isCompleted) {
    await markOrderAsPaid(order.id, { provider: "PAYPAL", reference: paypalOrderId });
    await createAuditLog({
      category: "PAYMENT",
      action: "PAYPAL_CAPTURE_COMPLETED",
      message: `Paiement PayPal confirme pour ${order.orderNumber}`,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      requestId: req.requestId,
      req,
      meta: { orderId: order.id, paypalOrderId, status: captured.status }
    });
    setFlash(req, "success", "Paiement PayPal confirme.");
  } else {
    await order.update({ paymentStatus: "FAILED", paymentProvider: "PAYPAL", paymentReference: paypalOrderId });
    setFlash(req, "error", "Le paiement PayPal n'a pas ete confirme.");
  }

  res.redirect(`/orders/${order.id}`);
});

const paypalWebhook = asyncHandler(async (req, res) => {
  const models = defineModels();
  const signatureOk = await verifyWebhookSignature(req);
  if (!signatureOk) return res.status(400).json({ ok: false, error: "INVALID_SIGNATURE" });

  const event = req.body || {};
  const eventType = event.event_type || "";
  if (eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "CHECKOUT.ORDER.APPROVED") {
    const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id || event.resource?.id;
    if (paypalOrderId) {
      const order = await models.Order.findOne({ where: { paymentReference: paypalOrderId } });
      if (order) {
        await markOrderAsPaid(order.id, { provider: "PAYPAL", reference: paypalOrderId });
      }
    }
  }
  return res.json({ ok: true });
});

module.exports = {
  startPayPal,
  paypalReturn,
  paypalWebhook
};
