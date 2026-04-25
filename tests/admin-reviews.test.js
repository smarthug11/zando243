const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-reviews-${process.pid}-${Date.now()}.sqlite`);

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
const { recomputeProductRating } = require("../src/services/reviewService");

defineModels();

let models;
let adminUser;
let customerUser;
let category;
let product;

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
    originalUrl: "/admin/reviews",
    path: "/admin/reviews",
    requestId: "req-admin-reviews-test",
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

async function createBaseProduct() {
  category = await models.Category.create({
    name: "Electronique",
    slug: "electronique",
    parentId: null
  });

  product = await models.Product.create({
    categoryId: category.id,
    name: "Casque Audio",
    slug: "casque-audio",
    description: "Casque sans fil",
    weightKg: 0.5,
    purchasePrice: 20,
    priceWithoutDelivery: 50,
    finalPrice: 57.5,
    stock: 10,
    sku: "CASQUE-001",
    brand: "Zando",
    status: "ACTIVE"
  });
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

  await createBaseProduct();
}

async function createReview({ userId, rating, comment, isHidden = false, createdAt = new Date() }) {
  return models.Review.create({
    userId,
    productId: product.id,
    rating,
    comment,
    isHidden,
    verifiedPurchase: false,
    createdAt,
    updatedAt: createdAt
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

test("un admin connecté peut afficher la page de modération des avis avec les relations nécessaires", async () => {
  const secondUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await createReview({
    userId: customerUser.id,
    rating: 4,
    comment: "Bon produit",
    createdAt: new Date("2026-01-01T10:00:00Z")
  });
  await createReview({
    userId: secondUser.id,
    rating: 2,
    comment: "Moyen",
    createdAt: new Date("2026-01-02T10:00:00Z")
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.reviewsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/reviews");
  assert.equal(res.rendered.locals.title, "Admin Avis");
  assert.equal(res.rendered.locals.reviews.length, 2);
  assert.equal(res.rendered.locals.reviews[0].comment, "Moyen");
  assert.equal(res.rendered.locals.reviews[0].product.name, "Casque Audio");
  assert.equal(res.rendered.locals.reviews[0].user.firstName, "Jane");
});

test("un admin peut masquer un avis et la note moyenne du produit est recalculée", async () => {
  const secondUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await createReview({ userId: customerUser.id, rating: 5, comment: "Excellent" });
  const reviewToHide = await createReview({ userId: secondUser.id, rating: 3, comment: "Correct" });
  await recomputeProductRating(product.id);

  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/reviews/${reviewToHide.id}/moderation`,
    params: { id: reviewToHide.id },
    body: { action: "hide" }
  });

  const { res, nextError } = await runHandler(adminController.moderateReview, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/reviews");

  const refreshedReview = await models.Review.findByPk(reviewToHide.id);
  const refreshedProduct = await models.Product.findByPk(product.id);

  assert.equal(refreshedReview.isHidden, true);
  assert.equal(Number(refreshedProduct.avgRating), 5);
  assert.equal(refreshedProduct.countReviews, 1);
});

test("un admin peut réafficher un avis et la note moyenne du produit est recalculée", async () => {
  const secondUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await createReview({ userId: customerUser.id, rating: 5, comment: "Excellent" });
  const hiddenReview = await createReview({ userId: secondUser.id, rating: 3, comment: "Correct", isHidden: true });
  await recomputeProductRating(product.id);

  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/reviews/${hiddenReview.id}/moderation`,
    params: { id: hiddenReview.id },
    body: { action: "unhide" }
  });

  const { res, nextError } = await runHandler(adminController.moderateReview, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/reviews");

  const refreshedReview = await models.Review.findByPk(hiddenReview.id);
  const refreshedProduct = await models.Product.findByPk(product.id);

  assert.equal(refreshedReview.isHidden, false);
  assert.equal(Number(refreshedProduct.avgRating), 4);
  assert.equal(refreshedProduct.countReviews, 2);
});

test("un admin peut supprimer définitivement un avis et la note moyenne du produit est recalculée", async () => {
  const secondUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await createReview({ userId: customerUser.id, rating: 5, comment: "Excellent" });
  const reviewToDelete = await createReview({ userId: secondUser.id, rating: 3, comment: "Correct" });
  await recomputeProductRating(product.id);

  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/reviews/${reviewToDelete.id}/moderation`,
    params: { id: reviewToDelete.id },
    body: { action: "delete" }
  });

  const { res, nextError } = await runHandler(adminController.moderateReview, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/reviews");

  const deletedReview = await models.Review.findByPk(reviewToDelete.id);
  const refreshedProduct = await models.Product.findByPk(product.id);

  assert.equal(deletedReview, null);
  assert.equal(Number(refreshedProduct.avgRating), 5);
  assert.equal(refreshedProduct.countReviews, 1);
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/reviews" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/reviews" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
