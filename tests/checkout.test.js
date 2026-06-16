const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");


require("./_setup-test-db");
const { sequelize, defineModels, hashPassword } = require("../src/models");
const cartController = require("../src/controllers/cartController");
const paymentController = require("../src/controllers/paymentController");
const cartService = require("../src/services/cartService");
const orderService = require("../src/services/orderService");
const { errorHandler } = require("../src/middlewares/errorHandler");
const { env } = require("../src/config/env");

defineModels();

let models;
let customerUser;
let category;
let productA;
let productB;
let originalPaypalConfig;
let originalFetch;

function createRes() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.rendered = { view, locals }; return this; },
    redirect(location) { this.redirectTo = location; this.statusCode = 302; return this; }
  };
}

function createReq(overrides = {}) {
  const session = { guestCartKey: null, ...(overrides.session || {}) };
  return {
    body: {},
    params: {},
    query: {},
    user: customerUser,
    method: "POST",
    originalUrl: "/cart/checkout",
    path: "/cart/checkout",
    requestId: "req-checkout-test",
    session,
    sessionID: "test-session-id-checkout",
    accepts(type) { return type === "html"; },
    get() { return null; },
    headers: {},
    ip: "127.0.0.1",
    ...overrides,
    session
  };
}

async function runHandler(handler, req, res = createRes()) {
  let nextError = null;
  await handler(req, res, (err) => { nextError = err || null; });
  return { res, nextError };
}

async function createUser(email = "alice-checkout@example.com") {
  return models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Client",
    email,
    isActive: true,
    emailVerifiedAt: new Date(),
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });
}

async function createProduct({ name, sku, priceWithoutDelivery, weightKg, stock }) {
  return models.Product.create({
    categoryId: category.id,
    name,
    description: `${name} description`,
    sku,
    priceWithoutDelivery,
    weightKg,
    stock,
    status: "ACTIVE"
  });
}

async function createVariant(product, overrides = {}) {
  return models.ProductVariant.create({
    productId: product.id,
    name: overrides.name || "Variante test",
    color: overrides.color || null,
    size: overrides.size || null,
    sku: overrides.sku || null,
    stock: overrides.stock ?? 1
  });
}

async function addCartItem(req, product, qty) {
  const cart = await cartService.getOrCreateCart(req);
  return models.CartItem.create({ cartId: cart.id, productId: product.id, qty });
}

async function createValidCoupon(overrides = {}) {
  const now = Date.now();
  return models.Coupon.create({
    code: overrides.code || "FIXED5",
    type: overrides.type || "FIXED",
    value: overrides.value ?? 5,
    minCart: overrides.minCart ?? 0,
    maxDiscount: overrides.maxDiscount ?? null,
    startAt: overrides.startAt || new Date(now - 86400000),
    endAt: overrides.endAt || new Date(now + 86400000),
    usageLimit: overrides.usageLimit ?? 10,
    usagePerUser: overrides.usagePerUser ?? 1,
    usageCount: overrides.usageCount ?? 0,
    isActive: overrides.isActive ?? true
  });
}

async function seedBaseData() {
  await sequelize.sync({ force: true });
  customerUser = await createUser();
  category = await models.Category.create({ name: "Checkout", slug: "checkout" });
  productA = await createProduct({
    name: "Produit A",
    sku: "CHK-A",
    priceWithoutDelivery: 10,
    weightKg: 1,
    stock: 10
  });
  productB = await createProduct({
    name: "Produit B",
    sku: "CHK-B",
    priceWithoutDelivery: 20,
    weightKg: 2,
    stock: 3
  });
}

test.before(async () => {
  models = defineModels();
  originalPaypalConfig = { ...env.paypal };
  originalFetch = global.fetch;
});

test.beforeEach(async () => {
  await seedBaseData();
  Object.assign(env.paypal, originalPaypalConfig);
  global.fetch = originalFetch;
});

test.after(() => {
  Object.assign(env.paypal, originalPaypalConfig);
  global.fetch = originalFetch;
});

test("client connecté peut créer une commande depuis un panier valide", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 2);

  const order = await orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" });

  assert.equal(order.userId, customerUser.id);
  assert.equal(order.paymentMethod, "MOBILE_MONEY");
  assert.equal(order.paymentStatus, "PENDING");
  assert.equal(order.status, "Processing");
  assert.equal(Number(order.subtotal), 50);
  assert.equal(Number(order.total), 50);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productSnapshot.name, "Produit A");
  assert.equal(Number(order.items[0].unitPrice), 10);
  assert.equal(Number(order.items[0].qty), 2);

  await productA.reload();
  assert.equal(productA.stock, 8);
  assert.equal(productA.popularityScore, 2);
  assert.equal(await models.CartItem.count(), 0);
  assert.equal(await models.OrderStatusHistory.count({ where: { orderId: order.id, status: "Processing" } }), 1);
  assert.equal(await models.Notification.count({ where: { userId: customerUser.id, type: "ORDER_CREATED" } }), 1);
  assert.equal(await models.AuditLog.count({ where: { action: "ORDER_CREATED", actorUserId: customerUser.id } }), 1);
  assert.ok(fs.existsSync(path.join(env.invoiceDir, `${order.orderNumber}.pdf`)));
});

test("checkout controller redirige un visiteur non connecté vers login sans créer de commande", async () => {
  const req = createReq({
    user: null,
    body: { paymentMethod: "MOBILE_MONEY" }
  });

  const { res, nextError } = await runHandler(cartController.checkout, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/auth2/login");
  assert.deepEqual(req.session.flash, {
    type: "error",
    message: "Connectez-vous pour finaliser le paiement. Votre panier invite est conserve."
  });
  assert.equal(await models.Order.count(), 0);
});

test("checkout PayPal non configuré garde le panier et ne crée pas de commande", async () => {
  env.paypal.clientId = "";
  env.paypal.clientSecret = "";
  const req = createReq({
    user: customerUser,
    body: { paymentMethod: "PAYPAL" }
  });
  await addCartItem(req, productA, 1);

  const { res, nextError } = await runHandler(cartController.checkout, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  assert.deepEqual(req.session.flash, { type: "error", message: "PayPal n'est pas configure sur le serveur." });
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
});

test("échec d'initialisation PayPal conserve les CartItem", async () => {
  env.paypal.clientId = "client-id";
  env.paypal.clientSecret = "client-secret";
  env.paypal.baseUrl = "https://api-m.sandbox.paypal.com";
  global.fetch = async (url) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      return { ok: true, json: async () => ({ access_token: "test-token" }) };
    }
    return { ok: false, statusText: "Bad Gateway", json: async () => ({ message: "create failed" }) };
  };
  const req = createReq({
    user: customerUser,
    body: { paymentMethod: "PAYPAL" }
  });
  await addCartItem(req, productA, 1);

  const checkoutResult = await runHandler(cartController.checkout, req);
  assert.equal(checkoutResult.nextError, null);
  const order = await models.Order.findOne({ where: { userId: customerUser.id } });
  assert.ok(order);
  assert.equal(await models.CartItem.count(), 1);

  const paypalReq = createReq({
    user: customerUser,
    method: "GET",
    originalUrl: "/payments/paypal/start",
    path: "/payments/paypal/start",
    query: { orderId: order.id },
    session: req.session
  });
  const { res, nextError } = await runHandler(paymentController.startPayPal, paypalReq);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  assert.deepEqual(paypalReq.session.flash, {
    type: "error",
    message: "Impossible d'initialiser le paiement PayPal. Votre panier est conserve."
  });
  await order.reload();
  assert.equal(order.paymentReference, null);
  assert.equal(await models.CartItem.count(), 1);
});

test("panier vide est refusé selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser });

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "EMPTY_CART" && err.statusCode === 400
  );
  assert.equal(await models.Order.count(), 0);
});

test("checkout refuse un client dont l'email n'est pas vérifié", async () => {
  await customerUser.update({ emailVerifiedAt: null });
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 1);

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "EMAIL_NOT_VERIFIED" && err.statusCode === 403
  );

  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
});

test("stock insuffisant est refusé sans décrémenter le stock", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productB, 4);

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "OUT_OF_STOCK" && err.statusCode === 400
  );

  await productB.reload();
  assert.equal(productB.stock, 3);
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
});

test("checkout utilise le stock relu dans la transaction et ignore le stock préchargé périmé", async () => {
  const req = createReq({ user: customerUser });
  const cart = await cartService.getOrCreateCart(req);
  await models.CartItem.create({ cartId: cart.id, productId: productB.id, qty: 1 });
  await productB.update({ stock: 1 });

  const originalFindByPk = models.Cart.findByPk;
  models.Cart.findByPk = async () => ({
    id: cart.id,
    items: [
      {
        savedForLater: false,
        productId: productB.id,
        qty: 1,
        product: { stock: 0, name: productB.name }
      }
    ]
  });

  let order;
  try {
    order = await orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" });
  } finally {
    models.Cart.findByPk = originalFindByPk;
  }

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productId, productB.id);
  await productB.reload();
  assert.equal(productB.stock, 0);
  assert.equal(await models.CartItem.count(), 0);
});

test("stock insuffisant après relecture transactionnelle refuse la commande et garde le panier", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productB, 1);
  await productB.update({ stock: 0 });

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "OUT_OF_STOCK" && err.statusCode === 400
  );

  await productB.reload();
  assert.equal(productB.stock, 0);
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.OrderItem.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
});

test("checkout ne rend jamais le stock négatif et ne crée pas d'OrderItem si la quantité dépasse le stock", async () => {
  const req = createReq({ user: customerUser });
  await productB.update({ stock: 1 });
  await addCartItem(req, productB, 2);

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "OUT_OF_STOCK" && err.statusCode === 400
  );

  await productB.reload();
  assert.equal(productB.stock, 1);
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.OrderItem.count(), 0);
});

test("checkout avec variante stock 1 et quantité 1 décrémente ProductVariant.stock", async () => {
  const req = createReq({ user: customerUser });
  const variant = await createVariant(productA, { name: "Rouge", stock: 1 });
  const cart = await cartService.getOrCreateCart(req);
  await models.CartItem.create({ cartId: cart.id, productId: productA.id, variantId: variant.id, qty: 1 });

  const order = await orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" });

  assert.equal(order.items.length, 1);
  await variant.reload();
  await productA.reload();
  assert.equal(variant.stock, 0);
  assert.equal(productA.stock, 10);
  assert.equal(productA.popularityScore, 1);
});

test("checkout avec variante stock 1 et quantité 2 est refusé sans stock négatif", async () => {
  const req = createReq({ user: customerUser });
  const variant = await createVariant(productA, { name: "Bleu", stock: 1 });
  const cart = await cartService.getOrCreateCart(req);
  await models.CartItem.create({ cartId: cart.id, productId: productA.id, variantId: variant.id, qty: 2 });

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "OUT_OF_STOCK" && err.statusCode === 400
  );

  await variant.reload();
  await productA.reload();
  assert.equal(variant.stock, 1);
  assert.equal(productA.stock, 10);
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.OrderItem.count(), 0);
});

test("checkout agrège plusieurs items de la même variante avant vérification stock", async () => {
  const req = createReq({ user: customerUser });
  const variant = await createVariant(productA, { name: "Noir", stock: 1 });
  const cart = await cartService.getOrCreateCart(req);
  await models.CartItem.create({ cartId: cart.id, productId: productA.id, variantId: variant.id, qty: 1 });
  await models.CartItem.create({ cartId: cart.id, productId: productA.id, variantId: variant.id, qty: 1 });

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "OUT_OF_STOCK" && err.statusCode === 400
  );

  await variant.reload();
  assert.equal(variant.stock, 1);
  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.OrderItem.count(), 0);
});

test("coupon valide est appliqué et enregistré", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 2);
  const coupon = await createValidCoupon({ code: "FIXED5", value: 5 });

  const order = await orderService.createOrderFromCart(req, {
    paymentMethod: "MOBILE_MONEY",
    couponCode: "fixed5"
  });

  assert.equal(order.couponCode, "FIXED5");
  assert.equal(Number(order.discountTotal), 5);
  assert.equal(Number(order.total), 45);
  assert.equal(await models.CouponRedemption.count({ where: { couponId: coupon.id, userId: customerUser.id, orderId: order.id } }), 1);
  await coupon.reload();
  assert.equal(coupon.usageCount, 1);
});

test("coupon invalide est refusé sans vider le panier", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 1);

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY", couponCode: "NOPE" }),
    (err) => err.code === "INVALID_COUPON" && err.statusCode === 400
  );

  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
  await productA.reload();
  assert.equal(productA.stock, 10);
});

test("livraison porte utilise l'adresse client et ajoute les frais actuels", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 1);
  const address = await models.Address.create({
    userId: customerUser.id,
    label: "Bureau",
    number: "8",
    street: "Rue B",
    neighborhood: "Centre",
    municipality: "Gombe",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });

  const order = await orderService.createOrderFromCart(req, {
    paymentMethod: "MOBILE_MONEY",
    doorDelivery: true,
    addressId: address.id
  });

  assert.equal(order.addressSnapshot.label, "Bureau");
  assert.equal(order.addressSnapshot.street, "Rue B");
  assert.equal(Number(order.shippingFee), 5);
  assert.equal(Number(order.total), 30);
  assert.match(order.trackingNumber, /^ITS-D-/);
});

test("méthode CARD initialise provider PayPal et le controller redirige vers le paiement", async () => {
  env.paypal.clientId = "client-id";
  env.paypal.clientSecret = "client-secret";
  const req = createReq({
    user: customerUser,
    body: { paymentMethod: "CARD" }
  });
  await addCartItem(req, productA, 1);

  const { res, nextError } = await runHandler(cartController.checkout, req);

  assert.equal(nextError, null);
  const order = await models.Order.findOne({ where: { userId: customerUser.id } });
  assert.equal(order.paymentMethod, "CARD");
  assert.equal(order.paymentProvider, "PAYPAL");
  assert.match(res.redirectTo, new RegExp(`^/payments/paypal/start\\?orderId=${order.id}`));
});

test("transaction rollback si une étape critique échoue après création de commande", async () => {
  const req = createReq({ user: customerUser });
  await addCartItem(req, productA, 1);
  const originalCreate = models.OrderItem.create;
  models.OrderItem.create = async () => {
    throw new Error("ORDER_ITEM_FAILURE");
  };

  try {
    await assert.rejects(
      () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
      /ORDER_ITEM_FAILURE/
    );
  } finally {
    models.OrderItem.create = originalCreate;
  }

  assert.equal(await models.Order.count(), 0);
  assert.equal(await models.OrderItem.count(), 0);
  assert.equal(await models.CartItem.count(), 1);
  await productA.reload();
  assert.equal(productA.stock, 10);
});

test("checkout controller propage les erreurs métier au middleware d'erreur", async () => {
  const req = createReq({
    user: customerUser,
    body: { paymentMethod: "MOBILE_MONEY" }
  });
  const res = createRes();

  const { nextError } = await runHandler(cartController.checkout, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 400);
});
