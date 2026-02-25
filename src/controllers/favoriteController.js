const { asyncHandler } = require("../utils/asyncHandler");
const favoriteService = require("../services/favoriteService");

const listFavorites = asyncHandler(async (req, res) => {
  const result = await favoriteService.listFavorites(req.user.id, req.query);
  res.render("pages/favorites", { title: "Mes favoris", ...result });
});

const addFavorite = asyncHandler(async (req, res) => {
  await favoriteService.toggleFavorite(req.user.id, req.params.productId);
  res.redirect(req.get("referer") || "/favorites");
});

const removeFavorite = asyncHandler(async (req, res) => {
  await favoriteService.removeFavorite(req.user.id, req.params.productId);
  res.redirect("/favorites");
});

const moveToCart = asyncHandler(async (req, res) => {
  await favoriteService.moveFavoriteToCart(req, req.user.id, req.params.productId);
  res.redirect("/cart");
});

module.exports = { listFavorites, addFavorite, removeFavorite, moveToCart };
