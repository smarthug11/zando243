const { DataTypes } = require("sequelize");
const bcrypt = require("bcrypt");
const { sequelize } = require("../config/database");
const { toSlug } = require("../utils/slugify");
const { computeDisplayFinalPrice } = require("../utils/pricing");
const { logger } = require("../utils/logger");

let initialized = false;
const db = { sequelize };

function defineModels() {
  if (initialized) return db;
  const isPostgres = sequelize.getDialect() === "postgres";
  const JsonType = isPostgres ? DataTypes.JSONB : DataTypes.JSON;
  const KeywordsType = isPostgres ? DataTypes.ARRAY(DataTypes.STRING) : DataTypes.JSON;

  const commonOpts = { sequelize, underscored: true, paranoid: false };

  db.User = sequelize.define(
    "User",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: "CUSTOMER" },
      firstName: { type: DataTypes.STRING, allowNull: false },
      lastName: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
      phone: { type: DataTypes.STRING },
      avatarUrl: { type: DataTypes.STRING },
      loyaltyPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
      passwordHash: { type: DataTypes.STRING, allowNull: false },
      emailVerifiedAt: { type: DataTypes.DATE },
      emailVerificationTokenHash: { type: DataTypes.STRING },
      resetPasswordTokenHash: { type: DataTypes.STRING },
      resetPasswordExpiresAt: { type: DataTypes.DATE },
      refreshTokenVersion: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { ...commonOpts, paranoid: true, tableName: "users" }
  );

  db.Address = sequelize.define(
    "Address",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      label: { type: DataTypes.STRING, allowNull: false },
      number: { type: DataTypes.STRING },
      street: { type: DataTypes.STRING, allowNull: false },
      neighborhood: { type: DataTypes.STRING },
      municipality: { type: DataTypes.STRING },
      city: { type: DataTypes.STRING, allowNull: false },
      country: { type: DataTypes.STRING, allowNull: false, defaultValue: "RDC" },
      isDefault: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    { ...commonOpts, tableName: "addresses" }
  );

  db.Category = sequelize.define(
    "Category",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      parentId: { type: DataTypes.UUID }
    },
    {
      ...commonOpts,
      tableName: "categories",
      hooks: {
        beforeValidate(category) {
          if (!category.slug && category.name) category.slug = toSlug(category.name);
        }
      }
    }
  );

  db.Product = sequelize.define(
    "Product",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: false },
      weightKg: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.1 },
      purchasePrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      priceWithoutDelivery: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      finalPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      salePrice: { type: DataTypes.DECIMAL(12, 2) },
      discountPercent: { type: DataTypes.DECIMAL(5, 2) },
      stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sku: { type: DataTypes.STRING, allowNull: false, unique: true },
      brand: { type: DataTypes.STRING },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "ACTIVE" },
      keywords: { type: KeywordsType, defaultValue: [] },
      avgRating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
      countReviews: { type: DataTypes.INTEGER, defaultValue: 0 },
      popularityScore: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    {
      ...commonOpts,
      paranoid: true,
      tableName: "products",
      hooks: {
        beforeValidate(product) {
          if (!product.slug && product.name) product.slug = toSlug(product.name);
          if (product.priceWithoutDelivery != null && product.weightKg != null) {
            product.finalPrice = computeDisplayFinalPrice(product);
          }
        }
      }
    }
  );

  db.ProductImage = sequelize.define(
    "ProductImage",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      productId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID },
      url: { type: DataTypes.STRING, allowNull: false },
      isMain: { type: DataTypes.BOOLEAN, defaultValue: false },
      position: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { ...commonOpts, tableName: "product_images" }
  );

  db.ProductVariant = sequelize.define(
    "ProductVariant",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      productId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      color: { type: DataTypes.STRING },
      size: { type: DataTypes.STRING },
      sku: { type: DataTypes.STRING, unique: true },
      stock: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { ...commonOpts, tableName: "product_variants" }
  );

  db.Cart = sequelize.define(
    "Cart",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID },
      sessionId: { type: DataTypes.STRING }
    },
    { ...commonOpts, tableName: "carts" }
  );

  db.CartItem = sequelize.define(
    "CartItem",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      cartId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID },
      qty: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      savedForLater: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    { ...commonOpts, tableName: "cart_items" }
  );

  db.Favorite = sequelize.define(
    "Favorite",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false }
    },
    { ...commonOpts, tableName: "favorites", indexes: [{ unique: true, fields: ["user_id", "product_id"] }] }
  );

  db.Order = sequelize.define(
    "Order",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      orderNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      addressSnapshot: { type: JsonType, allowNull: false },
      subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      shippingFee: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      discountTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      couponCode: { type: DataTypes.STRING },
      paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: "CASH_ON_DELIVERY" },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Processing" },
      trackingNumber: { type: DataTypes.STRING },
      trackingCarrier: { type: DataTypes.STRING },
      customsFee: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
      consolidationReference: { type: DataTypes.STRING },
      logisticsMeta: { type: JsonType, defaultValue: {} },
      internalNote: { type: DataTypes.TEXT }
    },
    { ...commonOpts, tableName: "orders" }
  );

  db.OrderItem = sequelize.define(
    "OrderItem",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      orderId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID },
      productSnapshot: { type: JsonType, allowNull: false },
      unitPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      qty: { type: DataTypes.INTEGER, allowNull: false },
      lineTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false }
    },
    { ...commonOpts, tableName: "order_items" }
  );

  db.OrderStatusHistory = sequelize.define(
    "OrderStatusHistory",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      orderId: { type: DataTypes.UUID, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      note: { type: DataTypes.TEXT }
    },
    { ...commonOpts, tableName: "order_status_histories" }
  );

  db.Review = sequelize.define(
    "Review",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      rating: { type: DataTypes.INTEGER, allowNull: false },
      comment: { type: DataTypes.TEXT },
      isHidden: { type: DataTypes.BOOLEAN, defaultValue: false },
      verifiedPurchase: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    { ...commonOpts, tableName: "reviews" }
  );

  db.Coupon = sequelize.define(
    "Coupon",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      code: { type: DataTypes.STRING, allowNull: false, unique: true },
      type: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      minCart: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
      maxDiscount: { type: DataTypes.DECIMAL(12, 2) },
      startAt: { type: DataTypes.DATE, allowNull: false },
      endAt: { type: DataTypes.DATE, allowNull: false },
      usageLimit: { type: DataTypes.INTEGER },
      usagePerUser: { type: DataTypes.INTEGER, defaultValue: 1 },
      usageCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
    },
    { ...commonOpts, tableName: "coupons" }
  );

  db.CouponRedemption = sequelize.define(
    "CouponRedemption",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      couponId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false }
    },
    { ...commonOpts, tableName: "coupon_redemptions" }
  );

  db.Notification = sequelize.define(
    "Notification",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      readAt: { type: DataTypes.DATE }
    },
    { ...commonOpts, tableName: "notifications" }
  );

  db.ReturnRequest = sequelize.define(
    "ReturnRequest",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      orderId: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Requested" }
    },
    { ...commonOpts, tableName: "return_requests" }
  );

  db.SupportTicket = sequelize.define(
    "SupportTicket",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      subject: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" }
    },
    { ...commonOpts, tableName: "support_tickets" }
  );

  db.SupportMessage = sequelize.define(
    "SupportMessage",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false }
    },
    { ...commonOpts, tableName: "support_messages" }
  );

  db.RecentlyViewed = sequelize.define(
    "RecentlyViewed",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID },
      sessionId: { type: DataTypes.STRING },
      productId: { type: DataTypes.UUID, allowNull: false },
      viewedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    { ...commonOpts, tableName: "recently_viewed", updatedAt: false }
  );

  db.AuditLog = sequelize.define(
    "AuditLog",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      category: { type: DataTypes.STRING, allowNull: false },
      level: { type: DataTypes.STRING, allowNull: false, defaultValue: "INFO" },
      action: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      meta: { type: JsonType, defaultValue: {} },
      actorUserId: { type: DataTypes.UUID },
      actorEmail: { type: DataTypes.STRING },
      requestId: { type: DataTypes.STRING },
      ip: { type: DataTypes.STRING },
      userAgent: { type: DataTypes.STRING }
    },
    { ...commonOpts, tableName: "audit_logs" }
  );

  db.User.hasMany(db.Address, { foreignKey: "userId" });
  db.Address.belongsTo(db.User, { foreignKey: "userId" });
  db.Category.belongsTo(db.Category, { as: "parent", foreignKey: "parentId" });
  db.Category.hasMany(db.Category, { as: "children", foreignKey: "parentId" });
  db.Category.hasMany(db.Product, { foreignKey: "categoryId" });
  db.Product.belongsTo(db.Category, { foreignKey: "categoryId" });
  db.Product.hasMany(db.ProductImage, { foreignKey: "productId", as: "images" });
  db.ProductImage.belongsTo(db.Product, { foreignKey: "productId" });
  db.Product.hasMany(db.ProductVariant, { foreignKey: "productId", as: "variants" });
  db.ProductVariant.belongsTo(db.Product, { foreignKey: "productId" });
  db.ProductVariant.hasMany(db.ProductImage, { foreignKey: "variantId", as: "images" });
  db.ProductImage.belongsTo(db.ProductVariant, { foreignKey: "variantId", as: "variant" });
  db.User.hasMany(db.Cart, { foreignKey: "userId" });
  db.Cart.belongsTo(db.User, { foreignKey: "userId" });
  db.Cart.hasMany(db.CartItem, { foreignKey: "cartId", as: "items" });
  db.CartItem.belongsTo(db.Cart, { foreignKey: "cartId" });
  db.CartItem.belongsTo(db.Product, { foreignKey: "productId", as: "product" });
  db.CartItem.belongsTo(db.ProductVariant, { foreignKey: "variantId", as: "variant" });
  db.User.belongsToMany(db.Product, { through: db.Favorite, foreignKey: "userId", otherKey: "productId", as: "favoriteProducts" });
  db.Product.belongsToMany(db.User, { through: db.Favorite, foreignKey: "productId", otherKey: "userId", as: "favoritedByUsers" });
  db.Favorite.belongsTo(db.Product, { foreignKey: "productId", as: "product" });
  db.Favorite.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.User.hasMany(db.Order, { foreignKey: "userId" });
  db.Order.belongsTo(db.User, { foreignKey: "userId" });
  db.Order.hasMany(db.OrderItem, { foreignKey: "orderId", as: "items" });
  db.OrderItem.belongsTo(db.Order, { foreignKey: "orderId" });
  db.Order.hasMany(db.OrderStatusHistory, { foreignKey: "orderId", as: "statusHistory" });
  db.OrderStatusHistory.belongsTo(db.Order, { foreignKey: "orderId" });
  db.User.hasMany(db.Review, { foreignKey: "userId" });
  db.Product.hasMany(db.Review, { foreignKey: "productId", as: "reviews" });
  db.Review.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.Review.belongsTo(db.Product, { foreignKey: "productId", as: "product" });
  db.Coupon.hasMany(db.CouponRedemption, { foreignKey: "couponId", as: "redemptions" });
  db.CouponRedemption.belongsTo(db.Coupon, { foreignKey: "couponId" });
  db.CouponRedemption.belongsTo(db.User, { foreignKey: "userId" });
  db.CouponRedemption.belongsTo(db.Order, { foreignKey: "orderId" });
  db.User.hasMany(db.Notification, { foreignKey: "userId" });
  db.Notification.belongsTo(db.User, { foreignKey: "userId" });
  db.Order.hasOne(db.ReturnRequest, { foreignKey: "orderId", as: "returnRequest" });
  db.ReturnRequest.belongsTo(db.Order, { foreignKey: "orderId" });
  db.User.hasMany(db.SupportTicket, { foreignKey: "userId" });
  db.SupportTicket.belongsTo(db.User, { foreignKey: "userId" });
  db.SupportTicket.hasMany(db.SupportMessage, { foreignKey: "ticketId", as: "messages" });
  db.SupportMessage.belongsTo(db.SupportTicket, { foreignKey: "ticketId" });
  db.SupportMessage.belongsTo(db.User, { foreignKey: "userId", as: "author" });
  db.RecentlyViewed.belongsTo(db.Product, { foreignKey: "productId", as: "product" });
  db.RecentlyViewed.belongsTo(db.User, { foreignKey: "userId" });
  db.AuditLog.belongsTo(db.User, { foreignKey: "actorUserId", as: "actor" });
  db.User.hasMany(db.AuditLog, { foreignKey: "actorUserId", as: "auditLogs" });

  initialized = true;
  return db;
}

async function initDatabase() {
  defineModels();
  try {
    await sequelize.authenticate();
    logger.info("Connexion PostgreSQL OK");
    try {
      const { createAuditLog } = require("../services/auditLogService");
      await createAuditLog({
        category: "SYSTEM",
        action: "DB_CONNECT_OK",
        message: "Connexion base de données réussie",
        meta: { dialect: sequelize.getDialect() }
      });
    } catch (_e) {}
  } catch (error) {
    logger.warn({ err: error }, "Connexion PostgreSQL indisponible au demarrage (verifier .env / migrations)");
    try {
      const { createAuditLog } = require("../services/auditLogService");
      await createAuditLog({
        category: "SYSTEM",
        level: "ERROR",
        action: "DB_CONNECT_FAILED",
        message: "Echec connexion base de données au démarrage",
        meta: { dialect: sequelize.getDialect(), error: error.message }
      });
    } catch (_e) {}
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

module.exports = { ...db, defineModels, initDatabase, hashPassword };
