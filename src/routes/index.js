const publicRoutes = require("./publicRoutes");
const auth2Routes = require("./auth2Routes");
const accountRoutes = require("./accountRoutes");
const cartRoutes = require("./cartRoutes");
const favoriteRoutes = require("./favoriteRoutes");
const orderRoutes = require("./orderRoutes");
const ticketRoutes = require("./ticketRoutes");
const adminRoutes = require("./adminRoutes");
const paymentRoutes = require("./paymentRoutes");

function registerRoutes(app) {
  app.use("/", publicRoutes);
  app.use("/auth2", auth2Routes);
  app.use("/account", accountRoutes);
  app.use("/cart", cartRoutes);
  app.use("/favorites", favoriteRoutes);
  app.use("/orders", orderRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/payments", paymentRoutes);
  app.use("/admin", adminRoutes);
}

module.exports = { registerRoutes };
