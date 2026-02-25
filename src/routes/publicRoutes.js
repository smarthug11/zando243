const express = require("express");
const ctrl = require("../controllers/publicController");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();
router.get("/", ctrl.home);
router.get("/products", ctrl.products);
router.get("/products/:slug", ctrl.productDetail);
router.post("/products/:slug/reviews", requireAuth, ...ctrl.reviewValidators, ctrl.submitReview);
router.get("/categories/:slug", ctrl.categoryPage);
router.get("/search", ctrl.search);
router.get("/sitemap.xml", ctrl.sitemap);
router.get("/robots.txt", ctrl.robots);

module.exports = router;
