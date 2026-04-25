const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-categories-${process.pid}-${Date.now()}.sqlite`);

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
    originalUrl: "/admin/categories",
    path: "/admin/categories",
    requestId: "req-admin-categories-test",
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
    firstName: "Customer",
    lastName: "User",
    email: "customer@example.com",
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

test("un admin connecté peut afficher la page catégories et voir les catégories existantes", async () => {
  await models.Category.create({ name: "Mode", slug: "mode", parentId: null });
  await models.Category.create({ name: "Chaussures", slug: "chaussures", parentId: null });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.categoriesPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/categories");
  assert.equal(res.rendered.locals.title, "Admin Catégories");
  assert.equal(res.rendered.locals.categories.length, 2);
  assert.equal(res.rendered.locals.categories[0].name, "Chaussures");
  assert.equal(res.rendered.locals.categories[1].name, "Mode");
});

test("un admin peut créer une catégorie", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: {
      name: "Téléphones",
      parentId: ""
    }
  });

  const { res, nextError } = await runHandler(adminController.createCategory, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/categories");

  const category = await models.Category.findOne({ where: { name: "Téléphones" } });
  assert.ok(category);
  assert.equal(category.slug, "telephones");
  assert.equal(category.parentId, null);
});

test("un admin peut modifier une catégorie existante", async () => {
  const parent = await models.Category.create({ name: "Electronique", slug: "electronique", parentId: null });
  const category = await models.Category.create({ name: "Tel", slug: "tel", parentId: null });

  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/categories/${category.id}`,
    params: { id: category.id },
    body: {
      name: "Téléphones",
      parentId: parent.id
    }
  });

  const { res, nextError } = await runHandler(adminController.updateCategory, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/categories");

  const updated = await models.Category.findByPk(category.id);
  assert.equal(updated.name, "Téléphones");
  assert.equal(updated.slug, "telephones");
  assert.equal(updated.parentId, parent.id);
});

test("un admin obtient une 404 s'il modifie une catégorie inexistante", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/categories/missing-id",
    params: { id: "missing-id" },
    body: {
      name: "Introuvable",
      parentId: ""
    }
  });

  const { res, nextError } = await runHandler(adminController.updateCategory, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Catégorie introuvable");
});

test("un admin peut supprimer une catégorie si le comportement actuel le permet", async () => {
  const category = await models.Category.create({ name: "Accessoires", slug: "accessoires", parentId: null });

  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/categories/${category.id}/delete`,
    params: { id: category.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteCategory, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/categories");

  const deleted = await models.Category.findByPk(category.id);
  assert.equal(deleted, null);
});

test("un utilisateur non-admin est bloque selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/categories" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloque selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/categories" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
