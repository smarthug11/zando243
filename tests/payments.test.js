const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.tmpdir(), `zando243-payments-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const paymentController = require("../src/controllers/paymentController");
const paymentRoutes = require("../src/routes/paymentRoutes");
const { requireAuth } = require("../src/middlewares/auth");
const { errorHandler } = require("../src/middlewares/errorHandler");
const { env } = require("../src/config/env");

defineModels();

let models;
let customerUser;
let otherUser;
let originalFetch;
let originalPaypalConfig;

function createRes() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    headers: {},
    jsonBody: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.rendered = { view, locals }; return this; },
    redirect(location) { this.redirectTo = location; this.statusCode = 302; return this; },
    json(payload) { this.jsonBody = payload; return this; }
  };
}

function createReq(overrides = {}) {
  const session = { ...(overrides.session || {}) };
  return {
    body: {},
    params: {},
    query: {},
    user: customerUser,
    method: "GET",
    originalUrl: "/payments/paypal/start",
    path: "/payments/paypal/start",
    requestId: "req-payments-test",
    session,
    accepts(type) { return type === "html"; },
    get() { return null; },
    headers: {},
    ...overrides,
    session
  };
}

async function runHandler(handler, req, res = createRes()) {
  let nextError = null;
  await handler(req, res, (err) => { nextError = err || null; });
  return { res, nextError };
}

function routeMethods(pathname) {
  const methods = paymentRoutes.stack
    .filter((entry) => entry.route?.path === pathname)
    .flatMap((entry) => Object.keys(entry.route.methods));
  assert.ok(methods.length, `route ${pathname} should exist`);
  return methods.sort();
}

function mockPayPalFetch({ createdOrderId = "PAYPAL-CREATED", captureStatus = "COMPLETED", verifyStatus = "SUCCESS" } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/v1/oauth2/token")) {
      return { ok: true, json: async () => ({ access_token: "test-token" }) };
    }
    if (String(url).endsWith("/v2/checkout/orders")) {
      return {
        ok: true,
        json: async () => ({
          id: createdOrderId,
          links: [{ rel: "approve", href: `https://paypal.test/approve/${createdOrderId}` }]
        })
      };
    }
    if (String(url).includes("/capture")) {
      return {
        ok: true,
        json: async () => ({
          id: createdOrderId,
          status: captureStatus,
          purchase_units: [{ reference_id: JSON.parse(options.body || "{}").reference_id }]
        })
      };
    }
    if (String(url).endsWith("/v1/notifications/verify-webhook-signature")) {
      return { ok: true, json: async () => ({ verification_status: verifyStatus }) };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  return calls;
}

async function createUser(email, firstName) {
  return models.User.create({
    role: "CUSTOMER",
    firstName,
    lastName: "Client",
    email,
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });
}

async function createOrder(userId, overrides = {}) {
  return models.Order.create({
    orderNumber: overrides.orderNumber || `PAY-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    userId,
    addressSnapshot: { label: "Maison", street: "Rue A", city: "Kinshasa", country: "RDC" },
    subtotal: overrides.subtotal ?? 25,
    shippingFee: overrides.shippingFee ?? 0,
    discountTotal: overrides.discountTotal ?? 0,
    total: overrides.total ?? 25,
    paymentMethod: overrides.paymentMethod || "PAYPAL",
    paymentStatus: overrides.paymentStatus || "PENDING",
    paymentProvider: overrides.paymentProvider || null,
    paymentReference: overrides.paymentReference || null,
    status: "Processing"
  });
}

async function seedBaseData() {
  await sequelize.sync({ force: true });
  customerUser = await createUser("alice-payments@example.com", "Alice");
  otherUser = await createUser("bob-payments@example.com", "Bob");
}

test.before(async () => {
  models = defineModels();
  originalFetch = global.fetch;
  originalPaypalConfig = { ...env.paypal };
});

test.beforeEach(async () => {
  await seedBaseData();
  env.paypal.clientId = "client-id";
  env.paypal.clientSecret = "client-secret";
  env.paypal.webhookId = "webhook-id";
  env.paypal.baseUrl = "https://api-m.sandbox.paypal.com";
  global.fetch = originalFetch;
});

test.after(() => {
  global.fetch = originalFetch;
  Object.assign(env.paypal, originalPaypalConfig);
});

test("les routes PayPal exposent les méthodes attendues", () => {
  assert.deepEqual(routeMethods("/paypal/start"), ["get"]);
  assert.deepEqual(routeMethods("/paypal/return"), ["get"]);
  assert.deepEqual(routeMethods("/paypal/sdk/create-order"), ["post"]);
  assert.deepEqual(routeMethods("/paypal/sdk/capture-order"), ["post"]);
  assert.deepEqual(routeMethods("/paypal/webhook"), ["post"]);
});

test("start PayPal pour commande valide crée une référence et redirige vers approveUrl", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "PAY-START" });
  mockPayPalFetch({ createdOrderId: "PAYPAL-START" });
  const req = createReq({ user: customerUser, query: { orderId: order.id } });

  const { res, nextError } = await runHandler(paymentController.startPayPal, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "https://paypal.test/approve/PAYPAL-START");
  await order.reload();
  assert.equal(order.paymentProvider, "PAYPAL");
  assert.equal(order.paymentReference, "PAYPAL-START");
  assert.equal(await models.AuditLog.count({ where: { action: "PAYPAL_ORDER_CREATED" } }), 1);
});

test("start PayPal pour commande inexistante ou non propriétaire redirige vers /orders", async () => {
  const foreignOrder = await createOrder(otherUser.id, { orderNumber: "PAY-FOREIGN" });
  const req = createReq({ user: customerUser, query: { orderId: foreignOrder.id } });

  const { res, nextError } = await runHandler(paymentController.startPayPal, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/orders");
  assert.deepEqual(req.session.flash, { type: "error", message: "Commande introuvable." });
});

test("SDK create-order associe une commande locale existante à un ordre PayPal", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "PAY-SDK-CREATE" });
  mockPayPalFetch({ createdOrderId: "PAYPAL-SDK-CREATE" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { localOrderId: order.id },
    originalUrl: "/payments/paypal/sdk/create-order"
  });

  const { res, nextError } = await runHandler(paymentController.createPayPalOrderForSdk, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.jsonBody, { ok: true, paypalOrderId: "PAYPAL-SDK-CREATE", localOrderId: order.id });
  await order.reload();
  assert.equal(order.paymentProvider, "PAYPAL");
  assert.equal(order.paymentReference, "PAYPAL-SDK-CREATE");
});

test("SDK capture-order refuse un mismatch localOrderId/paypalOrderId sans marquer payée", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-EXPECTED" });
  const calls = mockPayPalFetch();
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { localOrderId: order.id, paypalOrderId: "PAYPAL-WRONG" },
    originalUrl: "/payments/paypal/sdk/capture-order"
  });

  const { res, nextError } = await runHandler(paymentController.capturePayPalOrderForSdk, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { ok: false, error: "PAYPAL_ORDER_MISMATCH" });
  await order.reload();
  assert.equal(order.paymentStatus, "PENDING");
  assert.equal(calls.length, 0);
});

test("SDK capture-order valide marque la commande payée", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-CAPTURE" });
  mockPayPalFetch({ createdOrderId: "PAYPAL-CAPTURE", captureStatus: "COMPLETED" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { localOrderId: order.id, paypalOrderId: "PAYPAL-CAPTURE" },
    originalUrl: "/payments/paypal/sdk/capture-order"
  });

  const { res, nextError } = await runHandler(paymentController.capturePayPalOrderForSdk, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.jsonBody, { ok: true, orderId: order.id, status: "COMPLETED" });
  await order.reload();
  assert.equal(order.paymentStatus, "PAID");
  assert.equal(order.paymentProvider, "PAYPAL");
  assert.equal(order.paymentReference, "PAYPAL-CAPTURE");
  assert.ok(order.paidAt);
});

test("SDK capture-order déjà payée ne rappelle pas PayPal", async () => {
  const order = await createOrder(customerUser.id, { paymentStatus: "PAID", paymentReference: "PAYPAL-PAID" });
  const calls = mockPayPalFetch();
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { localOrderId: order.id, paypalOrderId: "PAYPAL-PAID" },
    originalUrl: "/payments/paypal/sdk/capture-order"
  });

  const { res, nextError } = await runHandler(paymentController.capturePayPalOrderForSdk, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.jsonBody, { ok: true, orderId: order.id, status: "COMPLETED", alreadyPaid: true });
  assert.equal(calls.length, 0);
});

test("return PayPal capture valide marque la commande payée et redirige vers le détail", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-RETURN" });
  global.fetch = async (url) => {
    if (String(url).endsWith("/v1/oauth2/token")) return { ok: true, json: async () => ({ access_token: "test-token" }) };
    if (String(url).includes("/capture")) {
      return { ok: true, json: async () => ({ status: "COMPLETED", purchase_units: [{ reference_id: order.id }] }) };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const req = createReq({ user: customerUser, query: { token: "PAYPAL-RETURN" }, originalUrl: "/payments/paypal/return" });

  const { res, nextError } = await runHandler(paymentController.paypalReturn, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, `/orders/${order.id}`);
  await order.reload();
  assert.equal(order.paymentStatus, "PAID");
  assert.deepEqual(req.session.flash, { type: "success", message: "Paiement PayPal confirme." });
});

test("webhook avec cert_url invalide est refusé sans appel réseau", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-WEBHOOK" });
  const calls = mockPayPalFetch({ verifyStatus: "SUCCESS" });
  const req = createReq({
    user: null,
    method: "POST",
    headers: { "paypal-cert-url": "https://evil.example/cert.pem" },
    body: { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "PAYPAL-WEBHOOK" } },
    originalUrl: "/payments/paypal/webhook"
  });

  const { res, nextError } = await runHandler(paymentController.paypalWebhook, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { ok: false, error: "INVALID_SIGNATURE" });
  assert.equal(calls.length, 0);
  await order.reload();
  assert.equal(order.paymentStatus, "PENDING");
});

test("webhook avec signature invalide est refusé", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-WEBHOOK-BAD" });
  mockPayPalFetch({ verifyStatus: "FAILURE" });
  const req = createReq({
    user: null,
    method: "POST",
    headers: {
      "paypal-cert-url": "https://api-m.paypal.com/cert.pem",
      "paypal-transmission-id": "tid",
      "paypal-transmission-time": "time",
      "paypal-auth-algo": "algo",
      "paypal-transmission-sig": "sig"
    },
    body: { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "PAYPAL-WEBHOOK-BAD" } },
    originalUrl: "/payments/paypal/webhook"
  });

  const { res, nextError } = await runHandler(paymentController.paypalWebhook, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { ok: false, error: "INVALID_SIGNATURE" });
  await order.reload();
  assert.equal(order.paymentStatus, "PENDING");
});

test("webhook valide marque la commande payée sans session", async () => {
  const order = await createOrder(customerUser.id, { paymentReference: "PAYPAL-WEBHOOK-OK" });
  mockPayPalFetch({ verifyStatus: "SUCCESS" });
  const req = createReq({
    user: null,
    method: "POST",
    headers: {
      "paypal-cert-url": "https://api-m.paypal.com/cert.pem",
      "paypal-transmission-id": "tid",
      "paypal-transmission-time": "time",
      "paypal-auth-algo": "algo",
      "paypal-transmission-sig": "sig"
    },
    body: { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "PAYPAL-WEBHOOK-OK" } },
    originalUrl: "/payments/paypal/webhook"
  });

  const { res, nextError } = await runHandler(paymentController.paypalWebhook, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.jsonBody, { ok: true });
  await order.reload();
  assert.equal(order.paymentStatus, "PAID");
});

test("un visiteur non connecté est bloqué sur les routes PayPal client", async () => {
  const req = createReq({ user: null });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
});
