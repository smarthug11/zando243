const { asyncHandler } = require("../utils/asyncHandler");
const orderService = require("../services/orderService");
const { getInvoiceDownload } = require("../services/invoiceService");

const listOrders = asyncHandler(async (req, res) => {
  const orders = await orderService.listUserOrders(req.user.id);
  res.render("pages/orders/list", { title: "Mes commandes", orders });
});

const orderDetail = asyncHandler(async (req, res) => {
  const order = await orderService.getUserOrder(req.user.id, req.params.id);
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  res.render("pages/orders/detail", { title: order.orderNumber, order });
});

const returnRequest = asyncHandler(async (req, res) => {
  await orderService.requestReturn(req.user.id, req.params.id, req.body.reason || "Demande client");
  res.redirect(`/orders/${req.params.id}`);
});

const downloadInvoice = asyncHandler(async (req, res) => {
  const order = await orderService.getUserOrder(req.user.id, req.params.id);
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  const invoice = getInvoiceDownload(order);
  if (!invoice) return res.status(404).render("pages/errors/404", { title: "Facture introuvable" });
  res.setHeader("Content-Disposition", invoice.contentDisposition);
  res.setHeader("Content-Type", invoice.contentType);
  res.sendFile(invoice.filepath);
});

module.exports = { listOrders, orderDetail, returnRequest, downloadInvoice };
