const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const http = require("http");


process.env.BETTER_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "test_better_auth_secret_at_least_32_chars_long_xx";
process.env.BETTER_AUTH_URL = "http://127.0.0.1";
require("./_setup-test-db");
const { sequelize, defineModels } = require("../src/models");
defineModels();

let server, baseUrl;

async function startServer() {
  const app = require("../app");
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}
function stopServer() { return new Promise((r) => server.close(() => r())); }

async function form(urlPath, body, cookieJar = []) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (cookieJar.length) headers.cookie = cookieJar.join("; ");
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body || {})) params.append(k, v == null ? "" : String(v));
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST", headers, body: params.toString(), redirect: "manual"
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const head = c.split(";")[0];
    const name = head.split("=")[0];
    const idx = cookieJar.findIndex((existing) => existing.startsWith(name + "="));
    if (idx >= 0) cookieJar[idx] = head; else cookieJar.push(head);
  }
  return { status: res.status, location: res.headers.get("location"), cookieJar };
}

async function get(urlPath, cookieJar = []) {
  const headers = {};
  if (cookieJar.length) headers.cookie = cookieJar.join("; ");
  const res = await fetch(`${baseUrl}${urlPath}`, { headers, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});
test.after(async () => { await stopServer(); });

test("GET /auth2/login affiche la page si flag ON", async () => {
  const r = await get("/auth2/login");
  assert.equal(r.status, 200);
});

test("POST /auth2/register crée user Better Auth + user Sequelize et pose cookie session", async () => {
  const email = `ssr-register-${Date.now()}@example.com`;
  const jar = [];
  const r = await form("/auth2/register", {
    firstName: "Ssr", lastName: "Register", email,
    password: "Password123!Ssr", phone: "+243"
  }, jar);
  assert.equal(r.status, 302, `expected redirect, got ${r.status}`);
  assert.equal(r.location, "/");

  const sessionCookie = jar.find((c) => c.startsWith("better-auth.session_token="));
  assert.ok(sessionCookie, "session cookie attendu après register SSR");

  const models = defineModels();
  const u = await models.User.findOne({ where: { email } });
  assert.ok(u, "users miroir attendu");
  assert.equal(u.firstName, "Ssr");
  assert.equal(u.role, "CUSTOMER");
});

test("POST /auth2/login avec mauvais mot de passe redirige vers /auth2/login avec flash error", async () => {
  const email = `ssr-badpw-${Date.now()}@example.com`;
  const jar = [];
  await form("/auth2/register", { firstName: "X", lastName: "Y", email, password: "Password123!Ssr" }, jar);
  // logout d'abord (le register pose une session)
  const jarLogout = [...jar];
  await form("/auth2/logout", {}, jarLogout);
  // nouveau jar vide simulant un visiteur
  const r = await form("/auth2/login", { email, password: "WrongPwOhYes" }, []);
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/login");
});

test("POST /auth2/login après register : merge guest cart vers user", async () => {
  // 1) sign-up Better Auth (sans utiliser SSR pour avoir une session propre)
  const email = `ssr-merge-${Date.now()}@example.com`;
  const password = "Password123!Merge";
  const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "Merge T", firstName: "Merge", lastName: "T" })
  });
  const signupBody = await signupRes.json();
  assert.equal(signupRes.status, 200);
  const userId = signupBody.user.id;
  // se déconnecter
  const setCookies = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [];
  const initialSession = setCookies.find((c) => c.startsWith("better-auth.session_token="))?.split(";")[0];
  await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: "POST", headers: { "content-type": "application/json", cookie: initialSession }, body: "{}"
  });

  // 2) visiteur : pose un panier invité via interaction directe
  const models = defineModels();
  // créer un produit + un panier guest via cookies sid via session express
  const category = await models.Category.create({ name: "MergeCat", slug: `mergecat-${Date.now()}` });
  const product = await models.Product.create({
    categoryId: category.id, name: "MergeProd", slug: `mergeprod-${Date.now()}`,
    description: "x", sku: `SKU-MERGE-${Date.now()}`, priceWithoutDelivery: 10, weightKg: 1, stock: 5, status: "ACTIVE"
  });
  // démarrer une session express invitée
  const visitorJar = [];
  const home = await fetch(`${baseUrl}/`, { redirect: "manual" });
  const homeCookies = home.headers.getSetCookie ? home.headers.getSetCookie() : [];
  for (const c of homeCookies) visitorJar.push(c.split(";")[0]);

  // ajouter au panier (guest)
  await form("/cart/items", { productId: product.id, qty: 2 }, visitorJar);

  // vérifier qu'un Cart guest existe
  const guestCart = await models.Cart.findOne({ where: { userId: null } });
  assert.ok(guestCart, "cart guest doit exister");

  // 3) login Better Auth via SSR (avec le même cookie de session express)
  const loginRes = await form("/auth2/login", { email, password }, visitorJar);
  assert.equal(loginRes.status, 302);
  assert.equal(loginRes.location, "/");

  // 4) vérifier que le cart guest est merge
  const userCart = await models.Cart.findOne({ where: { userId } });
  assert.ok(userCart, "cart user doit exister après merge");
  const userItems = await models.CartItem.findAll({ where: { cartId: userCart.id } });
  assert.equal(userItems.length, 1);
  assert.equal(Number(userItems[0].qty), 2);
});
