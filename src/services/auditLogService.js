const { Op } = require("sequelize");
const { defineModels } = require("../models");
const { logger } = require("../utils/logger");
const { getClientContext } = require("../utils/clientContext");

defineModels();

const CATEGORIES = ["SYSTEM", "AUTH", "ORDER", "USER", "PRODUCT", "ADMIN", "SUPPORT", "PAYMENT"];
const LEVELS = ["INFO", "WARN", "ERROR"];

function normalize(value, fallback) {
  return value ? String(value).toUpperCase() : fallback;
}

async function createAuditLog(payload = {}) {
  try {
    const models = defineModels();
    const category = normalize(payload.category, "SYSTEM");
    const level = normalize(payload.level, "INFO");
    const reqContext = payload.req ? getClientContext(payload.req) : null;
    const effectiveIp = payload.ip || reqContext?.ip || null;
    const effectiveUserAgent = payload.userAgent || reqContext?.userAgent || null;
    const effectiveMeta = {
      ...(payload.meta || {}),
      ...(reqContext ? { clientContext: reqContext } : {})
    };

    return await models.AuditLog.create({
      category: CATEGORIES.includes(category) ? category : "SYSTEM",
      level: LEVELS.includes(level) ? level : "INFO",
      action: payload.action || "UNKNOWN_ACTION",
      message: payload.message || "Event",
      meta: effectiveMeta,
      actorUserId: payload.actorUserId || null,
      actorEmail: payload.actorEmail || null,
      requestId: payload.requestId || null,
      ip: effectiveIp,
      userAgent: effectiveUserAgent
    });
  } catch (err) {
    logger.warn({ err }, "Echec ecriture audit log");
    return null;
  }
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function escapeLike(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function listAuditLogs(filters = {}) {
  const models = defineModels();
  const where = {};
  if (filters.category) where.category = normalize(filters.category);
  if (filters.level) where.level = normalize(filters.level);
  if (filters.actorEmail) where.actorEmail = { [Op.like]: `%${escapeLike(filters.actorEmail)}%` };
  if (filters.q) {
    const q = escapeLike(filters.q);
    where[Op.or] = [
      { message: { [Op.like]: `%${q}%` } },
      { action: { [Op.like]: `%${q}%` } }
    ];
  }
  const startDate = parseDate(filters.startDate, false);
  const endDate = parseDate(filters.endDate, true);
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = startDate;
    if (endDate) where.createdAt[Op.lte] = endDate;
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(200, Math.max(10, Number(filters.limit) || 50));
  const offset = (page - 1) * limit;

  const { rows, count } = await models.AuditLog.findAndCountAll({
    where,
    include: [{ model: models.User, as: "actor", required: false }],
    order: [["createdAt", "DESC"]],
    limit,
    offset
  });

  return {
    logs: rows,
    count,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(count / limit)),
    filters: {
      category: filters.category || "",
      level: filters.level || "",
      q: filters.q || "",
      actorEmail: filters.actorEmail || "",
      startDate: filters.startDate || "",
      endDate: filters.endDate || ""
    }
  };
}

module.exports = { createAuditLog, listAuditLogs, CATEGORIES, LEVELS };
