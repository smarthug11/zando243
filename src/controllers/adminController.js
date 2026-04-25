const { defineModels } = require("../models");

defineModels();

module.exports = {
  ...require("./admin/dashboardController"),
  ...require("./admin/categoryController"),
  ...require("./admin/couponController"),
  ...require("./admin/reviewController"),
  ...require("./admin/userController"),
  ...require("./admin/logController"),
  ...require("./admin/logisticsController"),
  ...require("./admin/refundController"),
  ...require("./admin/orderController"),
  ...require("./admin/productController")
};
