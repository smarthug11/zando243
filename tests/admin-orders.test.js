const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { PassThrough } = require("stream");

const dbPath = path.join(os.tmpdir(), `zando243-admin-orders-${process.pid}-${Date.now()}.sqlite`);

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
let secondCustomer;

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
    originalUrl: "/admin/orders",
    path: "/admin/orders",
    requestId: "req-admin-orders-test",
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

async function seedBaseData() {
  await sequelize.sync({ force: true });

  adminUser = await createUser({
    role: "ADMIN",
    firstName: "Admin",
    lastName: "Root",
    email: "admin@example.com"
  });

  customerUser = await createUser({
    firstName: "Alice",
    lastName: "Client",
    email: "alice@example.com"
  });

  secondCustomer = await createUser({
    firstName: "Bob",
    lastName: "Buyer",
    email: "bob@example.com"
  });
}

async function createOrder(overrides = {}) {
  const order = await models.Order.create({
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

  if (overrides.items) {
    for (const item of overrides.items) {
      await models.OrderItem.create({
        orderId: order.id,
        productSnapshot: item.productSnapshot,
        unitPrice: item.unitPrice,
        qty: item.qty,
        lineTotal: item.lineTotal
      });
    }
  }

  return order;
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

test("un admin connecté peut afficher la liste des commandes", async () => {
  await createOrder({ orderNumber: "ADM-ORD-001" });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/orders");
  assert.equal(res.rendered.locals.title, "Admin Commandes");
  assert.equal(res.rendered.locals.orders.length, 1);
  assert.equal(res.rendered.locals.orders[0].orderNumber, "ADM-ORD-001");
  assert.deepEqual(res.rendered.locals.filters, { q: "", status: "", startDate: "", endDate: "" });
});

test("la vue reçoit les commandes triées par date descendante avec User et items", async () => {
  await createOrder({
    orderNumber: "ADM-OLD",
    createdAt: new Date("2026-04-10T10:00:00Z"),
    updatedAt: new Date("2026-04-10T10:00:00Z"),
    items: [
      {
        productSnapshot: { name: "Ancien produit", weightKg: 1 },
        unitPrice: 20,
        qty: 1,
        lineTotal: 20
      }
    ]
  });
  await createOrder({
    orderNumber: "ADM-NEW",
    createdAt: new Date("2026-04-12T10:00:00Z"),
    updatedAt: new Date("2026-04-12T10:00:00Z"),
    items: [
      {
        productSnapshot: { name: "Nouveau produit", weightKg: 2 },
        unitPrice: 40,
        qty: 2,
        lineTotal: 80
      }
    ]
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);
  const orders = res.rendered.locals.orders;

  assert.equal(nextError, null);
  assert.deepEqual(orders.map((order) => order.orderNumber), ["ADM-NEW", "ADM-OLD"]);
  assert.equal(orders[0].User.firstName, "Alice");
  assert.equal(orders[0].User.lastName, "Client");
  assert.equal(orders[0].items.length, 1);
  assert.equal(orders[0].items[0].qty, 2);
  assert.deepEqual(orders[0].items[0].productSnapshot, { name: "Nouveau produit", weightKg: 2 });
});

test("la recherche filtre actuellement par prénom, nom ou email client", async () => {
  await createOrder({ orderNumber: "ADM-ALICE", userId: customerUser.id });
  await createOrder({ orderNumber: "ADM-BOB", userId: secondCustomer.id });

  const req = createReq({ user: adminUser, query: { q: "bob@example.com" } });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.orders.map((order) => order.orderNumber), ["ADM-BOB"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "bob@example.com", status: "", startDate: "", endDate: "" });
});

test("la recherche ne filtre pas par numéro de commande selon le comportement actuel", async () => {
  await createOrder({ orderNumber: "ADM-SEARCH-ORDER", userId: customerUser.id });

  const req = createReq({ user: adminUser, query: { q: "ADM-SEARCH-ORDER" } });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.orders, []);
});

test("le filtre statut respecte le statut exact demandé", async () => {
  await createOrder({ orderNumber: "ADM-PROCESSING", status: "Processing" });
  await createOrder({ orderNumber: "ADM-SHIPPED", status: "Shipped" });

  const req = createReq({ user: adminUser, query: { status: "Shipped" } });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.orders.map((order) => order.orderNumber), ["ADM-SHIPPED"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "", status: "Shipped", startDate: "", endDate: "" });
});

test("les filtres dates sont conservés dans la vue mais ne filtrent pas actuellement", async () => {
  await createOrder({
    orderNumber: "ADM-BEFORE",
    createdAt: new Date("2026-04-09T23:59:59Z"),
    updatedAt: new Date("2026-04-09T23:59:59Z")
  });
  await createOrder({
    orderNumber: "ADM-START",
    createdAt: new Date("2026-04-10T00:00:00Z"),
    updatedAt: new Date("2026-04-10T00:00:00Z")
  });
  await createOrder({
    orderNumber: "ADM-END",
    createdAt: new Date("2026-04-11T23:59:59Z"),
    updatedAt: new Date("2026-04-11T23:59:59Z")
  });
  await createOrder({
    orderNumber: "ADM-AFTER",
    createdAt: new Date("2026-04-12T00:00:00Z"),
    updatedAt: new Date("2026-04-12T00:00:00Z")
  });

  const req = createReq({ user: adminUser, query: { startDate: "2026-04-10", endDate: "2026-04-11" } });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.orders.map((order) => order.orderNumber), ["ADM-AFTER", "ADM-END", "ADM-START", "ADM-BEFORE"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "", status: "", startDate: "2026-04-10", endDate: "2026-04-11" });
});

test("la limite actuelle de 100 commandes est respectée", async () => {
  for (let i = 0; i < 105; i += 1) {
    await createOrder({
      orderNumber: `ADM-LIMIT-${String(i).padStart(3, "0")}`,
      createdAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`),
      updatedAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`)
    });
  }

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.ordersPage, req);
  const orders = res.rendered.locals.orders;

  assert.equal(nextError, null);
  assert.equal(orders.length, 100);
  for (let i = 1; i < orders.length; i += 1) {
    assert.ok(new Date(orders[i - 1].createdAt) >= new Date(orders[i].createdAt));
  }
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/orders" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/orders" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

function createPdfRes() {
  const base = createRes();
  const pt = new PassThrough();
  const chunks = [];
  pt.on("data", (chunk) => chunks.push(chunk));
  base.write = pt.write.bind(pt);
  base.end = pt.end.bind(pt);
  base.on = pt.on.bind(pt);
  base.once = pt.once.bind(pt);
  base.emit = pt.emit.bind(pt);
  base.removeListener = pt.removeListener.bind(pt);
  base.removeAllListeners = pt.removeAllListeners.bind(pt);
  base.pdfFinished = () => new Promise((resolve) => pt.on("finish", resolve));
  return base;
}

// ============================================================
// orderDetailPage
// ============================================================

test("un admin peut afficher le détail d'une commande existante", async () => {
  const order = await createOrder({ orderNumber: "DETAIL-001" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    originalUrl: `/admin/orders/${order.id}`,
    params: { id: order.id }
  });

  const { res, nextError } = await runHandler(adminController.orderDetailPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/order-detail");
  assert.equal(res.rendered.locals.title, `Commande ${order.orderNumber}`);
  assert.equal(res.rendered.locals.order.id, order.id);
  assert.equal(res.rendered.locals.order.orderNumber, "DETAIL-001");
});

test("la vue reçoit le User associé à la commande selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "DETAIL-USER-001", userId: customerUser.id });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });

  const { res, nextError } = await runHandler(adminController.orderDetailPage, req);

  assert.equal(nextError, null);
  assert.ok(res.rendered.locals.order.User);
  assert.equal(res.rendered.locals.order.User.email, customerUser.email);
  assert.equal(res.rendered.locals.order.User.firstName, "Alice");
});

test("la vue reçoit les items de la commande selon le comportement actuel", async () => {
  const order = await createOrder({
    orderNumber: "DETAIL-ITEMS-001",
    items: [{ productSnapshot: { name: "Chaussure", weightKg: 1 }, unitPrice: 50, qty: 2, lineTotal: 100 }]
  });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });

  const { res, nextError } = await runHandler(adminController.orderDetailPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.order.items.length, 1);
  assert.equal(res.rendered.locals.order.items[0].qty, 2);
});

test("la vue reçoit l'historique de statut selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "DETAIL-HISTORY-001" });
  await models.OrderStatusHistory.create({ orderId: order.id, status: "Processing", note: "Commande créée" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });

  const { res, nextError } = await runHandler(adminController.orderDetailPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.order.statusHistory.length, 1);
  assert.equal(res.rendered.locals.order.statusHistory[0].status, "Processing");
});

test("commande inexistante pour orderDetailPage rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "GET",
    originalUrl: "/admin/orders/11111111-1111-4111-8111-111111111111",
    params: { id: "11111111-1111-4111-8111-111111111111" }
  });

  const { res, nextError } = await runHandler(adminController.orderDetailPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Commande introuvable");
});

test("un non-admin est bloqué sur orderDetailPage selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "DETAIL-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "GET",
    originalUrl: `/admin/orders/${order.id}`,
    params: { id: order.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur orderDetailPage selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "DETAIL-AUTH-001" });
  const req = createReq({
    user: null,
    method: "GET",
    originalUrl: `/admin/orders/${order.id}`,
    params: { id: order.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

// ============================================================
// updateOrder
// ============================================================

test("un admin peut changer le statut d'une commande existante", async () => {
  const order = await createOrder({ orderNumber: "STATUS-001", status: "Processing" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/orders/${order.id}/status`,
    params: { id: order.id },
    body: { status: "Shipped", note: "Expédié" }
  });

  const { res, nextError } = await runHandler(adminController.updateOrder, req);
  await order.reload();

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/orders");
  assert.equal(order.status, "Shipped");
});

test("l'historique de statut est créé lors du changement selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-HISTORY-001", status: "Processing" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: order.id },
    body: { status: "Shipped", note: "Note expédition" }
  });

  const { nextError } = await runHandler(adminController.updateOrder, req);
  const history = await models.OrderStatusHistory.findOne({ where: { orderId: order.id, status: "Shipped" } });

  assert.equal(nextError, null);
  assert.ok(history);
  assert.equal(history.note, "Note expédition");
});

test("l'audit log ADMIN_ORDER_STATUS est créé lors du changement selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-AUDIT-001", status: "Processing" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: order.id },
    body: { status: "Shipped" }
  });

  const { nextError } = await runHandler(adminController.updateOrder, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_ORDER_STATUS" } });

  assert.equal(nextError, null);
  assert.ok(auditLog);
  assert.equal(auditLog.category, "ORDER");
  assert.equal(auditLog.message, `Statut commande changé: ${order.orderNumber} -> Shipped`);
  assert.equal(auditLog.actorUserId, adminUser.id);
  assert.equal(auditLog.meta.orderId, order.id);
  assert.equal(auditLog.meta.status, "Shipped");
});

test("les points fidélité sont attribués lors du passage à Delivered selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-LOYALTY-001", status: "Shipped", total: 110 });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: order.id },
    body: { status: "Delivered" }
  });

  const { nextError } = await runHandler(adminController.updateOrder, req);
  await customerUser.reload();

  assert.equal(nextError, null);
  assert.equal(customerUser.loyaltyPoints, 110);
});

test("la notification client est créée lors du passage à Delivered selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-NOTIF-001", status: "Shipped" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: order.id },
    body: { status: "Delivered" }
  });

  const { nextError } = await runHandler(adminController.updateOrder, req);
  const notification = await models.Notification.findOne({ where: { userId: customerUser.id, type: "ORDER_STATUS" } });

  assert.equal(nextError, null);
  assert.ok(notification);
  assert.match(notification.message, /livrée/);
});

test("le stock est restauré lors du passage à Cancelled selon le comportement actuel", async () => {
  const category = await models.Category.create({ name: "Cat Cancel", slug: `cat-cancel-${Date.now()}` });
  const product = await models.Product.create({
    categoryId: category.id,
    name: "Produit Cancel",
    slug: `produit-cancel-${Date.now()}`,
    description: "Test",
    weightKg: 1,
    purchasePrice: 10,
    priceWithoutDelivery: 50,
    stock: 5,
    sku: `CANCEL-${Date.now()}`,
    brand: "Test",
    status: "ACTIVE"
  });
  const order = await createOrder({ orderNumber: "STATUS-CANCEL-001", status: "Processing" });
  await models.OrderItem.create({
    orderId: order.id,
    productId: product.id,
    productSnapshot: { name: "Produit Cancel", sku: product.sku, weightKg: 1 },
    unitPrice: 50,
    qty: 3,
    lineTotal: 150
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: order.id },
    body: { status: "Cancelled" }
  });

  const { nextError } = await runHandler(adminController.updateOrder, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.equal(product.stock, 8);
});

test("commande inexistante pour updateOrder propage une erreur 404 selon le comportement actuel", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/orders/11111111-1111-4111-8111-111111111111/status",
    params: { id: "11111111-1111-4111-8111-111111111111" },
    body: { status: "Shipped" }
  });
  const res = createRes();

  const { nextError } = await runHandler(adminController.updateOrder, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Commande introuvable/);
});

test("un non-admin est bloqué sur updateOrder selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/orders/${order.id}/status`,
    params: { id: order.id },
    body: { status: "Shipped" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur updateOrder selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "STATUS-AUTH-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/orders/${order.id}/status`,
    params: { id: order.id },
    body: { status: "Shipped" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

// ============================================================
// orderRawPdf
// ============================================================

test("un admin peut exporter le PDF brut d'une commande existante", async () => {
  const order = await createOrder({ orderNumber: "PDF-RAW-001" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    originalUrl: `/admin/orders/${order.id}/export-pdf`,
    params: { id: order.id }
  });
  const res = createPdfRes();

  const { nextError } = await runHandler(adminController.orderRawPdf, req, res);

  assert.equal(nextError, null);
  assert.equal(res.headers["content-type"], "application/pdf");
});

test("le Content-Disposition du PDF brut contient le numéro de commande", async () => {
  const order = await createOrder({ orderNumber: "PDF-RAW-FILENAME-001" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });
  const res = createPdfRes();

  const { nextError } = await runHandler(adminController.orderRawPdf, req, res);

  assert.equal(nextError, null);
  assert.match(res.headers["content-disposition"], /attachment/);
  assert.match(res.headers["content-disposition"], /commande-PDF-RAW-FILENAME-001\.pdf/);
});

test("commande inexistante pour orderRawPdf rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: "11111111-1111-4111-8111-111111111111" }
  });

  const { res, nextError } = await runHandler(adminController.orderRawPdf, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Commande introuvable");
});

test("un non-admin est bloqué sur orderRawPdf selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "PDF-RAW-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "GET",
    params: { id: order.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur orderRawPdf selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un admin peut exporter le bordereau PDF d'une commande existante", async () => {
  const order = await createOrder({ orderNumber: "PDF-LABEL-001" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });
  const res = createPdfRes();

  const { nextError } = await runHandler(adminController.orderShippingLabelPdf, req, res);
  await res.pdfFinished();

  assert.equal(nextError, null);
  assert.equal(res.headers["content-type"], "application/pdf");
});

test("le Content-Disposition du bordereau contient le numéro de commande", async () => {
  const order = await createOrder({ orderNumber: "PDF-LABEL-FILENAME-001" });
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: order.id }
  });
  const res = createPdfRes();

  const { nextError } = await runHandler(adminController.orderShippingLabelPdf, req, res);
  await res.pdfFinished();

  assert.equal(nextError, null);
  assert.match(res.headers["content-disposition"], /attachment/);
  assert.match(res.headers["content-disposition"], /bordereau-PDF-LABEL-FILENAME-001\.pdf/);
});

test("commande inexistante pour orderShippingLabelPdf rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "GET",
    params: { id: "22222222-2222-4222-8222-222222222222" }
  });

  const { res, nextError } = await runHandler(adminController.orderShippingLabelPdf, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Commande introuvable");
});

test("un non-admin est bloqué sur orderShippingLabelPdf selon le comportement actuel", async () => {
  const order = await createOrder({ orderNumber: "PDF-LABEL-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "GET",
    params: { id: order.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur orderShippingLabelPdf selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
