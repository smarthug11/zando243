const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-checkout-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const cartController = require("../src/controllers/cartController");
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
});

test.beforeEach(async () => {
  await seedBaseData();
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
  assert.equal(res.redirectTo, "/auth/login");
  assert.deepEqual(req.session.flash, {
    type: "error",
    message: "Connectez-vous pour finaliser le paiement. Votre panier invite est conserve."
  });
  assert.equal(await models.Order.count(), 0);
});

test("panier vide est refusé selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser });

  await assert.rejects(
    () => orderService.createOrderFromCart(req, { paymentMethod: "MOBILE_MONEY" }),
    (err) => err.code === "EMPTY_CART" && err.statusCode === 400
  );
  assert.equal(await models.Order.count(), 0);
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
