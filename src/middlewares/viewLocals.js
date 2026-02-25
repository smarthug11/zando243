const { env } = require("../config/env");

function attachViewLocals(req, res, next) {
  res.locals.app = { name: env.appName, url: env.appUrl };
  res.locals.currentPath = req.path;
  res.locals.requestId = req.requestId;
  res.locals.flash = req.session.flash || null;
  res.locals.auth = { user: req.user || null };
  if (req.session.flash) delete req.session.flash;
  next();
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { attachViewLocals, setFlash };
