const { asyncHandler } = require("../../utils/asyncHandler");
const adminRefundService = require("../../services/adminRefundService");

const refundsPage = asyncHandler(async (_req, res) => {
  const returns = await adminRefundService.listReturnRequests();
  res.render("pages/admin/refunds", { title: "Admin Retours/Remboursements", returns });
});

module.exports = {
  refundsPage
};
