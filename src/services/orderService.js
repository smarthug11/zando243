const { sequelize, defineModels } = require("../models");
const { randomInt } = require("crypto");
const { loadCart } = require("./cartService");
const { validateCoupon, recordCouponRedemption } = require("./promoService");
const { generateInvoicePdf } = require("./invoiceService");
const { applyDeliveredOrderEffects } = require("./loyaltyService");
const { sendOrderInvoiceEmail } = require("./emailService");
const { AppError } = require("../utils/AppError");
const { computeCheckoutLineTotal, round2 } = require("../utils/pricing");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const path = require("path");
const { createAuditLog } = require("./auditLogService");

defineModels();

async function generateUniqueOrderNumber(transaction) {
  const models = defineModels();
  for (let i = 0; i < 10; i += 1) {
    const candidate = `ORD-${new Date().getFullYear()}-${String(randomInt(10000, 100000))}`;
    const exists = await models.Order.findOne({ where: { orderNumber: candidate }, attributes: ["id"], transaction });
    if (!exists) return candidate;
  }
  return `ORD-${new Date().getFullYear()}-${Date.now()}-${randomInt(0, 10000)}`;
}

function generateTrackingNumberCandidate({ doorDelivery = false } = {}) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(randomInt(100000, 1000000));
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
  const fallback = `ITS-${doorDelivery ? "D" : "R"}-${Date.now()}-${randomInt(0, 10000)}`;
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

async function clearActiveCartItemsForUser(userId) {
  const models = defineModels();
  const cart = await models.Cart.findOne({ where: { userId }, attributes: ["id"] });
  if (!cart) return 0;
  return models.CartItem.destroy({ where: { cartId: cart.id, savedForLater: false } });
}

async function createOrderFromCart(req, { paymentMethod, couponCode, doorDelivery = false, addressId = null, clearCartItems = true }) {
  const models = defineModels();
  if (!req.user) throw new AppError("Authentification requise", 401, "AUTH_REQUIRED");
  if (!req.user.emailVerifiedAt) {
    throw new AppError("Veuillez vérifier votre adresse email avant de passer commande.", 403, "EMAIL_NOT_VERIFIED");
  }
  const cart = await loadCart(req);
  const preloadedItems = (cart?.items || []).filter((i) => !i.savedForLater);
  if (!preloadedItems.length) throw new AppError("Panier vide", 400, "EMPTY_CART");
  const address = doorDelivery ? await getUserAddressById(req.user.id, addressId) : getPickupOfficeAddress();
  if (!address) throw new AppError("Adresse requise pour commander", 400, "ADDRESS_REQUIRED");

  const order = await sequelize.transaction(async (transaction) => {
    const productLockOptions = sequelize.getDialect() === "postgres" ? { lock: transaction.LOCK.UPDATE } : {};
    const lockedCartItems = await models.CartItem.findAll({
      where: { cartId: cart.id, savedForLater: false },
      include: [
        { model: models.Product, as: "product", required: true },
        { model: models.ProductVariant, as: "variant", required: false }
      ],
      order: [["createdAt", "DESC"]],
      transaction
    });

    if (!lockedCartItems.length) throw new AppError("Panier vide", 400, "EMPTY_CART");

    const activeQtyByProductId = new Map();
    const stockQtyByProductId = new Map();
    const stockQtyByVariantId = new Map();
    const productIdByVariantId = new Map();
    for (const item of lockedCartItems) {
      const itemQty = Number(item.qty || 0);
      activeQtyByProductId.set(item.productId, (activeQtyByProductId.get(item.productId) || 0) + itemQty);
      if (item.variantId) {
        stockQtyByVariantId.set(item.variantId, (stockQtyByVariantId.get(item.variantId) || 0) + itemQty);
        productIdByVariantId.set(item.variantId, item.productId);
      } else {
        stockQtyByProductId.set(item.productId, (stockQtyByProductId.get(item.productId) || 0) + itemQty);
      }
    }

    const productIds = Array.from(activeQtyByProductId.keys()).sort();
    const lockedProducts = await models.Product.findAll({
      where: { id: productIds },
      transaction,
      ...productLockOptions
    });
    const productsById = new Map(lockedProducts.map((product) => [product.id, product]));

    for (const productId of productIds) {
      const product = productsById.get(productId);
      if (!product || product.status !== "ACTIVE") {
        throw new AppError("Produit indisponible", 400, "PRODUCT_UNAVAILABLE");
      }
      const requestedQty = stockQtyByProductId.get(productId) || 0;
      if (Number(product.stock) < requestedQty) {
        throw new AppError(`Stock insuffisant pour ${product.name}`, 400, "OUT_OF_STOCK");
      }
    }

    const variantIds = Array.from(stockQtyByVariantId.keys()).sort();
    const lockedVariants = variantIds.length
      ? await models.ProductVariant.findAll({
          where: { id: variantIds },
          transaction,
          ...productLockOptions
        })
      : [];
    const variantsById = new Map(lockedVariants.map((variant) => [variant.id, variant]));

    for (const variantId of variantIds) {
      const variant = variantsById.get(variantId);
      if (!variant || variant.productId !== productIdByVariantId.get(variantId)) {
        throw new AppError("Variante indisponible", 400, "VARIANT_UNAVAILABLE");
      }
      const requestedQty = stockQtyByVariantId.get(variantId);
      if (Number(variant.stock) < requestedQty) {
        throw new AppError(`Stock insuffisant pour ${variant.name}`, 400, "OUT_OF_STOCK");
      }
    }

    const checkoutItems = lockedCartItems.map((item) => ({
      item,
      product: productsById.get(item.productId),
      variant: item.variantId ? variantsById.get(item.variantId) : null
    }));

    const subtotal = round2(
      checkoutItems.reduce(
        (sum, { item, product }) =>
          sum +
          computeCheckoutLineTotal({
            priceWithoutDelivery: Number(product.priceWithoutDelivery),
            weightKg: Number(product.weightKg),
            qty: item.qty
          }),
        0
      )
    );

    const { coupon: effectiveCoupon, discountAmount: effectiveDiscount } = await validateCoupon({
      code: couponCode,
      userId: req.user.id,
      subtotal,
      transaction
    });
    const shippingFee = doorDelivery ? 5 : 0;
    const total = round2(Math.max(0, subtotal + shippingFee - effectiveDiscount));
    const trackingNumber = await generateUniqueTrackingNumber({ doorDelivery, transaction });
    const orderNumber = await generateUniqueOrderNumber(transaction);
    const created = await models.Order.create(
      {
        orderNumber,
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
        discountTotal: effectiveDiscount,
        total,
        couponCode: effectiveCoupon?.code || null,
        paymentMethod: paymentMethod || "CASH_ON_DELIVERY",
        paymentStatus: "PENDING",
        paymentProvider: paymentMethod === "PAYPAL" || paymentMethod === "CARD" ? "PAYPAL" : null,
        status: "Processing",
        trackingNumber,
        trackingCarrier: "ITS Logistics"
      },
      { transaction }
    );

    for (const { item, product, variant } of checkoutItems) {
      const unitPrice = Number(product.priceWithoutDelivery);
      const lineTotal = computeCheckoutLineTotal({
        priceWithoutDelivery: unitPrice,
        weightKg: Number(product.weightKg),
        qty: item.qty
      });
      await models.OrderItem.create(
        {
          orderId: created.id,
          productId: item.productId,
          productSnapshot: {
            name: product.name,
            sku: product.sku,
            weightKg: Number(product.weightKg),
            priceWithoutDelivery: unitPrice,
            finalPrice: Number(product.finalPrice),
            variant: variant
              ? {
                  id: variant.id,
                  name: variant.name,
                  color: variant.color,
                  size: variant.size,
                  sku: variant.sku
                }
              : null
          },
          unitPrice,
          qty: item.qty,
          lineTotal
        },
        { transaction }
      );
    }

    for (const [productId, qty] of stockQtyByProductId) {
      await models.Product.decrement({ stock: qty }, { where: { id: productId }, transaction });
    }
    for (const [variantId, qty] of stockQtyByVariantId) {
      await models.ProductVariant.decrement({ stock: qty }, { where: { id: variantId }, transaction });
    }
    for (const [productId, qty] of activeQtyByProductId) {
      await models.Product.increment({ popularityScore: qty }, { where: { id: productId }, transaction });
    }

    await models.OrderStatusHistory.create(
      { orderId: created.id, status: "Processing", note: "Commande créée" },
      { transaction }
    );

    if (effectiveCoupon) {
      await recordCouponRedemption({ couponId: effectiveCoupon.id, userId: req.user.id, orderId: created.id, transaction });
    }

    if (clearCartItems) {
      await models.CartItem.destroy({ where: { cartId: cart.id, savedForLater: false }, transaction });
    }
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

async function markOrderAsPaid(orderId, { provider = "PAYPAL", reference = null, transaction = null } = {}) {
  const models = defineModels();
  const order = await models.Order.findByPk(orderId, { transaction });
  if (!order) throw new AppError("Commande introuvable", 404, "ORDER_NOT_FOUND");
  if (order.paymentStatus === "PAID") return order;
  await order.update(
    {
      paymentStatus: "PAID",
      paymentProvider: provider || order.paymentProvider || null,
      paymentReference: reference || order.paymentReference || null,
      paidAt: new Date()
    },
    { transaction }
  );
  return order;
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

const RETURN_ALLOWED_STATUSES = new Set(["Pending", "Processing", "Shipped"]);

async function requestReturn(userId, orderId, reason) {
  const models = defineModels();
  const order = await models.Order.findOne({ where: { id: orderId, userId } });
  if (!order) throw new AppError("Commande introuvable", 404, "ORDER_NOT_FOUND");
  if (order.status === "Delivered") {
    throw new AppError("Retour refusé: commande déjà livrée", 400, "RETURN_NOT_ALLOWED_DELIVERED");
  }
  if (!RETURN_ALLOWED_STATUSES.has(order.status)) {
    throw new AppError("Retour refusé: statut de commande non éligible", 400, "RETURN_NOT_ALLOWED_STATUS");
  }
  return models.ReturnRequest.upsert({ orderId, reason, status: "Requested" });
}

const ALLOWED_ORDER_STATUSES = new Set(["Pending", "Processing", "Shipped", "Delivered", "Cancelled", "Refunded"]);

async function updateOrderStatus(orderId, status, note = null) {
  const models = defineModels();
  if (!ALLOWED_ORDER_STATUSES.has(status)) {
    throw new AppError("Statut de commande invalide", 422, "INVALID_ORDER_STATUS");
  }
  const order = await models.Order.findByPk(orderId);
  if (!order) throw new AppError("Commande introuvable", 404, "ORDER_NOT_FOUND");
  const prevStatus = order.status;
  order.status = status;
  await order.save();
  await models.OrderStatusHistory.create({ orderId: order.id, status, note });
  if (status === "Delivered") {
    // Idempotence : les effets de livraison (points fidélité + notification) ne sont
    // appliqués qu'à la PREMIÈRE livraison, même si le statut repasse plus tard par
    // Delivered (ex. Delivered -> Shipped -> Delivered). On s'appuie sur l'historique :
    // l'entrée Delivered vient d'être créée, donc count === 1 = toute première livraison.
    const deliveredCount = await models.OrderStatusHistory.count({
      where: { orderId: order.id, status: "Delivered" }
    });
    if (deliveredCount === 1) {
      await sequelize.transaction(async (t) => {
        await applyDeliveredOrderEffects(order, t);
      });
    }
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
  ALLOWED_ORDER_STATUSES,
  createOrderFromCart,
  clearActiveCartItemsForUser,
  listUserOrders,
  getUserOrder,
  requestReturn,
  updateOrderStatus,
  markOrderAsPaid
};
