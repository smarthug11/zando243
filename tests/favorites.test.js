const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-favorites-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const favoriteController = require("../src/controllers/favoriteController");
const { requireAuth } = require("../src/middlewares/auth");
const { errorHandler } = require("../src/middlewares/errorHandler");

defineModels();

let models;
let alice;
let bob;
let category;
let productA;
let productB;

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
    originalUrl: "/favorites",
    path: "/favorites",
    requestId: "req-favorites-test",
    session: { guestCartKey: "guest_test_session" },
    accepts(type) {
      return type === "html";
    },
    get(name) {
      if (name && name.toLowerCase() === "referer") return null;
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

async function seedProducts() {
  category = await models.Category.create({
    name: "Electronique",
    slug: "electronique",
    parentId: null
  });

  productA = await models.Product.create({
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

  productB = await models.Product.create({
    categoryId: category.id,
    name: "Souris",
    slug: "souris",
    description: "Souris bluetooth",
    weightKg: 0.2,
    purchasePrice: 10,
    priceWithoutDelivery: 25,
    finalPrice: 28,
    stock: 15,
    sku: "SOURIS-001",
    brand: "Zando",
    status: "ACTIVE"
  });

  await models.ProductImage.create({
    productId: productA.id,
    url: "https://cdn.example.com/casque.jpg",
    isMain: true,
    position: 0
  });
}

async function seedBaseData() {
  await sequelize.sync({ force: true });

  alice = await models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Support",
    email: "alice@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  bob = await models.User.create({
    role: "CUSTOMER",
    firstName: "Bob",
    lastName: "Client",
    email: "bob@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  await seedProducts();
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

test("un utilisateur connecté peut afficher sa page favoris", async () => {
  await models.Favorite.create({ userId: alice.id, productId: productA.id });

  const req = createReq({ user: alice });
  const { res, nextError } = await runHandler(favoriteController.listFavorites, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/favorites");
  assert.equal(res.rendered.locals.title, "Mes favoris");
  assert.equal(res.rendered.locals.favorites.length, 1);
});

test("la page favoris affiche uniquement les favoris de l'utilisateur courant", async () => {
  await models.Favorite.create({ userId: alice.id, productId: productA.id });
  await models.Favorite.create({ userId: bob.id, productId: productB.id });

  const req = createReq({ user: alice });
  const { res, nextError } = await runHandler(favoriteController.listFavorites, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.locals.favorites.length, 1);
  assert.equal(res.rendered.locals.favorites[0].productId, productA.id);
  assert.equal(res.rendered.locals.favorites[0].product.name, "Casque Audio");
});

test("un utilisateur connecté peut ajouter un produit aux favoris", async () => {
  const req = createReq({
    user: alice,
    method: "POST",
    params: { productId: productA.id }
  });

  const { res, nextError } = await runHandler(favoriteController.addFavorite, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/favorites");

  const favorite = await models.Favorite.findOne({ where: { userId: alice.id, productId: productA.id } });
  assert.ok(favorite);
});

test("ajouter deux fois le même produit conserve le comportement actuel de bascule", async () => {
  const firstReq = createReq({
    user: alice,
    method: "POST",
    params: { productId: productA.id }
  });
  const secondReq = createReq({
    user: alice,
    method: "POST",
    params: { productId: productA.id }
  });

  const first = await runHandler(favoriteController.addFavorite, firstReq);
  const second = await runHandler(favoriteController.addFavorite, secondReq);

  assert.equal(first.nextError, null);
  assert.equal(second.nextError, null);
  assert.equal(first.res.redirectTo, "/favorites");
  assert.equal(second.res.redirectTo, "/favorites");

  const count = await models.Favorite.count({ where: { userId: alice.id, productId: productA.id } });
  assert.equal(count, 0);
});

test("un utilisateur connecté peut retirer un produit des favoris", async () => {
  await models.Favorite.create({ userId: alice.id, productId: productA.id });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/favorites/${productA.id}/delete`,
    params: { productId: productA.id }
  });

  const { res, nextError } = await runHandler(favoriteController.removeFavorite, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/favorites");

  const count = await models.Favorite.count({ where: { userId: alice.id, productId: productA.id } });
  assert.equal(count, 0);
});

test("un utilisateur connecté peut déplacer un favori vers le panier", async () => {
  await models.Favorite.create({ userId: alice.id, productId: productA.id });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/favorites/${productA.id}/move-to-cart`,
    params: { productId: productA.id }
  });

  const { res, nextError } = await runHandler(favoriteController.moveToCart, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");

  const remainingFavorite = await models.Favorite.count({ where: { userId: alice.id, productId: productA.id } });
  assert.equal(remainingFavorite, 0);

  const cart = await models.Cart.findOne({
    where: { userId: alice.id },
    include: [{ model: models.CartItem, as: "items" }]
  });
  assert.ok(cart);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].productId, productA.id);
  assert.equal(cart.items[0].qty, 1);
});

test("un utilisateur ne peut pas supprimer le favori d'un autre utilisateur", async () => {
  await models.Favorite.create({ userId: bob.id, productId: productA.id });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/favorites/${productA.id}/delete`,
    params: { productId: productA.id }
  });

  const { res, nextError } = await runHandler(favoriteController.removeFavorite, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/favorites");

  const bobsFavorite = await models.Favorite.count({ where: { userId: bob.id, productId: productA.id } });
  const alicesFavorite = await models.Favorite.count({ where: { userId: alice.id, productId: productA.id } });
  assert.equal(bobsFavorite, 1);
  assert.equal(alicesFavorite, 0);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const getReq = createReq({ user: null, method: "GET", originalUrl: "/favorites" });
  const getRes = createRes();
  const { nextError: getError } = await runHandler(requireAuth, getReq, getRes);

  assert.ok(getError);
  errorHandler(getError, getReq, getRes);
  assert.equal(getRes.statusCode, 401);
  assert.equal(getRes.rendered.view, "pages/errors/error");
  assert.match(getRes.rendered.locals.error.message, /Authentification requise/);

  const postReq = createReq({ user: null, method: "POST", originalUrl: `/favorites/${productA.id}`, params: { productId: productA.id } });
  const postRes = createRes();
  const { nextError: postError } = await runHandler(requireAuth, postReq, postRes);

  assert.ok(postError);
  errorHandler(postError, postReq, postRes);
  assert.equal(postRes.statusCode, 401);
  assert.equal(postRes.rendered.view, "pages/errors/error");
  assert.match(postRes.rendered.locals.error.message, /Authentification requise/);
});
