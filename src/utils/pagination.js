function getPagination(query = {}, defaultLimit = 12) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function toPageMeta({ count, page, limit }) {
  const totalPages = Math.max(1, Math.ceil(count / limit));
  return { count, page, limit, totalPages, hasPrev: page > 1, hasNext: page < totalPages };
}

module.exports = { getPagination, toPageMeta };
