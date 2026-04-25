const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { escapeLike } = require("../utils/escapeLike");

async function listOrders(query = {}) {
  const models = defineModels();
  const q = (query.q || "").trim();
  const status = (query.status || "").trim();
  const startDate = (query.startDate || "").trim();
  const endDate = (query.endDate || "").trim();

  const orderWhere = {};
  if (status) orderWhere.status = status;
  if (startDate || endDate) {
    const range = {};
    if (startDate) {
      const d = new Date(startDate);
      d.setHours(0, 0, 0, 0);
      if (!Number.isNaN(d.getTime())) range[Op.gte] = d;
    }
    if (endDate) {
      const d = new Date(endDate);
      d.setHours(23, 59, 59, 999);
      if (!Number.isNaN(d.getTime())) range[Op.lte] = d;
    }
    if (Object.keys(range).length) orderWhere.createdAt = range;
  }

  const userInclude = {
    model: models.User,
    required: !!q
  };
  if (q) {
    const safeQ = escapeLike(q);
    userInclude.where = {
      [Op.or]: [
        { firstName: { [Op.like]: `%${safeQ}%` } },
        { lastName: { [Op.like]: `%${safeQ}%` } },
        { email: { [Op.like]: `%${safeQ}%` } }
      ]
    };
  }

  const orders = await models.Order.findAll({
    where: orderWhere,
    include: [userInclude, { model: models.OrderItem, as: "items" }],
    order: [["createdAt", "DESC"]],
    limit: 100
  });

  return {
    orders,
    filters: { q, status, startDate, endDate }
  };
}

async function getOrderDetail(orderId) {
  const models = defineModels();
  return models.Order.findByPk(orderId, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" },
      { model: models.OrderStatusHistory, as: "statusHistory", required: false }
    ]
  });
}

async function getOrderForPdf(orderId) {
  const models = defineModels();
  return models.Order.findByPk(orderId, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" },
      { model: models.OrderStatusHistory, as: "statusHistory", required: false }
    ]
  });
}

async function getOrderForShippingLabel(orderId) {
  const models = defineModels();
  return models.Order.findByPk(orderId, {
    include: [
      models.User,
      { model: models.OrderItem, as: "items" }
    ]
  });
}

module.exports = { listOrders, getOrderDetail, getOrderForPdf, getOrderForShippingLabel }; // updateOrder reste mince dans le controller : audit dépend de req
