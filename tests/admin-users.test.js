const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-users-${process.pid}-${Date.now()}.sqlite`);

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
let customerA;
let customerB;

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
    originalUrl: "/admin/users",
    path: "/admin/users",
    requestId: "req-admin-users-test",
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

  customerA = await models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Client",
    email: "alice@example.com",
    loyaltyPoints: 20,
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  customerB = await models.User.create({
    role: "CUSTOMER",
    firstName: "Bob",
    lastName: "Client",
    email: "bob@example.com",
    loyaltyPoints: 5,
    isActive: false,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await models.User.create({
    role: "ADMIN",
    firstName: "Other",
    lastName: "Admin",
    email: "other-admin@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
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

test("un admin connecté peut afficher la page clients/utilisateurs", async () => {
  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.usersPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/users");
  assert.equal(res.rendered.locals.title, "Admin Clients");
});

test("la page reçoit la liste des utilisateurs selon le tri et filtre actuels", async () => {
  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.usersPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.users.length, 2);
  assert.ok(res.rendered.locals.users.every((u) => u.role === "CUSTOMER"));
  assert.equal(res.rendered.locals.users[0].email, "bob@example.com");
  assert.equal(res.rendered.locals.users[1].email, "alice@example.com");
});

test("un admin peut bloquer un utilisateur", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/users/${customerA.id}/block-toggle`,
    params: { id: customerA.id },
    body: { action: "block" }
  });

  const { res, nextError } = await runHandler(adminController.toggleUserBlock, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/users");

  const refreshed = await models.User.findByPk(customerA.id);
  assert.equal(refreshed.isActive, false);
});

test("un admin peut débloquer un utilisateur", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/users/${customerB.id}/block-toggle`,
    params: { id: customerB.id },
    body: { action: "unblock" }
  });

  const { res, nextError } = await runHandler(adminController.toggleUserBlock, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/users");

  const refreshed = await models.User.findByPk(customerB.id);
  assert.equal(refreshed.isActive, true);
});

test("un admin sur un utilisateur inexistant conserve le comportement actuel", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/users/missing-id/block-toggle",
    params: { id: "missing-id" },
    body: { action: "block" }
  });

  const { res, nextError } = await runHandler(adminController.toggleUserBlock, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/users");
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerA, method: "GET", originalUrl: "/admin/users" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/users" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
