const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { toSlug } = require("../utils/slugify");

function parseHttpsUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? raw : null;
  } catch (_) {
    return null;
  }
}

function pickProductFields(body) {
  return {
    name:                 body.name,
    description:          body.description || "",
    brand:                body.brand || null,
    sku:                  body.sku || null,
    categoryId:           body.categoryId || null,
    priceWithoutDelivery: body.priceWithoutDelivery,
    purchasePrice:        body.purchasePrice || 0,
    weightKg:             body.weightKg,
    stock:                body.stock,
    status:               ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(body.status) ? body.status : "ACTIVE",
    salePrice:            body.salePrice || null,
    discountPercent:      body.discountPercent || null
  };
}

async function listProducts(query = {}) {
  const models = defineModels();
  const q = (query.q || "").trim();
  const categoryId = (query.categoryId || "").trim();
  const stockLte = (query.stockLte || "").trim();
  const where = {};

  if (q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${q}%` } },
      { sku: { [Op.like]: `%${q}%` } },
      { brand: { [Op.like]: `%${q}%` } }
    ];
  }
  if (categoryId) where.categoryId = categoryId;
  if (stockLte !== "" && !Number.isNaN(Number(stockLte))) {
    where.stock = { [Op.lte]: Number(stockLte) };
  }

  const products = await models.Product.findAll({
    where,
    include: [
      models.Category,
      { model: models.ProductImage, as: "images", required: false },
      { model: models.ProductVariant, as: "variants", required: false }
    ],
    order: [["createdAt", "DESC"]],
    limit: 200
  });
  const categories = await models.Category.findAll({ order: [["name", "ASC"]] });

  return {
    products,
    categories,
    filters: { q, categoryId, stockLte }
  };
}

async function createProductFromAdmin(payload = {}) {
  const models = defineModels();
  const product = await models.Product.create({
    ...pickProductFields(payload),
    slug: toSlug(payload.name),
    keywords: (payload.keywords || "").split(",").map((s) => s.trim()).filter(Boolean)
  });
  const imageUrl = parseHttpsUrl(payload.imageUrl);
  if (imageUrl) await models.ProductImage.create({ productId: product.id, url: imageUrl, isMain: true, position: 0 });
  return product;
}

async function updateProductFromAdmin(productId, payload = {}) {
  const models = defineModels();
  const product = await models.Product.findByPk(productId);
  if (!product) return null;

  Object.assign(product, {
    ...pickProductFields(payload),
    slug: toSlug(payload.name || product.name),
    keywords: (payload.keywords || "").split(",").map((s) => s.trim()).filter(Boolean)
  });
  await product.save();
  return product;
}

async function deleteProductFromAdmin(productId) {
  const models = defineModels();
  const product = await models.Product.findByPk(productId);
  await models.Product.destroy({ where: { id: productId } });
  return product;
}

async function addProductImageFromAdmin(productId, payload = {}) {
  const models = defineModels();
  const product = await models.Product.findByPk(productId);
  if (!product) return { error: "PRODUCT_NOT_FOUND" };

  const isMain = payload.isMain === "1";
  const variantId = payload.variantId || null;
  if (variantId) {
    const variant = await models.ProductVariant.findOne({ where: { id: variantId, productId: product.id } });
    if (!variant) return { error: "VARIANT_NOT_FOUND" };
  }
  if (isMain) {
    await models.ProductImage.update({ isMain: false }, { where: { productId: product.id } });
  }
  const imageUrl = parseHttpsUrl(payload.url);
  if (!imageUrl) return { error: "INVALID_IMAGE_URL" };

  const image = await models.ProductImage.create({
    productId: product.id,
    variantId,
    url: imageUrl,
    isMain,
    position: Number(payload.position || 0)
  });
  return { image };
}

async function updateProductImageFromAdmin(productId, imageId, payload = {}) {
  const models = defineModels();
  const image = await models.ProductImage.findOne({ where: { id: imageId, productId } });
  if (!image) return { error: "IMAGE_NOT_FOUND" };

  const isMain = payload.isMain === "1";
  const variantId = payload.variantId || null;
  if (variantId) {
    const variant = await models.ProductVariant.findOne({ where: { id: variantId, productId } });
    if (!variant) return { error: "VARIANT_NOT_FOUND" };
  }
  if (isMain) {
    await models.ProductImage.update({ isMain: false }, { where: { productId } });
  }
  const updatedUrl = payload.url ? parseHttpsUrl(payload.url) : image.url;
  if (payload.url && !updatedUrl) return { error: "INVALID_IMAGE_URL" };

  await image.update({
    url: updatedUrl,
    position: payload.position != null ? Number(payload.position) : image.position,
    variantId,
    isMain
  });
  return { image };
}

async function deleteProductImageFromAdmin(productId, imageId) {
  const models = defineModels();
  await models.ProductImage.destroy({ where: { id: imageId, productId } });
  const remainingMain = await models.ProductImage.findOne({ where: { productId, isMain: true } });
  if (!remainingMain) {
    const first = await models.ProductImage.findOne({ where: { productId }, order: [["position", "ASC"], ["createdAt", "ASC"]] });
    if (first) await first.update({ isMain: true });
  }
}

async function addProductVariantFromAdmin(productId, payload = {}) {
  const models = defineModels();
  const product = await models.Product.findByPk(productId);
  if (!product) return { error: "PRODUCT_NOT_FOUND" };
  const variant = await models.ProductVariant.create({
    productId: product.id,
    name: payload.name,
    color: payload.color || null,
    size: payload.size || null,
    sku: payload.sku || null,
    stock: Number(payload.stock || 0)
  });
  return { variant };
}

async function updateProductVariantFromAdmin(productId, variantId, payload = {}) {
  const models = defineModels();
  const variant = await models.ProductVariant.findOne({ where: { id: variantId, productId } });
  if (!variant) return { error: "VARIANT_NOT_FOUND" };
  await variant.update({
    name: payload.name || variant.name,
    color: payload.color || null,
    size: payload.size || null,
    sku: payload.sku || null,
    stock: Number(payload.stock || 0)
  });
  return { variant };
}

async function deleteProductVariantFromAdmin(productId, variantId) {
  const models = defineModels();
  await models.ProductVariant.destroy({ where: { id: variantId, productId } });
}

module.exports = {
  listProducts,
  createProductFromAdmin,
  updateProductFromAdmin,
  deleteProductFromAdmin,
  addProductImageFromAdmin,
  updateProductImageFromAdmin,
  deleteProductImageFromAdmin,
  addProductVariantFromAdmin,
  updateProductVariantFromAdmin,
  deleteProductVariantFromAdmin
};
