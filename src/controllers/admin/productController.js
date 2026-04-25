const { body } = require("express-validator");
const { asyncHandler } = require("../../utils/asyncHandler");
const adminProductService = require("../../services/adminProductService");
const { createAuditLog } = require("../../services/auditLogService");
const { handleValidation } = require("../../middlewares/validators");

const productValidators = [body("name").notEmpty(), body("priceWithoutDelivery").isFloat({ min: 0 }), body("weightKg").isFloat({ min: 0.01 }), body("stock").isInt({ min: 0 }), handleValidation];

const productsPage = asyncHandler(async (req, res) => {
  const { products, categories, filters } = await adminProductService.listProducts(req.query);
  res.render("pages/admin/products", {
    title: "Admin Produits",
    products,
    categories,
    filters
  });
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.createProductFromAdmin(req.body);
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_CREATE",
    message: `Produit créé: ${product.name}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: product.id, sku: product.sku }
  });
  res.redirect("/admin/products");
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.updateProductFromAdmin(req.params.id, req.body);
  if (!product) return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_UPDATE",
    message: `Produit modifié: ${product.name}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: product.id, sku: product.sku }
  });
  res.redirect("/admin/products");
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.deleteProductFromAdmin(req.params.id);
  await createAuditLog({
    category: "PRODUCT",
    action: "ADMIN_PRODUCT_DELETE",
    message: `Produit supprimé: ${product?.name || req.params.id}`,
    actorUserId: req.user?.id,
    actorEmail: req.user?.email,
    requestId: req.requestId,
    req,
    meta: { productId: req.params.id }
  });
  res.redirect("/admin/products");
});

const addProductImage = asyncHandler(async (req, res) => {
  const result = await adminProductService.addProductImageFromAdmin(req.params.id, req.body);
  if (result.error === "PRODUCT_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  if (result.error === "VARIANT_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  if (result.error === "INVALID_IMAGE_URL") {
    return res.status(400).render("pages/errors/error", {
      title: "URL invalide",
      error: { message: "L'URL de l'image doit commencer par https://" },
      status: 400
    });
  }
  res.redirect("/admin/products");
});

const updateProductImage = asyncHandler(async (req, res) => {
  const result = await adminProductService.updateProductImageFromAdmin(req.params.id, req.params.imageId, req.body);
  if (result.error === "IMAGE_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Image introuvable" });
  if (result.error === "VARIANT_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  if (result.error === "INVALID_IMAGE_URL") {
    return res.status(400).render("pages/errors/error", {
      title: "URL invalide",
      error: { message: "L'URL de l'image doit commencer par https://" },
      status: 400
    });
  }
  res.redirect("/admin/products");
});

const deleteProductImage = asyncHandler(async (req, res) => {
  await adminProductService.deleteProductImageFromAdmin(req.params.id, req.params.imageId);
  res.redirect("/admin/products");
});

const addProductVariant = asyncHandler(async (req, res) => {
  const result = await adminProductService.addProductVariantFromAdmin(req.params.id, req.body);
  if (result.error === "PRODUCT_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Produit introuvable" });
  res.redirect("/admin/products");
});

const updateProductVariant = asyncHandler(async (req, res) => {
  const result = await adminProductService.updateProductVariantFromAdmin(req.params.id, req.params.variantId, req.body);
  if (result.error === "VARIANT_NOT_FOUND") return res.status(404).render("pages/errors/404", { title: "Variante introuvable" });
  res.redirect("/admin/products");
});

const deleteProductVariant = asyncHandler(async (req, res) => {
  await adminProductService.deleteProductVariantFromAdmin(req.params.id, req.params.variantId);
  res.redirect("/admin/products");
});

module.exports = {
  productValidators,
  productsPage,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImage,
  updateProductImage,
  deleteProductImage,
  addProductVariant,
  updateProductVariant,
  deleteProductVariant
};
