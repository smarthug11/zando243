const { body } = require("express-validator");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const ticketService = require("../services/ticketService");

const ticketValidators = [body("subject").notEmpty(), handleValidation];
const messageValidators = [body("message").isLength({ min: 2 }), handleValidation];

const listTickets = asyncHandler(async (req, res) => {
  const tickets = await ticketService.listUserTickets(req.user.id);
  res.render("pages/tickets/list", { title: "Support", tickets });
});

const createTicket = asyncHandler(async (req, res) => {
  await ticketService.createTicketForUser(req.user.id, req.body);
  res.redirect("/tickets");
});

const addMessage = asyncHandler(async (req, res) => {
  const ticket = await ticketService.addMessageToUserTicket(req.user.id, req.params.id, req.body.message);
  if (!ticket) return res.status(404).render("pages/errors/404", { title: "Ticket introuvable" });
  res.redirect("/tickets");
});

module.exports = { ticketValidators, messageValidators, listTickets, createTicket, addMessage };
