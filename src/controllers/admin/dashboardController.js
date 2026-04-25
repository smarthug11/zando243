const { asyncHandler } = require("../../utils/asyncHandler");
const { getDashboardStats } = require("../../services/adminService");

const dashboard = asyncHandler(async (req, res) => {
  const stats = await getDashboardStats(req.query);
  res.render("pages/admin/dashboard", { title: "Admin Dashboard", stats });
});

const stats = asyncHandler(async (req, res) => {
  res.json(await getDashboardStats(req.query));
});

module.exports = {
  dashboard,
  stats
};
