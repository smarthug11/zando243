const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-logs-${process.pid}-${Date.now()}.sqlite`);

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
    originalUrl: "/admin/logs",
    path: "/admin/logs",
    requestId: "req-admin-logs-test",
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

async function createLog(overrides = {}) {
  return models.AuditLog.create({
    category: "SYSTEM",
    level: "INFO",
    action: "DEFAULT_ACTION",
    message: "Default event",
    meta: {},
    actorUserId: adminUser.id,
    actorEmail: adminUser.email,
    requestId: "req-log",
    ip: "127.0.0.1",
    userAgent: "test-agent",
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

test("un admin connecté peut afficher la page logs et recevoir les logs d’audit existants", async () => {
  await createLog({
    category: "AUTH",
    level: "WARN",
    action: "USER_LOGIN",
    message: "Connexion utilisateur",
    createdAt: new Date("2026-04-01T10:00:00Z"),
    updatedAt: new Date("2026-04-01T10:00:00Z")
  });
  await createLog({
    category: "ORDER",
    level: "ERROR",
    action: "ORDER_FAILED",
    message: "Echec commande",
    actorUserId: customerUser.id,
    actorEmail: customerUser.email,
    createdAt: new Date("2026-04-02T10:00:00Z"),
    updatedAt: new Date("2026-04-02T10:00:00Z")
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.logsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/logs");
  assert.equal(res.rendered.locals.title, "Logs système et métier");
  assert.equal(res.rendered.locals.logs.length, 2);
  assert.equal(res.rendered.locals.logs[0].action, "ORDER_FAILED");
  assert.equal(res.rendered.locals.logs[0].actor.email, "alice@example.com");
  assert.ok(Array.isArray(res.rendered.locals.categories));
  assert.ok(Array.isArray(res.rendered.locals.levels));
});

test("les filtres existants fonctionnent selon le comportement actuel", async () => {
  await createLog({
    category: "AUTH",
    level: "WARN",
    action: "USER_LOGIN",
    message: "Connexion utilisateur admin",
    actorUserId: adminUser.id,
    actorEmail: adminUser.email,
    createdAt: new Date("2026-04-10T09:00:00Z"),
    updatedAt: new Date("2026-04-10T09:00:00Z")
  });
  await createLog({
    category: "ORDER",
    level: "ERROR",
    action: "ORDER_FAILED",
    message: "Commande client echouee",
    actorUserId: customerUser.id,
    actorEmail: customerUser.email,
    createdAt: new Date("2026-04-11T09:00:00Z"),
    updatedAt: new Date("2026-04-11T09:00:00Z")
  });

  const req = createReq({
    user: adminUser,
    query: {
      category: "order",
      level: "error",
      q: "failed",
      actorEmail: "alice@example.com",
      startDate: "2026-04-11",
      endDate: "2026-04-11"
    }
  });
  const { res, nextError } = await runHandler(adminController.logsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.logs.length, 1);
  assert.equal(res.rendered.locals.logs[0].action, "ORDER_FAILED");
  assert.equal(res.rendered.locals.filters.category, "order");
  assert.equal(res.rendered.locals.filters.level, "error");
  assert.equal(res.rendered.locals.filters.q, "failed");
  assert.equal(res.rendered.locals.filters.actorEmail, "alice@example.com");
});

test("la pagination et la limite fonctionnent selon le comportement actuel", async () => {
  for (let i = 0; i < 12; i += 1) {
    await createLog({
      category: "SYSTEM",
      level: "INFO",
      action: `ACTION_${i}`,
      message: `Event ${i}`,
      createdAt: new Date(`2026-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
      updatedAt: new Date(`2026-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`)
    });
  }

  const req = createReq({
    user: adminUser,
    query: { page: "2", limit: "10" }
  });
  const { res, nextError } = await runHandler(adminController.logsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.logs.length, 2);
  assert.equal(res.rendered.locals.count, 12);
  assert.equal(res.rendered.locals.page, 2);
  assert.equal(res.rendered.locals.limit, 10);
  assert.equal(res.rendered.locals.totalPages, 2);
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/logs" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/logs" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
