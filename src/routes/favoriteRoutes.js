const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/favoriteController");

const router = express.Router();
router.use(requireAuth);
router.get("/", ctrl.listFavorites);
router.post("/:productId", ctrl.addFavorite);
router.delete("/:productId", ctrl.removeFavorite);
router.post("/:productId/delete", ctrl.removeFavorite);
router.post("/:productId/move-to-cart", ctrl.moveToCart);

module.exports = router;
