const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-admin-products-${process.pid}-${Date.now()}.sqlite`);

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
let categoryA;
let categoryB;

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
    originalUrl: "/admin/products",
    path: "/admin/products",
    requestId: "req-admin-products-test",
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

function productCreateBody(overrides = {}) {
  return {
    name: "Produit Créé Admin",
    description: "Description créée",
    brand: "Marque Admin",
    sku: `CREATE-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    categoryId: categoryA.id,
    priceWithoutDelivery: "50",
    purchasePrice: "20",
    weightKg: "1",
    stock: "8",
    status: "ACTIVE",
    keywords: "mode, chaussure,  promo ",
    imageUrl: "",
    ...overrides
  };
}

function productUpdateBody(overrides = {}) {
  return {
    name: "Produit Modifié Admin",
    description: "Description modifiée",
    brand: "Marque Modifiée",
    sku: `UPDATE-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    categoryId: categoryB.id,
    priceWithoutDelivery: "80",
    purchasePrice: "30",
    weightKg: "2",
    stock: "12",
    status: "INACTIVE",
    keywords: "modifie, admin,  test ",
    ...overrides
  };
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

async function createProduct(overrides = {}) {
  return models.Product.create({
    categoryId: categoryA.id,
    name: `Produit ${Date.now()} ${Math.random().toString(16).slice(2)}`,
    slug: `produit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    description: "Description produit",
    weightKg: 1,
    purchasePrice: 10,
    priceWithoutDelivery: 50,
    stock: 10,
    sku: `SKU-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    brand: "Zando",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
}

async function createProductVariant(product, overrides = {}) {
  return models.ProductVariant.create({
    productId: product.id,
    name: "Variante test",
    color: "Noir",
    size: "M",
    sku: `VAR-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    stock: 4,
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

  categoryB = await models.Category.create({ name: "Sacs", slug: "sacs" });
  categoryA = await models.Category.create({ name: "Chaussures", slug: "chaussures" });
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

test("un admin connecté peut afficher la liste admin des produits", async () => {
  await createProduct({ name: "Basket Admin", sku: "BASKET-ADMIN" });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/admin/products");
  assert.equal(res.rendered.locals.title, "Admin Produits");
  assert.equal(res.rendered.locals.products.length, 1);
  assert.equal(res.rendered.locals.products[0].name, "Basket Admin");
  assert.deepEqual(res.rendered.locals.filters, { q: "", categoryId: "", stockLte: "" });
});

test("la vue reçoit les catégories triées par nom ascendant", async () => {
  await createProduct({ name: "Produit avec catégories", sku: "PROD-CAT" });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.categories.map((category) => category.name), ["Chaussures", "Sacs"]);
});

test("les produits sont triés par date descendante avec Category, images et variants", async () => {
  const oldProduct = await createProduct({
    name: "Ancien produit",
    sku: "OLD-PRODUCT",
    createdAt: new Date("2026-04-10T10:00:00Z"),
    updatedAt: new Date("2026-04-10T10:00:00Z")
  });
  const newProduct = await createProduct({
    name: "Nouveau produit",
    sku: "NEW-PRODUCT",
    createdAt: new Date("2026-04-12T10:00:00Z"),
    updatedAt: new Date("2026-04-12T10:00:00Z")
  });
  await models.ProductImage.create({
    productId: newProduct.id,
    url: "https://cdn.example.com/new.jpg",
    isMain: true,
    position: 0
  });
  await models.ProductVariant.create({
    productId: newProduct.id,
    name: "Taille M",
    color: "Rouge",
    size: "M",
    sku: "NEW-PRODUCT-M",
    stock: 3
  });
  await models.ProductImage.create({
    productId: oldProduct.id,
    url: "https://cdn.example.com/old.jpg",
    isMain: true,
    position: 0
  });

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.productsPage, req);
  const products = res.rendered.locals.products;

  assert.equal(nextError, null);
  assert.deepEqual(products.map((product) => product.name), ["Nouveau produit", "Ancien produit"]);
  assert.equal(products[0].Category.name, "Chaussures");
  assert.equal(products[0].images.length, 1);
  assert.equal(products[0].images[0].url, "https://cdn.example.com/new.jpg");
  assert.equal(products[0].variants.length, 1);
  assert.equal(products[0].variants[0].name, "Taille M");
});

test("la recherche filtre actuellement par nom, sku ou marque", async () => {
  await createProduct({ name: "Basket Rouge", sku: "BASKET-ROUGE", brand: "Zando" });
  await createProduct({ name: "Sac Bleu", sku: "SAC-BLEU", brand: "Maison" });

  const req = createReq({ user: adminUser, query: { q: "Maison" } });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.products.map((product) => product.name), ["Sac Bleu"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "Maison", categoryId: "", stockLte: "" });
});

test("la recherche ne filtre pas par slug ou description selon le comportement actuel", async () => {
  await createProduct({
    name: "Produit visible",
    sku: "VISIBLE-001",
    brand: "Visible",
    slug: "slug-special-recherche",
    description: "Description avec mot-cache"
  });

  const slugReq = createReq({ user: adminUser, query: { q: "slug-special-recherche" } });
  const slugResult = await runHandler(adminController.productsPage, slugReq);

  const descriptionReq = createReq({ user: adminUser, query: { q: "mot-cache" } });
  const descriptionResult = await runHandler(adminController.productsPage, descriptionReq);

  assert.equal(slugResult.nextError, null);
  assert.deepEqual(slugResult.res.rendered.locals.products, []);
  assert.equal(descriptionResult.nextError, null);
  assert.deepEqual(descriptionResult.res.rendered.locals.products, []);
});

test("le filtre catégorie limite les produits à la catégorie demandée", async () => {
  await createProduct({ name: "Produit chaussures", sku: "PROD-SHOES", categoryId: categoryA.id });
  await createProduct({ name: "Produit sacs", sku: "PROD-BAGS", categoryId: categoryB.id });

  const req = createReq({ user: adminUser, query: { categoryId: categoryB.id } });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.products.map((product) => product.name), ["Produit sacs"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "", categoryId: categoryB.id, stockLte: "" });
});

test("le filtre stockLte limite les produits au stock inférieur ou égal", async () => {
  await createProduct({ name: "Stock faible", sku: "STOCK-LOW", stock: 2 });
  await createProduct({ name: "Stock haut", sku: "STOCK-HIGH", stock: 20 });

  const req = createReq({ user: adminUser, query: { stockLte: "10" } });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.products.map((product) => product.name), ["Stock faible"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "", categoryId: "", stockLte: "10" });
});

test("le paramètre status est ignoré selon le comportement actuel", async () => {
  await createProduct({ name: "Produit actif", sku: "PROD-ACTIVE", status: "ACTIVE" });
  await createProduct({ name: "Produit draft", sku: "PROD-DRAFT", status: "DRAFT" });

  const req = createReq({ user: adminUser, query: { status: "ACTIVE" } });
  const { res, nextError } = await runHandler(adminController.productsPage, req);

  assert.equal(nextError, null);
  assert.deepEqual(res.rendered.locals.products.map((product) => product.name), ["Produit draft", "Produit actif"]);
  assert.deepEqual(res.rendered.locals.filters, { q: "", categoryId: "", stockLte: "" });
});

test("la limite actuelle de 200 produits est respectée", async () => {
  for (let i = 0; i < 205; i += 1) {
    await createProduct({
      name: `Produit limite ${String(i).padStart(3, "0")}`,
      sku: `LIMIT-${String(i).padStart(3, "0")}`,
      createdAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`),
      updatedAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`)
    });
  }

  const req = createReq({ user: adminUser });
  const { res, nextError } = await runHandler(adminController.productsPage, req);
  const products = res.rendered.locals.products;

  assert.equal(nextError, null);
  assert.equal(products.length, 200);
  for (let i = 1; i < products.length; i += 1) {
    assert.ok(new Date(products[i - 1].createdAt) >= new Date(products[i].createdAt));
  }
});

test("un admin peut créer un produit avec les champs requis", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: productCreateBody({
      name: "Sneaker Admin",
      sku: "CREATE-SNEAKER-001",
      keywords: "sneaker, admin, test"
    })
  });

  const { res, nextError } = await runHandler(adminController.createProduct, req);
  const product = await models.Product.findOne({ where: { sku: "CREATE-SNEAKER-001" } });

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(product);
  assert.equal(product.name, "Sneaker Admin");
  assert.equal(product.description, "Description créée");
  assert.equal(product.brand, "Marque Admin");
  assert.equal(product.categoryId, categoryA.id);
  assert.equal(Number(product.priceWithoutDelivery), 50);
  assert.equal(Number(product.purchasePrice), 20);
  assert.equal(Number(product.weightKg), 1);
  assert.equal(product.stock, 8);
  assert.equal(product.status, "ACTIVE");
});

test("la création génère le slug et transforme les keywords selon le comportement actuel", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: productCreateBody({
      name: "Chaussure Été Test",
      sku: "CREATE-SLUG-001",
      keywords: " été, chaussure,, promo "
    })
  });

  const { nextError } = await runHandler(adminController.createProduct, req);
  const product = await models.Product.findOne({ where: { sku: "CREATE-SLUG-001" } });

  assert.equal(nextError, null);
  assert.equal(product.slug, "chaussure-ete-test");
  assert.deepEqual(product.keywords, ["été", "chaussure", "promo"]);
});

test("imageUrl HTTPS crée une image principale à la création", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: productCreateBody({
      name: "Produit Image",
      sku: "CREATE-IMAGE-001",
      imageUrl: "https://cdn.example.com/product.jpg"
    })
  });

  const { nextError } = await runHandler(adminController.createProduct, req);
  const product = await models.Product.findOne({ where: { sku: "CREATE-IMAGE-001" } });
  const image = await models.ProductImage.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.ok(image);
  assert.equal(image.url, "https://cdn.example.com/product.jpg");
  assert.equal(image.isMain, true);
  assert.equal(image.position, 0);
});

test("la création écrit un audit log produit selon le comportement actuel", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: productCreateBody({
      name: "Produit Audité",
      sku: "CREATE-AUDIT-001"
    })
  });

  const { nextError } = await runHandler(adminController.createProduct, req);
  const product = await models.Product.findOne({ where: { sku: "CREATE-AUDIT-001" } });
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_CREATE" } });

  assert.equal(nextError, null);
  assert.ok(auditLog);
  assert.equal(auditLog.category, "PRODUCT");
  assert.equal(auditLog.message, "Produit créé: Produit Audité");
  assert.equal(auditLog.actorUserId, adminUser.id);
  assert.equal(auditLog.actorEmail, adminUser.email);
  assert.equal(auditLog.requestId, "req-admin-products-test");
  assert.equal(auditLog.meta.productId, product.id);
  assert.equal(auditLog.meta.sku, "CREATE-AUDIT-001");
});

test("les champs non autorisés ne sont pas injectés lors de la création", async () => {
  const injectedId = "11111111-1111-4111-8111-111111111111";
  const req = createReq({
    user: adminUser,
    method: "POST",
    body: productCreateBody({
      id: injectedId,
      name: "Produit Protégé",
      sku: "CREATE-MASS-ASSIGNMENT-001",
      priceWithoutDelivery: "50",
      weightKg: "1",
      finalPrice: "9999",
      avgRating: "5",
      countReviews: "99",
      popularityScore: "88"
    })
  });

  const { nextError } = await runHandler(adminController.createProduct, req);
  const product = await models.Product.findOne({ where: { sku: "CREATE-MASS-ASSIGNMENT-001" } });

  assert.equal(nextError, null);
  assert.notEqual(product.id, injectedId);
  assert.equal(Number(product.finalPrice), 65);
  assert.equal(Number(product.avgRating), 0);
  assert.equal(product.countReviews, 0);
  assert.equal(product.popularityScore, 0);
});

test("un non-admin est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: customerUser, method: "GET", originalUrl: "/admin/products" });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const req = createReq({ user: null, method: "GET", originalUrl: "/admin/products" });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un non-admin est bloqué sur la création selon le comportement actuel", async () => {
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: "/admin/products",
    body: productCreateBody()
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la création selon le comportement actuel", async () => {
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: "/admin/products",
    body: productCreateBody()
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un admin peut modifier un produit existant avec les champs autorisés", async () => {
  const product = await createProduct({
    name: "Produit Original",
    sku: "UPDATE-ORIGINAL-001",
    status: "ACTIVE",
    categoryId: categoryA.id
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      name: "Produit Mis à Jour",
      sku: "UPDATE-UPDATED-001",
      status: "INACTIVE"
    })
  });

  const { res, nextError } = await runHandler(adminController.updateProduct, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(product.name, "Produit Mis à Jour");
  assert.equal(product.description, "Description modifiée");
  assert.equal(product.brand, "Marque Modifiée");
  assert.equal(product.sku, "UPDATE-UPDATED-001");
  assert.equal(product.categoryId, categoryB.id);
  assert.equal(Number(product.priceWithoutDelivery), 80);
  assert.equal(Number(product.purchasePrice), 30);
  assert.equal(Number(product.weightKg), 2);
  assert.equal(product.stock, 12);
  assert.equal(product.status, "INACTIVE");
});

test("la modification régénère le slug quand le nom change", async () => {
  const product = await createProduct({
    name: "Ancien Nom",
    slug: "ancien-nom",
    sku: "UPDATE-SLUG-001"
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      name: "Nouveau Nom Été",
      sku: "UPDATE-SLUG-001"
    })
  });

  const { nextError } = await runHandler(adminController.updateProduct, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.equal(product.slug, "nouveau-nom-ete");
});

test("si le nom reste identique, le slug reste généré depuis ce nom", async () => {
  const product = await createProduct({
    name: "Nom Stable",
    slug: "nom-stable",
    sku: "UPDATE-STABLE-001"
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      name: "Nom Stable",
      sku: "UPDATE-STABLE-001"
    })
  });

  const { nextError } = await runHandler(adminController.updateProduct, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.equal(product.slug, "nom-stable");
});

test("la modification transforme les keywords selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Keywords", sku: "UPDATE-KEYWORDS-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      name: "Produit Keywords",
      sku: "UPDATE-KEYWORDS-001",
      keywords: " été, promo,, admin "
    })
  });

  const { nextError } = await runHandler(adminController.updateProduct, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.deepEqual(product.keywords, ["été", "promo", "admin"]);
});

test("modifier un produit inexistant rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: "11111111-1111-4111-8111-111111111111" },
    body: productUpdateBody({ sku: "UPDATE-MISSING-001" })
  });

  const { res, nextError } = await runHandler(adminController.updateProduct, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Produit introuvable");
});

test("la modification écrit un audit log produit selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Audit Update", sku: "UPDATE-AUDIT-OLD" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      name: "Produit Audité Modifié",
      sku: "UPDATE-AUDIT-NEW"
    })
  });

  const { nextError } = await runHandler(adminController.updateProduct, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_UPDATE" } });

  assert.equal(nextError, null);
  assert.ok(auditLog);
  assert.equal(auditLog.category, "PRODUCT");
  assert.equal(auditLog.message, "Produit modifié: Produit Audité Modifié");
  assert.equal(auditLog.actorUserId, adminUser.id);
  assert.equal(auditLog.actorEmail, adminUser.email);
  assert.equal(auditLog.requestId, "req-admin-products-test");
  assert.equal(auditLog.meta.productId, product.id);
  assert.equal(auditLog.meta.sku, "UPDATE-AUDIT-NEW");
});

test("les champs non autorisés ne sont pas injectés lors de la modification", async () => {
  const originalCreatedAt = new Date("2026-04-01T10:00:00Z");
  const originalUpdatedAt = new Date("2026-04-01T10:00:00Z");
  const product = await createProduct({
    name: "Produit Protégé Update",
    sku: "UPDATE-MASS-OLD",
    avgRating: 2,
    countReviews: 3,
    popularityScore: 4,
    createdAt: originalCreatedAt,
    updatedAt: originalUpdatedAt
  });
  const originalId = product.id;
  const req = createReq({
    user: adminUser,
    method: "POST",
    params: { id: product.id },
    body: productUpdateBody({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Produit Protégé Modifié",
      sku: "UPDATE-MASS-NEW",
      priceWithoutDelivery: "80",
      weightKg: "2",
      finalPrice: "9999",
      avgRating: "5",
      countReviews: "99",
      popularityScore: "88",
      createdAt: "2030-01-01T00:00:00Z",
      updatedAt: "2030-01-01T00:00:00Z"
    })
  });

  const { nextError } = await runHandler(adminController.updateProduct, req);
  await product.reload();

  assert.equal(nextError, null);
  assert.equal(product.id, originalId);
  assert.equal(Number(product.finalPrice), 65);
  assert.equal(Number(product.avgRating), 2);
  assert.equal(product.countReviews, 3);
  assert.equal(product.popularityScore, 4);
  assert.equal(product.createdAt.toISOString(), originalCreatedAt.toISOString());
  assert.notEqual(product.updatedAt.toISOString(), "2030-01-01T00:00:00.000Z");
});

test("un non-admin est bloqué sur la modification selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Blocage Update", sku: "UPDATE-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}`,
    params: { id: product.id },
    body: productUpdateBody({ sku: "UPDATE-BLOCK-NEW" })
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la modification selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Auth Update", sku: "UPDATE-AUTH-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}`,
    params: { id: product.id },
    body: productUpdateBody({ sku: "UPDATE-AUTH-NEW" })
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un admin peut supprimer un produit existant selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit à Supprimer", sku: "DELETE-EXISTING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/delete`,
    params: { id: product.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProduct, req);
  const defaultLookup = await models.Product.findByPk(product.id);
  const paranoidLookup = await models.Product.findByPk(product.id, { paranoid: false });

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(defaultLookup, null);
  assert.ok(paranoidLookup);
  assert.ok(paranoidLookup.deletedAt);
});

test("la suppression produit conserve le redirect actuel", async () => {
  const product = await createProduct({ name: "Produit Redirect Delete", sku: "DELETE-REDIRECT-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/delete`,
    params: { id: product.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProduct, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.redirectTo, "/admin/products");
});

test("supprimer un produit inexistant redirige et audite selon le comportement actuel", async () => {
  const missingProductId = "11111111-1111-4111-8111-111111111111";
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${missingProductId}/delete`,
    params: { id: missingProductId }
  });

  const { res, nextError } = await runHandler(adminController.deleteProduct, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_DELETE" } });

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(auditLog);
  assert.equal(auditLog.category, "PRODUCT");
  assert.equal(auditLog.message, `Produit supprimé: ${missingProductId}`);
  assert.equal(auditLog.meta.productId, missingProductId);
});

test("la suppression écrit un audit log produit selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Audit Delete", sku: "DELETE-AUDIT-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/delete`,
    params: { id: product.id }
  });

  const { nextError } = await runHandler(adminController.deleteProduct, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_DELETE" } });

  assert.equal(nextError, null);
  assert.ok(auditLog);
  assert.equal(auditLog.category, "PRODUCT");
  assert.equal(auditLog.message, "Produit supprimé: Produit Audit Delete");
  assert.equal(auditLog.actorUserId, adminUser.id);
  assert.equal(auditLog.actorEmail, adminUser.email);
  assert.equal(auditLog.requestId, "req-admin-products-test");
  assert.equal(auditLog.meta.productId, product.id);
});

test("un non-admin est bloqué sur la suppression selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Blocage Delete", sku: "DELETE-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/delete`,
    params: { id: product.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la suppression selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Auth Delete", sku: "DELETE-AUTH-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/delete`,
    params: { id: product.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un admin peut ajouter une image HTTPS à un produit existant", async () => {
  const product = await createProduct({ name: "Produit Image", sku: "IMAGE-ADD-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: {
      url: "https://cdn.example.com/produit.jpg",
      isMain: "1",
      position: "3"
    }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);
  const image = await models.ProductImage.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(image);
  assert.equal(image.productId, product.id);
  assert.equal(image.url, "https://cdn.example.com/produit.jpg");
  assert.equal(image.variantId, null);
  assert.equal(image.isMain, true);
  assert.equal(image.position, 3);
});

test("l'ajout d'image persiste variantId selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Variante", sku: "IMAGE-VARIANT-001" });
  const variant = await createProductVariant(product, { sku: "IMAGE-VARIANT-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: {
      url: "https://cdn.example.com/variant.jpg",
      variantId: variant.id,
      position: "2"
    }
  });

  const { nextError } = await runHandler(adminController.addProductImage, req);
  const image = await models.ProductImage.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(image.variantId, variant.id);
  assert.equal(image.isMain, false);
  assert.equal(image.position, 2);
});

test("l'ajout d'image principale désactive les images principales existantes", async () => {
  const product = await createProduct({ name: "Produit Image Principale", sku: "IMAGE-MAIN-001" });
  const firstImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/ancienne.jpg",
    isMain: true,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: {
      url: "https://cdn.example.com/nouvelle.jpg",
      isMain: "1",
      position: "4"
    }
  });

  const { nextError } = await runHandler(adminController.addProductImage, req);
  await firstImage.reload();
  const newImage = await models.ProductImage.findOne({ where: { productId: product.id, url: "https://cdn.example.com/nouvelle.jpg" } });

  assert.equal(nextError, null);
  assert.equal(firstImage.isMain, false);
  assert.equal(newImage.isMain, true);
});

test("ajouter une image à un produit inexistant rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/products/11111111-1111-4111-8111-111111111111/images",
    params: { id: "11111111-1111-4111-8111-111111111111" },
    body: {
      url: "https://cdn.example.com/missing.jpg"
    }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Produit introuvable");
});

test("ajouter une image avec une variante introuvable rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Variante Missing", sku: "IMAGE-VARIANT-MISSING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: {
      url: "https://cdn.example.com/variant-missing.jpg",
      variantId: "11111111-1111-4111-8111-111111111111"
    }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);
  const imageCount = await models.ProductImage.count({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Variante introuvable");
  assert.equal(imageCount, 0);
});

test("l'ajout d'image refuse les URLs javascript selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image JS", sku: "IMAGE-JS-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: { url: "javascript:alert(1)" }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);
  const imageCount = await models.ProductImage.count({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(res.rendered.locals.error.message, "L'URL de l'image doit commencer par https://");
  assert.equal(imageCount, 0);
});

test("l'ajout d'image refuse les URLs data selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Data", sku: "IMAGE-DATA-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: { url: "data:image/png;base64,AAAA" }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);
  const imageCount = await models.ProductImage.count({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(imageCount, 0);
});

test("l'ajout d'image refuse les URLs http selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image HTTP", sku: "IMAGE-HTTP-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: { url: "http://cdn.example.com/image.jpg" }
  });

  const { res, nextError } = await runHandler(adminController.addProductImage, req);
  const imageCount = await models.ProductImage.count({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(imageCount, 0);
});

test("un non-admin est bloqué sur l'ajout d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Blocage", sku: "IMAGE-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: { url: "https://cdn.example.com/blocked.jpg" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur l'ajout d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Auth", sku: "IMAGE-AUTH-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images`,
    params: { id: product.id },
    body: { url: "https://cdn.example.com/auth.jpg" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});

test("un admin peut modifier une image existante avec une URL HTTPS valide", async () => {
  const product = await createProduct({ name: "Produit Image Update", sku: "IMAGE-UPDATE-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/ancienne-update.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: {
      url: "https://cdn.example.com/nouvelle-update.jpg",
      isMain: "1",
      position: "7"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(image.productId, product.id);
  assert.equal(image.url, "https://cdn.example.com/nouvelle-update.jpg");
  assert.equal(image.variantId, null);
  assert.equal(image.isMain, true);
  assert.equal(image.position, 7);
});

test("la modification d'image conserve l'URL actuelle si aucune URL n'est fournie", async () => {
  const product = await createProduct({ name: "Produit Image URL Stable", sku: "IMAGE-URL-STABLE-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/stable.jpg",
    isMain: true,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: {
      position: "5"
    }
  });

  const { nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(image.url, "https://cdn.example.com/stable.jpg");
  assert.equal(image.isMain, false);
  assert.equal(image.position, 5);
});

test("la modification d'image met à jour variantId selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Update Variante", sku: "IMAGE-UPDATE-VARIANT-001" });
  const variant = await createProductVariant(product, { sku: "IMAGE-UPDATE-VARIANT-SKU-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/variant-update.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: {
      variantId: variant.id,
      position: "9"
    }
  });

  const { nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(image.variantId, variant.id);
  assert.equal(image.position, 9);
});

test("la modification d'image principale désactive les autres images principales du produit", async () => {
  const product = await createProduct({ name: "Produit Image Update Principale", sku: "IMAGE-UPDATE-MAIN-001" });
  const firstImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/main-old.jpg",
    isMain: true,
    position: 1
  });
  const secondImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/main-new.jpg",
    isMain: false,
    position: 2
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${secondImage.id}`,
    params: { id: product.id, imageId: secondImage.id },
    body: {
      isMain: "1"
    }
  });

  const { nextError } = await runHandler(adminController.updateProductImage, req);
  await firstImage.reload();
  await secondImage.reload();

  assert.equal(nextError, null);
  assert.equal(firstImage.isMain, false);
  assert.equal(secondImage.isMain, true);
});

test("modifier une image avec un produit inexistant rend le 404 image actuel", async () => {
  const product = await createProduct({ name: "Produit Image Missing Product", sku: "IMAGE-MISSING-PRODUCT-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/missing-product.jpg",
    isMain: false,
    position: 1
  });
  const missingProductId = "11111111-1111-4111-8111-111111111111";
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${missingProductId}/images/${image.id}`,
    params: { id: missingProductId, imageId: image.id },
    body: {
      url: "https://cdn.example.com/ignored.jpg"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Image introuvable");
});

test("modifier une image inexistante rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Missing", sku: "IMAGE-MISSING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/11111111-1111-4111-8111-111111111111`,
    params: { id: product.id, imageId: "11111111-1111-4111-8111-111111111111" },
    body: {
      url: "https://cdn.example.com/missing-image.jpg"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Image introuvable");
});

test("modifier une image appartenant à un autre produit rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Owner", sku: "IMAGE-OWNER-001" });
  const otherProduct = await createProduct({ name: "Produit Image Other Owner", sku: "IMAGE-OWNER-OTHER-001" });
  const image = await models.ProductImage.create({
    productId: otherProduct.id,
    url: "https://cdn.example.com/other-owner.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: {
      url: "https://cdn.example.com/should-not-update.jpg"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Image introuvable");
  assert.equal(image.url, "https://cdn.example.com/other-owner.jpg");
});

test("modifier une image avec une variante introuvable rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Update Variante Missing", sku: "IMAGE-UPDATE-VARIANT-MISSING-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/variant-missing-update.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: {
      variantId: "11111111-1111-4111-8111-111111111111"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Variante introuvable");
  assert.equal(image.variantId, null);
});

test("la modification d'image refuse les URLs javascript selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Update JS", sku: "IMAGE-UPDATE-JS-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/js-old.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: { url: "javascript:alert(1)" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(res.rendered.locals.error.message, "L'URL de l'image doit commencer par https://");
  assert.equal(image.url, "https://cdn.example.com/js-old.jpg");
});

test("la modification d'image refuse les URLs data selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Update Data", sku: "IMAGE-UPDATE-DATA-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/data-old.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: { url: "data:image/png;base64,AAAA" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(image.url, "https://cdn.example.com/data-old.jpg");
});

test("la modification d'image refuse les URLs http selon la validation HTTPS actuelle", async () => {
  const product = await createProduct({ name: "Produit Image Update HTTP", sku: "IMAGE-UPDATE-HTTP-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/http-old.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: { url: "http://cdn.example.com/http-new.jpg" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductImage, req);
  await image.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.equal(res.rendered.locals.title, "URL invalide");
  assert.equal(image.url, "https://cdn.example.com/http-old.jpg");
});

test("un non-admin est bloqué sur la modification d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Update Blocage", sku: "IMAGE-UPDATE-BLOCK-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/update-blocked.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: { url: "https://cdn.example.com/update-blocked-new.jpg" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la modification d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Update Auth", sku: "IMAGE-UPDATE-AUTH-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/update-auth.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}`,
    params: { id: product.id, imageId: image.id },
    body: { url: "https://cdn.example.com/update-auth-new.jpg" }
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
// deleteProductImage
// ============================================================

test("un admin peut supprimer une image existante du bon produit", async () => {
  const product = await createProduct({ name: "Produit Image Delete", sku: "IMAGE-DEL-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/to-delete.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}/delete`,
    params: { id: product.id, imageId: image.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductImage, req);
  const found = await models.ProductImage.findByPk(image.id);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(found, null);
});

test("supprimer l'image principale promeut la première image restante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Delete Main", sku: "IMAGE-DEL-MAIN-001" });
  const mainImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/main-del.jpg",
    isMain: true,
    position: 0
  });
  const secondImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/second-del.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${mainImage.id}/delete`,
    params: { id: product.id, imageId: mainImage.id }
  });

  const { nextError } = await runHandler(adminController.deleteProductImage, req);
  await secondImage.reload();

  assert.equal(nextError, null);
  assert.equal(secondImage.isMain, true);
});

test("supprimer une image non principale ne modifie pas l'image principale existante", async () => {
  const product = await createProduct({ name: "Produit Image Delete Non-Main", sku: "IMAGE-DEL-NONMAIN-001" });
  const mainImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/keep-main-del.jpg",
    isMain: true,
    position: 0
  });
  const otherImage = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/delete-non-main.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${otherImage.id}/delete`,
    params: { id: product.id, imageId: otherImage.id }
  });

  const { nextError } = await runHandler(adminController.deleteProductImage, req);
  await mainImage.reload();

  assert.equal(nextError, null);
  assert.equal(mainImage.isMain, true);
});

test("produit inexistant pour deleteProductImage redirige sans erreur selon le comportement actuel (permissif)", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/products/11111111-1111-4111-8111-111111111111/images/22222222-2222-4222-8222-222222222222/delete",
    params: { id: "11111111-1111-4111-8111-111111111111", imageId: "22222222-2222-4222-8222-222222222222" }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductImage, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
});

test("image inexistante pour deleteProductImage redirige sans erreur selon le comportement actuel (permissif)", async () => {
  const product = await createProduct({ name: "Produit Image Delete Missing", sku: "IMAGE-DEL-MISSING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/11111111-1111-4111-8111-111111111111/delete`,
    params: { id: product.id, imageId: "11111111-1111-4111-8111-111111111111" }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductImage, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
});

test("image appartenant à un autre produit n'est pas supprimée et redirige selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Delete Owner", sku: "IMAGE-DEL-OWNER-001" });
  const otherProduct = await createProduct({ name: "Produit Image Delete Other", sku: "IMAGE-DEL-OWNER-OTHER-001" });
  const image = await models.ProductImage.create({
    productId: otherProduct.id,
    url: "https://cdn.example.com/other-del.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}/delete`,
    params: { id: product.id, imageId: image.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductImage, req);
  const found = await models.ProductImage.findByPk(image.id);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(found);
});

test("deleteProductImage n'écrit pas d'audit log selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Delete Audit", sku: "IMAGE-DEL-AUDIT-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/audit-del.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}/delete`,
    params: { id: product.id, imageId: image.id }
  });

  const { nextError } = await runHandler(adminController.deleteProductImage, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_IMAGE_DELETE" } });

  assert.equal(nextError, null);
  assert.equal(auditLog, null);
});

test("un non-admin est bloqué sur la suppression d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Delete Block", sku: "IMAGE-DEL-BLOCK-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/del-blocked.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}/delete`,
    params: { id: product.id, imageId: image.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la suppression d'image selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Image Delete Auth", sku: "IMAGE-DEL-AUTH-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    url: "https://cdn.example.com/del-auth.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/images/${image.id}/delete`,
    params: { id: product.id, imageId: image.id }
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
// addProductVariant
// ============================================================

test("un admin peut ajouter une variante à un produit existant", async () => {
  const product = await createProduct({ name: "Produit Variante Add", sku: "VARIANT-ADD-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: {
      name: "Taille L Rouge",
      color: "Rouge",
      size: "L",
      sku: "VARIANT-ADD-001-L-ROUGE",
      stock: "5"
    }
  });

  const { res, nextError } = await runHandler(adminController.addProductVariant, req);
  const variant = await models.ProductVariant.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(variant);
  assert.equal(variant.productId, product.id);
  assert.equal(variant.name, "Taille L Rouge");
  assert.equal(variant.color, "Rouge");
  assert.equal(variant.size, "L");
  assert.equal(variant.sku, "VARIANT-ADD-001-L-ROUGE");
  assert.equal(variant.stock, 5);
});

test("les champs color, size et sku sont null si absents selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Add Null", sku: "VARIANT-ADD-NULL-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: { name: "Sans options", color: "", size: "", sku: "" }
  });

  const { nextError } = await runHandler(adminController.addProductVariant, req);
  const variant = await models.ProductVariant.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(variant.color, null);
  assert.equal(variant.size, null);
  assert.equal(variant.sku, null);
});

test("le stock est 0 par défaut si non fourni selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Add Stock Default", sku: "VARIANT-ADD-STOCK-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: { name: "Variante sans stock" }
  });

  const { nextError } = await runHandler(adminController.addProductVariant, req);
  const variant = await models.ProductVariant.findOne({ where: { productId: product.id } });

  assert.equal(nextError, null);
  assert.equal(variant.stock, 0);
});

test("ajouter une variante à un produit inexistant rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/products/11111111-1111-4111-8111-111111111111/variants",
    params: { id: "11111111-1111-4111-8111-111111111111" },
    body: { name: "Variante orpheline", stock: "3" }
  });

  const { res, nextError } = await runHandler(adminController.addProductVariant, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Produit introuvable");
});

test("addProductVariant n'écrit pas d'audit log selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Add Audit", sku: "VARIANT-ADD-AUDIT-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: { name: "Variante auditée", stock: "1" }
  });

  const { nextError } = await runHandler(adminController.addProductVariant, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_VARIANT_CREATE" } });

  assert.equal(nextError, null);
  assert.equal(auditLog, null);
});

test("un non-admin est bloqué sur l'ajout de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Add Block", sku: "VARIANT-ADD-BLOCK-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: { name: "Variante bloquée", stock: "1" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur l'ajout de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Add Auth", sku: "VARIANT-ADD-AUTH-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants`,
    params: { id: product.id },
    body: { name: "Variante non auth", stock: "1" }
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
// updateProductVariant
// ============================================================

test("un admin peut modifier une variante existante du bon produit", async () => {
  const product = await createProduct({ name: "Produit Variante Update", sku: "VARIANT-UPD-001" });
  const variant = await createProductVariant(product, {
    name: "Ancienne variante",
    color: "Blanc",
    size: "S",
    sku: "VARIANT-UPD-SKU-001",
    stock: 3
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: {
      name: "Nouvelle variante",
      color: "Noir",
      size: "XL",
      sku: "VARIANT-UPD-SKU-NEW-001",
      stock: "10"
    }
  });

  const { res, nextError } = await runHandler(adminController.updateProductVariant, req);
  await variant.reload();

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(variant.name, "Nouvelle variante");
  assert.equal(variant.color, "Noir");
  assert.equal(variant.size, "XL");
  assert.equal(variant.sku, "VARIANT-UPD-SKU-NEW-001");
  assert.equal(variant.stock, 10);
});

test("le nom reste celui de la variante si non fourni dans le body selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Update Name", sku: "VARIANT-UPD-NAME-001" });
  const variant = await createProductVariant(product, { name: "Nom Stable", sku: "VARIANT-UPD-NAME-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { stock: "7" }
  });

  const { nextError } = await runHandler(adminController.updateProductVariant, req);
  await variant.reload();

  assert.equal(nextError, null);
  assert.equal(variant.name, "Nom Stable");
  assert.equal(variant.stock, 7);
});

test("color, size, sku sont mis à null si falsy dans le body selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Update Null", sku: "VARIANT-UPD-NULL-001" });
  const variant = await createProductVariant(product, {
    name: "Variante avec options",
    color: "Vert",
    size: "M",
    sku: "VARIANT-UPD-NULL-SKU-001",
    stock: 2
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { name: "Variante sans options", color: "", size: "", sku: "" }
  });

  const { nextError } = await runHandler(adminController.updateProductVariant, req);
  await variant.reload();

  assert.equal(nextError, null);
  assert.equal(variant.color, null);
  assert.equal(variant.size, null);
  assert.equal(variant.sku, null);
});

test("variante inexistante pour updateProductVariant rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Variante Update Missing", sku: "VARIANT-UPD-MISSING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/11111111-1111-4111-8111-111111111111`,
    params: { id: product.id, variantId: "11111111-1111-4111-8111-111111111111" },
    body: { name: "Variante fantôme", stock: "1" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductVariant, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Variante introuvable");
});

test("produit inexistant pour updateProductVariant rend la page 404 actuelle", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/products/11111111-1111-4111-8111-111111111111/variants/22222222-2222-4222-8222-222222222222",
    params: { id: "11111111-1111-4111-8111-111111111111", variantId: "22222222-2222-4222-8222-222222222222" },
    body: { name: "Variante fantôme", stock: "1" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductVariant, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Variante introuvable");
});

test("variante appartenant à un autre produit rend la page 404 actuelle", async () => {
  const product = await createProduct({ name: "Produit Variante Update Owner", sku: "VARIANT-UPD-OWNER-001" });
  const otherProduct = await createProduct({ name: "Produit Variante Update Other", sku: "VARIANT-UPD-OWNER-OTHER-001" });
  const variant = await createProductVariant(otherProduct, { name: "Variante test", sku: "VARIANT-UPD-OWNER-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { name: "Tentative hijack", stock: "99" }
  });

  const { res, nextError } = await runHandler(adminController.updateProductVariant, req);
  await variant.reload();

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Variante introuvable");
  assert.equal(variant.name, "Variante test");
});

test("updateProductVariant n'écrit pas d'audit log selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Update Audit", sku: "VARIANT-UPD-AUDIT-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-UPD-AUDIT-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { name: "Variante auditée", stock: "2" }
  });

  const { nextError } = await runHandler(adminController.updateProductVariant, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_VARIANT_UPDATE" } });

  assert.equal(nextError, null);
  assert.equal(auditLog, null);
});

test("un non-admin est bloqué sur la modification de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Update Block", sku: "VARIANT-UPD-BLOCK-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-UPD-BLOCK-SKU-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { name: "Blocage", stock: "1" }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la modification de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Update Auth", sku: "VARIANT-UPD-AUTH-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-UPD-AUTH-SKU-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}`,
    params: { id: product.id, variantId: variant.id },
    body: { name: "Non auth", stock: "1" }
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
// deleteProductVariant
// ============================================================

test("un admin peut supprimer une variante existante du bon produit", async () => {
  const product = await createProduct({ name: "Produit Variante Delete", sku: "VARIANT-DEL-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-DEL-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductVariant, req);
  const found = await models.ProductVariant.findByPk(variant.id);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.equal(found, null);
});

test("produit inexistant pour deleteProductVariant redirige sans erreur selon le comportement actuel (permissif)", async () => {
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: "/admin/products/11111111-1111-4111-8111-111111111111/variants/22222222-2222-4222-8222-222222222222/delete",
    params: { id: "11111111-1111-4111-8111-111111111111", variantId: "22222222-2222-4222-8222-222222222222" }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductVariant, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
});

test("variante inexistante pour deleteProductVariant redirige sans erreur selon le comportement actuel (permissif)", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Missing", sku: "VARIANT-DEL-MISSING-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/11111111-1111-4111-8111-111111111111/delete`,
    params: { id: product.id, variantId: "11111111-1111-4111-8111-111111111111" }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductVariant, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
});

test("variante appartenant à un autre produit n'est pas supprimée selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Owner", sku: "VARIANT-DEL-OWNER-001" });
  const otherProduct = await createProduct({ name: "Produit Variante Delete Other", sku: "VARIANT-DEL-OWNER-OTHER-001" });
  const variant = await createProductVariant(otherProduct, { sku: "VARIANT-DEL-OWNER-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });

  const { res, nextError } = await runHandler(adminController.deleteProductVariant, req);
  const found = await models.ProductVariant.findByPk(variant.id);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/admin/products");
  assert.ok(found);
});

test("les images liées à la variante supprimée sont supprimées en cascade selon le comportement actuel (SQLite ON DELETE CASCADE)", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Images", sku: "VARIANT-DEL-IMGS-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-DEL-IMGS-SKU-001" });
  const image = await models.ProductImage.create({
    productId: product.id,
    variantId: variant.id,
    url: "https://cdn.example.com/variant-image-orphan.jpg",
    isMain: false,
    position: 1
  });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });

  const { nextError } = await runHandler(adminController.deleteProductVariant, req);
  const foundVariant = await models.ProductVariant.findByPk(variant.id);
  const foundImage = await models.ProductImage.findByPk(image.id);

  assert.equal(nextError, null);
  assert.equal(foundVariant, null);
  // En SQLite test (sync force:true), Sequelize génère ON DELETE CASCADE/SET NULL sur variantId
  // → l'image est supprimée ou variantId mis à null. Comportement verrouillé : image absente.
  assert.equal(foundImage, null);
});

test("deleteProductVariant n'écrit pas d'audit log selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Audit", sku: "VARIANT-DEL-AUDIT-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-DEL-AUDIT-SKU-001" });
  const req = createReq({
    user: adminUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });

  const { nextError } = await runHandler(adminController.deleteProductVariant, req);
  const auditLog = await models.AuditLog.findOne({ where: { action: "ADMIN_PRODUCT_VARIANT_DELETE" } });

  assert.equal(nextError, null);
  assert.equal(auditLog, null);
});

test("un non-admin est bloqué sur la suppression de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Block", sku: "VARIANT-DEL-BLOCK-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-DEL-BLOCK-SKU-001" });
  const req = createReq({
    user: customerUser,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireRole("ADMIN"), req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Accès refusé/);
});

test("un visiteur non connecté est bloqué sur la suppression de variante selon le comportement actuel", async () => {
  const product = await createProduct({ name: "Produit Variante Delete Auth", sku: "VARIANT-DEL-AUTH-001" });
  const variant = await createProductVariant(product, { sku: "VARIANT-DEL-AUTH-SKU-001" });
  const req = createReq({
    user: null,
    method: "POST",
    originalUrl: `/admin/products/${product.id}/variants/${variant.id}/delete`,
    params: { id: product.id, variantId: variant.id }
  });
  const res = createRes();

  const { nextError } = await runHandler(requireAuth, req, res);

  assert.ok(nextError);
  errorHandler(nextError, req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.rendered.view, "pages/errors/error");
  assert.match(res.rendered.locals.error.message, /Authentification requise/);
});
