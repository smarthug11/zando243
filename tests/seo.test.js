const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-seo-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels } = require("../src/models");
const publicController = require("../src/controllers/publicController");

defineModels();

let models;

function createRes() {
  return {
    statusCode: 200,
    body: null,
    contentType: null,
    locals: {
      app: {
        url: "https://zando243.example"
      }
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createReq(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    method: "GET",
    originalUrl: "/sitemap.xml",
    path: "/sitemap.xml",
    requestId: "req-seo-test",
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

async function createProduct({ categoryId, name, slug, sku, status = "ACTIVE", popularityScore = 0, createdAt = new Date() }) {
  return models.Product.create({
    categoryId,
    name,
    slug,
    description: `${name} description`,
    weightKg: 0.5,
    purchasePrice: 10,
    priceWithoutDelivery: 25,
    stock: 5,
    sku,
    status,
    popularityScore,
    createdAt,
    updatedAt: createdAt
  });
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await sequelize.sync({ force: true });
});

test.after(async () => {
  await sequelize.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("GET /sitemap.xml répond en XML avec les URLs publiques de base", async () => {
  const req = createReq();
  const { res, nextError } = await runHandler(publicController.sitemap, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, "application/xml");
  assert.match(res.body, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(res.body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(res.body, /<loc>https:\/\/zando243\.example\/<\/loc>/);
  assert.match(res.body, /<loc>https:\/\/zando243\.example\/products<\/loc>/);
  assert.match(res.body, /<\/urlset>$/);
});

test("GET /sitemap.xml inclut les catégories selon la logique actuelle", async () => {
  await models.Category.create({ name: "Sacs", slug: "sacs" });
  await models.Category.create({ name: "Chaussures", slug: "chaussures" });

  const req = createReq();
  const { res, nextError } = await runHandler(publicController.sitemap, req);

  assert.equal(nextError, null);
  assert.match(res.body, /<loc>https:\/\/zando243\.example\/categories\/chaussures<\/loc>/);
  assert.match(res.body, /<loc>https:\/\/zando243\.example\/categories\/sacs<\/loc>/);
});

test("GET /sitemap.xml inclut seulement les produits actifs selon la logique catalogue actuelle", async () => {
  const category = await models.Category.create({ name: "Mode", slug: "mode" });
  await createProduct({
    categoryId: category.id,
    name: "Produit actif",
    slug: "produit-actif",
    sku: "SEO-ACTIVE",
    status: "ACTIVE"
  });
  await createProduct({
    categoryId: category.id,
    name: "Produit brouillon",
    slug: "produit-brouillon",
    sku: "SEO-DRAFT",
    status: "DRAFT"
  });

  const req = createReq();
  const { res, nextError } = await runHandler(publicController.sitemap, req);

  assert.equal(nextError, null);
  assert.match(res.body, /<loc>https:\/\/zando243\.example\/products\/produit-actif<\/loc>/);
  assert.doesNotMatch(res.body, /produit-brouillon/);
});

test("GET /sitemap.xml garde le comportement actuel avec aucune catégorie ni produit", async () => {
  const req = createReq();
  const { res, nextError } = await runHandler(publicController.sitemap, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, "application/xml");
  assert.equal(
    res.body,
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n<url><loc>https://zando243.example/</loc></url>\n<url><loc>https://zando243.example/products</loc></url>\n</urlset>"
  );
});

test("GET /robots.txt répond en texte brut avec les directives actuelles", async () => {
  const req = createReq({ originalUrl: "/robots.txt", path: "/robots.txt" });
  const { res } = await runHandler(publicController.robots, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, "text/plain");
  assert.equal(res.body, "User-agent: *\nAllow: /\nSitemap: /sitemap.xml");
});
