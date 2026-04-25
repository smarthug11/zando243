const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-coupons-${process.pid}-${Date.now()}.sqlite`);

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
    originalUrl: "/admin/coupons",
    path: "/admin/coupons",
    requestId: "req-admin-coupons-test",
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

test("un admin connecté peut afficher la page coupons et voir les coupons existants", async () => {
  await models.Coupon.create({
    code: "WELCOME",
    type: "PERCENT",
    value: 10,
    minCart: 20,
    startAt: new Date("2026-01-01T10:00:00Z"),
    endAt: new Date("2026-12-31T10:00:00Z"),
    isActive: true
  });
  await models.Coupon.create({
    code: "VIP",
    type: "FIXED",
    value: 5,
    minCart: 0,
    startAt: new Date("2026-02-01T10:00:00Z"),
    endAt: new Date("2026-11-30T10:00:00Z"),
    isActive: false
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.couponsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/coupons");
  assert.equal(res.rendered.locals.title, "Admin Coupons");
  assert.equal(res.rendered.locals.coupons.length, 2);
  assert.equal(res.rendered.locals.coupons[0].code, "VIP");
  assert.equal(res.rendered.locals.coupons[1].code, "WELCOME");
});

test("un admin peut créer un coupon avec les champs acceptés actuellement", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: {
      code: "summer10",
      type: "PERCENT",
      value: "10.5",
      minCart: "50",
      maxDiscount: "25",
      startAt: "2026-06-01T10:30",
      endAt: "2026-06-30T18:45",
      usageLimit: "100",
      usagePerUser: "2",
      isActive: "1"
    }
  });

  const { res, nextError } = await runHandler(adminController.createCoupon, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/coupons");

  const coupon = await models.Coupon.findOne({ where: { code: "SUMMER10" } });
  assert.ok(coupon);
  assert.equal(coupon.type, "PERCENT");
});

test("les valeurs numériques, dates et statut sont persistés selon le comportement actuel", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: {
      code: "flat5",
      type: "FIXED",
      value: "5",
      minCart: "",
      maxDiscount: "",
      startAt: "2026-07-01T08:00",
      endAt: "2026-07-31T20:15",
      usageLimit: "",
      usagePerUser: "",
      isActive: ""
    }
  });

  const { res, nextError } = await runHandler(adminController.createCoupon, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/coupons");

  const coupon = await models.Coupon.findOne({ where: { code: "FLAT5" } });
  assert.ok(coupon);
  assert.equal(Number(coupon.value), 5);
  assert.equal(Number(coupon.minCart), 0);
  assert.equal(coupon.maxDiscount, null);
  assert.equal(coupon.usageLimit, null);
  assert.equal(Number(coupon.usagePerUser), 1);
  assert.equal(coupon.isActive, false);
  assert.equal(new Date(coupon.startAt).toISOString(), new Date("2026-07-01T08:00").toISOString());
  assert.equal(new Date(coupon.endAt).toISOString(), new Date("2026-07-31T20:15").toISOString());
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/coupons" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/coupons" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
