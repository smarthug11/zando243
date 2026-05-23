const { body, validationResult } = require("express-validator");
const { asyncHandler } = require("../../utils/asyncHandler");
const adminCouponService = require("../../services/adminCouponService");
const { createAuditLog } = require("../../services/auditLogService");
const { setFlash } = require("../../middlewares/viewLocals");

function handleCouponValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const firstMessage = errors.array().find((error) => typeof error.msg === "string" && error.msg)?.msg;
  setFlash(req, "error", firstMessage || "Coupon invalide.");
  return res.redirect("/admin/coupons");
}

const couponValidators = [
  body("code").trim().notEmpty().withMessage("Le code du coupon est requis."),
  body("type").isIn(["PERCENT", "FIXED"]).withMessage("Le type de coupon est invalide."),
  body("value").isFloat({ min: 0 }).withMessage("La valeur du coupon est requise."),
  body("minCart").optional({ values: "falsy" }).isFloat({ min: 0 }).withMessage("Le minimum panier est invalide."),
  body("maxDiscount").optional({ values: "falsy" }).isFloat({ min: 0 }).withMessage("Le plafond de remise est invalide."),
  body("usageLimit").optional({ values: "falsy" }).isInt({ min: 1 }).withMessage("La limite d'usage est invalide."),
  body("usagePerUser").optional({ values: "falsy" }).isInt({ min: 1 }).withMessage("La limite par utilisateur est invalide."),
  body("startAt").notEmpty().withMessage("La date de début est requise.").bail().isISO8601().withMessage("La date de début est invalide."),
  body("endAt").notEmpty().withMessage("La date de fin est requise.").bail().isISO8601().withMessage("La date de fin est invalide."),
  handleCouponValidation
];

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
