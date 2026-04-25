const { defineModels } = require("../models");

defineModels();

async function listUserTickets(userId) {
  const models = defineModels();
  return models.SupportTicket.findAll({
    where: { userId },
    include: [{ model: models.SupportMessage, as: "messages", include: [{ model: models.User, as: "author" }] }],
    order: [["createdAt", "DESC"]]
  });
}

async function createTicketForUser(userId, { subject, message }) {
  const models = defineModels();
  const ticket = await models.SupportTicket.create({
    userId,
    subject,
    status: "Open"
  });

  if (message) {
    await models.SupportMessage.create({
      ticketId: ticket.id,
      userId,
      message
    });
  }

  return ticket;
}

async function addMessageToUserTicket(userId, ticketId, message) {
  const models = defineModels();
  const ticket = await models.SupportTicket.findOne({
    where: { id: ticketId, userId }
  });

  if (!ticket) return null;

  await models.SupportMessage.create({
    ticketId: ticket.id,
    userId,
    message
  });
  await ticket.update({ status: "Pending" });

  return ticket;
}

module.exports = {
  listUserTickets,
  createTicketForUser,
  addMessageToUserTicket
};
