const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-dashboard-${process.pid}-${Date.now()}.sqlite`);

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
    originalUrl: "/admin",
    path: "/admin",
    requestId: "req-admin-dashboard-test",
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

async function createUser(overrides = {}) {
  return models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Client",
    email: `user-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!"),
    ...overrides
  });
}

async function seedBaseData({ withCustomer = true } = {}) {
  await sequelize.sync({ force: true });

  adminUser = await createUser({
    role: "ADMIN",
    firstName: "Admin",
    lastName: "Root",
    email: "admin@example.com"
  });

  customerUser = withCustomer
    ? await createUser({
        role: "CUSTOMER",
        firstName: "Alice",
        lastName: "Client",
        email: "alice@example.com"
      })
    : null;
}

async function createProduct({ name, sku, categoryId, weightKg = 1, priceWithoutDelivery = 50 }) {
  return models.Product.create({
    categoryId,
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${sku.toLowerCase()}`,
    description: `${name} description`,
    weightKg,
    purchasePrice: 10,
    priceWithoutDelivery,
    stock: 10,
    sku,
    status: "ACTIVE"
  });
}

async function createOrder({ userId, orderNumber, total, createdAt, items = [] }) {
  const order = await models.Order.create({
    orderNumber,
    userId,
    addressSnapshot: {
      fullName: "Alice Client",
      line1: "1 Rue Test",
      city: "Kinshasa",
      country: "CD"
    },
    subtotal: total,
    shippingFee: 0,
    discountTotal: 0,
    total,
    paymentMethod: "CASH_ON_DELIVERY",
    paymentStatus: "PENDING",
    status: "Processing",
    createdAt,
    updatedAt: createdAt
  });

  for (const item of items) {
    await models.OrderItem.create({
      orderId: order.id,
      productId: item.productId,
      productSnapshot: item.productSnapshot,
      unitPrice: item.unitPrice,
      qty: item.qty,
      lineTotal: item.lineTotal
    });
  }

  return order;
}

async function seedDashboardData() {
  const categoryA = await models.Category.create({ name: "Chaussures", slug: "chaussures" });
  const categoryB = await models.Category.create({ name: "Sacs", slug: "sacs" });
  const productA = await createProduct({ name: "Basket", sku: "SKU-BASKET", categoryId: categoryA.id, weightKg: 1.5, priceWithoutDelivery: 40 });
  const productB = await createProduct({ name: "Sac", sku: "SKU-SAC", categoryId: categoryB.id, weightKg: 0.5, priceWithoutDelivery: 50 });
  await createProduct({ name: "Sandale", sku: "SKU-SANDALE", categoryId: categoryA.id, weightKg: 0.3, priceWithoutDelivery: 20 });

  const customerInRange = await createUser({
    firstName: "Bob",
    lastName: "Client",
    email: "bob@example.com",
    createdAt: new Date("2026-04-10T08:00:00Z"),
    updatedAt: new Date("2026-04-10T08:00:00Z")
  });
  await createUser({
    firstName: "Charlie",
    lastName: "Client",
    email: "charlie@example.com",
    createdAt: new Date("2026-03-01T08:00:00Z"),
    updatedAt: new Date("2026-03-01T08:00:00Z")
  });

  await createOrder({
    userId: customerInRange.id,
    orderNumber: "DASH-001",
    total: 110,
    createdAt: new Date("2026-04-10T10:00:00Z"),
    items: [
      {
        productId: productA.id,
        productSnapshot: { name: productA.name, weightKg: 1.5 },
        unitPrice: 40,
        qty: 2,
        lineTotal: 80
      }
    ]
  });
  await createOrder({
    userId: customerInRange.id,
    orderNumber: "DASH-002",
    total: 50,
    createdAt: new Date("2026-04-11T10:00:00Z"),
    items: [
      {
        productId: productB.id,
        productSnapshot: { name: productB.name, weightKg: 0.5 },
        unitPrice: 50,
        qty: 1,
        lineTotal: 50
      }
    ]
  });
  await createOrder({
    userId: customerInRange.id,
    orderNumber: "DASH-OLD",
    total: 1000,
    createdAt: new Date("2026-03-01T10:00:00Z"),
    items: [
      {
        productId: productA.id,
        productSnapshot: { name: productA.name, weightKg: 2 },
        unitPrice: 1000,
        qty: 1,
        lineTotal: 1000
      }
    ]
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

test("un admin connecté peut afficher le dashboard", async () => {
  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.dashboard, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/dashboard");
  assert.equal(res.rendered.locals.title, "Admin Dashboard");
  assert.ok(res.rendered.locals.stats);
});

test("la vue reçoit les statistiques calculées selon le comportement actuel", async () => {
  await seedDashboardData();

  const req = createReq({
    user: adminUser,
    query: { startDate: "2026-04-10", endDate: "2026-04-11" }
  });
  const { res, nextError } = await runHandler(adminController.dashboard, req);
  const { stats } = res.rendered.locals;

  assert.equal(nextError, null);
  assert.equal(stats.revenueTotal, 160);
  assert.equal(stats.orderCount, 2);
  assert.equal(stats.avgCart, 80);
  assert.equal(stats.weightDeliveryRevenue, 52.5);
  assert.equal(stats.usersCount, 1);
  assert.equal(stats.usersCountTotal, 3);
  assert.equal(stats.filters.startDate, "2026-04-10");
  assert.equal(stats.filters.endDate, "2026-04-11");
});

test("la vue reçoit les top produits, top catégories et données de progression existants", async () => {
  await seedDashboardData();

  const req = createReq({
    user: adminUser,
    query: { startDate: "2026-04-10", endDate: "2026-04-11" }
  });
  const { res, nextError } = await runHandler(adminController.dashboard, req);
  const { stats } = res.rendered.locals;

  assert.equal(nextError, null);
  assert.ok(stats.topProducts.length >= 2);
  assert.ok(stats.topCategories.length >= 2);
  assert.deepEqual(stats.progression.labels, ["2026-04-10", "2026-04-11"]);
  assert.deepEqual(stats.progression.series.revenueTotal, [110, 50]);
  assert.deepEqual(stats.progression.series.weightDeliveryRevenue, [45, 7.5]);
  assert.deepEqual(stats.progression.series.orderCount, [1, 1]);
  assert.deepEqual(stats.progression.series.avgCart, [110, 50]);
  assert.deepEqual(stats.progression.series.usersCount, [1, 0]);
});

test("les commandes récentes suivent le filtre, le tri et le calcul de frais poids actuels", async () => {
  await seedDashboardData();

  const req = createReq({
    user: adminUser,
    query: { startDate: "2026-04-10", endDate: "2026-04-11" }
  });
  const { res, nextError } = await runHandler(adminController.dashboard, req);
  const { recentOrders } = res.rendered.locals.stats;

  assert.equal(nextError, null);
  assert.deepEqual(recentOrders.map((order) => order.orderNumber), ["DASH-002", "DASH-001"]);
  assert.deepEqual(recentOrders.map((order) => order.weightDeliveryAmount), [7.5, 45]);
});

test("le dashboard fonctionne avec une base sans commandes, produits ni clients", async () => {
  await seedBaseData({ withCustomer: false });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.dashboard, req);
  const { stats } = res.rendered.locals;

  assert.equal(nextError, null);
  assert.equal(stats.revenueTotal, 0);
  assert.equal(stats.weightDeliveryRevenue, 0);
  assert.equal(stats.orderCount, 0);
  assert.equal(stats.avgCart, 0);
  assert.equal(stats.usersCount, 0);
  assert.equal(stats.usersCountTotal, 0);
  assert.deepEqual(stats.topProducts, []);
  assert.deepEqual(stats.topCategories, []);
  assert.deepEqual(stats.recentOrders, []);
  assert.ok(Array.isArray(stats.progression.labels));
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
