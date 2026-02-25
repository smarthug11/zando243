const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { round2 } = require("../utils/pricing");
const { AppError } = require("../utils/AppError");

defineModels();

async function validateCoupon({ code, userId, subtotal }) {
  const models = defineModels();
  if (!code) return { coupon: null, discountAmount: 0 };
  const coupon = await models.Coupon.findOne({ where: { code: code.toUpperCase() } });
  if (!coupon || !coupon.isActive) throw new AppError("Coupon invalide", 400, "INVALID_COUPON");
  const now = new Date();
  if (coupon.startAt > now || coupon.endAt < now) throw new AppError("Coupon expiré/inactif", 400, "COUPON_NOT_VALID");
  if (Number(coupon.minCart || 0) > Number(subtotal)) throw new AppError("Panier inférieur au minimum requis", 400, "COUPON_MIN_CART");
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) throw new AppError("Limite coupon atteinte", 400, "COUPON_LIMIT");
  const usedByUser = await models.CouponRedemption.count({ where: { couponId: coupon.id, userId } });
  if (coupon.usagePerUser && usedByUser >= coupon.usagePerUser) {
    throw new AppError("Coupon déjà utilisé au maximum", 400, "COUPON_USER_LIMIT");
  }
  let discountAmount =
    coupon.type === "PERCENT"
      ? (Number(subtotal) * Number(coupon.value)) / 100
      : Number(coupon.value);
  if (coupon.maxDiscount) discountAmount = Math.min(discountAmount, Number(coupon.maxDiscount));
  discountAmount = round2(Math.max(0, discountAmount));
  return { coupon, discountAmount };
}

async function recordCouponRedemption({ couponId, userId, orderId, transaction }) {
  if (!couponId) return;
  const models = defineModels();
  await models.CouponRedemption.create({ couponId, userId, orderId }, { transaction });
  await models.Coupon.increment({ usageCount: 1 }, { where: { id: couponId }, transaction });
}

module.exports = { validateCoupon, recordCouponRedemption };
