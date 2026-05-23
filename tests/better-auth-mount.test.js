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

async function jsonRequest(method, urlPath, body, headers = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_e) { payload = text; }
  return { status: res.status, headers: res.headers, body: payload };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await startServer();
});

test.after(async () => {
  await stopServer();
});

test("Better Auth handler répond sur /api/auth/sign-up/email avec flag ON", async () => {
  const res = await jsonRequest("POST", "/api/auth/sign-up/email", {
    email: `mount-${Date.now()}@example.com`,
    password: "Password123!Better",
    name: "Mount Test",
    firstName: "Mount",
    lastName: "Test"
  });
  console.log("STATUS:", res.status, "BODY:", JSON.stringify(res.body).slice(0, 500));
  assert.notEqual(res.status, 404, "le handler doit être monté");
  assert.notEqual(res.status, 415, "Content-Type doit être accepté");
  assert.ok([200, 201, 400, 422].includes(res.status), `status inattendu: ${res.status}`);
});

test("CSRF est exempté sur /api/auth/* (pas d'erreur EBADCSRFTOKEN)", async () => {
  process.env.CSRF_ENABLED = "true";
  const res = await jsonRequest("POST", "/api/auth/sign-up/email", {
    email: `csrf-${Date.now()}@example.com`,
    password: "Password123!Better",
    name: "Csrf Test",
    firstName: "Csrf",
    lastName: "Test"
  });
  process.env.CSRF_ENABLED = "false";
  assert.notEqual(res.status, 403, "CSRF ne doit pas bloquer /api/auth/*");
});
