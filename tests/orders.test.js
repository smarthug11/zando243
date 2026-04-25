const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.tmpdir(), `zando243-orders-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const orderController = require("../src/controllers/orderController");
const orderRoutes = require("../src/routes/orderRoutes");
const orderService = require("../src/services/orderService");
const { sendOrderInvoiceEmail } = require("../src/services/emailService");
const { generateInvoicePdf } = require("../src/services/invoiceService");
const { requireAuth } = require("../src/middlewares/auth");
const { errorHandler } = require("../src/middlewares/errorHandler");
const { env } = require("../src/config/env");
const app = require("../app");

defineModels();

let models;
let customerUser;
let otherUser;

function createRes() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    headers: {},
    sentFile: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.rendered = { view, locals }; return this; },
    redirect(location) { this.redirectTo = location; this.statusCode = 302; return this; },
    sendFile(filepath) { this.sentFile = filepath; return this; }
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
    originalUrl: "/orders",
    path: "/orders",
    requestId: "req-orders-test",
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
  const methods = orderRoutes.stack
    .filter((entry) => entry.route?.path === pathname)
    .flatMap((entry) => Object.keys(entry.route.methods));
  assert.ok(methods.length, `route ${pathname} should exist`);
  return methods.sort();
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
    orderNumber: overrides.orderNumber || `ORD-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    userId,
    addressSnapshot: {
      label: "Maison",
      street: "Rue A",
      city: "Kinshasa",
      country: "RDC"
    },
    subtotal: overrides.subtotal ?? 25,
    shippingFee: overrides.shippingFee ?? 0,
    discountTotal: overrides.discountTotal ?? 0,
    total: overrides.total ?? 25,
    paymentMethod: overrides.paymentMethod || "CARD",
    paymentStatus: overrides.paymentStatus || "PENDING",
    status: overrides.status || "Processing",
    trackingNumber: overrides.trackingNumber || "TRK-TEST",
    trackingCarrier: overrides.trackingCarrier || "ITS Logistics",
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt
  });
}

async function addOrderRelations(order) {
  await models.OrderItem.create({
    orderId: order.id,
    productId: null,
    productSnapshot: { name: "Produit commande", sku: "SKU-ORDER" },
    unitPrice: 25,
    qty: 1,
    lineTotal: 25
  });
  await models.OrderStatusHistory.create({
    orderId: order.id,
    status: order.status,
    note: "Statut initial"
  });
}

async function seedBaseData() {
  await sequelize.sync({ force: true });
  customerUser = await createUser("alice-orders@example.com", "Alice");
  otherUser = await createUser("bob-orders@example.com", "Bob");
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await seedBaseData();
});

test("les routes commandes client exposent les méthodes attendues", () => {
  assert.deepEqual(routeMethods("/"), ["get"]);
  assert.deepEqual(routeMethods("/:id"), ["get"]);
  assert.deepEqual(routeMethods("/:id/invoice"), ["get"]);
  assert.deepEqual(routeMethods("/:id/return-request"), ["post"]);
});

test("client connecté voit seulement ses commandes", async () => {
  const oldOrder = await createOrder(customerUser.id, {
    orderNumber: "USER-OLD",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
  const newOrder = await createOrder(customerUser.id, {
    orderNumber: "USER-NEW",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z")
  });
  await createOrder(otherUser.id, { orderNumber: "OTHER-ORDER" });
  await addOrderRelations(oldOrder);
  await addOrderRelations(newOrder);

  const req = createReq({ user: customerUser });
  const { res, nextError } = await runHandler(orderController.listOrders, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.view, "pages/orders/list");
  assert.deepEqual(res.rendered.locals.orders.map((order) => order.orderNumber), ["USER-NEW", "USER-OLD"]);
  assert.equal(res.rendered.locals.orders[0].items.length, 1);
});

test("détail commande affiche la bonne commande avec relations nécessaires à la vue", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "USER-DETAIL" });
  await addOrderRelations(order);
  await models.ReturnRequest.create({ orderId: order.id, reason: "Déjà demandé", status: "Requested" });

  const req = createReq({ user: customerUser, params: { id: order.id }, originalUrl: `/orders/${order.id}` });
  const { res, nextError } = await runHandler(orderController.orderDetail, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.view, "pages/orders/detail");
  assert.equal(res.rendered.locals.order.id, order.id);
  assert.equal(res.rendered.locals.order.items.length, 1);
  assert.equal(res.rendered.locals.order.statusHistory.length, 1);
  assert.ok(res.rendered.locals.order.returnRequest);
});

test("client ne voit pas le détail d'une commande d'un autre utilisateur", async () => {
  const foreignOrder = await createOrder(otherUser.id, { orderNumber: "OTHER-DETAIL" });

  const req = createReq({ user: customerUser, params: { id: foreignOrder.id }, originalUrl: `/orders/${foreignOrder.id}` });
  const { res, nextError } = await runHandler(orderController.orderDetail, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
});

test("commande inexistante retourne le comportement 404 actuel", async () => {
  const req = createReq({
    user: customerUser,
    params: { id: "11111111-1111-4111-8111-111111111111" },
    originalUrl: "/orders/11111111-1111-4111-8111-111111111111"
  });
  const { res, nextError } = await runHandler(orderController.orderDetail, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
});

test("ancien chemin public /invoices n'est pas servi en statique", () => {
  const hasInvoiceStaticMount = app._router.stack.some((layer) => {
    const regexp = String(layer.regexp || "");
    return regexp.includes("invoices");
  });

  assert.equal(hasInvoiceStaticMount, false);
});

test("visiteur non connecté est bloqué sur l'accès facture client", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "INV-AUTH" });
  const req = createReq({
    user: null,
    params: { id: order.id },
    originalUrl: `/orders/${order.id}/invoice`
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
});

test("client peut télécharger sa facture existante", async () => {
  fs.mkdirSync(env.invoiceDir, { recursive: true });
  const order = await createOrder(customerUser.id, { orderNumber: "INV-OWN" });
  const invoicePath = path.join(env.invoiceDir, "INV-OWN.pdf");
  fs.writeFileSync(invoicePath, "%PDF-1.3\nfacture test\n");
  const req = createReq({
    user: customerUser,
    params: { id: order.id },
    originalUrl: `/orders/${order.id}/invoice`
  });

  const { res, nextError } = await runHandler(orderController.downloadInvoice, req);

  assert.equal(nextError, null);
  assert.equal(res.headers["content-disposition"], 'attachment; filename="INV-OWN.pdf"');
  assert.equal(res.headers["content-type"], "application/pdf");
  assert.equal(res.sentFile, invoicePath);
});

test("client ne peut pas télécharger la facture d'une commande étrangère", async () => {
  fs.mkdirSync(env.invoiceDir, { recursive: true });
  const foreignOrder = await createOrder(otherUser.id, { orderNumber: "INV-FOREIGN" });
  fs.writeFileSync(path.join(env.invoiceDir, "INV-FOREIGN.pdf"), "%PDF-1.3\nfacture étrangère\n");
  const req = createReq({
    user: customerUser,
    params: { id: foreignOrder.id },
    originalUrl: `/orders/${foreignOrder.id}/invoice`
  });

  const { res, nextError } = await runHandler(orderController.downloadInvoice, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.sentFile, null);
});

test("facture d'une commande inexistante retourne le comportement 404 actuel", async () => {
  const req = createReq({
    user: customerUser,
    params: { id: "22222222-2222-4222-8222-222222222222" },
    originalUrl: "/orders/22222222-2222-4222-8222-222222222222/invoice"
  });

  const { res, nextError } = await runHandler(orderController.downloadInvoice, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
});

test("fichier facture absent retourne le comportement 404 actuel", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "INV-MISSING" });
  const invoicePath = path.join(env.invoiceDir, "INV-MISSING.pdf");
  if (fs.existsSync(invoicePath)) fs.unlinkSync(invoicePath);
  const req = createReq({
    user: customerUser,
    params: { id: order.id },
    originalUrl: `/orders/${order.id}/invoice`
  });

  const { res, nextError } = await runHandler(orderController.downloadInvoice, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
});

test("generateInvoicePdf produit le fichier et l'URL historique actuelle", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "INV-GENERATE" });
  await addOrderRelations(order);
  const hydrated = await orderService.getUserOrder(customerUser.id, order.id);

  const invoiceUrl = await generateInvoicePdf(hydrated);

  assert.equal(invoiceUrl, "/invoices/INV-GENERATE.pdf");
  assert.equal(fs.existsSync(path.join(env.invoiceDir, "INV-GENERATE.pdf")), true);
});

test("emailService ne tente pas d'envoi réel sans configuration SMTP", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "INV-EMAIL" });
  order.User = customerUser;
  order.items = [
    {
      productSnapshot: { name: "Produit email", sku: "MAIL-1", weightKg: 0.2 },
      qty: 1,
      unitPrice: 25,
      lineTotal: 25
    }
  ];

  const result = await sendOrderInvoiceEmail(order, { attachmentPath: path.join(env.invoiceDir, "INV-EMAIL.pdf") });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "smtp_not_configured");
  assert.match(result.html, /INV-EMAIL/);
});

test("demande de retour fonctionne pour une commande non livrée selon le comportement actuel", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "RETURN-OK", status: "Processing" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: order.id },
    body: { reason: "Taille incorrecte" },
    originalUrl: `/orders/${order.id}/return-request`
  });

  const { res, nextError } = await runHandler(orderController.returnRequest, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, `/orders/${order.id}`);
  const request = await models.ReturnRequest.findOne({ where: { orderId: order.id } });
  assert.equal(request.reason, "Taille incorrecte");
  assert.equal(request.status, "Requested");
});

test("demande de retour utilise le motif par défaut si le body est vide", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "RETURN-DEFAULT", status: "Processing" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: order.id },
    body: {},
    originalUrl: `/orders/${order.id}/return-request`
  });

  const { nextError } = await runHandler(orderController.returnRequest, req);

  assert.equal(nextError, null);
  const request = await models.ReturnRequest.findOne({ where: { orderId: order.id } });
  assert.equal(request.reason, "Demande client");
});

test("demande de retour est refusée pour une commande Delivered selon le comportement actuel", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "RETURN-NO", status: "Delivered" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: order.id },
    body: { reason: "Refus attendu" },
    originalUrl: `/orders/${order.id}/return-request`
  });
  const res = createRes();

  const { nextError } = await runHandler(orderController.returnRequest, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(await models.ReturnRequest.count({ where: { orderId: order.id } }), 0);
});

test("demande de retour sur commande étrangère propage une 404", async () => {
  const foreignOrder = await createOrder(otherUser.id, { orderNumber: "RETURN-FOREIGN", status: "Processing" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: foreignOrder.id },
    body: { reason: "Tentative étrangère" },
    originalUrl: `/orders/${foreignOrder.id}/return-request`
  });
  const res = createRes();

  const { nextError } = await runHandler(orderController.returnRequest, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(await models.ReturnRequest.count({ where: { orderId: foreignOrder.id } }), 0);
});

test("double demande de retour suit le comportement upsert actuel", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "RETURN-TWICE", status: "Processing" });

  await orderService.requestReturn(customerUser.id, order.id, "Premier motif");
  await orderService.requestReturn(customerUser.id, order.id, "Second motif");

  const requests = await models.ReturnRequest.findAll({ where: { orderId: order.id }, order: [["createdAt", "ASC"]] });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.reason), ["Premier motif", "Second motif"]);
});

test("utilisateur non connecté est bloqué sur les routes commandes", async () => {
  const req = createReq({ user: null });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
});
