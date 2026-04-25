const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-refunds-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const adminController = require("../src/controllers/adminController");
const { requireAuth } = require("../src/middlewares/auth");
const { requireRole } = require("../src/middlewares/roles");
const { errorHandler } = require("../src/middlewares/errorHandler");

defineModels();

let models;
let adminUser;
let customerUser;

function createRes() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    jsonPayload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, locals) {
      this.rendered = { view, locals };
      return this;
    },
    redirect(location) {
      this.redirectTo = location;
      this.statusCode = this.statusCode || 302;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };
}

function createReq(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    user: null,
    method: "GET",
    originalUrl: "/admin/refunds",
    path: "/admin/refunds",
    requestId: "req-admin-refunds-test",
    session: {},
    accepts(type) {
      return type === "html";
    },
    get() {
      return null;
    },
    headers: {},
    ...overrides
  };
}

async function runHandler(handler, req, res = createRes()) {
  let nextError = null;
  await handler(req, res, (err) => {
    nextError = err || null;
  });
  return { res, nextError };
}

async function seedBaseData() {
  await sequelize.sync({ force: true });

  adminUser = await models.User.create({
    role: "ADMIN",
    firstName: "Admin",
    lastName: "Root",
    email: "admin@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  customerUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Client",
    email: "alice@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });
}

async function createOrder(overrides = {}) {
  return models.Order.create({
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: customerUser.id,
    addressSnapshot: {
      fullName: "Alice Client",
      line1: "1 Rue Test",
      city: "Kinshasa",
      country: "CD"
    },
    subtotal: 100,
    shippingFee: 10,
    discountTotal: 0,
    total: 110,
    paymentMethod: "CASH_ON_DELIVERY",
    paymentStatus: "PENDING",
    status: "Processing",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
}

async function createReturnRequest(overrides = {}) {
  const order = overrides.order || await createOrder(overrides.orderOverrides || {});
  return models.ReturnRequest.create({
    orderId: order.id,
    reason: "Produit defectueux",
    status: "Requested",
    ...overrides.returnOverrides
  });
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await seedBaseData();
});

test.after(async () => {
  await sequelize.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("un admin connecté peut afficher la page retours/remboursements", async () => {
  const order = await createOrder({ orderNumber: "RET-001", status: "Processing" });
  await createReturnRequest({
    order,
    returnOverrides: { reason: "Taille incorrecte", status: "Requested" }
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.refundsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/refunds");
  assert.equal(res.rendered.locals.title, "Admin Retours/Remboursements");
  assert.equal(res.rendered.locals.returns.length, 1);
  assert.equal(res.rendered.locals.returns[0].reason, "Taille incorrecte");
});

test("la page reçoit toutes les demandes de retour selon le comportement actuel", async () => {
  const processingOrder = await createOrder({ orderNumber: "RET-PROCESSING", status: "Processing" });
  const deliveredOrder = await createOrder({ orderNumber: "RET-DELIVERED", status: "Delivered" });
  await createReturnRequest({
    order: processingOrder,
    returnOverrides: { reason: "Retour processing", status: "Requested" }
  });
  await createReturnRequest({
    order: deliveredOrder,
    returnOverrides: { reason: "Retour delivered", status: "Approved" }
  });

  const req = createReq({
    user: adminUser,
    query: { status: "Requested", q: "ignore" }
  });
  const { res, nextError } = await runHandler(adminController.refundsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(
    res.rendered.locals.returns.map((returnRequest) => returnRequest.reason).sort(),
    ["Retour delivered", "Retour processing"]
  );
});

test("la relation commande nécessaire à la vue est incluse selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "RET-ORDER", status: "Processing" });
  await models.OrderItem.create({
    orderId: order.id,
    productSnapshot: { name: "Produit test" },
    unitPrice: 25,
    qty: 1,
    lineTotal: 25
  });
  await createReturnRequest({
    order,
    returnOverrides: { reason: "Article abime", status: "Requested" }
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.refundsPage, req);
  const renderedReturn = res.rendered.locals.returns[0];

  assert.equal(nextError, null);
  assert.equal(renderedReturn.Order.orderNumber, "RET-ORDER");
  assert.equal(renderedReturn.Order.status, "Processing");
  assert.equal(renderedReturn.Order.User, undefined);
  assert.equal(renderedReturn.Order.items, undefined);
});

test("aucun tri ni limite supplementaire n'est applique selon le comportement actuel", async () => {
  for (let i = 0; i < 105; i += 1) {
    const order = await createOrder({
      orderNumber: `RET-${String(i).padStart(3, "0")}`,
      createdAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
      updatedAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`)
    });
    await createReturnRequest({
      order,
      returnOverrides: {
        reason: `Retour ${i}`,
        status: i % 2 === 0 ? "Requested" : "Approved"
      }
    });
  }

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.refundsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.returns.length, 105);
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/refunds" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/refunds" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
