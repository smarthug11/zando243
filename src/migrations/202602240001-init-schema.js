"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const S = Sequelize;
    const dialect = queryInterface.sequelize.getDialect();
    const isPostgres = dialect === "postgres";
    const JsonType = isPostgres ? S.JSONB : S.JSON;
    const KeywordsType = isPostgres ? S.ARRAY(S.STRING) : S.JSON;
    const nowDefault = isPostgres ? S.fn("NOW") : S.literal("CURRENT_TIMESTAMP");
    const base = {
      id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
      created_at: { type: S.DATE, allowNull: false, defaultValue: nowDefault },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: nowDefault }
    };
    const create = (name, cols) => queryInterface.createTable(name, cols);

    await create("users", {
      ...base,
      role: { type: S.STRING, allowNull: false, defaultValue: "CUSTOMER" },
      first_name: { type: S.STRING, allowNull: false },
      last_name: { type: S.STRING, allowNull: false },
      email: { type: S.STRING, allowNull: false, unique: true },
      phone: S.STRING,
      avatar_url: S.STRING,
      loyalty_points: { type: S.INTEGER, defaultValue: 0 },
      is_active: { type: S.BOOLEAN, defaultValue: true },
      password_hash: { type: S.STRING, allowNull: false },
      email_verified_at: S.DATE,
      email_verification_token_hash: S.STRING,
      reset_password_token_hash: S.STRING,
      reset_password_expires_at: S.DATE,
      refresh_token_version: { type: S.INTEGER, defaultValue: 0 },
      failed_login_attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: S.DATE,
      deleted_at: S.DATE
    });

    await create("categories", {
      ...base,
      name: { type: S.STRING, allowNull: false },
      slug: { type: S.STRING, allowNull: false, unique: true },
      parent_id: { type: S.UUID, references: { model: "categories", key: "id" }, onDelete: "SET NULL" }
    });

    await create("products", {
      ...base,
      category_id: { type: S.UUID, allowNull: false, references: { model: "categories", key: "id" }, onDelete: "RESTRICT" },
      name: { type: S.STRING, allowNull: false },
      slug: { type: S.STRING, allowNull: false, unique: true },
      description: { type: S.TEXT, allowNull: false },
      weight_kg: { type: S.DECIMAL(10, 2), allowNull: false, defaultValue: 0.1 },
      purchase_price: { type: S.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price_without_delivery: { type: S.DECIMAL(12, 2), allowNull: false },
      final_price: { type: S.DECIMAL(12, 2), allowNull: false },
      sale_price: S.DECIMAL(12, 2),
      discount_percent: S.DECIMAL(5, 2),
      stock: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      sku: { type: S.STRING, allowNull: false, unique: true },
      brand: S.STRING,
      status: { type: S.STRING, allowNull: false, defaultValue: "ACTIVE" },
      keywords: { type: KeywordsType, defaultValue: [] },
      avg_rating: { type: S.DECIMAL(3, 2), defaultValue: 0 },
      count_reviews: { type: S.INTEGER, defaultValue: 0 },
      popularity_score: { type: S.INTEGER, defaultValue: 0 },
      deleted_at: S.DATE
    });

    await create("product_images", {
      ...base,
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" },
      url: { type: S.STRING, allowNull: false },
      is_main: { type: S.BOOLEAN, defaultValue: false },
      position: { type: S.INTEGER, defaultValue: 0 }
    });

    await create("product_variants", {
      ...base,
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" },
      name: { type: S.STRING, allowNull: false },
      color: S.STRING,
      size: S.STRING,
      sku: { type: S.STRING, unique: true },
      stock: { type: S.INTEGER, defaultValue: 0 }
    });

    await create("addresses", {
      ...base,
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      label: { type: S.STRING, allowNull: false },
      number: S.STRING,
      street: { type: S.STRING, allowNull: false },
      neighborhood: S.STRING,
      municipality: S.STRING,
      city: { type: S.STRING, allowNull: false },
      country: { type: S.STRING, allowNull: false, defaultValue: "RDC" },
      is_default: { type: S.BOOLEAN, defaultValue: false }
    });

    await create("carts", {
      ...base,
      user_id: { type: S.UUID, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      session_id: S.STRING
    });

    await create("cart_items", {
      ...base,
      cart_id: { type: S.UUID, allowNull: false, references: { model: "carts", key: "id" }, onDelete: "CASCADE" },
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" },
      variant_id: { type: S.UUID, references: { model: "product_variants", key: "id" }, onDelete: "SET NULL" },
      qty: { type: S.INTEGER, allowNull: false, defaultValue: 1 },
      saved_for_later: { type: S.BOOLEAN, defaultValue: false }
    });

    await create("favorites", {
      ...base,
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" }
    });
    await queryInterface.addConstraint("favorites", { fields: ["user_id", "product_id"], type: "unique", name: "favorites_user_product_unique" });

    await create("orders", {
      ...base,
      order_number: { type: S.STRING, allowNull: false, unique: true },
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "RESTRICT" },
      address_snapshot: { type: JsonType, allowNull: false },
      subtotal: { type: S.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      shipping_fee: { type: S.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      discount_total: { type: S.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total: { type: S.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      coupon_code: S.STRING,
      payment_method: { type: S.STRING, allowNull: false, defaultValue: "CASH_ON_DELIVERY" },
      status: { type: S.STRING, allowNull: false, defaultValue: "Processing" },
      tracking_number: S.STRING,
      tracking_carrier: S.STRING,
      customs_fee: { type: S.DECIMAL(12, 2), defaultValue: 0 },
      consolidation_reference: S.STRING,
      logistics_meta: { type: JsonType, defaultValue: {} },
      internal_note: S.TEXT
    });

    await create("order_items", {
      ...base,
      order_id: { type: S.UUID, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
      product_id: { type: S.UUID, references: { model: "products", key: "id" }, onDelete: "SET NULL" },
      product_snapshot: { type: JsonType, allowNull: false },
      unit_price: { type: S.DECIMAL(12, 2), allowNull: false },
      qty: { type: S.INTEGER, allowNull: false },
      line_total: { type: S.DECIMAL(12, 2), allowNull: false }
    });

    await create("order_status_histories", {
      ...base,
      order_id: { type: S.UUID, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
      status: { type: S.STRING, allowNull: false },
      note: S.TEXT
    });

    await create("reviews", {
      ...base,
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" },
      rating: { type: S.INTEGER, allowNull: false },
      comment: S.TEXT,
      is_hidden: { type: S.BOOLEAN, defaultValue: false },
      verified_purchase: { type: S.BOOLEAN, defaultValue: false }
    });

    await create("coupons", {
      ...base,
      code: { type: S.STRING, allowNull: false, unique: true },
      type: { type: S.STRING, allowNull: false },
      value: { type: S.DECIMAL(12, 2), allowNull: false },
      min_cart: { type: S.DECIMAL(12, 2), defaultValue: 0 },
      max_discount: S.DECIMAL(12, 2),
      start_at: { type: S.DATE, allowNull: false },
      end_at: { type: S.DATE, allowNull: false },
      usage_limit: S.INTEGER,
      usage_per_user: { type: S.INTEGER, defaultValue: 1 },
      usage_count: { type: S.INTEGER, defaultValue: 0 },
      is_active: { type: S.BOOLEAN, defaultValue: true }
    });

    await create("coupon_redemptions", {
      ...base,
      coupon_id: { type: S.UUID, allowNull: false, references: { model: "coupons", key: "id" }, onDelete: "CASCADE" },
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      order_id: { type: S.UUID, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" }
    });

    await create("notifications", {
      ...base,
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      type: { type: S.STRING, allowNull: false },
      message: { type: S.TEXT, allowNull: false },
      read_at: S.DATE
    });

    await create("return_requests", {
      ...base,
      order_id: { type: S.UUID, allowNull: false, unique: true, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
      reason: { type: S.TEXT, allowNull: false },
      status: { type: S.STRING, allowNull: false, defaultValue: "Requested" }
    });

    await create("support_tickets", {
      ...base,
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      subject: { type: S.STRING, allowNull: false },
      status: { type: S.STRING, allowNull: false, defaultValue: "Open" }
    });

    await create("support_messages", {
      ...base,
      ticket_id: { type: S.UUID, allowNull: false, references: { model: "support_tickets", key: "id" }, onDelete: "CASCADE" },
      user_id: { type: S.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      message: { type: S.TEXT, allowNull: false }
    });

    await queryInterface.createTable("recently_viewed", {
      id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
      user_id: { type: S.UUID, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      session_id: S.STRING,
      product_id: { type: S.UUID, allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE" },
      viewed_at: { type: S.DATE, allowNull: false, defaultValue: nowDefault },
      created_at: { type: S.DATE, allowNull: false, defaultValue: nowDefault }
    });
  },

  async down(queryInterface) {
    for (const t of [
      "recently_viewed","support_messages","support_tickets","return_requests","notifications","coupon_redemptions","coupons","reviews","order_status_histories","order_items","orders","favorites","cart_items","carts","addresses","product_variants","product_images","products","categories","users"
    ]) {
      await queryInterface.dropTable(t);
    }
  }
};
