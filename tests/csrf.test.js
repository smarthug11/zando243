const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

process.env.BETTER_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "test_better_auth_secret_at_least_32_chars_long_xx";
process.env.BETTER_AUTH_URL = "http://127.0.0.1";
process.env.CSRF_ENABLED = "true";
require("./_setup-test-db");

const { sequelize, defineModels } = require("../src/models");
defineModels();

let server;
let baseUrl;

function buildJar() {
  const jar = [];
  return {
    headerValue() { return jar.join("; "); },
    absorb(setCookieArr) {
      for (const c of setCookieArr || []) {
        if (!c) continue;
        const head = c.split(";")[0];
        const name = head.split("=")[0];
        const idx = jar.findIndex((e) => e.startsWith(name + "="));
        if (idx >= 0) jar[idx] = head;
        else jar.push(head);
      }
    }
  };
}

async function startServer() {
  const app = require("../app");
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => server.close(resolve));
}

function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, "token CSRF attendu dans le formulaire SSR");
  return match[1];
}

async function get(pathname, jar) {
  const headers = {};
  if (jar.headerValue()) headers.cookie = jar.headerValue();
  const res = await fetch(`${baseUrl}${pathname}`, { headers, redirect: "manual" });
  jar.absorb(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
  return { status: res.status, text: await res.text() };
}

async function postForm(pathname, body, jar) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (jar.headerValue()) headers.cookie = jar.headerValue();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) params.append(key, String(value));
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: params.toString(),
    redirect: "manual"
  });
  jar.absorb(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});

test.after(async () => {
  await stopServer();
});

test("GET /auth2/login puis POST immédiat en session neuve ne renvoie pas 403", async () => {
  const jar = buildJar();
  const page = await get("/auth2/login", jar);
  assert.equal(page.status, 200);

  const res = await postForm("/auth2/login", {
    _csrf: extractCsrf(page.text),
    email: "ghost@example.com",
    password: "Password123!Ghost"
  }, jar);

  assert.equal(res.status, 302);
  assert.equal(res.location, "/auth2/login");
});

test("GET /products puis POST add-to-cart en session neuve ne renvoie pas 403", async () => {
  const models = defineModels();
  const category = await models.Category.create({ name: "CSRF", slug: "csrf" });
  const product = await models.Product.create({
    categoryId: category.id,
    name: "Produit CSRF",
    description: "Produit test CSRF",
    sku: "CSRF-ADD",
    priceWithoutDelivery: 10,
    weightKg: 1,
    stock: 5,
    status: "ACTIVE"
  });

  const jar = buildJar();
  const page = await get("/products", jar);
  assert.equal(page.status, 200);

  const res = await postForm("/cart/items", {
    _csrf: extractCsrf(page.text),
    productId: product.id,
    qty: 1
  }, jar);

  assert.equal(res.status, 302);
  assert.notEqual(res.status, 403);
});
