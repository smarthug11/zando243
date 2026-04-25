const jwt = require("jsonwebtoken");
const { env } = require("./env");

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, type: "access" },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, version: user.refreshTokenVersion || 0, type: "refresh" },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshTtl }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret, { algorithms: ["HS256"] });
  if (payload.type !== "access") throw new Error("Type de token invalide");
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwt.refreshSecret, { algorithms: ["HS256"] });
  if (payload.type !== "refresh") throw new Error("Type de token invalide");
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
