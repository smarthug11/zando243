const express = require("express");
const ctrl = require("../controllers/cartController");

const router = express.Router();
router.get("/", ctrl.showCart);
router.post("/items", ...ctrl.cartItemValidators, ctrl.addCartItem);
router.patch("/items/:id", ctrl.updateCartItem);
router.post("/items/:id", ctrl.updateCartItem);
router.delete("/items/:id", ctrl.deleteCartItem);
router.post("/items/:id/delete", ctrl.deleteCartItem);
router.post("/items/:id/save-for-later", ctrl.saveForLater);
router.post("/checkout/address", ...ctrl.checkoutAddressValidators, ctrl.createCheckoutAddress);
router.post("/checkout", ...ctrl.checkoutValidators, ctrl.checkout);

module.exports = router;
