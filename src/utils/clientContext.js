function firstIpFromForwarded(forwarded) {
  if (!forwarded || typeof forwarded !== "string") return null;
  const first = forwarded.split(",")[0]?.trim();
  if (!first) return null;
  return first.replace(/^::ffff:/, "");
}

function normalizeIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, "");
}

function getClientContext(req) {
  const headers = req?.headers || {};
  const forwardedIp = firstIpFromForwarded(headers["x-forwarded-for"]);
  const ip =
    normalizeIp(forwardedIp) ||
    normalizeIp(headers["x-real-ip"]) ||
    normalizeIp(req?.ip) ||
    null;

  // Best-effort geo/operator from common reverse proxies/CDNs.
  const geo = {
    country:
      headers["cf-ipcountry"] ||
      headers["x-vercel-ip-country"] ||
      headers["x-country-code"] ||
      null,
    region:
      headers["x-vercel-ip-country-region"] ||
      headers["x-region-code"] ||
      null,
    city: headers["x-vercel-ip-city"] || headers["x-city"] || null,
    timezone: headers["x-vercel-ip-timezone"] || null
  };

  const network = {
    asn: headers["x-asn"] || headers["cf-asn"] || null,
    operator: headers["x-isp"] || headers["x-operator"] || headers["x-carrier"] || null,
    forwardedFor: headers["x-forwarded-for"] || null
  };

  return {
    ip,
    userAgent: req?.headers?.["user-agent"] || null,
    geo,
    network
  };
}

module.exports = { getClientContext };
