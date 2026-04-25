const { body } = require("express-validator");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const cartService = require("../services/cartService");
const orderService = require("../services/orderService");
const { setFlash } = require("../middlewares/viewLocals");
const { defineModels } = require("../models");
const { env } = require("../config/env");

defineModels();

const cartItemValidators = [body("productId").isUUID(), body("qty").optional().isInt({ min: 1, max: 99 }), handleValidation];
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

const addCartItem = asyncHandler(async (req, res) => {
  await cartService.addItem(req, req.body);
  setFlash(req, "success", "Article ajoute au panier.");
  if (req.body.redirectTo === "cart") {
    return res.redirect("/cart");
  }
  res.redirect(req.get("referer") || "/products");
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

const checkout = asyncHandler(async (req, res) => {
  if (!req.user) {
    setFlash(req, "error", "Connectez-vous pour finaliser le paiement. Votre panier invite est conserve.");
    return res.redirect("/auth/login");
  }
  const order = await orderService.createOrderFromCart(req, {
    paymentMethod: req.body.paymentMethod,
    couponCode: req.body.couponCode,
    doorDelivery: req.body.doorDelivery === "1",
    addressId: req.body.addressId
  });
  if (req.body.paymentMethod === "PAYPAL" || req.body.paymentMethod === "CARD") {
    return res.redirect(`/payments/paypal/start?orderId=${encodeURIComponent(order.id)}`);
  }
  setFlash(req, "success", `Commande ${order.orderNumber} creee.`);
  res.redirect(`/orders/${order.id}`);
});

const createCheckoutAddress = asyncHandler(async (req, res) => {
  if (!req.user) {
    setFlash(req, "error", "Connectez-vous pour ajouter une adresse.");
    return res.redirect("/auth/login");
  }
  await cartService.createCheckoutAddress(req.user.id, req.body);
  setFlash(req, "success", "Adresse ajoutee pour la commande.");
  res.redirect("/cart");
});

module.exports = {
  cartItemValidators,
  checkoutValidators,
  checkoutAddressValidators,
  showCart,
  addCartItem,
  updateCartItem,
  deleteCartItem,
  saveForLater,
  checkout,
  createCheckoutAddress
};
