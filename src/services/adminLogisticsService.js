const { defineModels } = require("../models");

async function listLogisticsOrders() {
  const models = defineModels();
  return models.Order.findAll({
    order: [["createdAt", "DESC"]],
    limit: 100
  });
}

module.exports = { listLogisticsOrders };
