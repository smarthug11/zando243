const { defineModels } = require("../models");
const { computeCheckoutLineTotal, round2 } = require("../utils/pricing");
const { AppError } = require("../utils/AppError");

defineModels();

async function ensureCartIdentity(req) {
  if (!req.session.guestCartKey) req.session.guestCartKey = `guest_${req.sessionID}`;
  return req.user ? { userId: req.user.id } : { sessionId: req.session.guestCartKey };
}

async function getOrCreateCart(req, transaction) {
  const models = defineModels();
  const identity = await ensureCartIdentity(req);
  const where = req.user ? { userId: identity.userId } : { sessionId: identity.sessionId, userId: null };
  let cart = await models.Cart.findOne({ where, transaction });
  if (!cart) cart = await models.Cart.create(where, { transaction });
  return cart;
}

async function loadCart(req) {
  const models = defineModels();
  const cart = await getOrCreateCart(req);
  return models.Cart.findByPk(cart.id, {
    include: [
      {
        model: models.CartItem,
        as: "items",
        include: [
          { model: models.Product, as: "product", include: [{ model: models.ProductImage, as: "images", required: false }] },
          { model: models.ProductVariant, as: "variant", required: false }
        ]
      }
    ],
    order: [[{ model: models.CartItem, as: "items" }, "createdAt", "DESC"]]
  });
}

function computeCartTotals(cart) {
  const items = (cart?.items || []).filter((i) => !i.savedForLater);
  const subtotal = round2(
    items.reduce(
      (sum, item) =>
        sum +
        computeCheckoutLineTotal({
          priceWithoutDelivery: Number(item.product?.priceWithoutDelivery || 0),
          weightKg: Number(item.product?.weightKg || 0),
          qty: item.qty
        }),
      0
    )
  );
  const shippingFee = 0;
  return { subtotal, shippingFee, discountTotal: 0, total: subtotal + shippingFee };
}

async function addItem(req, { productId, qty = 1, variantId = null }) {
  const models = defineModels();
  const cart = await getOrCreateCart(req);
  const product = await models.Product.findByPk(productId);
  if (!product || product.status !== "ACTIVE") throw new AppError("Produit indisponible", 404, "PRODUCT_NOT_FOUND");
  let item = await models.CartItem.findOne({ where: { cartId: cart.id, productId, variantId, savedForLater: false } });
  if (item) {
    item.qty += Number(qty);
    await item.save();
  } else {
    item = await models.CartItem.create({ cartId: cart.id, productId, variantId, qty: Number(qty) });
  }
  return item;
}

async function updateItem(req, itemId, changes) {
  const models = defineModels();
  const cart = await getOrCreateCart(req);
  const item = await models.CartItem.findOne({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw new AppError("Article panier introuvable", 404, "CART_ITEM_NOT_FOUND");
  if (changes.qty != null) item.qty = Math.max(1, Number(changes.qty));
  if (changes.savedForLater != null) item.savedForLater = Boolean(changes.savedForLater);
  await item.save();
  return item;
}

async function removeItem(req, itemId) {
  const models = defineModels();
  const cart = await getOrCreateCart(req);
  await models.CartItem.destroy({ where: { id: itemId, cartId: cart.id } });
}

async function createCheckoutAddress(userId, payload) {
  const models = defineModels();
  if (payload.isDefault) {
    await models.Address.update({ isDefault: false }, { where: { userId } });
  }
  return models.Address.create({
    userId,
    label: payload.label,
    number: payload.number || null,
    street: payload.street,
    neighborhood: payload.neighborhood || null,
    municipality: payload.municipality || null,
    city: payload.city,
    country: payload.country,
    isDefault: payload.isDefault === "1"
  });
}

async function mergeGuestCartIntoUser(req, userId) {
  const models = defineModels();
  if (!req.session.guestCartKey) return;
  const guestCart = await models.Cart.findOne({
    where: { sessionId: req.session.guestCartKey, userId: null },
    include: [{ model: models.CartItem, as: "items" }]
  });
  if (!guestCart) return;
  let userCart = await models.Cart.findOne({ where: { userId } });
  if (!userCart) userCart = await models.Cart.create({ userId });

  for (const guestItem of guestCart.items || []) {
    const existing = await models.CartItem.findOne({
      where: {
        cartId: userCart.id,
        productId: guestItem.productId,
        variantId: guestItem.variantId,
        savedForLater: guestItem.savedForLater
      }
    });
    if (existing) {
      existing.qty += guestItem.qty;
      await existing.save();
    } else {
      await models.CartItem.create({
        cartId: userCart.id,
        productId: guestItem.productId,
        variantId: guestItem.variantId,
        qty: guestItem.qty,
        savedForLater: guestItem.savedForLater
      });
    }
  }
  await models.CartItem.destroy({ where: { cartId: guestCart.id } });
  await guestCart.destroy();
}

async function getCartItemCount(req) {
  const models = defineModels();
  const where = req.user
    ? { userId: req.user.id }
    : req.session?.guestCartKey
      ? { sessionId: req.session.guestCartKey, userId: null }
      : null;

  if (!where) return 0;

  const cart = await models.Cart.findOne({
    where,
    include: [{ model: models.CartItem, as: "items" }]
  });
  if (!cart) return 0;
  return (cart.items || []).filter((item) => !item.savedForLater).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

module.exports = {
  ensureCartIdentity,
  getOrCreateCart,
  loadCart,
  computeCartTotals,
  addItem,
  updateItem,
  removeItem,
  createCheckoutAddress,
  mergeGuestCartIntoUser,
  getCartItemCount
};
