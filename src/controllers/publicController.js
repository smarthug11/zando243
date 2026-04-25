const { asyncHandler } = require("../utils/asyncHandler");
const catalogService = require("../services/catalogService");
const { ensureCartIdentity } = require("../services/cartService");
const reviewService = require("../services/reviewService");
const seoService = require("../services/seoService");
const { body } = require("express-validator");
const { handleValidation } = require("../middlewares/validators");
const { setFlash } = require("../middlewares/viewLocals");

const home = asyncHandler(async (req, res) => {
  const identity = await ensureCartIdentity(req);
  const [{ products }, categories, recent] = await Promise.all([
    catalogService.listProducts({ page: 1, limit: 8, sort: "popular" }),
    catalogService.listCategories(),
    catalogService.getRecentlyViewed({ userId: req.user?.id, sessionId: identity.sessionId })
  ]);
  res.render("pages/home", { title: "Accueil", products, categories, recent });
});

const products = asyncHandler(async (req, res) => {
  const result = await catalogService.listProducts(req.query);
  const categories = await catalogService.listCategories();
  res.render("pages/products/list", {
    title: "Produits",
    ...result,
    categories,
    filters: req.query
  });
});

const productDetail = asyncHandler(async (req, res) => {
  const identity = await ensureCartIdentity(req);
  const product = await catalogService.getProductBySlug(req.params.slug);
  if (!product) return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  await catalogService.trackRecentlyViewed({
    userId: req.user?.id,
    sessionId: identity.sessionId,
    productId: product.id
  });
  const similar = (await catalogService.listProducts({ category: product.Category?.slug, limit: 4 })).products.filter(
    (p) => p.id !== product.id
  );
  res.render("pages/products/detail", { title: product.name, product, similar });
});

const categoryPage = asyncHandler(async (req, res) => {
  const category = await catalogService.getCategoryBySlug(req.params.slug);
  if (!category) return res.status(404).render("pages/errors/404", { title: "Catégorie introuvable" });
  const result = await catalogService.listProducts({ ...req.query, category: category.slug });
  res.render("pages/products/list", { title: category.name, ...result, categories: await catalogService.listCategories(), filters: { ...req.query, category: category.slug } });
});

const search = asyncHandler(async (req, res) => {
  const result = await catalogService.listProducts(req.query);
  res.render("pages/products/list", { title: `Recherche: ${req.query.q || ""}`, ...result, categories: await catalogService.listCategories(), filters: req.query });
});

const reviewValidators = [
  body("rating").isInt({ min: 1, max: 5 }),
  body("comment").optional({ values: "falsy" }).isLength({ max: 2000 }),
  handleValidation
];

const submitReview = asyncHandler(async (req, res) => {
  await reviewService.createOrUpdateReview({
    userId: req.user.id,
    productSlug: req.params.slug,
    rating: req.body.rating,
    comment: req.body.comment
  });
  setFlash(req, "success", "Votre avis a été enregistré.");
  res.redirect(`/products/${req.params.slug}#reviews`);
});

const sitemap = asyncHandler(async (_req, res) => {
  const xml = await seoService.generateSitemapXml(res.locals.app.url);
  res.type("application/xml").send(xml);
});

function robots(_req, res) {
  res.type("text/plain").send(seoService.generateRobotsTxt());
}

module.exports = {
  home,
  products,
  productDetail,
  categoryPage,
  search,
  reviewValidators,
  submitReview,
  sitemap,
  robots
};
