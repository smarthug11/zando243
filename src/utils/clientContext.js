function normalizeIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, "");
}

// Quand TRUST_CDN_HEADERS=true (déploiement derrière Cloudflare/Vercel),
// on accepte les headers géo/réseau du CDN. Sinon ils sont ignorés car
// trivialement spoofables par n'importe quel client.
const TRUST_CDN_HEADERS = String(process.env.TRUST_CDN_HEADERS || "").toLowerCase() === "true";

function getClientContext(req) {
  const headers = req?.headers || {};

  // req.ip est résolu par Express selon `trust proxy`. On ne touche plus
  // X-Forwarded-For / X-Real-IP directement — ils sont spoofables par
  // n'importe quel client si trust proxy n'est pas configuré correctement.
  const ip = normalizeIp(req?.ip) || null;

  const geo = TRUST_CDN_HEADERS
    ? {
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
      }
    : { country: null, region: null, city: null, timezone: null };

  const network = TRUST_CDN_HEADERS
    ? {
        asn: headers["x-asn"] || headers["cf-asn"] || null,
        operator: headers["x-isp"] || headers["x-operator"] || headers["x-carrier"] || null,
        forwardedFor: headers["x-forwarded-for"] || null
      }
    : { asn: null, operator: null, forwardedFor: null };

  return {
    ip,
    userAgent: req?.headers?.["user-agent"] || null,
    geo,
    network
  };
}

module.exports = { getClientContext };
