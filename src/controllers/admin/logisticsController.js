const { asyncHandler } = require("../../utils/asyncHandler");
const adminLogisticsService = require("../../services/adminLogisticsService");

const logisticsPage = asyncHandler(async (_req, res) => {
  const orders = await adminLogisticsService.listLogisticsOrders();
  res.render("pages/admin/logistics", { title: "Module Logistique", orders });
});

module.exports = {
  logisticsPage
};
