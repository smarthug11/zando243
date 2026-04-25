const { body } = require("express-validator");
const { asyncHandler } = require("../../utils/asyncHandler");
const adminCouponService = require("../../services/adminCouponService");
const { createAuditLog } = require("../../services/auditLogService");
const { handleValidation } = require("../../middlewares/validators");

const couponValidators = [body("code").notEmpty(), body("type").isIn(["PERCENT", "FIXED"]), body("value").isFloat({ min: 0 }), handleValidation];

const couponsPage = asyncHandler(async (_req, res) => {
  const coupons = await adminCouponService.listCoupons();
  res.render("pages/admin/coupons", { title: "Admin Coupons", coupons });
});

const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await adminCouponService.createCoupon(req.body);
  await createAuditLog({
    category: "ADMIN",
    action: "ADMIN_COUPON_CREATE",
    message: `Coupon créé: ${coupon.code}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { couponId: coupon.id, type: coupon.type, value: coupon.value }
  });
  res.redirect("/admin/coupons");
});

module.exports = {
  couponValidators,
  couponsPage,
  createCoupon
};
