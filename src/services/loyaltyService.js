const { env } = require("../config/env");
const { defineModels } = require("../models");

defineModels();

function computeEarnedPoints(orderTotal) {
  if (Number(orderTotal) < env.loyaltyMinOrderForPoints) return 0;
  return Math.floor(Number(orderTotal) * env.loyaltyPointsPerDollar);
}

async function grantPointsForDeliveredOrder(order, transaction) {
  const models = defineModels();
  const points = computeEarnedPoints(order.total);
  if (!points) return 0;
  await models.User.increment({ loyaltyPoints: points }, { where: { id: order.userId }, transaction });
  return points;
}

async function applyDeliveredOrderEffects(order, transaction) {
  const models = defineModels();
  const points = await grantPointsForDeliveredOrder(order, transaction);
  await models.Notification.create(
    { userId: order.userId, type: "ORDER_STATUS", message: `Commande ${order.orderNumber} livrée.` },
    { transaction }
  );
  return { points };
}

module.exports = { computeEarnedPoints, grantPointsForDeliveredOrder, applyDeliveredOrderEffects };
