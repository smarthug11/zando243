const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const dbPath = path.join(os.tmpdir(), `zando243-tickets-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = "test";
process.env.SQLITE_STORAGE = dbPath;
process.env.CSRF_ENABLED = "false";
process.env.DB_LOG = "false";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.COOKIE_SECRET = "test_cookie_secret";
process.env.SESSION_SECRET = "test_session_secret";

const { sequelize, defineModels, hashPassword } = require("../src/models");
const ticketController = require("../src/controllers/ticketController");
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
    originalUrl: "/tickets",
    path: "/tickets",
    requestId: "req-test",
    accepts(type) {
      return type === "html";
    },
    get() {
      return null;
    },
    headers: {},
    session: {},
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
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
    refreshTokenVersion: 0
  });

  bob = await models.User.create({
    role: "CUSTOMER",
    firstName: "Bob",
    lastName: "Client",
    email: "bob@example.com",
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
    refreshTokenVersion: 0
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

test("un utilisateur connecté peut afficher la liste de ses tickets", async () => {
  const aliceTicket = await models.SupportTicket.create({
    userId: alice.id,
    subject: "Commande perdue",
    status: "Open"
  });
  await models.SupportMessage.create({
    ticketId: aliceTicket.id,
    userId: alice.id,
    message: "Je n'ai pas reçu mon colis."
  });

  await models.SupportTicket.create({
    userId: bob.id,
    subject: "Facture",
    status: "Open"
  });

  const req = createReq({ user: alice });
  const { res, nextError } = await runHandler(ticketController.listTickets, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered.view, "pages/tickets/list");
  assert.equal(res.rendered.locals.title, "Support");
  assert.equal(res.rendered.locals.tickets.length, 1);
  assert.equal(res.rendered.locals.tickets[0].subject, "Commande perdue");
  assert.equal(res.rendered.locals.tickets[0].messages.length, 1);
  assert.equal(res.rendered.locals.tickets[0].messages[0].message, "Je n'ai pas reçu mon colis.");
});

test("un utilisateur connecté peut créer un ticket", async () => {
  const req = createReq({
    user: alice,
    method: "POST",
    body: {
      subject: "Problème de livraison",
      message: "Merci de vérifier la livraison"
    }
  });

  const { res, nextError } = await runHandler(ticketController.createTicket, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/tickets");

  const tickets = await models.SupportTicket.findAll({
    where: { userId: alice.id },
    include: [{ model: models.SupportMessage, as: "messages" }]
  });

  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].subject, "Problème de livraison");
  assert.equal(tickets[0].status, "Open");
  assert.equal(tickets[0].messages.length, 1);
  assert.equal(tickets[0].messages[0].message, "Merci de vérifier la livraison");
});

test("un utilisateur connecté peut ajouter un message à un de ses tickets", async () => {
  const ticket = await models.SupportTicket.create({
    userId: alice.id,
    subject: "Retour produit",
    status: "Open"
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/tickets/${ticket.id}/messages`,
    params: { id: ticket.id },
    body: { message: "Je souhaite ajouter une précision." }
  });

  const { res, nextError } = await runHandler(ticketController.addMessage, req);

  assert.equal(nextError, null);
  assert.equal(res.redirectTo, "/tickets");

  const refreshedTicket = await models.SupportTicket.findByPk(ticket.id, {
    include: [{ model: models.SupportMessage, as: "messages" }]
  });

  assert.equal(refreshedTicket.status, "Pending");
  assert.equal(refreshedTicket.messages.length, 1);
  assert.equal(refreshedTicket.messages[0].message, "Je souhaite ajouter une précision.");
  assert.equal(refreshedTicket.messages[0].userId, alice.id);
});

test("un utilisateur ne peut pas accéder ou répondre à un ticket qui appartient à un autre utilisateur", async () => {
  const bobsTicket = await models.SupportTicket.create({
    userId: bob.id,
    subject: "Ticket privé",
    status: "Open"
  });

  const req = createReq({
    user: alice,
    method: "POST",
    originalUrl: `/tickets/${bobsTicket.id}/messages`,
    params: { id: bobsTicket.id },
    body: { message: "Tentative d'accès" }
  });

  const { res, nextError } = await runHandler(ticketController.addMessage, req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "pages/errors/404");
  assert.equal(res.rendered.locals.title, "Ticket introuvable");

  const messageCount = await models.SupportMessage.count({ where: { ticketId: bobsTicket.id } });
  assert.equal(messageCount, 0);
});

test("un visiteur non connecté est bloqué selon le comportement actuel", async () => {
  const getReq = createReq({ user: null, method: "GET", originalUrl: "/tickets" });
  const getRes = createRes();
  const { nextError: getError } = await runHandler(requireAuth, getReq, getRes);

  assert.ok(getError);
  errorHandler(getError, getReq, getRes);
  assert.equal(getRes.statusCode, 401);
  assert.equal(getRes.rendered.view, "pages/errors/error");
  assert.match(getRes.rendered.locals.error.message, /Authentification requise/);

  const postReq = createReq({ user: null, method: "POST", originalUrl: "/tickets", body: { subject: "Visiteur" } });
  const postRes = createRes();
  const { nextError: postError } = await runHandler(requireAuth, postReq, postRes);

  assert.ok(postError);
  errorHandler(postError, postReq, postRes);
  assert.equal(postRes.statusCode, 401);
  assert.equal(postRes.rendered.view, "pages/errors/error");
  assert.match(postRes.rendered.locals.error.message, /Authentification requise/);
});
