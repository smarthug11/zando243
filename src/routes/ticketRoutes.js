const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/ticketController");

const router = express.Router();
router.use(requireAuth);
router.get("/", ctrl.listTickets);
router.post("/", ...ctrl.ticketValidators, ctrl.createTicket);
router.post("/:id/messages", ...ctrl.messageValidators, ctrl.addMessage);

module.exports = router;
