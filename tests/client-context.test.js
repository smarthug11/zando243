const test = require("node:test");
const assert = require("node:assert/strict");

const { getClientContext } = require("../src/utils/clientContext");

function makeReq({ ip = "10.0.0.1", headers = {} } = {}) {
  return { ip, headers };
}

test("getClientContext utilise req.ip et IGNORE X-Forwarded-For spoofé", () => {
  // Express résout req.ip selon `trust proxy`. On vérifie qu'on ne prend
  // PAS un X-Forwarded-For brut, qui serait spoofable par n'importe quel client.
  const req = makeReq({
    ip: "10.0.0.1",
    headers: { "x-forwarded-for": "8.8.8.8, 1.1.1.1", "x-real-ip": "9.9.9.9" }
  });

  const ctx = getClientContext(req);

  assert.equal(ctx.ip, "10.0.0.1", "doit utiliser req.ip, pas les headers spoofés");
});

test("getClientContext normalise les adresses IPv4-mappées", () => {
  const req = makeReq({ ip: "::ffff:127.0.0.1" });
  const ctx = getClientContext(req);
  assert.equal(ctx.ip, "127.0.0.1");
});

test("getClientContext n'expose pas les headers géo/réseau si TRUST_CDN_HEADERS n'est pas activé", () => {
  const previous = process.env.TRUST_CDN_HEADERS;
  delete process.env.TRUST_CDN_HEADERS;
  // Re-require pour réévaluer la const TRUST_CDN_HEADERS du module
  delete require.cache[require.resolve("../src/utils/clientContext")];
  const { getClientContext: fresh } = require("../src/utils/clientContext");

  const req = makeReq({
    headers: {
      "cf-ipcountry": "US",
      "x-vercel-ip-city": "Atlantis",
      "x-isp": "Spoofed ISP",
      "x-asn": "AS00000"
    }
  });

  const ctx = fresh(req);

  assert.equal(ctx.geo.country, null);
  assert.equal(ctx.geo.city, null);
  assert.equal(ctx.network.operator, null);
  assert.equal(ctx.network.asn, null);

  if (previous !== undefined) process.env.TRUST_CDN_HEADERS = previous;
  delete require.cache[require.resolve("../src/utils/clientContext")];
});

test("getClientContext lit les headers CDN UNIQUEMENT si TRUST_CDN_HEADERS=true", () => {
  const previous = process.env.TRUST_CDN_HEADERS;
  process.env.TRUST_CDN_HEADERS = "true";
  delete require.cache[require.resolve("../src/utils/clientContext")];
  const { getClientContext: fresh } = require("../src/utils/clientContext");

  const req = makeReq({
    headers: {
      "cf-ipcountry": "FR",
      "x-vercel-ip-city": "Paris",
      "x-isp": "Orange",
      "x-asn": "AS3215"
    }
  });

  const ctx = fresh(req);

  assert.equal(ctx.geo.country, "FR");
  assert.equal(ctx.geo.city, "Paris");
  assert.equal(ctx.network.operator, "Orange");
  assert.equal(ctx.network.asn, "AS3215");

  if (previous === undefined) delete process.env.TRUST_CDN_HEADERS;
  else process.env.TRUST_CDN_HEADERS = previous;
  delete require.cache[require.resolve("../src/utils/clientContext")];
});

test("getClientContext capture le User-Agent tel quel (non utilisé en innerHTML côté client)", () => {
  const req = makeReq({
    headers: { "user-agent": "Mozilla/5.0 <script>alert(1)</script>" }
  });
  const ctx = getClientContext(req);
  // Le UA est stocké brut. Le danger XSS est neutralisé côté template (EJS escape
  // + clone DOM dans logs.ejs). Ici on vérifie juste qu'il est capturé.
  assert.equal(ctx.userAgent, "Mozilla/5.0 <script>alert(1)</script>");
});
