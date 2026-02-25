const publicRoutes = require("./publicRoutes");
const authRoutes = require("./authRoutes");
const accountRoutes = require("./accountRoutes");
const cartRoutes = require("./cartRoutes");
const favoriteRoutes = require("./favoriteRoutes");
const orderRoutes = require("./orderRoutes");
const ticketRoutes = require("./ticketRoutes");
const adminRoutes = require("./adminRoutes");

function registerRoutes(app) {
  app.use("/", publicRoutes);
  app.use("/auth", authRoutes);
  app.use("/account", accountRoutes);
  app.use("/cart", cartRoutes);
  app.use("/favorites", favoriteRoutes);
  app.use("/orders", orderRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/admin", adminRoutes);
}

module.exports = { registerRoutes };
