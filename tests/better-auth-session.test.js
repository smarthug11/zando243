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
const { loadCurrentUser } = require("../src/middlewares/auth");
defineModels();

let server;
let baseUrl;

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

function stopServer() {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function signupAndGetCookie(email) {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!Secure",
      name: "Session Test",
      firstName: "Session",
      lastName: "Test"
    })
  });
  assert.equal(res.status, 200, `signup failed: ${res.status}`);
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  const sessionCookie = cookies.find((c) => c && c.startsWith("better-auth.session_token="));
  assert.ok(sessionCookie, "session cookie should be set");
  const body = await res.json();
  return { cookie: sessionCookie.split(";")[0], userId: body.user.id, email: body.user.email };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});

test.after(async () => {
  await stopServer();
});

test("loadCurrentUser ne pose rien sans cookie quand flag ON mais aucun token", async () => {
  const req = { headers: {}, cookies: {} };
  let nextCalled = false;
  await loadCurrentUser(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined);
});

test("loadCurrentUser peuple req.user à partir d'un cookie Better Auth après sign-up (hook miroir actif)", async () => {
  const email = `session-ok-${Date.now()}@example.com`;
  const { cookie, userId } = await signupAndGetCookie(email);

  const req = { headers: { cookie }, cookies: {} };
  let nextCalled = false;
  await loadCurrentUser(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.ok(req.user, "req.user devrait être peuplé via le miroir Sequelize");
  assert.equal(req.user.id, userId);
  assert.equal(req.user.email, email);
});

test("loadCurrentUser ne peuple pas req.user si le user Sequelize miroir devient inactif", async () => {
  const email = `session-inactive-${Date.now()}@example.com`;
  const { cookie, userId } = await signupAndGetCookie(email);

  const models = defineModels();
  await models.User.update({ isActive: false }, { where: { id: userId } });

  const req = { headers: { cookie }, cookies: {} };
  let nextCalled = false;
  await loadCurrentUser(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined, "user inactif ne doit pas peupler req.user");
});

test("loadCurrentUser ne crashe jamais même si Better Auth jette", async () => {
  const req = { headers: { cookie: "better-auth.session_token=invalide; Path=/" }, cookies: {} };
  let nextCalled = false;
  await loadCurrentUser(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined);
});
