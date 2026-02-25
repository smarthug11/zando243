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
  return jwt.verify(token, env.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
