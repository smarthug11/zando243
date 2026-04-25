const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.tmpdir(), `zando243-auth-service-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const authService = require("../src/services/authService");
const { signRefreshToken } = require("../src/config/jwt");

defineModels();

let models;

async function createUser(overrides = {}) {
  return models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Auth",
    email: overrides.email || "alice-auth@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!"),
    ...overrides
  });
}

test.before(async () => {
  models = defineModels();
});

test.beforeEach(async () => {
  await sequelize.sync({ force: true });
});

test("registerUser refuse un mot de passe de moins de 12 caractères", async () => {
  await assert.rejects(
    () =>
      authService.registerUser({
        firstName: "Alice",
        lastName: "Auth",
        email: "short-password@example.com",
        password: "shortpass"
      }),
    (err) =>
      err.code === "WEAK_PASSWORD" &&
      err.statusCode === 422 &&
      err.message === "Le mot de passe doit contenir au moins 12 caractères."
  );
});

test("registerUser refuse un mot de passe évident de la blocklist", async () => {
  await assert.rejects(
    () =>
      authService.registerUser({
        firstName: "Alice",
        lastName: "Auth",
        email: "weak-password@example.com",
        password: "123456789012"
      }),
    (err) =>
      err.code === "WEAK_PASSWORD" &&
      err.statusCode === 422 &&
      err.message === "Ce mot de passe est trop facile à deviner. Choisissez une phrase ou un mot de passe plus personnel."
  );
});

test("resetPassword refuse un nouveau mot de passe évident", async () => {
  const user = await createUser();
  const reset = await authService.createResetToken(user.email);

  await assert.rejects(
    () => authService.resetPassword(reset.token, "zando2431234"),
    (err) => err.code === "WEAK_PASSWORD" && err.statusCode === 422
  );
});

test("refreshSession incrémente refreshTokenVersion et invalide l'ancien token", async () => {
  const user = await createUser();
  const token = signRefreshToken(user);

  const refreshed = await authService.refreshSession(token);

  assert.equal(refreshed.id, user.id);
  assert.equal(refreshed.refreshTokenVersion, 1);

  await assert.rejects(
    () => authService.refreshSession(token),
    (err) => err.code === "REFRESH_REVOKED" && err.statusCode === 401
  );
});

test("loginUser verrouille le compte après 10 échecs et refuse pendant le verrouillage", async () => {
  const user = await createUser();

  for (let i = 0; i < 10; i += 1) {
    await assert.rejects(
      () => authService.loginUser({ email: user.email, password: "WrongPassword123!" }),
      (err) => err.code === "BAD_CREDENTIALS" && err.statusCode === 401
    );
  }

  await user.reload();
  assert.equal(user.failedLoginAttempts, 10);
  assert.ok(user.lockedUntil > new Date());

  await assert.rejects(
    () => authService.loginUser({ email: user.email, password: "Password123!" }),
    (err) => err.code === "ACCOUNT_LOCKED" && err.statusCode === 423
  );
});

test("loginUser réinitialise le compteur après un succès hors verrouillage", async () => {
  const user = await createUser({ failedLoginAttempts: 2 });

  const loggedIn = await authService.loginUser({ email: user.email, password: "Password123!" });

  assert.equal(loggedIn.id, user.id);
  assert.equal(loggedIn.failedLoginAttempts, 0);
  assert.equal(loggedIn.lockedUntil, null);
});
