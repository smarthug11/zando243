const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { sequelize } = require("../config/database");
const { getPagination, toPageMeta } = require("../utils/pagination");

defineModels();

function buildProductWhere(query = {}) {
  const likeOp = sequelize.getDialect() === "postgres" ? Op.iLike : Op.like;
  const where = { status: "ACTIVE" };
  if (query.q) {
    where[Op.or] = [
      { name: { [likeOp]: `%${query.q}%` } },
      { description: { [likeOp]: `%${query.q}%` } },
      { brand: { [likeOp]: `%${query.q}%` } }
    ];
  }
  if (query.min) where.priceWithoutDelivery = { ...(where.priceWithoutDelivery || {}), [Op.gte]: Number(query.min) };
  if (query.max) where.priceWithoutDelivery = { ...(where.priceWithoutDelivery || {}), [Op.lte]: Number(query.max) };
  if (query.rating) where.avgRating = { [Op.gte]: Number(query.rating) };
  if (query.stock === "1" || query.stock === "true") where.stock = { [Op.gt]: 0 };
  return where;
}

function buildOrder(sort) {
  switch (sort) {
    case "price_asc":
      return [["priceWithoutDelivery", "ASC"]];
    case "price_desc":
      return [["priceWithoutDelivery", "DESC"]];
    case "newest":
      return [["createdAt", "DESC"]];
    case "popular":
    default:
      return [["popularityScore", "DESC"], ["createdAt", "DESC"]];
  }
}

async function listProducts(query = {}) {
  const models = defineModels();
  const { page, limit, offset } = getPagination(query, 12);
  const where = buildProductWhere(query);
  if (query.category) {
    const category = await models.Category.findOne({ where: { slug: query.category } });
    if (category) where.categoryId = category.id;
  }
  const { rows, count } = await models.Product.findAndCountAll({
    where,
    include: [
      { model: models.ProductImage, as: "images", required: false },
      { model: models.Category, required: false }
    ],
    order: buildOrder(query.sort),
    limit,
    offset,
    distinct: true
  });
  return { products: rows, pageMeta: toPageMeta({ count, page, limit }) };
}

async function getProductBySlug(slug) {
  const models = defineModels();
  return models.Product.findOne({
    where: { slug },
    include: [
      { model: models.ProductImage, as: "images", include: [{ model: models.ProductVariant, as: "variant", required: false }], required: false },
      { model: models.ProductVariant, as: "variants", required: false },
      { model: models.Category },
      {
        model: models.Review,
        as: "reviews",
        where: { isHidden: false },
        required: false,
        include: [{ model: models.User, as: "user", attributes: ["id", "firstName", "lastName"] }]
      }
    ]
  });
}

async function listCategories() {
  const models = defineModels();
  return models.Category.findAll({ order: [["name", "ASC"]] });
}

async function getCategoryBySlug(slug) {
  const models = defineModels();
  return models.Category.findOne({ where: { slug } });
}

async function trackRecentlyViewed({ userId, sessionId, productId }) {
  const models = defineModels();
  if (!productId || (!userId && !sessionId)) return;
  await models.RecentlyViewed.create({ userId: userId || null, sessionId: sessionId || null, productId, viewedAt: new Date() });
}

async function getRecentlyViewed({ userId, sessionId }) {
  const models = defineModels();
  if (!userId && !sessionId) return [];
  const where = userId ? { userId } : { sessionId };
  return models.RecentlyViewed.findAll({
    where,
    include: [{ model: models.Product, as: "product", include: [{ model: models.ProductImage, as: "images", required: false }] }],
    order: [["viewedAt", "DESC"]],
    limit: 20
  });
}

module.exports = {
  listProducts,
  getProductBySlug,
  listCategories,
  getCategoryBySlug,
  trackRecentlyViewed,
  getRecentlyViewed
};
