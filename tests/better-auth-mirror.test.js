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

async function post(urlPath, body, cookie) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST", headers, body: JSON.stringify(body)
  });
  const text = await res.text();
  let payload = null; try { payload = JSON.parse(text); } catch (_e) { payload = text; }
  return { status: res.status, body: payload, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")] };
}

function extractSessionCookie(setCookieArr) {
  const c = (setCookieArr || []).find((x) => x && x.startsWith("better-auth.session_token="));
  return c ? c.split(";")[0] : null;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});
test.after(async () => { await stopServer(); });

test("sign-up Better Auth crée la ligne users miroir avec même id", async () => {
  const email = `mirror-signup-${Date.now()}@example.com`;
  const r = await post("/api/auth/sign-up/email", {
    email, password: "Password123!Mirror",
    name: "Mirror One", firstName: "Mirror", lastName: "One", phone: "+243000"
  });
  assert.equal(r.status, 200);
  const models = defineModels();
  const u = await models.User.findByPk(r.body.user.id);
  assert.ok(u, "users devrait avoir une ligne miroir");
  assert.equal(u.email, email);
  assert.equal(u.firstName, "Mirror");
  assert.equal(u.lastName, "One");
  assert.equal(u.role, "CUSTOMER");
  assert.equal(u.passwordHash, null);
});

test("sign-up Better Auth crée aussi un AuditLog USER_REGISTER", async () => {
  const email = `mirror-audit-${Date.now()}@example.com`;
  const r = await post("/api/auth/sign-up/email", {
    email, password: "Password123!Audit",
    name: "Mirror Audit", firstName: "Mirror", lastName: "Audit"
  });
  assert.equal(r.status, 200);
  const models = defineModels();
  const log = await models.AuditLog.findOne({ where: { action: "USER_REGISTER", actorUserId: r.body.user.id } });
  assert.ok(log, "AuditLog USER_REGISTER attendu");
  assert.equal(log.actorEmail, email);
});

test("sign-in après sign-up crée un AuditLog USER_LOGIN", async () => {
  const email = `mirror-login-${Date.now()}@example.com`;
  const password = "Password123!Login";
  await post("/api/auth/sign-up/email", {
    email, password, name: "Mirror Login", firstName: "Mirror", lastName: "Login"
  });
  const r = await post("/api/auth/sign-in/email", { email, password });
  assert.equal(r.status, 200);
  const models = defineModels();
  const log = await models.AuditLog.findOne({ where: { action: "USER_LOGIN", actorEmail: email } });
  assert.ok(log, "AuditLog USER_LOGIN attendu");
});

test("sign-up refuse mot de passe trop court via policy maison (parité)", async () => {
  const email = `mirror-shortpw-${Date.now()}@example.com`;
  const r = await post("/api/auth/sign-up/email", {
    email, password: "short", name: "Short", firstName: "S", lastName: "P"
  });
  assert.notEqual(r.status, 200);
  assert.ok(r.status === 400 || r.status === 422, `status: ${r.status}`);
});

test("sign-up refuse mot de passe de la blocklist via policy maison", async () => {
  const email = `mirror-weakpw-${Date.now()}@example.com`;
  const r = await post("/api/auth/sign-up/email", {
    email, password: "123456789012", name: "Weak", firstName: "W", lastName: "P"
  });
  assert.notEqual(r.status, 200);
  assert.ok(r.status === 400 || r.status === 422, `status: ${r.status}`);
  assert.ok(JSON.stringify(r.body).toLowerCase().includes("facile") || JSON.stringify(r.body).toLowerCase().includes("weak"), "message blocklist attendu");
});

test("rôle ADMIN ne peut pas être injecté via sign-up (sécurité critique)", async () => {
  const email = `mirror-roleinj-${Date.now()}@example.com`;
  const r = await post("/api/auth/sign-up/email", {
    email, password: "Password123!RoleInj",
    name: "Inject", firstName: "Inject", lastName: "Role",
    role: "ADMIN"
  });
  assert.equal(r.status, 200);
  const models = defineModels();
  const u = await models.User.findByPk(r.body.user.id);
  assert.equal(u.role, "CUSTOMER", "le rôle doit rester CUSTOMER même si ADMIN est posté");
});

test("sign-out après sign-in écrit AuditLog USER_LOGOUT", async () => {
  const email = `mirror-logout-${Date.now()}@example.com`;
  const password = "Password123!Logout";
  const su = await post("/api/auth/sign-up/email", { email, password, name: "Logout", firstName: "Lo", lastName: "Ut" });
  const cookie = extractSessionCookie(su.setCookie);
  const r = await post("/api/auth/sign-out", {}, cookie);
  assert.ok([200, 204].includes(r.status), `status: ${r.status}`);
  const models = defineModels();
  const log = await models.AuditLog.findOne({ where: { action: "USER_LOGOUT", actorEmail: email } });
  assert.ok(log, "AuditLog USER_LOGOUT attendu");
});
