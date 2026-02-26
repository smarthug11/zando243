const { sequelize, defineModels } = require("../models");
const { computeCartTotals, loadCart } = require("./cartService");
const { validateCoupon, recordCouponRedemption } = require("./promoService");
const { generateInvoicePdf } = require("./invoiceService");
const { grantPointsForDeliveredOrder } = require("./loyaltyService");
const { sendOrderInvoiceEmail } = require("./emailService");
const { AppError } = require("../utils/AppError");
const { computeCheckoutLineTotal, round2 } = require("../utils/pricing");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const path = require("path");
const { createAuditLog } = require("./auditLogService");

defineModels();

function generateOrderNumber() {
  return `ORD-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 90000))}`;
}

function generateTrackingNumberCandidate({ doorDelivery = false } = {}) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(100000 + Math.random() * 900000));
  const mode = doorDelivery ? "D" : "R"; // D = door delivery, R = retrait bureau
  return `ITS-${mode}-${y}${m}${d}-${rand}`;
}

async function generateUniqueTrackingNumber({ doorDelivery = false, transaction } = {}) {
  const models = defineModels();
  for (let i = 0; i < 10; i += 1) {
    const candidate = generateTrackingNumberCandidate({ doorDelivery });
    const exists = await models.Order.findOne({
      where: { trackingNumber: candidate },
      attributes: ["id"],
      transaction
    });
    if (!exists) return candidate;
  }
  // Fallback ultra-peu probable si collisions répétées
  const fallback = `ITS-${doorDelivery ? "D" : "R"}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  return fallback;
}

async function getUserDefaultAddress(userId) {
  const models = defineModels();
  return models.Address.findOne({ where: { userId, isDefault: true } }) || models.Address.findOne({ where: { userId } });
}

async function getUserAddressById(userId, addressId) {
  const models = defineModels();
  if (!addressId) return getUserDefaultAddress(userId);
  return models.Address.findOne({ where: { id: addressId, userId } });
}

function getPickupOfficeAddress() {
  return { ...env.pickupOfficeAddress };
}

async function createOrderFromCart(req, { paymentMethod, couponCode, doorDelivery = false, addressId = null }) {
  const models = defineModels();
  if (!req.user) throw new AppError("Authentification requise", 401, "AUTH_REQUIRED");
  const cart = await loadCart(req);
  const items = (cart?.items || []).filter((i) => !i.savedForLater);
  if (!items.length) throw new AppError("Panier vide", 400, "EMPTY_CART");
  const address = doorDelivery ? await getUserAddressById(req.user.id, addressId) : getPickupOfficeAddress();
  if (!address) throw new AppError("Adresse requise pour commander", 400, "ADDRESS_REQUIRED");

  const baseTotals = computeCartTotals(cart);
  const { coupon, discountAmount } = await validateCoupon({
    code: couponCode,
    userId: req.user.id,
    subtotal: baseTotals.subtotal
  });

  const shippingFee = doorDelivery ? 5 : 0;
  const subtotal = round2(
    items.reduce(
      (sum, item) =>
        sum +
        computeCheckoutLineTotal({
          priceWithoutDelivery: Number(item.product.priceWithoutDelivery),
          weightKg: Number(item.product.weightKg),
          qty: item.qty
        }),
      0
    )
  );
  const total = round2(Math.max(0, subtotal + shippingFee - discountAmount));

  const order = await sequelize.transaction(async (transaction) => {
    for (const item of items) {
      if (item.product.stock < item.qty) throw new AppError(`Stock insuffisant pour ${item.product.name}`, 400, "OUT_OF_STOCK");
    }
    const trackingNumber = await generateUniqueTrackingNumber({ doorDelivery, transaction });
    const created = await models.Order.create(
      {
        orderNumber: generateOrderNumber(),
        userId: req.user.id,
        addressSnapshot: {
          label: address.label,
          number: address.number,
          street: address.street,
          neighborhood: address.neighborhood,
          municipality: address.municipality,
          city: address.city,
          country: address.country
        },
        subtotal,
        shippingFee,
        discountTotal: discountAmount,
        total,
        couponCode: coupon?.code || null,
        paymentMethod: paymentMethod || "CASH_ON_DELIVERY",
        status: "Processing",
        trackingNumber,
        trackingCarrier: "ITS Logistics"
      },
      { transaction }
    );

    for (const item of items) {
      const unitPrice = Number(item.product.priceWithoutDelivery);
      const lineTotal = computeCheckoutLineTotal({
        priceWithoutDelivery: unitPrice,
        weightKg: Number(item.product.weightKg),
        qty: item.qty
      });
      await models.OrderItem.create(
        {
          orderId: created.id,
          productId: item.productId,
          productSnapshot: {
            name: item.product.name,
            sku: item.product.sku,
            weightKg: Number(item.product.weightKg),
            priceWithoutDelivery: unitPrice,
            finalPrice: Number(item.product.finalPrice)
          },
          unitPrice,
          qty: item.qty,
          lineTotal
        },
        { transaction }
      );

      await models.Product.decrement({ stock: item.qty }, { where: { id: item.productId }, transaction });
      await models.Product.increment({ popularityScore: item.qty }, { where: { id: item.productId }, transaction });
    }

    await models.OrderStatusHistory.create(
      { orderId: created.id, status: "Processing", note: "Commande créée" },
      { transaction }
    );

    if (coupon) {
      await recordCouponRedemption({ couponId: coupon.id, userId: req.user.id, orderId: created.id, transaction });
    }

    await models.CartItem.destroy({ where: { cartId: cart.id, savedForLater: false }, transaction });
    await models.Notification.create(
      { userId: req.user.id, type: "ORDER_CREATED", message: `Commande ${created.orderNumber} créée.` },
      { transaction }
    );

    return created;
  });

  const hydrated = await models.Order.findByPk(order.id, {
    include: [{ model: models.OrderItem, as: "items" }, models.User]
  });
  await generateInvoicePdf(hydrated);
  try {
    await sendOrderInvoiceEmail(hydrated, {
      attachmentPath: path.join(env.invoiceDir, `${hydrated.orderNumber}.pdf`)
    });
  } catch (emailErr) {
    // L'email ne doit jamais casser la finalisation de commande.
    logger.warn({ err: emailErr, orderNumber: hydrated.orderNumber }, "Echec envoi email facture");
  }
  await createAuditLog({
    category: "ORDER",
    action: "ORDER_CREATED",
    message: `Commande ${hydrated.orderNumber} créée`,
    actorUserId: req.user.id,
    actorEmail: req.user.email,
    requestId: req.requestId,
    req,
    meta: {
      orderId: hydrated.id,
      total: hydrated.total,
      paymentMethod: hydrated.paymentMethod,
      status: hydrated.status
    }
  });
  return hydrated;
}

async function listUserOrders(userId) {
  const models = defineModels();
  return models.Order.findAll({
    where: { userId },
    include: [{ model: models.OrderItem, as: "items" }],
    order: [["createdAt", "DESC"]]
  });
}

async function getUserOrder(userId, orderId) {
  const models = defineModels();
  return models.Order.findOne({
    where: { id: orderId, userId },
    include: [
      { model: models.OrderItem, as: "items" },
      { model: models.OrderStatusHistory, as: "statusHistory" },
      { model: models.ReturnRequest, as: "returnRequest", required: false }
    ]
  });
}

async function requestReturn(userId, orderId, reason) {
  const models = defineModels();
  const order = await models.Order.findOne({ where: { id: orderId, userId } });
  if (!order) throw new AppError("Commande introuvable", 404, "ORDER_NOT_FOUND");
  if (order.status === "Delivered") {
    throw new AppError("Retour refusé: commande déjà livrée", 400, "RETURN_NOT_ALLOWED_DELIVERED");
  }
  return models.ReturnRequest.upsert({ orderId, reason, status: "Requested" });
}

async function updateOrderStatus(orderId, status, note = null) {
  const models = defineModels();
  const order = await models.Order.findByPk(orderId);
  if (!order) throw new AppError("Commande introuvable", 404, "ORDER_NOT_FOUND");
  const prevStatus = order.status;
  order.status = status;
  await order.save();
  await models.OrderStatusHistory.create({ orderId: order.id, status, note });
  if (status === "Delivered" && prevStatus !== "Delivered") {
    await sequelize.transaction(async (t) => {
      await grantPointsForDeliveredOrder(order, t);
      await models.Notification.create(
        { userId: order.userId, type: "ORDER_STATUS", message: `Commande ${order.orderNumber} livrée.` },
        { transaction: t }
      );
    });
  }
  if (status === "Cancelled") {
    const items = await models.OrderItem.findAll({ where: { orderId: order.id } });
    for (const item of items) {
      if (item.productId) {
        await models.Product.increment({ stock: item.qty }, { where: { id: item.productId } });
      }
    }
  }
  await createAuditLog({
    category: "ORDER",
    action: "ORDER_STATUS_UPDATED",
    message: `Commande ${order.orderNumber} -> ${status}`,
    meta: { orderId: order.id, previousStatus: prevStatus, status, note }
  });
  return order;
}

module.exports = {
  createOrderFromCart,
  listUserOrders,
  getUserOrder,
  requestReturn,
  updateOrderStatus
};
