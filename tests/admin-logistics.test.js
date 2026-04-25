const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-logistics-${process.pid}-${Date.now()}.sqlite`);

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
    originalUrl: "/admin/logistics",
    path: "/admin/logistics",
    requestId: "req-admin-logistics-test",
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
    trackingNumber: null,
    trackingCarrier: "ITS Logistics",
    customsFee: 0,
    consolidationReference: null,
    logisticsMeta: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
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

test("un admin connecté peut afficher la page logistique", async () => {
  await createOrder({
    orderNumber: "LOG-001",
    trackingNumber: "ITS-D-001",
    consolidationReference: "GRP-001",
    customsFee: 12.5,
    createdAt: new Date("2026-04-20T10:00:00Z"),
    updatedAt: new Date("2026-04-20T10:00:00Z")
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.logisticsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/logistics");
  assert.equal(res.rendered.locals.title, "Module Logistique");
  assert.equal(res.rendered.locals.orders.length, 1);
  assert.equal(res.rendered.locals.orders[0].orderNumber, "LOG-001");
});

test("la page reçoit toutes les commandes selon le comportement logistique actuel", async () => {
  await createOrder({ orderNumber: "LOG-PROCESSING", status: "Processing" });
  await createOrder({ orderNumber: "LOG-SHIPPED", status: "Shipped" });
  await createOrder({ orderNumber: "LOG-DELIVERED", status: "Delivered" });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.logisticsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(
    res.rendered.locals.orders.map((order) => order.orderNumber).sort(),
    ["LOG-DELIVERED", "LOG-PROCESSING", "LOG-SHIPPED"]
  );
});

test("les données transmises correspondent aux champs réellement utilisés par la vue", async () => {
  const order = await createOrder({
    orderNumber: "LOG-FIELDS",
    status: "Processing",
    trackingNumber: "ITS-R-777",
    consolidationReference: "GRP-777",
    customsFee: 9.99
  });
  await models.OrderItem.create({
    orderId: order.id,
    productSnapshot: { name: "Produit test" },
    unitPrice: 9.99,
    qty: 1,
    lineTotal: 9.99
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.logisticsPage, req);
  const renderedOrder = res.rendered.locals.orders[0];

  assert.equal(nextError, null);
  assert.equal(renderedOrder.orderNumber, "LOG-FIELDS");
  assert.equal(renderedOrder.status, "Processing");
  assert.equal(renderedOrder.trackingNumber, "ITS-R-777");
  assert.equal(renderedOrder.consolidationReference, "GRP-777");
  assert.equal(Number(renderedOrder.customsFee), 9.99);
  assert.equal(renderedOrder.User, undefined);
  assert.equal(renderedOrder.items, undefined);
});

test("le tri par date descendante et la limite de 100 commandes sont respectés", async () => {
  for (let i = 0; i < 105; i += 1) {
    await createOrder({
      orderNumber: `LOG-${String(i).padStart(3, "0")}`,
      createdAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`),
      updatedAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`)
    });
  }

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.logisticsPage, req);
  const orders = res.rendered.locals.orders;

  assert.equal(nextError, null);
  assert.equal(orders.length, 100);
  for (let i = 1; i < orders.length; i += 1) {
    assert.ok(new Date(orders[i - 1].createdAt) >= new Date(orders[i].createdAt));
  }
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/logistics" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/logistics" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
