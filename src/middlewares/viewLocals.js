const { env } = require("../config/env");
const cartService = require("../services/cartService");

async function attachViewLocals(req, res, next) {
  try {
    res.locals.app = { name: env.appName, url: env.appUrl };
    res.locals.currentPath = req.path;
    res.locals.requestId = req.requestId;
    res.locals.flash = req.session.flash || null;
    res.locals.auth = { user: req.user || null };
    res.locals.cartSummary = { count: await cartService.getCartItemCount(req) };
    if (req.session.flash) delete req.session.flash;
    next();
  } catch (error) {
    next(error);
  }
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { attachViewLocals, setFlash };
