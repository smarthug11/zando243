const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.tmpdir(), `zando243-loyalty-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const orderService = require("../src/services/orderService");
const accountService = require("../src/services/accountService");
const { computeEarnedPoints } = require("../src/services/loyaltyService");

defineModels();

let models;
let customerUser;
let otherUser;

async function createUser(email, firstName, loyaltyPoints = 0) {
  return models.User.create({
    role: "CUSTOMER",
    firstName,
    lastName: "Client",
    email,
    loyaltyPoints,
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });
}

async function createOrder(userId, overrides = {}) {
  return models.Order.create({
    orderNumber: overrides.orderNumber || `LOYALTY-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    userId,
    addressSnapshot: {
      label: "Maison",
      street: "Rue Fidélité",
      city: "Kinshasa",
      country: "RDC"
    },
    subtotal: overrides.subtotal ?? 50,
    shippingFee: overrides.shippingFee ?? 0,
    discountTotal: overrides.discountTotal ?? 0,
    total: overrides.total ?? 50,
    paymentMethod: overrides.paymentMethod || "CARD",
    paymentStatus: overrides.paymentStatus || "PENDING",
    status: overrides.status || "Processing",
    trackingNumber: overrides.trackingNumber || "TRK-LOYALTY",
    trackingCarrier: overrides.trackingCarrier || "ITS Logistics",
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt
  });
}

async function seedBaseData() {
  await sequelize.sync({ force: true });
  customerUser = await createUser("alice-loyalty@example.com", "Alice", 10);
  otherUser = await createUser("bob-loyalty@example.com", "Bob", 0);
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await seedBaseData();
});

test("formule fidélité actuelle: seuil minimum puis arrondi inférieur", () => {
  assert.equal(computeEarnedPoints(9.99), 0);
  assert.equal(computeEarnedPoints(10), 10);
  assert.equal(computeEarnedPoints(110.75), 110);
});

test("passage à Delivered attribue les points selon le total actuel", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "LOYALTY-DELIVERED", status: "Shipped", total: 125.75 });

  await orderService.updateOrderStatus(order.id, "Delivered");
  await customerUser.reload();

  assert.equal(customerUser.loyaltyPoints, 135);
});

test("passage à Delivered crée la notification client actuelle", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "LOYALTY-NOTIF", status: "Shipped", total: 50 });

  await orderService.updateOrderStatus(order.id, "Delivered");

  const notification = await models.Notification.findOne({ where: { userId: customerUser.id, type: "ORDER_STATUS" } });
  assert.ok(notification);
  assert.equal(notification.message, "Commande LOYALTY-NOTIF livrée.");
});

test("passage à Delivered deux fois ne double ni les points ni la notification", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "LOYALTY-ONCE", status: "Shipped", total: 50 });

  await orderService.updateOrderStatus(order.id, "Delivered");
  await orderService.updateOrderStatus(order.id, "Delivered");
  await customerUser.reload();

  assert.equal(customerUser.loyaltyPoints, 60);
  assert.equal(await models.Notification.count({ where: { userId: customerUser.id, type: "ORDER_STATUS" } }), 1);
});

test("statut non Delivered ne donne pas de points et ne crée pas de notification statut", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "LOYALTY-SHIPPED", status: "Processing", total: 200 });

  await orderService.updateOrderStatus(order.id, "Shipped");
  await customerUser.reload();

  assert.equal(customerUser.loyaltyPoints, 10);
  assert.equal(await models.Notification.count({ where: { userId: customerUser.id, type: "ORDER_STATUS" } }), 0);
});

test("Delivered sous le seuil ne donne pas de points mais garde la notification actuelle", async () => {
  const order = await createOrder(customerUser.id, { orderNumber: "LOYALTY-LOW", status: "Shipped", total: 9.99 });

  await orderService.updateOrderStatus(order.id, "Delivered");
  await customerUser.reload();

  assert.equal(customerUser.loyaltyPoints, 10);
  assert.equal(await models.Notification.count({ where: { userId: customerUser.id, type: "ORDER_STATUS" } }), 1);
});

test("notification de commande livrée est visible dans les données profil du bon utilisateur", async () => {
  const order = await createOrder(customerUser.id, {
    orderNumber: "LOYALTY-PROFILE",
    status: "Shipped",
    total: 25,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z")
  });
  await models.Notification.create({
    userId: otherUser.id,
    type: "ORDER_STATUS",
    message: "Notification autre client"
  });

  await orderService.updateOrderStatus(order.id, "Delivered");

  const profile = await accountService.getProfileData(customerUser.id);
  assert.equal(profile.notifications.length, 1);
  assert.equal(profile.notifications[0].message, "Commande LOYALTY-PROFILE livrée.");
  assert.equal(profile.notifications[0].userId, customerUser.id);
});
