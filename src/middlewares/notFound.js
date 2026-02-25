const { AppError } = require("../utils/AppError");

function notFoundHandler(req, res, next) {
  if (req.accepts("html")) {
    return res.status(404).render("pages/errors/404", { title: "Page non trouvee" });
  }
  next(new AppError("Ressource introuvable", 404, "NOT_FOUND"));
}

module.exports = { notFoundHandler };
