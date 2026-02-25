const { body } = require("express-validator");
const { defineModels } = require("../models");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");

defineModels();
const ticketValidators = [body("subject").notEmpty(), handleValidation];
const messageValidators = [body("message").isLength({ min: 2 }), handleValidation];

const listTickets = asyncHandler(async (req, res) => {
  const models = defineModels();
  const tickets = await models.SupportTicket.findAll({
    where: { userId: req.user.id },
    include: [{ model: models.SupportMessage, as: "messages", include: [{ model: models.User, as: "author" }] }],
    order: [["createdAt", "DESC"]]
  });
  res.render("pages/tickets/list", { title: "Support", tickets });
});

const createTicket = asyncHandler(async (req, res) => {
  const models = defineModels();
  const ticket = await models.SupportTicket.create({ userId: req.user.id, subject: req.body.subject, status: "Open" });
  if (req.body.message) await models.SupportMessage.create({ ticketId: ticket.id, userId: req.user.id, message: req.body.message });
  res.redirect("/tickets");
});

const addMessage = asyncHandler(async (req, res) => {
  const models = defineModels();
  const ticket = await models.SupportTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!ticket) return res.status(404).render("pages/errors/404", { title: "Ticket introuvable" });
  await models.SupportMessage.create({ ticketId: ticket.id, userId: req.user.id, message: req.body.message });
  await ticket.update({ status: "Pending" });
  res.redirect("/tickets");
});

module.exports = { ticketValidators, messageValidators, listTickets, createTicket, addMessage };
