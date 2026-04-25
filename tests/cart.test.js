const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.tmpdir(), `zando243-cart-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const cartController = require("../src/controllers/cartController");
const cartRoutes = require("../src/routes/cartRoutes");
const cartService = require("../src/services/cartService");
const { requireAuth } = require("../src/middlewares/auth");
const { errorHandler } = require("../src/middlewares/errorHandler");

defineModels();

let models;
let customerUser;
let otherUser;
let category;
let activeProduct;
let inactiveProduct;

function createRes() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.rendered = { view, locals }; return this; },
    redirect(location) { this.redirectTo = location; this.statusCode = 302; return this; }
  };
}

function createReq(overrides = {}) {
  const session = { guestCartKey: null, ...(overrides.session || {}) };
  return {
    body: {},
    params: {},
    query: {},
    user: null,
    method: "GET",
    originalUrl: "/cart",
    path: "/cart",
    requestId: "req-cart-test",
    session,
    sessionID: "test-session-id-cart",
    accepts(type) { return type === "html"; },
    get(header) { return header === "referer" ? null : null; },
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

async function runMiddlewareChain(handlers, req, res = createRes()) {
  let nextError = null;

  for (const handler of handlers) {
    if (nextError) break;
    await new Promise((resolve, reject) => {
      const next = (err) => {
        if (err) nextError = err;
        resolve();
      };
      try {
        const result = handler(req, res, next);
        if (result && typeof result.then === "function") result.then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  return { res, nextError };
}

function routeMethods(path) {
  const methods = cartRoutes.stack
    .filter((entry) => entry.route?.path === path)
    .flatMap((entry) => Object.keys(entry.route.methods));
  assert.ok(methods.length, `route ${path} should exist`);
  return methods.sort();
}

async function seedBaseData() {
  await sequelize.sync({ force: true });

  customerUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Client",
    email: "alice@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  otherUser = await models.User.create({
    role: "CUSTOMER",
    firstName: "Bob",
    lastName: "Other",
    email: "bob@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  category = await models.Category.create({
    name: "Categorie Test",
    slug: "categorie-test"
  });

  activeProduct = await models.Product.create({
    categoryId: category.id,
    name: "Produit Test",
    description: "Produit de test pour le panier",
    sku: "SKU-CART-ACTIVE",
    priceWithoutDelivery: 10.00,
    weightKg: 1.0,
    stock: 50,
    status: "ACTIVE"
  });

  inactiveProduct = await models.Product.create({
    categoryId: category.id,
    name: "Produit Inactif",
    description: "Produit inactif de test pour le panier",
    sku: "SKU-CART-INACTIVE",
    priceWithoutDelivery: 5.00,
    weightKg: 0.5,
    stock: 10,
    status: "DRAFT"
  });
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await seedBaseData();
});

// ── routes ───────────────────────────────────────────────────────────────────

test("les routes panier hors checkout exposent les méthodes attendues", () => {
  assert.deepEqual(routeMethods("/"), ["get"]);
  assert.deepEqual(routeMethods("/items"), ["post"]);
  assert.deepEqual(routeMethods("/items/:id"), ["delete", "patch", "post"]);
  assert.deepEqual(routeMethods("/items/:id/delete"), ["post"]);
  assert.deepEqual(routeMethods("/items/:id/save-for-later"), ["post"]);
});

// ── showCart ──────────────────────────────────────────────────────────────────

test("un visiteur peut afficher son panier invité", async () => {
  const req = createReq({ user: null });
  const { res, nextError } = await runHandler(cartController.showCart, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.view, "pages/cart");
  assert.equal(res.rendered.locals.title, "Panier");
});

test("un utilisateur connecté peut afficher son panier", async () => {
  const req = createReq({ user: customerUser });
  const { res, nextError } = await runHandler(cartController.showCart, req);

  assert.equal(nextError, null);
  assert.equal(res.rendered.view, "pages/cart");
  assert.ok(Array.isArray(res.rendered.locals.addresses));
});

test("showCart passe un objet totals à la vue", async () => {
  const req = createReq({ user: null });
  const { res } = await runHandler(cartController.showCart, req);

  const { totals } = res.rendered.locals;
  assert.ok(typeof totals.subtotal === "number");
  assert.ok(typeof totals.total === "number");
  assert.ok(typeof totals.shippingFee === "number");
  assert.ok(typeof totals.discountTotal === "number");
});

test("showCart ne charge aucune adresse pour un invité", async () => {
  const req = createReq({ user: null });
  const { res } = await runHandler(cartController.showCart, req);

  assert.deepEqual(res.rendered.locals.addresses, []);
});

test("showCart charge les adresses triées isDefault DESC pour un utilisateur connecté", async () => {
  await models.Address.create({ userId: customerUser.id, label: "A", street: "Rue A", city: "Kin", country: "RDC", isDefault: false });
  await models.Address.create({ userId: customerUser.id, label: "B", street: "Rue B", city: "Kin", country: "RDC", isDefault: true });

  const req = createReq({ user: customerUser });
  const { res } = await runHandler(cartController.showCart, req);

  const addresses = res.rendered.locals.addresses;
  assert.equal(addresses.length, 2);
  assert.equal(addresses[0].isDefault, true);
});

// ── addCartItem ───────────────────────────────────────────────────────────────

test("ajout produit au panier invité crée un CartItem", async () => {
  const req = createReq({
    user: null,
    method: "POST",
    body: { productId: activeProduct.id, qty: 2 }
  });
  const { res, nextError } = await runHandler(cartController.addCartItem, req);

  assert.equal(nextError, null);
  assert.ok(res.redirectTo);
  const cart = await models.Cart.findOne({ where: { sessionId: `guest_${req.sessionID}` } });
  assert.ok(cart);
  const items = await models.CartItem.findAll({ where: { cartId: cart.id } });
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].qty), 2);
});

test("ajout produit au panier connecté crée un CartItem lié à l'utilisateur", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: activeProduct.id, qty: 1 }
  });
  const { nextError } = await runHandler(cartController.addCartItem, req);

  assert.equal(nextError, null);
  const cart = await models.Cart.findOne({ where: { userId: customerUser.id } });
  assert.ok(cart);
  const items = await models.CartItem.findAll({ where: { cartId: cart.id } });
  assert.equal(items.length, 1);
});

test("ajout d'un produit déjà présent agrège la quantité selon le comportement actuel", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: activeProduct.id, qty: 3 }
  });
  await runHandler(cartController.addCartItem, req);
  await runHandler(cartController.addCartItem, req);

  const cart = await models.Cart.findOne({ where: { userId: customerUser.id } });
  const items = await models.CartItem.findAll({ where: { cartId: cart.id } });
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].qty), 6);
});

test("addCartItem redirige vers /cart si redirectTo=cart", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: activeProduct.id, qty: 1, redirectTo: "cart" }
  });
  const { res } = await runHandler(cartController.addCartItem, req);

  assert.equal(res.redirectTo, "/cart");
});

test("ajout d'un produit inexistant propage une erreur selon le comportement actuel", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: "00000000-0000-4000-8000-000000000000", qty: 1 }
  });
  const { res, nextError } = await runHandler(cartController.addCartItem, req);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
});

test("ajout d'un produit inactif propage une erreur selon le comportement actuel", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: inactiveProduct.id, qty: 1 }
  });
  const { res, nextError } = await runHandler(cartController.addCartItem, req);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
});

test("POST /items refuse une quantité invalide via les validateurs de route", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { productId: activeProduct.id, qty: "0" }
  });
  const res = createRes();

  const { nextError } = await runMiddlewareChain(cartController.cartItemValidators, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 422);
});

// ── updateCartItem ────────────────────────────────────────────────────────────

test("modification de quantité met à jour l'item selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser });
  const cart = await cartService.getOrCreateCart(req);
  const item = await models.CartItem.create({ cartId: cart.id, productId: activeProduct.id, qty: 2 });

  const updateReq = createReq({
    user: customerUser,
    method: "POST",
    params: { id: item.id },
    body: { qty: 5 }
  });
  const { res, nextError } = await runHandler(cartController.updateCartItem, updateReq);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  await item.reload();
  assert.equal(Number(item.qty), 5);
});

test("la quantité ne descend pas sous 1 selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser });
  const cart = await cartService.getOrCreateCart(req);
  const item = await models.CartItem.create({ cartId: cart.id, productId: activeProduct.id, qty: 3 });

  const updateReq = createReq({
    user: customerUser,
    method: "POST",
    params: { id: item.id },
    body: { qty: 0 }
  });
  await runHandler(cartController.updateCartItem, updateReq);

  await item.reload();
  assert.equal(Number(item.qty), 1);
});

test("modification d'un item étranger propage une erreur selon le comportement actuel", async () => {
  const otherReq = createReq({ user: otherUser });
  const otherCart = await cartService.getOrCreateCart(otherReq);
  const foreignItem = await models.CartItem.create({ cartId: otherCart.id, productId: activeProduct.id, qty: 1 });

  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: foreignItem.id },
    body: { qty: 5 }
  });
  const res = createRes();
  const { nextError } = await runHandler(cartController.updateCartItem, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
});

// ── deleteCartItem ────────────────────────────────────────────────────────────

test("suppression d'un article le retire du panier", async () => {
  const req = createReq({ user: customerUser });
  const cart = await cartService.getOrCreateCart(req);
  const item = await models.CartItem.create({ cartId: cart.id, productId: activeProduct.id, qty: 1 });

  const deleteReq = createReq({
    user: customerUser,
    method: "POST",
    params: { id: item.id }
  });
  const { res, nextError } = await runHandler(cartController.deleteCartItem, deleteReq);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  const found = await models.CartItem.findByPk(item.id);
  assert.equal(found, null);
});

test("la suppression d'un item étranger est silencieuse selon le comportement actuel", async () => {
  const otherReq = createReq({ user: otherUser });
  const otherCart = await cartService.getOrCreateCart(otherReq);
  const foreignItem = await models.CartItem.create({ cartId: otherCart.id, productId: activeProduct.id, qty: 1 });

  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: foreignItem.id }
  });
  const { res, nextError } = await runHandler(cartController.deleteCartItem, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  const found = await models.CartItem.findByPk(foreignItem.id);
  assert.ok(found, "l'item étranger ne doit pas être supprimé");
});

// ── saveForLater ──────────────────────────────────────────────────────────────

test("save-for-later passe l'item en savedForLater=true", async () => {
  const req = createReq({ user: customerUser });
  const cart = await cartService.getOrCreateCart(req);
  const item = await models.CartItem.create({ cartId: cart.id, productId: activeProduct.id, qty: 2, savedForLater: false });

  const sflReq = createReq({
    user: customerUser,
    method: "POST",
    params: { id: item.id }
  });
  const { res, nextError } = await runHandler(cartController.saveForLater, sflReq);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  await item.reload();
  assert.equal(item.savedForLater, true);
});

test("save-for-later sur un item étranger propage une erreur selon le comportement actuel", async () => {
  const otherReq = createReq({ user: otherUser });
  const otherCart = await cartService.getOrCreateCart(otherReq);
  const foreignItem = await models.CartItem.create({ cartId: otherCart.id, productId: activeProduct.id, qty: 1 });

  const req = createReq({
    user: customerUser,
    method: "POST",
    params: { id: foreignItem.id }
  });
  const res = createRes();
  const { nextError } = await runHandler(cartController.saveForLater, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 404);
});

// ── computeCartTotals ─────────────────────────────────────────────────────────

test("les totaux excluent les articles savedForLater selon le comportement actuel", async () => {
  const mockCart = {
    items: [
      { savedForLater: false, product: { priceWithoutDelivery: 10, weightKg: 1 }, qty: 2 },
      { savedForLater: true, product: { priceWithoutDelivery: 50, weightKg: 5 }, qty: 1 }
    ]
  };
  const totals = cartService.computeCartTotals(mockCart);
  // Item 1 : (10 + 15*1) * 2 = 50
  assert.equal(totals.subtotal, 50);
  assert.equal(totals.total, 50);
});

test("le total du panier est calculé avec la formule (prix + 15*poids) * qty", async () => {
  const mockCart = {
    items: [
      { savedForLater: false, product: { priceWithoutDelivery: 20, weightKg: 2 }, qty: 3 }
    ]
  };
  const totals = cartService.computeCartTotals(mockCart);
  // (20 + 15*2) * 3 = 50 * 3 = 150
  assert.equal(totals.subtotal, 150);
  assert.equal(totals.shippingFee, 0);
  assert.equal(totals.discountTotal, 0);
});

test("panier vide retourne des totaux à zéro", async () => {
  const totals = cartService.computeCartTotals(null);
  assert.equal(totals.subtotal, 0);
  assert.equal(totals.total, 0);
});

// ── checkout address ─────────────────────────────────────────────────────────

test("client connecté peut créer une adresse depuis checkout", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: {
      label: "Maison",
      number: "12",
      street: "Rue A",
      neighborhood: "Quartier",
      municipality: "Commune",
      city: "Kinshasa",
      country: "RDC"
    }
  });

  const { res, nextError } = await runHandler(cartController.createCheckoutAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  assert.deepEqual(req.session.flash, { type: "success", message: "Adresse ajoutee pour la commande." });

  const address = await models.Address.findOne({ where: { userId: customerUser.id, label: "Maison" } });
  assert.ok(address);
  assert.equal(address.userId, customerUser.id);
  assert.equal(address.number, "12");
  assert.equal(address.neighborhood, "Quartier");
  assert.equal(address.municipality, "Commune");
  assert.equal(address.isDefault, false);
});

test("création adresse checkout avec isDefault=1 remplace seulement le défaut du user courant", async () => {
  const existingCustomerAddress = await models.Address.create({
    userId: customerUser.id,
    label: "Ancienne",
    street: "Rue Ancienne",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });
  const otherDefaultAddress = await models.Address.create({
    userId: otherUser.id,
    label: "Autre",
    street: "Rue Autre",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: {
      label: "Nouvelle",
      street: "Rue Nouvelle",
      city: "Kinshasa",
      country: "RDC",
      isDefault: "1"
    }
  });

  const { res, nextError } = await runHandler(cartController.createCheckoutAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/cart");
  await existingCustomerAddress.reload();
  await otherDefaultAddress.reload();
  const newAddress = await models.Address.findOne({ where: { userId: customerUser.id, label: "Nouvelle" } });
  assert.equal(existingCustomerAddress.isDefault, false);
  assert.equal(otherDefaultAddress.isDefault, true);
  assert.equal(newAddress.isDefault, true);
});

test("création adresse checkout convertit les champs optionnels vides en null", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: {
      label: "Sans option",
      number: "",
      street: "Rue A",
      neighborhood: "",
      municipality: "",
      city: "Kinshasa",
      country: "RDC"
    }
  });

  const { nextError } = await runHandler(cartController.createCheckoutAddress, req);

  assert.equal(nextError, null);
  const address = await models.Address.findOne({ where: { userId: customerUser.id, label: "Sans option" } });
  assert.equal(address.number, null);
  assert.equal(address.neighborhood, null);
  assert.equal(address.municipality, null);
});

test("visiteur non connecté est redirigé pour créer une adresse checkout", async () => {
  const req = createReq({
    user: null,
    method: "POST",
    body: { label: "Maison", street: "Rue A", city: "Kinshasa", country: "RDC" }
  });

  const { res, nextError } = await runHandler(cartController.createCheckoutAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/auth/login");
  assert.deepEqual(req.session.flash, { type: "error", message: "Connectez-vous pour ajouter une adresse." });
  assert.equal(await models.Address.count(), 0);
});

test("POST /checkout/address refuse les champs requis vides via les validateurs de route", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    body: { label: "", street: "", city: "", country: "" }
  });
  const res = createRes();

  const { nextError } = await runMiddlewareChain(cartController.checkoutAddressValidators, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 422);
  assert.equal(await models.Address.count(), 0);
});

// ── auth guard ────────────────────────────────────────────────────────────────

test("un visiteur non connecté est bloqué sur les routes protégées selon le comportement actuel", async () => {
  const req = createReq({ user: null });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
});
