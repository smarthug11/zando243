const { defineModels } = require("../models");

defineModels();

async function listCoupons() {
  const models = defineModels();
  return models.Coupon.findAll({ order: [["createdAt", "DESC"]] });
}

async function createCoupon(payload) {
  const models = defineModels();
  return models.Coupon.create({
    code: payload.code.toUpperCase(),
    type: payload.type,
    value: payload.value,
    minCart: payload.minCart || 0,
    maxDiscount: payload.maxDiscount || null,
    startAt: payload.startAt,
    endAt: payload.endAt,
    usageLimit: payload.usageLimit || null,
    usagePerUser: payload.usagePerUser || 1,
    isActive: payload.isActive === "1"
  });
}

module.exports = {
  listCoupons,
  createCoupon
};
