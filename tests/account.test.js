const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-account-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const accountController = require("../src/controllers/accountController");
const { requireAuth } = require("../src/middlewares/auth");
const { errorHandler } = require("../src/middlewares/errorHandler");

defineModels();

let models;
let alice;
let bob;

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
    originalUrl: "/account/profile",
    path: "/account/profile",
    requestId: "req-account-test",
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

async function seedBaseData() {
  await sequelize.sync({ force: true });

  alice = await models.User.create({
    role: "CUSTOMER",
    firstName: "Alice",
    lastName: "Support",
    email: "alice@example.com",
    phone: "099000111",
    avatarUrl: "https://cdn.example.com/alice.png",
    loyaltyPoints: 25,
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });

  bob = await models.User.create({
    role: "CUSTOMER",
    firstName: "Bob",
    lastName: "Client",
    email: "bob@example.com",
    isActive: true,
    refreshTokenVersion: 0,
    passwordHash: await hashPassword("Password123!")
  });
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

test("un utilisateur connecté peut afficher sa page profil avec ses informations, adresses et notifications récentes", async () => {
  await models.Address.create({
    userId: alice.id,
    label: "Maison",
    street: "Avenue 1",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });
  await models.Address.create({
    userId: alice.id,
    label: "Bureau",
    street: "Avenue 2",
    city: "Kinshasa",
    country: "RDC",
    isDefault: false
  });
  await models.Address.create({
    userId: bob.id,
    label: "Bob home",
    street: "Rue Bob",
    city: "Lubumbashi",
    country: "RDC",
    isDefault: true
  });

  const baseTime = Date.now();
  for (let i = 0; i < 12; i += 1) {
    await models.Notification.create({
      userId: alice.id,
      type: `TYPE_${i}`,
      message: `Notification ${i}`,
      createdAt: new Date(baseTime + i * 1000),
      updatedAt: new Date(baseTime + i * 1000)
    });
  }
  await models.Notification.create({
    userId: bob.id,
    type: "BOB",
    message: "Notification Bob"
  });

  const req = createReq({ user: alice });
  const { res, nextError } = await runHandler(accountController.profile, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/account/profile");
  assert.equal(res.rendered.locals.title, "Mon compte");
  assert.equal(res.rendered.locals.user.id, alice.id);
  assert.equal(res.rendered.locals.user.email, "alice@example.com");
  assert.equal(res.rendered.locals.addresses.length, 2);
  assert.equal(res.rendered.locals.addresses[0].label, "Maison");
  assert.equal(res.rendered.locals.notifications.length, 10);
  assert.equal(res.rendered.locals.notifications[0].message, "Notification 11");
  assert.equal(res.rendered.locals.notifications[9].message, "Notification 2");
  assert.ok(res.rendered.locals.notifications.every((n) => n.userId === alice.id));
});

test("un utilisateur connecté peut mettre à jour ses informations de profil selon le comportement actuel", async () => {
  const user = await models.User.findByPk(alice.id);
  const req = createReq({
    user,
    method: "POST",
    body: {
      firstName: "Alicia",
      lastName: "Updated",
      email: "ALICIA@EXAMPLE.COM",
      phone: "",
      avatarUrl: ""
    }
  });

  const { res, nextError } = await runHandler(accountController.updateProfile, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/account/profile");
  assert.deepEqual(req.session.flash, { type: "success", message: "Profil mis à jour." });

  const updatedUser = await models.User.findByPk(alice.id);
  assert.equal(updatedUser.firstName, "Alicia");
  assert.equal(updatedUser.lastName, "Updated");
  assert.equal(updatedUser.email, "alicia@example.com");
  assert.equal(updatedUser.phone, null);
  assert.equal(updatedUser.avatarUrl, null);
});

test("un utilisateur connecté peut créer une adresse et definir la nouvelle comme adresse par défaut", async () => {
  const existing = await models.Address.create({
    userId: alice.id,
    label: "Ancienne",
    street: "Rue 1",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: "/account/addresses",
    body: {
      label: "Nouvelle",
      street: "Rue 2",
      city: "Kinshasa",
      number: "12",
      neighborhood: "Gombe",
      municipality: "Gombe",
      country: "RDC",
      isDefault: "1"
    }
  });

  const { res, nextError } = await runHandler(accountController.createAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/account/profile");
  assert.deepEqual(req.session.flash, { type: "success", message: "Adresse ajoutée." });

  const refreshedOld = await models.Address.findByPk(existing.id);
  const addresses = await models.Address.findAll({
    where: { userId: alice.id },
    order: [["createdAt", "ASC"]]
  });

  assert.equal(addresses.length, 2);
  assert.equal(refreshedOld.isDefault, false);
  assert.equal(addresses[1].label, "Nouvelle");
  assert.equal(addresses[1].isDefault, true);
});

test("un utilisateur connecté peut modifier une adresse et définir une autre adresse par défaut", async () => {
  const defaultAddress = await models.Address.create({
    userId: alice.id,
    label: "Maison",
    street: "Rue 1",
    city: "Kinshasa",
    country: "RDC",
    isDefault: true
  });
  const secondaryAddress = await models.Address.create({
    userId: alice.id,
    label: "Bureau",
    street: "Rue 2",
    city: "Kinshasa",
    country: "RDC",
    isDefault: false
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/account/addresses/${secondaryAddress.id}`,
    params: { id: secondaryAddress.id },
    body: {
      label: "Bureau central",
      street: "Boulevard 30 Juin",
      city: "Kinshasa",
      number: "99",
      neighborhood: "Gombe",
      municipality: "Gombe",
      country: "RDC",
      isDefault: "1"
    }
  });

  const { res, nextError } = await runHandler(accountController.updateAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/account/profile");
  assert.deepEqual(req.session.flash, { type: "success", message: "Adresse mise à jour." });

  const refreshedDefault = await models.Address.findByPk(defaultAddress.id);
  const refreshedSecondary = await models.Address.findByPk(secondaryAddress.id);

  assert.equal(refreshedDefault.isDefault, false);
  assert.equal(refreshedSecondary.label, "Bureau central");
  assert.equal(refreshedSecondary.street, "Boulevard 30 Juin");
  assert.equal(refreshedSecondary.isDefault, true);
});

test("un utilisateur connecté peut supprimer une de ses adresses", async () => {
  const address = await models.Address.create({
    userId: alice.id,
    label: "A supprimer",
    street: "Rue 1",
    city: "Kinshasa",
    country: "RDC",
    isDefault: false
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/account/addresses/${address.id}/delete`,
    params: { id: address.id }
  });

  const { res, nextError } = await runHandler(accountController.deleteAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/account/profile");
  assert.deepEqual(req.session.flash, { type: "success", message: "Adresse supprimée." });

  const deleted = await models.Address.findByPk(address.id);
  assert.equal(deleted, null);
});

test("un utilisateur ne peut pas modifier une adresse qui ne lui appartient pas", async () => {
  const bobsAddress = await models.Address.create({
    userId: bob.id,
    label: "Bob home",
    street: "Rue Bob",
    city: "Lubumbashi",
    country: "RDC",
    isDefault: true
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/account/addresses/${bobsAddress.id}`,
    params: { id: bobsAddress.id },
    body: {
      label: "Intrusion",
      street: "Hack",
      city: "Kinshasa",
      country: "RDC"
    }
  });

  const { res, nextError } = await runHandler(accountController.updateAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Adresse introuvable");

  const unchanged = await models.Address.findByPk(bobsAddress.id);
  assert.equal(unchanged.label, "Bob home");
});

test("un utilisateur ne peut pas supprimer une adresse qui ne lui appartient pas selon le comportement actuel", async () => {
  const bobsAddress = await models.Address.create({
    userId: bob.id,
    label: "Bob home",
    street: "Rue Bob",
    city: "Lubumbashi",
    country: "RDC",
    isDefault: true
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/account/addresses/${bobsAddress.id}/delete`,
    params: { id: bobsAddress.id }
  });

  const { res, nextError } = await runHandler(accountController.deleteAddress, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/account/profile");
  assert.deepEqual(req.session.flash, { type: "success", message: "Adresse supprimée." });

  const unchanged = await models.Address.findByPk(bobsAddress.id);
  assert.ok(unchanged);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const getReq = createReq({ user: null, method: "GET", originalUrl: "/account/profile" });
  const getRes = createRes();
  const { nextError: getError } = await runHandler(requireAuth, getReq, getRes);

  assert.ok(getError);
  errorHandler(getError, getReq, getRes);
  assert.equal(getRes.statusCode, 401);
  assert.equal(getRes.rendered.view, "pages/errors/error");
  assert.match(getRes.rendered.locals.error.message, /Authentification requise/);

  const postReq = createReq({ user: null, method: "POST", originalUrl: "/account/addresses", body: { label: "Visiteur" } });
  const postRes = createRes();
  const { nextError: postError } = await runHandler(requireAuth, postReq, postRes);

  assert.ok(postError);
  errorHandler(postError, postReq, postRes);
  assert.equal(postRes.statusCode, 401);
  assert.equal(postRes.rendered.view, "pages/errors/error");
  assert.match(postRes.rendered.locals.error.message, /Authentification requise/);
});
