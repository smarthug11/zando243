const { defineModels } = require("../models");
const { getPagination, toPageMeta } = require("../utils/pagination");
const { addItem } = require("./cartService");

defineModels();

async function toggleFavorite(userId, productId) {
  const models = defineModels();
  const existing = await models.Favorite.findOne({ where: { userId, productId } });
  if (existing) {
    await existing.destroy();
    return { added: false };
  }
  await models.Favorite.create({ userId, productId });
  return { added: true };
}

async function removeFavorite(userId, productId) {
  const models = defineModels();
  await models.Favorite.destroy({ where: { userId, productId } });
}

async function listFavorites(userId, query = {}) {
  const models = defineModels();
  const { page, limit, offset } = getPagination(query, 12);
  const { rows, count } = await models.Favorite.findAndCountAll({
    where: { userId },
    include: [
      {
        model: models.Product,
        as: "product",
        include: [{ model: models.ProductImage, as: "images", required: false }]
      }
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset
  });
  return { favorites: rows, pageMeta: toPageMeta({ count, page, limit }) };
}

async function moveFavoriteToCart(req, userId, productId) {
  await addItem(req, { productId, qty: 1 });
  await removeFavorite(userId, productId);
}

module.exports = { toggleFavorite, removeFavorite, listFavorites, moveFavoriteToCart };
