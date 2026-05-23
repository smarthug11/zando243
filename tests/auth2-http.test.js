const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

process.env.BETTER_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "test_better_auth_secret_at_least_32_chars_long_xx";
process.env.BETTER_AUTH_URL = "http://127.0.0.1";
process.env.CSRF_ENABLED = "false";
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

function buildJar() {
  const jar = [];
  return {
    cookies: jar,
    headerValue() { return jar.join("; "); },
    absorb(setCookieArr) {
      for (const c of setCookieArr || []) {
        if (!c) continue;
        const head = c.split(";")[0];
        const name = head.split("=")[0];
        const idx = jar.findIndex((e) => e.startsWith(name + "="));
        if (idx >= 0) jar[idx] = head; else jar.push(head);
      }
    },
    has(name) { return jar.some((c) => c.startsWith(name + "=")); },
    get(name) {
      const c = jar.find((x) => x.startsWith(name + "="));
      return c ? c.split("=").slice(1).join("=") : null;
    }
  };
}

async function form(urlPath, body, jar) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (jar && jar.headerValue()) headers.cookie = jar.headerValue();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body || {})) params.append(k, v == null ? "" : String(v));
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST", headers, body: params.toString(), redirect: "manual"
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (jar) jar.absorb(setCookies);
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookies,
    text: await res.text().catch(() => "")
  };
}

async function get(urlPath, jar) {
  const headers = {};
  if (jar && jar.headerValue()) headers.cookie = jar.headerValue();
  const res = await fetch(`${baseUrl}${urlPath}`, { headers, redirect: "manual" });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (jar) jar.absorb(setCookies);
  return {
    status: res.status,
    location: res.headers.get("location"),
    text: await res.text().catch(() => "")
  };
}

function uniqueEmail(label) {
  return `auth2-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
}

// Helper : crée un user via l'API directe BA + retourne le cookie session.
// Préféré au SSR /auth2/register pour les tests qui ont besoin d'une session
// persistante (le SSR-controller via auth.handler interne pose un cookie qui
// n'est pas systématiquement reconnu par BA pour les requêtes suivantes).
async function apiSignUpAndJar({ email, password = "Password123!Auth", firstName = "T", lastName = "U", phone }) {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: `${firstName} ${lastName}`, firstName, lastName, phone })
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`sign-up failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = buildJar();
  jar.absorb(setCookies);
  return { jar, userId: body.user.id };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});
test.after(async () => { await stopServer(); });

// ============================================================================
// REGISTER (/auth2/register)
// ============================================================================

test("POST /auth2/register avec champs valides crée user + session + mirror", async () => {
  const email = uniqueEmail("reg-ok");
  const jar = buildJar();
  const r = await form("/auth2/register", {
    firstName: "Reg", lastName: "Ok", email, password: "Password123!Reg", phone: "+243"
  }, jar);

  assert.equal(r.status, 302);
  assert.equal(r.location, "/");
  assert.ok(jar.has("better-auth.session_token"), "cookie session attendu");

  const models = defineModels();
  const u = await models.User.findOne({ where: { email } });
  assert.ok(u, "ligne users miroir attendue");
  assert.equal(u.firstName, "Reg");
  assert.equal(u.role, "CUSTOMER");
});

test("POST /auth2/register avec mot de passe trop court redirige vers /auth2/register", async () => {
  const r = await form("/auth2/register", {
    firstName: "Short", lastName: "Pw", email: uniqueEmail("reg-short"), password: "short", phone: ""
  }, buildJar());
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/register");
});

test("POST /auth2/register avec email déjà utilisé redirige vers /auth2/register", async () => {
  const email = uniqueEmail("reg-dup");
  await form("/auth2/register", { firstName: "A", lastName: "B", email, password: "Password123!Dup1" }, buildJar());
  const r = await form("/auth2/register", { firstName: "C", lastName: "D", email, password: "Password123!Dup2" }, buildJar());
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/register");
});

// ============================================================================
// LOGIN (/auth2/login)
// ============================================================================

test("POST /auth2/login avec bons identifiants pose une session", async () => {
  const email = uniqueEmail("login-ok");
  const password = "Password123!LoginOk";
  const setupJar = buildJar();
  await form("/auth2/register", { firstName: "Lo", lastName: "Gin", email, password }, setupJar);
  await form("/auth2/logout", {}, setupJar);

  const jar = buildJar();
  const r = await form("/auth2/login", { email, password }, jar);
  assert.equal(r.status, 302);
  assert.equal(r.location, "/");
  assert.ok(jar.has("better-auth.session_token"), "session cookie attendu");
});

test("POST /auth2/login avec mauvais password redirige vers /auth2/login (pas de session)", async () => {
  const email = uniqueEmail("login-badpw");
  const setupJar = buildJar();
  await form("/auth2/register", { firstName: "X", lastName: "Y", email, password: "Password123!Good" }, setupJar);
  await form("/auth2/logout", {}, setupJar);

  const jar = buildJar();
  const r = await form("/auth2/login", { email, password: "WrongPassword123!Z" }, jar);
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/login");
  assert.ok(!jar.has("better-auth.session_token"), "aucune session ne doit être posée");
});

test("POST /auth2/login avec email inconnu redirige vers /auth2/login", async () => {
  const r = await form("/auth2/login", { email: "ghost-user@example.com", password: "Password123!Ghost" }, buildJar());
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/login");
});

// ============================================================================
// LOGOUT (/auth2/logout)
// ============================================================================

test("POST /auth2/logout détruit la session côté serveur et purge le cookie", async () => {
  const { jar } = await apiSignUpAndJar({ email: uniqueEmail("logout-ok"), firstName: "Lg", lastName: "Out" });
  assert.ok(jar.has("better-auth.session_token"));

  // accès OK avant logout
  const before = await get("/account/profile", jar);
  assert.equal(before.status, 200);

  const r = await form("/auth2/logout", {}, jar);
  assert.equal(r.status, 302);
  assert.equal(r.location, "/");

  // la session côté serveur doit être détruite
  const after = await get("/account/profile", jar);
  assert.ok(after.status !== 200, `attendu non-200 après logout, got ${after.status}`);
});

// ============================================================================
// FORGOT / RESET PASSWORD
// ============================================================================

test("POST /auth2/forgot-password avec email existant retourne un flash opaque", async () => {
  const email = uniqueEmail("forgot");
  await form("/auth2/register", { firstName: "Fo", lastName: "Rg", email, password: "Password123!Forgot" }, buildJar());

  const r = await form("/auth2/forgot-password", { email }, buildJar());
  assert.equal(r.status, 302);
  assert.equal(r.location, "/auth2/login");
});

test("POST /auth2/forgot-password avec email inconnu retourne le MÊME flash opaque (anti-énumération)", async () => {
  const r1 = await form("/auth2/forgot-password", { email: "definitely-not-existing@example.com" }, buildJar());
  assert.equal(r1.status, 302);
  assert.equal(r1.location, "/auth2/login");
});

// ============================================================================
// SESSION LOADING (cookie BA → req.user)
// ============================================================================

test("Cookie BA permet d'accéder à /account/profile après sign-up API", async () => {
  const { jar } = await apiSignUpAndJar({ email: uniqueEmail("session-access"), firstName: "Sn", lastName: "Acc" });
  const r = await get("/account/profile", jar);
  assert.equal(r.status, 200, `expected 200 with session cookie, got ${r.status}`);
});

test("Sans cookie BA, /account/profile redirige ou refuse l'accès", async () => {
  const r = await get("/account/profile", buildJar());
  assert.ok(r.status !== 200, `attendu non-200 sans session, got ${r.status}`);
});

// ============================================================================
// ROLE-BASED ACCESS
// ============================================================================

test("CUSTOMER ne peut pas accéder /admin (403)", async () => {
  const { jar } = await apiSignUpAndJar({ email: uniqueEmail("cust-admin"), firstName: "Cust", lastName: "X" });
  const r = await get("/admin", jar);
  assert.equal(r.status, 403);
});

test("ADMIN peut accéder /admin (200)", async () => {
  const { jar, userId } = await apiSignUpAndJar({ email: uniqueEmail("admin-ok"), firstName: "Ad", lastName: "Min" });
  const models = defineModels();
  await models.User.update({ role: "ADMIN", emailVerifiedAt: new Date() }, { where: { id: userId } });

  const r = await get("/admin", jar);
  assert.equal(r.status, 200, `expected 200 for ADMIN, got ${r.status}`);
});

// ============================================================================
// CART MERGE au login
// ============================================================================

test("Un panier invité fusionne dans le panier user au login", async () => {
  const email = uniqueEmail("cartmerge");
  const password = "Password123!CartMerge";

  // 1. créer un user via API directe puis se déconnecter
  const { userId } = await apiSignUpAndJar({ email, password, firstName: "Ca", lastName: "Rt" });

  // créer un produit
  const models = defineModels();
  const cat = await models.Category.create({ name: "CM", slug: `cm-${Date.now()}` });
  const prod = await models.Product.create({
    categoryId: cat.id, name: "P", slug: `pcm-${Date.now()}`,
    description: "x", sku: `SKU-CM-${Date.now()}`,
    priceWithoutDelivery: 10, weightKg: 1, stock: 5, status: "ACTIVE"
  });

  // 2. visiteur (nouvelle session) ajoute un item au panier
  const visitorJar = buildJar();
  await get("/", visitorJar); // démarre la session express
  await form("/cart/items", { productId: prod.id, qty: 2 }, visitorJar);

  // 3. login via SSR (même jar visiteur) → merge déclenché
  const r = await form("/auth2/login", { email, password }, visitorJar);
  assert.equal(r.status, 302);

  // 4. vérifier en base
  const carts = await models.Cart.findAll({ where: { userId }, include: [{ model: models.CartItem, as: "items" }] });
  const totalQty = carts.reduce((sum, c) => sum + (c.items || []).reduce((s, it) => s + Number(it.qty || 0), 0), 0);
  assert.ok(totalQty >= 2, `attendu ≥2 items après merge, got ${totalQty}`);
});
