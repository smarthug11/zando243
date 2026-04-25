const { asyncHandler } = require("../../utils/asyncHandler");
const { listAuditLogs, CATEGORIES, LEVELS } = require("../../services/auditLogService");

const logsPage = asyncHandler(async (req, res) => {
  const data = await listAuditLogs(req.query);
  res.render("pages/admin/logs", {
    title: "Logs système et métier",
    ...data,
    categories: CATEGORIES,
    levels: LEVELS
  });
});

module.exports = {
  logsPage
};
