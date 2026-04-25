const { asyncHandler } = require("../../utils/asyncHandler");
const adminReviewService = require("../../services/adminReviewService");
const { createAuditLog } = require("../../services/auditLogService");

const reviewsPage = asyncHandler(async (_req, res) => {
  const reviews = await adminReviewService.listReviews();
  res.render("pages/admin/reviews", { title: "Admin Avis", reviews });
});

const moderateReview = asyncHandler(async (req, res) => {
  const result = await adminReviewService.moderateReview(req.params.id, req.body.action);
  if (result) {
    await createAuditLog({
      category: "ADMIN",
      action: "ADMIN_REVIEW_MODERATION",
      message: `Modération avis ${result.review.id}: ${req.body.action}`,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      requestId: req.requestId,
      req,
      meta: { reviewId: result.review.id, productId: result.productId, action: req.body.action }
    });
  }
  res.redirect("/admin/reviews");
});

module.exports = {
  reviewsPage,
  moderateReview
};
