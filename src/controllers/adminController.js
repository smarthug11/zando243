const { body } = require("express-validator");
const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const { getDashboardStats } = require("../services/adminService");
const { updateOrderStatus } = require("../services/orderService");
const { toSlug } = require("../utils/slugify");
const { recomputeProductRating } = require("../services/reviewService");
const { createAuditLog, listAuditLogs, CATEGORIES, LEVELS } = require("../services/auditLogService");
const { streamRawOrderPdf, streamShippingLabelPdf } = require("../services/orderDocumentService");

defineModels();

const productValidators = [body("name").notEmpty(), body("priceWithoutDelivery").isFloat({ min: 0 }), body("weightKg").isFloat({ min: 0.01 }), body("stock").isInt({ min: 0 }), handleValidation];
const categoryValidators = [body("name").notEmpty(), handleValidation];
const couponValidators = [body("code").notEmpty(), body("type").isIn(["PERCENT", "FIXED"]), body("value").isFloat({ min: 0 }), handleValidation];

const dashboard = asyncHandler(async (_req, res) => {
  const stats = await getDashboardStats(_req.query);
  res.render("pages/admin/dashboard", { title: "Admin Dashboard", stats });
});

const logsPage = asyncHandler(async (req, res) => {
  const data = await listAuditLogs(req.query);
  res.render("pages/admin/logs", {
    title: "Logs système et métier",
    ...data,
    categories: CATEGORIES,
    levels: LEVELS
  });
});

const stats = asyncHandler(async (_req, res) => {
  res.json(await getDashboardStats(_req.query));
});

const productsPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const { Op } = require("sequelize");
  const q = (_req.query.q || "").trim();
  const categoryId = (_req.query.categoryId || "").trim();
  const stockLte = (_req.query.stockLte || "").trim();
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
  res.render("pages/admin/products", {
    title: "Admin Produits",
    products,
    categories,
    filters: { q, categoryId, stockLte }
  });
});

const addProductImage = asyncHandler(async (req, res) => {
  const models = defineModels();
  const product = await models.Product.findByPk(req.params.id);
  if (!product) return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  const isMain = req.body.isMain === "1";
  const variantId = req.body.variantId || null;
  if (variantId) {
    const variant = await models.ProductVariant.findOne({ where: { id: variantId, productId: product.id } });
    if (!variant) return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  }
  if (isMain) {
    await models.ProductImage.update({ isMain: false }, { where: { productId: product.id } });
  }
  await models.ProductImage.create({
    productId: product.id,
    variantId,
    url: req.body.url,
    isMain,
    position: Number(req.body.position || 0)
  });
  res.redirect("/admin/products");
});

const updateProductImage = asyncHandler(async (req, res) => {
  const models = defineModels();
  const image = await models.ProductImage.findOne({ where: { id: req.params.imageId, productId: req.params.id } });
  if (!image) return res.status(404).render("pages/errors/404", { title: "Image introuvable" });
  const isMain = req.body.isMain === "1";
  const variantId = req.body.variantId || null;
  if (variantId) {
    const variant = await models.ProductVariant.findOne({ where: { id: variantId, productId: req.params.id } });
    if (!variant) return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  }
  if (isMain) {
    await models.ProductImage.update({ isMain: false }, { where: { productId: req.params.id } });
  }
  await image.update({
    url: req.body.url || image.url,
    position: req.body.position != null ? Number(req.body.position) : image.position,
    variantId,
    isMain
  });
  res.redirect("/admin/products");
});

const deleteProductImage = asyncHandler(async (req, res) => {
  const models = defineModels();
  await models.ProductImage.destroy({ where: { id: req.params.imageId, productId: req.params.id } });
  const remainingMain = await models.ProductImage.findOne({ where: { productId: req.params.id, isMain: true } });
  if (!remainingMain) {
    const first = await models.ProductImage.findOne({ where: { productId: req.params.id }, order: [["position", "ASC"], ["createdAt", "ASC"]] });
    if (first) await first.update({ isMain: true });
  }
  res.redirect("/admin/products");
});

const addProductVariant = asyncHandler(async (req, res) => {
  const models = defineModels();
  const product = await models.Product.findByPk(req.params.id);
  if (!product) return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  await models.ProductVariant.create({
    productId: product.id,
    name: req.body.name,
    color: req.body.color || null,
    size: req.body.size || null,
    sku: req.body.sku || null,
    stock: Number(req.body.stock || 0)
  });
  res.redirect("/admin/products");
});

const updateProductVariant = asyncHandler(async (req, res) => {
  const models = defineModels();
  const variant = await models.ProductVariant.findOne({ where: { id: req.params.variantId, productId: req.params.id } });
  if (!variant) return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  await variant.update({
    name: req.body.name || variant.name,
    color: req.body.color || null,
    size: req.body.size || null,
    sku: req.body.sku || null,
    stock: Number(req.body.stock || 0)
  });
  res.redirect("/admin/products");
});

const deleteProductVariant = asyncHandler(async (req, res) => {
  const models = defineModels();
  await models.ProductVariant.destroy({ where: { id: req.params.variantId, productId: req.params.id } });
  res.redirect("/admin/products");
});

const createProduct = asyncHandler(async (req, res) => {
  const models = defineModels();
  const product = await models.Product.create({ ...req.body, slug: toSlug(req.body.name), keywords: (req.body.keywords || "").split(",").map((s) => s.trim()).filter(Boolean) });
  if (req.body.imageUrl) await models.ProductImage.create({ productId: product.id, url: req.body.imageUrl, isMain: true, position: 0 });
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_CREATE",
    message: `Produit créé: ${product.name}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: product.id, sku: product.sku }
  });
  res.redirect("/admin/products");
});

const updateProduct = asyncHandler(async (req, res) => {
  const models = defineModels();
  const product = await models.Product.findByPk(req.params.id);
  if (!product) return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  Object.assign(product, { ...req.body, slug: toSlug(req.body.name || product.name), keywords: (req.body.keywords || "").split(",").map((s) => s.trim()).filter(Boolean) });
  await product.save();
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_UPDATE",
    message: `Produit modifié: ${product.name}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: product.id, sku: product.sku }
  });
  res.redirect("/admin/products");
});

const deleteProduct = asyncHandler(async (req, res) => {
  const models = defineModels();
  const product = await models.Product.findByPk(req.params.id);
  await models.Product.destroy({ where: { id: req.params.id } });
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_DELETE",
    message: `Produit supprimé: ${product?.name || req.params.id}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: req.params.id }
  });
  res.redirect("/admin/products");
});

const categoriesPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const categories = await models.Category.findAll({ order: [["name", "ASC"]] });
  res.render("pages/admin/categories", { title: "Admin Catégories", categories });
});

const createCategory = asyncHandler(async (req, res) => {
  const models = defineModels();
  await models.Category.create({ name: req.body.name, slug: toSlug(req.body.name), parentId: req.body.parentId || null });
  res.redirect("/admin/categories");
});

const updateCategory = asyncHandler(async (req, res) => {
  const models = defineModels();
  const category = await models.Category.findByPk(req.params.id);
  if (!category) return res.status(404).render("pages/errors/404", { title: "Catégorie introuvable" });
  Object.assign(category, { name: req.body.name, slug: toSlug(req.body.name), parentId: req.body.parentId || null });
  await category.save();
  res.redirect("/admin/categories");
});

const deleteCategory = asyncHandler(async (req, res) => {
  const models = defineModels();
  await models.Category.destroy({ where: { id: req.params.id } });
  res.redirect("/admin/categories");
});

const ordersPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const q = (_req.query.q || "").trim();
  const status = (_req.query.status || "").trim();
  const startDate = (_req.query.startDate || "").trim();
  const endDate = (_req.query.endDate || "").trim();

  const orderWhere = {};
  if (status) orderWhere.status = status;
  if (startDate || endDate) {
    const range = {};
    if (startDate) {
      const d = new Date(startDate);
      d.setHours(0, 0, 0, 0);
      if (!Number.isNaN(d.getTime())) range[Op.gte] = d;
    }
    if (endDate) {
      const d = new Date(endDate);
      d.setHours(23, 59, 59, 999);
      if (!Number.isNaN(d.getTime())) range[Op.lte] = d;
    }
    if (Object.keys(range).length) orderWhere.createdAt = range;
  }

  const userInclude = {
    model: models.User,
    required: !!q
  };
  if (q) {
    userInclude.where = {
      [Op.or]: [
        { firstName: { [Op.like]: `%${q}%` } },
        { lastName: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } }
      ]
    };
  }

  const orders = await models.Order.findAll({
    where: orderWhere,
    include: [userInclude, { model: models.OrderItem, as: "items" }],
    order: [["createdAt", "DESC"]],
    limit: 100
  });
  res.render("pages/admin/orders", {
    title: "Admin Commandes",
    orders,
    filters: { q, status, startDate, endDate }
  });
});

const orderDetailPage = asyncHandler(async (req, res) => {
  const models = defineModels();
  const order = await models.Order.findByPk(req.params.id, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" },
      { model: models.OrderStatusHistory, as: "statusHistory", required: false }
    ]
  });
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  res.render("pages/admin/order-detail", { title: `Commande ${order.orderNumber}`, order });
});

const orderRawPdf = asyncHandler(async (req, res) => {
  const models = defineModels();
  const order = await models.Order.findByPk(req.params.id, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" },
      { model: models.OrderStatusHistory, as: "statusHistory", required: false }
    ]
  });
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  streamRawOrderPdf(order, res);
});

const orderShippingLabelPdf = asyncHandler(async (req, res) => {
  const models = defineModels();
  const order = await models.Order.findByPk(req.params.id, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" }
    ]
  });
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  await streamShippingLabelPdf(order, res);
});

const updateOrder = asyncHandler(async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.body.status, req.body.note || null);
  await createAuditLog({
    category: "ORDER",
    action: "ADMIN_ORDER_STATUS",
    message: `Statut commande changé: ${order.orderNumber} -> ${req.body.status}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { orderId: order.id, status: req.body.status, note: req.body.note || null }
  });
  res.redirect("/admin/orders");
});

const couponsPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const coupons = await models.Coupon.findAll({ order: [["createdAt", "DESC"]] });
  res.render("pages/admin/coupons", { title: "Admin Coupons", coupons });
});

const createCoupon = asyncHandler(async (req, res) => {
  const models = defineModels();
  const coupon = await models.Coupon.create({
    code: req.body.code.toUpperCase(),
    type: req.body.type,
    value: req.body.value,
    minCart: req.body.minCart || 0,
    maxDiscount: req.body.maxDiscount || null,
    startAt: req.body.startAt,
    endAt: req.body.endAt,
    usageLimit: req.body.usageLimit || null,
    usagePerUser: req.body.usagePerUser || 1,
    isActive: req.body.isActive === "1"
  });
  await createAuditLog({
    category: "ADMIN",
    action: "ADMIN_COUPON_CREATE",
    message: `Coupon créé: ${coupon.code}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { couponId: coupon.id, type: coupon.type, value: coupon.value }
  });
  res.redirect("/admin/coupons");
});

const reviewsPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const reviews = await models.Review.findAll({ include: [{ model: models.Product, as: "product" }, { model: models.User, as: "user" }], order: [["createdAt", "DESC"]], limit: 100 });
  res.render("pages/admin/reviews", { title: "Admin Avis", reviews });
});

const moderateReview = asyncHandler(async (req, res) => {
  const models = defineModels();
  const review = await models.Review.findByPk(req.params.id);
  if (review) {
    const productId = review.productId;
    if (req.body.action === "delete") await review.destroy();
    if (req.body.action === "hide") await review.update({ isHidden: true });
    if (req.body.action === "unhide") await review.update({ isHidden: false });
    await recomputeProductRating(productId);
    await createAuditLog({
      category: "ADMIN",
      action: "ADMIN_REVIEW_MODERATION",
      message: `Modération avis ${review.id}: ${req.body.action}`,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      requestId: req.requestId,
      req,
      meta: { reviewId: review.id, productId, action: req.body.action }
    });
  }
  res.redirect("/admin/reviews");
});

const refundsPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const returns = await models.ReturnRequest.findAll({ include: [{ model: models.Order }] });
  res.render("pages/admin/refunds", { title: "Admin Retours/Remboursements", returns });
});

const usersPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const users = await models.User.findAll({ where: { role: "CUSTOMER" }, order: [["createdAt", "DESC"]], limit: 100 });
  res.render("pages/admin/users", { title: "Admin Clients", users });
});

const toggleUserBlock = asyncHandler(async (req, res) => {
  const models = defineModels();
  const user = await models.User.findByPk(req.params.id);
  if (user) {
    await user.update({ isActive: req.body.action !== "block" });
    await createAuditLog({
      category: "USER",
      action: "ADMIN_USER_BLOCK_TOGGLE",
      message: `Client ${user.email} ${user.isActive ? "débloqué" : "bloqué"}`,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      requestId: req.requestId,
      req,
      meta: { targetUserId: user.id, targetEmail: user.email, isActive: user.isActive }
    });
  }
  res.redirect("/admin/users");
});

const logisticsPage = asyncHandler(async (_req, res) => {
  const models = defineModels();
  const orders = await models.Order.findAll({ order: [["createdAt", "DESC"]], limit: 100 });
  res.render("pages/admin/logistics", { title: "Module Logistique", orders });
});

module.exports = {
  productValidators,
  categoryValidators,
  couponValidators,
  dashboard,
  logsPage,
  stats,
  productsPage,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImage,
  updateProductImage,
  deleteProductImage,
  addProductVariant,
  updateProductVariant,
  deleteProductVariant,
  categoriesPage,
  createCategory,
  updateCategory,
  deleteCategory,
  ordersPage,
  orderDetailPage,
  orderRawPdf,
  orderShippingLabelPdf,
  updateOrder,
  couponsPage,
  createCoupon,
  reviewsPage,
  moderateReview,
  refundsPage,
  usersPage,
  toggleUserBlock,
  logisticsPage
};
