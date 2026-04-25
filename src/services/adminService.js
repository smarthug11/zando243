const { fn, col, literal, Op } = require("sequelize");
const { defineModels } = require("../models");

defineModels();

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

function computeWeightFeeForOrder(order) {
  return Number(
    ((order.items || []).reduce((sum, item) => {
      const snapshot = parseJson(item.productSnapshot) || {};
      const weightKg = Number(snapshot.weightKg || 0);
      return sum + 15 * weightKg * Number(item.qty || 0);
    }, 0)).toFixed(2)
  );
}

function formatDayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function createDayLabels(start, end) {
  const labels = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    labels.push(formatDayKey(cur));
    cur.setDate(cur.getDate() + 1);
    if (labels.length > 800) break;
  }
  return labels;
}

function buildProgression({ orders, customers, startDate, endDate }) {
  const allDates = [
    ...orders.map((o) => new Date(o.createdAt)),
    ...customers.map((u) => new Date(u.createdAt))
  ].filter((d) => !Number.isNaN(d.getTime()));

  const start = startDate || (allDates.length ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : new Date());
  const end = endDate || new Date();
  const labels = createDayLabels(start, end);

  const revenueByDay = Object.fromEntries(labels.map((l) => [l, 0]));
  const weightByDay = Object.fromEntries(labels.map((l) => [l, 0]));
  const ordersByDay = Object.fromEntries(labels.map((l) => [l, 0]));
  const clientsByDay = Object.fromEntries(labels.map((l) => [l, 0]));

  for (const o of orders) {
    const key = formatDayKey(o.createdAt);
    if (!(key in revenueByDay)) continue;
    revenueByDay[key] += Number(o.total || 0);
    weightByDay[key] += computeWeightFeeForOrder(o);
    ordersByDay[key] += 1;
  }

  for (const u of customers) {
    const key = formatDayKey(u.createdAt);
    if (!(key in clientsByDay)) continue;
    clientsByDay[key] += 1;
  }

  const revenueSeries = labels.map((l) => Number(revenueByDay[l].toFixed(2)));
  const weightSeries = labels.map((l) => Number(weightByDay[l].toFixed(2)));
  const orderCountSeries = labels.map((l) => ordersByDay[l]);
  const avgCartSeries = labels.map((l, i) =>
    orderCountSeries[i] ? Number((revenueSeries[i] / orderCountSeries[i]).toFixed(2)) : 0
  );
  const clientsSeries = labels.map((l) => clientsByDay[l]);

  return {
    labels,
    series: {
      revenueTotal: revenueSeries,
      weightDeliveryRevenue: weightSeries,
      orderCount: orderCountSeries,
      avgCart: avgCartSeries,
      usersCount: clientsSeries
    }
  };
}

function isWithinRange(dateValue, startDate, endDate) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

async function getDashboardStats(filters = {}) {
  const models = defineModels();
  const startDate = parseDateInput(filters.startDate, false);
  const endDate = parseDateInput(filters.endDate, true);
  const [allOrdersRaw, usersCountTotal, topProducts, topCategories, allCustomersRaw] = await Promise.all([
    models.Order.findAll({
      include: [{ model: models.OrderItem, as: "items" }],
      order: [["createdAt", "DESC"]],
      limit: 10000
    }),
    models.User.count({ where: { role: "CUSTOMER" } }),
    models.OrderItem.findAll({
      attributes: [
        "productId",
        [fn("SUM", col("qty")), "qtySold"],
        [fn("SUM", col("line_total")), "revenue"]
      ],
      group: ["productId"],
      order: [[literal("\"qtySold\""), "DESC"]],
      limit: 5
    }),
    models.Product.findAll({
      attributes: ["categoryId", [fn("COUNT", col("Product.id")), "productsCount"]],
      group: ["categoryId"],
      limit: 5
    }),
    models.User.findAll({ where: { role: "CUSTOMER" }, attributes: ["id", "createdAt"], order: [["createdAt", "ASC"]], limit: 10000 })
  ]);

  const allOrders = allOrdersRaw.map((o) => (o.get ? o.get({ plain: true }) : o));
  const allCustomers = allCustomersRaw.map((u) => (u.get ? u.get({ plain: true }) : u));

  // Enrich topProducts with product names
  const topProductIds = topProducts.map((r) => r.productId).filter(Boolean);
  const productMap = topProductIds.length
    ? Object.fromEntries(
        (await models.Product.findAll({ where: { id: topProductIds }, attributes: ["id", "name", "sku"] })).map((p) => [p.id, p])
      )
    : {};
  const enrichedTopProducts = topProducts.map((r) => ({ ...r.get({ plain: true }), product: productMap[r.productId] || null }));

  // Enrich topCategories with category names
  const topCategoryIds = topCategories.map((r) => r.categoryId).filter(Boolean);
  const categoryMap = topCategoryIds.length
    ? Object.fromEntries(
        (await models.Category.findAll({ where: { id: topCategoryIds }, attributes: ["id", "name"] })).map((c) => [c.id, c])
      )
    : {};
  const enrichedTopCategories = topCategories.map((r) => ({ ...r.get({ plain: true }), category: categoryMap[r.categoryId] || null }));
  const allFilteredOrders = allOrders.filter((o) => isWithinRange(o.createdAt, startDate, endDate));
  const filteredCustomers = allCustomers.filter((u) => isWithinRange(u.createdAt, startDate, endDate));

  const revenue = allFilteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const orderCount = allFilteredOrders.length;
  const weightDeliveryRevenue = allFilteredOrders.reduce((sum, o) => sum + computeWeightFeeForOrder(o), 0);
  const avgCart = orderCount ? revenue / orderCount : 0;
  const recentOrders = allFilteredOrders.slice(0, 8).map((o) => {
    return { ...o, weightDeliveryAmount: computeWeightFeeForOrder(o) };
  });
  const progression = buildProgression({
    orders: allFilteredOrders,
    customers: filteredCustomers,
    startDate,
    endDate
  });

  return {
    revenueTotal: Number(revenue || 0),
    weightDeliveryRevenue: Number(weightDeliveryRevenue || 0),
    orderCount,
    avgCart,
    usersCount: filteredCustomers.length,
    usersCountTotal,
    topProducts: enrichedTopProducts,
    topCategories: enrichedTopCategories,
    recentOrders,
    progression,
    filters: {
      startDate: filters.startDate || "",
      endDate: filters.endDate || ""
    }
  };
}

module.exports = { getDashboardStats };
