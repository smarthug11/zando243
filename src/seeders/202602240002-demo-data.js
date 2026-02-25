"use strict";
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");

const img = [
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80"
];
const brands = ["Samsung", "Apple", "Sony", "JBL", "Nike", "Adidas", "Xiaomi", "Tecno"];
const now = () => new Date();
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fp = (p, w) => +(p + 15 * w).toFixed(2);
const line = (p, w, q=1) => +((p + 15 * w) * q).toFixed(2);

module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    const asJson = (value) => (dialect === "sqlite" ? JSON.stringify(value) : value);
    const cleanupTables = [
      "recently_viewed","support_messages","support_tickets","reviews","notifications","return_requests",
      "coupon_redemptions","order_status_histories","order_items","orders","favorites","cart_items","carts",
      "addresses","product_variants","product_images","products","categories","coupons","users"
    ];
    if (dialect === "sqlite") {
      await queryInterface.sequelize.query("PRAGMA foreign_keys = OFF;");
    }
    for (const t of cleanupTables) {
      await queryInterface.bulkDelete(t, null, {});
    }
    if (dialect === "sqlite") {
      await queryInterface.sequelize.query("PRAGMA foreign_keys = ON;");
    }

    const password = await bcrypt.hash("Password123!", 10);
    const adminIds = [randomUUID(), randomUUID()];
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    const allUsers = [...adminIds, ...userIds];
    const userFields = [
      "id","role","first_name","last_name","email","phone","avatar_url","loyalty_points","is_active",
      "password_hash","email_verified_at","email_verification_token_hash","reset_password_token_hash",
      "reset_password_expires_at","refresh_token_version","created_at","updated_at","deleted_at"
    ];
    const mkUser = (row) => ({
      id: row.id,
      role: row.role,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone ?? null,
      avatar_url: row.avatar_url ?? null,
      loyalty_points: row.loyalty_points ?? 0,
      is_active: row.is_active ?? true,
      password_hash: row.password_hash,
      email_verified_at: row.email_verified_at ?? null,
      email_verification_token_hash: row.email_verification_token_hash ?? null,
      reset_password_token_hash: row.reset_password_token_hash ?? null,
      reset_password_expires_at: row.reset_password_expires_at ?? null,
      refresh_token_version: row.refresh_token_version ?? 0,
      created_at: row.created_at ?? now(),
      updated_at: row.updated_at ?? now(),
      deleted_at: null
    });

    const userRows = [
      mkUser({ id: adminIds[0], role: "ADMIN", first_name: "Admin", last_name: "One", email: "admin1@zando243.local", phone: "+243810000001", avatar_url: "https://i.pravatar.cc/150?img=10", loyalty_points: 0, is_active: true, password_hash: password, email_verified_at: now(), refresh_token_version: 0, created_at: now(), updated_at: now() }),
      mkUser({ id: adminIds[1], role: "ADMIN", first_name: "Admin", last_name: "Two", email: "admin2@zando243.local", phone: "+243810000002", avatar_url: "https://i.pravatar.cc/150?img=11", loyalty_points: 0, is_active: true, password_hash: password, email_verified_at: now(), refresh_token_version: 0, created_at: now(), updated_at: now() }),
      ...userIds.map((id, i) => mkUser({ id, role: "CUSTOMER", first_name: `Client${i+1}`, last_name: "Zando", email: `user${i+1}@zando243.local`, phone: `+24382${String(1000000+i).slice(-7)}`, avatar_url: `https://i.pravatar.cc/150?img=${20+i}`, loyalty_points: (i+1)*15, is_active: true, password_hash: password, email_verified_at: i < 8 ? now() : null, refresh_token_version: 0, created_at: daysAgo(40-i), updated_at: now() }))
    ];
    await queryInterface.bulkInsert("users", userRows, { fields: userFields });

    const cat = { e: randomUUID(), f: randomUUID(), h: randomUUID(), b: randomUUID(), p: randomUUID(), a: randomUUID(), mh: randomUUID(), mf: randomUUID() };
    await queryInterface.bulkInsert("categories", [
      { id: cat.e, name: "Electronics", slug: "electronics", parent_id: null, created_at: now(), updated_at: now() },
      { id: cat.f, name: "Fashion", slug: "fashion", parent_id: null, created_at: now(), updated_at: now() },
      { id: cat.h, name: "Maison", slug: "maison", parent_id: null, created_at: now(), updated_at: now() },
      { id: cat.b, name: "Beauté", slug: "beaute", parent_id: null, created_at: now(), updated_at: now() },
      { id: cat.p, name: "Téléphones", slug: "telephones", parent_id: cat.e, created_at: now(), updated_at: now() },
      { id: cat.a, name: "Audio", slug: "audio", parent_id: cat.e, created_at: now(), updated_at: now() },
      { id: cat.mh, name: "Mode Homme", slug: "mode-homme", parent_id: cat.f, created_at: now(), updated_at: now() },
      { id: cat.mf, name: "Mode Femme", slug: "mode-femme", parent_id: cat.f, created_at: now(), updated_at: now() }
    ]);

    const catList = [cat.e, cat.f, cat.h, cat.b, cat.p, cat.a, cat.mh, cat.mf];
    const products = [];
    const productImages = [];
    const variants = [];
    for (let i = 0; i < 60; i++) {
      const id = randomUUID();
      const w = +(0.2 + (i % 7) * 0.3).toFixed(2);
      const p = +(12 + i * 2.4).toFixed(2);
      const sale = i % 4 === 0 ? +(p * 0.9).toFixed(2) : null;
      const disc = sale ? +(((p - sale) / p) * 100).toFixed(2) : null;
      const name = `Produit ${i + 1} ${i % 2 ? "Classic" : "Premium"}`;
      products.push({
        id, category_id: catList[i % catList.length], name, slug: `${slug(name)}-${i+1}`,
        description: `Description du ${name} pour marketplace Zando243.`, weight_kg: w,
        purchase_price: +(p * 0.6).toFixed(2), price_without_delivery: p, final_price: fp(p, w),
        sale_price: sale, discount_percent: disc, stock: 8 + (i % 25), sku: `SKU-${String(i+1).padStart(5,"0")}`,
        brand: brands[i % brands.length], status: i % 12 === 0 ? "DRAFT" : "ACTIVE",
        keywords: asJson(["zando243", "marketplace", (brands[i % brands.length]).toLowerCase()]), avg_rating: 0, count_reviews: 0, popularity_score: 10 + (i % 50),
        created_at: daysAgo(70-i), updated_at: now()
      });
      productImages.push(
        { id: randomUUID(), product_id: id, url: `${img[i % img.length]}&sig=${i}`, is_main: true, position: 0, created_at: now(), updated_at: now() },
        { id: randomUUID(), product_id: id, url: `${img[(i+1) % img.length]}&sig=${i+100}`, is_main: false, position: 1, created_at: now(), updated_at: now() }
      );
      if (i % 3 === 0) {
        ["S","M","L"].forEach((size, j) => variants.push({ id: randomUUID(), product_id: id, name: `${name} ${size}`, color: ["Noir","Bleu","Rouge"][j], size, sku: `VAR-${i+1}-${size}`, stock: 5+j, created_at: now(), updated_at: now() }));
      }
    }
    await queryInterface.bulkInsert("products", products);
    await queryInterface.bulkInsert("product_images", productImages);
    await queryInterface.bulkInsert("product_variants", variants);

    const addresses = allUsers.map((uid, i) => ({ id: randomUUID(), user_id: uid, label: i % 2 ? "Bureau" : "Maison", number: `${100+i}`, street: `Avenue ${i+1}`, neighborhood: "Gombe", municipality: "Kinshasa", city: "Kinshasa", country: "RDC", is_default: true, created_at: now(), updated_at: now() }));
    await queryInterface.bulkInsert("addresses", addresses);

    const carts = [];
    const cartItems = [];
    userIds.slice(0, 4).forEach((uid, i) => {
      const cartId = randomUUID();
      carts.push({ id: cartId, user_id: uid, session_id: null, created_at: now(), updated_at: now() });
      [0,1,2].forEach((j) => cartItems.push({ id: randomUUID(), cart_id: cartId, product_id: products[(i*4+j)%products.length].id, variant_id: null, qty: j===0?2:1, saved_for_later: j===2, created_at: now(), updated_at: now() }));
    });
    await queryInterface.bulkInsert("carts", carts);
    await queryInterface.bulkInsert("cart_items", cartItems);

    await queryInterface.bulkInsert("favorites", userIds.flatMap((uid, i) => [0,1,2].map((j) => ({ id: randomUUID(), user_id: uid, product_id: products[(i+j)%products.length].id, created_at: daysAgo(j+1), updated_at: daysAgo(j+1) }))));

    const couponIds = { w: randomUUID(), f: randomUUID(), o: randomUUID() };
    await queryInterface.bulkInsert("coupons", [
      { id: couponIds.w, code: "WELCOME10", type: "PERCENT", value: 10, min_cart: 25, max_discount: 20, start_at: daysAgo(15), end_at: new Date(Date.now()+30*86400000), usage_limit: 500, usage_per_user: 1, usage_count: 10, is_active: true, created_at: now(), updated_at: now() },
      { id: couponIds.f, code: "FIXED5", type: "FIXED", value: 5, min_cart: 15, max_discount: null, start_at: daysAgo(5), end_at: new Date(Date.now()+20*86400000), usage_limit: 1000, usage_per_user: 2, usage_count: 6, is_active: true, created_at: now(), updated_at: now() },
      { id: couponIds.o, code: "OLD2025", type: "PERCENT", value: 15, min_cart: 60, max_discount: 25, start_at: daysAgo(400), end_at: daysAgo(300), usage_limit: 50, usage_per_user: 1, usage_count: 50, is_active: false, created_at: daysAgo(400), updated_at: daysAgo(300) }
    ]);

    const orders = [], orderItems = [], history = [], redemptions = [], returns = [], notifications = [];
    userIds.slice(0, 6).forEach((uid, i) => {
      const oid = randomUUID();
      const picks = [products[(i*3)%products.length], products[(i*3+1)%products.length]];
      const subtotal = picks.reduce((s, p) => s + line(+p.price_without_delivery, +p.weight_kg, 1), 0);
      const shipping = i % 2 === 0 ? 5 : 0;
      const discount = i % 3 === 0 ? 5 : 0;
      const status = i < 4 ? "Delivered" : (i % 2 ? "Shipped" : "Processing");
      const ad = addresses.find(a => a.user_id === uid);
      orders.push({ id: oid, order_number: `ORD-2026-${10000+i}`, user_id: uid, address_snapshot: asJson({ label: ad.label, street: ad.street, city: ad.city, country: ad.country }), subtotal, shipping_fee: shipping, discount_total: discount, total: +(subtotal + shipping - discount).toFixed(2), coupon_code: discount ? "FIXED5" : null, payment_method: ["CASH_ON_DELIVERY","CARD","MOBILE_MONEY"][i%3], status, tracking_number: `TRK${20000+i}`, tracking_carrier: "Zando Logistics", customs_fee: i % 2 ? 2.5 : 0, consolidation_reference: `CONSOL-${i+1}`, logistics_meta: asJson({ warehouse: "Kinshasa Hub" }), internal_note: i % 2 ? "Appeler avant livraison" : null, created_at: daysAgo(20-i), updated_at: daysAgo(1) });
      picks.forEach((p) => orderItems.push({ id: randomUUID(), order_id: oid, product_id: p.id, product_snapshot: asJson({ name: p.name, sku: p.sku, weightKg: +p.weight_kg, priceWithoutDelivery: +p.price_without_delivery }), unit_price: +p.price_without_delivery, qty: 1, line_total: line(+p.price_without_delivery, +p.weight_kg, 1), created_at: daysAgo(20-i), updated_at: daysAgo(20-i) }));
      ["Processing", i > 0 ? "Shipped" : "Processing", status].forEach((st, k) => history.push({ id: randomUUID(), order_id: oid, status: st, note: ["Commande créée","Transit logistique","Statut final"][k], created_at: daysAgo(20-i-k), updated_at: daysAgo(20-i-k) }));
      if (discount) redemptions.push({ id: randomUUID(), coupon_id: couponIds.f, user_id: uid, order_id: oid, created_at: daysAgo(20-i), updated_at: daysAgo(20-i) });
      if (status !== "Delivered") returns.push({ id: randomUUID(), order_id: oid, reason: "Annulation demandée avant livraison", status: i % 2 ? "Requested" : "Approved", created_at: daysAgo(3), updated_at: daysAgo(2) });
      notifications.push({ id: randomUUID(), user_id: uid, type: "ORDER_STATUS", message: `Commande ORD-2026-${10000+i} : ${status}`, read_at: i % 2 ? null : now(), created_at: daysAgo(1), updated_at: daysAgo(1) });
      notifications.push({ id: randomUUID(), user_id: uid, type: "PROMO", message: "Coupon FIXED5 actif cette semaine.", read_at: null, created_at: now(), updated_at: now() });
    });
    await queryInterface.bulkInsert("orders", orders);
    await queryInterface.bulkInsert("order_items", orderItems);
    await queryInterface.bulkInsert("order_status_histories", history);
    if (redemptions.length) await queryInterface.bulkInsert("coupon_redemptions", redemptions);
    if (returns.length) await queryInterface.bulkInsert("return_requests", returns);
    await queryInterface.bulkInsert("notifications", notifications);

    const reviews = userIds.slice(0, 10).map((uid, i) => ({ id: randomUUID(), user_id: uid, product_id: products[i].id, rating: 3 + (i % 3), comment: `Avis ${i+1}: produit ${i % 2 ? "très bon" : "correct"}.`, is_hidden: i === 9, verified_purchase: i < 6, created_at: daysAgo(10-i), updated_at: daysAgo(10-i) }));
    await queryInterface.bulkInsert("reviews", reviews);

    for (let i = 0; i < 12; i++) {
      const pid = products[i].id;
      const rv = reviews.filter(r => r.product_id === pid && !r.is_hidden);
      const count = rv.length;
      const avg = count ? +(rv.reduce((s, r) => s + r.rating, 0) / count).toFixed(2) : 0;
      await queryInterface.bulkUpdate("products", { count_reviews: count, avg_rating: avg }, { id: pid });
    }

    const tickets = [], messages = [];
    userIds.slice(0, 4).forEach((uid, i) => {
      const tid = randomUUID();
      tickets.push({ id: tid, user_id: uid, subject: `Ticket livraison ${i+1}`, status: i % 2 ? "Open" : "Pending", created_at: daysAgo(6-i), updated_at: daysAgo(1) });
      messages.push({ id: randomUUID(), ticket_id: tid, user_id: uid, message: "Bonjour, où en est ma commande ?", created_at: daysAgo(6-i), updated_at: daysAgo(6-i) });
      messages.push({ id: randomUUID(), ticket_id: tid, user_id: adminIds[0], message: "Nous vérifions avec la logistique.", created_at: daysAgo(5-i), updated_at: daysAgo(5-i) });
    });
    await queryInterface.bulkInsert("support_tickets", tickets);
    await queryInterface.bulkInsert("support_messages", messages);

    await queryInterface.bulkInsert("recently_viewed", userIds.flatMap((uid, i) => [0,1,2,3].map((j) => ({ id: randomUUID(), user_id: uid, session_id: null, product_id: products[(i+j)%products.length].id, viewed_at: daysAgo(j), created_at: daysAgo(j) }))));
  },

  async down(queryInterface) {
    for (const t of ["recently_viewed","support_messages","support_tickets","reviews","notifications","return_requests","coupon_redemptions","order_status_histories","order_items","orders","favorites","cart_items","carts","addresses","product_variants","product_images","products","categories","coupons","users"]) {
      await queryInterface.bulkDelete(t, null, {});
    }
  }
};
