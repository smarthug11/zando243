const { body } = require("express-validator");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const cartService = require("../services/cartService");
const orderService = require("../services/orderService");
const { setFlash } = require("../middlewares/viewLocals");
const { defineModels } = require("../models");
const { env } = require("../config/env");

defineModels();

const cartItemValidators = [
  body("productId").isUUID(),
  body("variantId").optional({ checkFalsy: true }).isUUID(),
  body("qty").optional().isInt({ min: 1, max: 99 }),
  handleValidation
];
const cartItemUpdateValidators = [
  body("qty")
    .exists({ checkFalsy: true })
    .withMessage("La quantité est requise.")
    .bail()
    .isInt({ min: 1, max: 99 })
    .withMessage("La quantité doit être un entier entre 1 et 99."),
  handleValidation
];
const checkoutValidators = [
  body("paymentMethod").isIn(["CASH_ON_DELIVERY", "CARD", "MOBILE_MONEY", "PAYPAL"]),
  body("addressId").optional({ checkFalsy: true }).isUUID(),
  handleValidation
];
const checkoutAddressValidators = [
  body("label").notEmpty(),
  body("street").notEmpty(),
  body("city").notEmpty(),
  body("country").notEmpty(),
  handleValidation
];

const showCart = asyncHandler(async (req, res) => {
  const models = defineModels();
  const cart = await cartService.loadCart(req);
  const addresses = req.user
    ? await models.Address.findAll({ where: { userId: req.user.id }, order: [["isDefault", "DESC"], ["createdAt", "DESC"]] })
    : [];

  res.render("pages/cart", {
    title: "Panier",
    cart,
    totals: cartService.computeCartTotals(cart),
    addresses,
    pickupOfficeAddress: env.pickupOfficeAddress
  });
});

function isPayPalBackedPayment(paymentMethod) {
  return paymentMethod === "PAYPAL" || paymentMethod === "CARD";
}

function isPayPalConfigured() {
  return Boolean(env.paypal.clientId && env.paypal.clientSecret);
}

function safeCartRedirectTarget(value) {
  if (typeof value !== "string") return "/products";
  const target = value.trim();
  if (!target.startsWith("/") || target.startsWith("//")) return "/products";
  return target;
}

const addCartItem = asyncHandler(async (req, res) => {
  await cartService.addItem(req, req.body);
  setFlash(req, "success", "Article ajoute au panier.");
  res.redirect(safeCartRedirectTarget(req.body.redirectTo));
});

const updateCartItem = asyncHandler(async (req, res) => {
  await cartService.updateItem(req, req.params.id, req.body);
  res.redirect("/cart");
});

const deleteCartItem = asyncHandler(async (req, res) => {
  await cartService.removeItem(req, req.params.id);
  res.redirect("/cart");
});

const saveForLater = asyncHandler(async (req, res) => {
  await cartService.updateItem(req, req.params.id, { savedForLater: true });
  res.redirect("/cart");
});

const moveSavedItemToCart = asyncHandler(async (req, res) => {
  await cartService.moveSavedItemToCart(req, req.params.id);
  res.redirect("/cart");
});

const checkout = asyncHandler(async (req, res) => {
  if (!req.user) {
    setFlash(req, "error", "Connectez-vous pour finaliser le paiement. Votre panier invite est conserve.");
    return res.redirect("/auth2/login");
  }
  const paypalBackedPayment = isPayPalBackedPayment(req.body.paymentMethod);
  if (paypalBackedPayment && !isPayPalConfigured()) {
    setFlash(req, "error", "PayPal n'est pas configure sur le serveur.");
    return res.redirect("/cart");
  }
  const order = await orderService.createOrderFromCart(req, {
    paymentMethod: req.body.paymentMethod,
    couponCode: req.body.couponCode,
    doorDelivery: req.body.doorDelivery === "1",
    addressId: req.body.addressId,
    clearCartItems: !paypalBackedPayment
  });
  if (paypalBackedPayment) {
    req.session.pendingPayPalCheckoutOrderId = order.id;
    return res.redirect(`/payments/paypal/start?orderId=${encodeURIComponent(order.id)}`);
  }
  setFlash(req, "success", `Commande ${order.orderNumber} creee.`);
  res.redirect(`/orders/${order.id}`);
});

const createCheckoutAddress = asyncHandler(async (req, res) => {
  if (!req.user) {
    setFlash(req, "error", "Connectez-vous pour ajouter une adresse.");
    return res.redirect("/auth2/login");
  }
  await cartService.createCheckoutAddress(req.user.id, req.body);
  setFlash(req, "success", "Adresse ajoutee pour la commande.");
  res.redirect("/cart");
});

module.exports = {
  cartItemValidators,
  cartItemUpdateValidators,
  checkoutValidators,
  checkoutAddressValidators,
  showCart,
  addCartItem,
  updateCartItem,
  deleteCartItem,
  saveForLater,
  moveSavedItemToCart,
  checkout,
  createCheckoutAddress
};
