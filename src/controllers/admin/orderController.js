const { asyncHandler } = require("../../utils/asyncHandler");
const adminOrderService = require("../../services/adminOrderService");
const { updateOrderStatus } = require("../../services/orderService");
const { createAuditLog } = require("../../services/auditLogService");
const { streamRawOrderPdf, streamShippingLabelPdf } = require("../../services/orderDocumentService");

const ordersPage = asyncHandler(async (req, res) => {
  const { orders, filters } = await adminOrderService.listOrders(req.query);
  res.render("pages/admin/orders", {
    title: "Admin Commandes",
    orders,
    filters
  });
});

const orderDetailPage = asyncHandler(async (req, res) => {
  const order = await adminOrderService.getOrderDetail(req.params.id);
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  res.render("pages/admin/order-detail", { title: `Commande ${order.orderNumber}`, order });
});

const updateOrder = asyncHandler(async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.body.status, req.body.note || null);
  await createAuditLog({
    category: "ORDER",
    action: "ADMIN_ORDER_STATUS",
    message: `Statut commande changé: ${order.orderNumber} -> ${req.body.status}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { orderId: order.id, status: req.body.status, note: req.body.note || null }
  });
  res.redirect("/admin/orders");
});

const orderRawPdf = asyncHandler(async (req, res) => {
  const order = await adminOrderService.getOrderForPdf(req.params.id);
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  streamRawOrderPdf(order, res);
});

const orderShippingLabelPdf = asyncHandler(async (req, res) => {
  const order = await adminOrderService.getOrderForShippingLabel(req.params.id);
  if (!order) return res.status(404).render("pages/errors/404", { title: "Commande introuvable" });
  await streamShippingLabelPdf(order, res);
});

module.exports = {
  ordersPage,
  orderDetailPage,
  updateOrder,
  orderRawPdf,
  orderShippingLabelPdf
};
