const { asyncHandler } = require("../../utils/asyncHandler");
const adminUserService = require("../../services/adminUserService");
const { createAuditLog } = require("../../services/auditLogService");

const usersPage = asyncHandler(async (_req, res) => {
  const users = await adminUserService.listCustomerUsers();
  res.render("pages/admin/users", { title: "Admin Clients", users });
});

const toggleUserBlock = asyncHandler(async (req, res) => {
  const user = await adminUserService.toggleUserBlock(req.params.id, req.body.action);
  if (user) {
    await createAuditLog({
      category: "USER",
      action: "ADMIN_USER_BLOCK_TOGGLE",
      message: `Client ${user.email} ${user.isActive ? "débloqué" : "bloqué"}`,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      requestId: req.requestId,
      req,
      meta: { targetUserId: user.id, targetEmail: user.email, isActive: user.isActive }
    });
  }
  res.redirect("/admin/users");
});

module.exports = {
  usersPage,
  toggleUserBlock
};
