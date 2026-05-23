const { body, validationResult } = require("express-validator");
const { asyncHandler } = require("../../utils/asyncHandler");
const adminCategoryService = require("../../services/adminCategoryService");
const { setFlash } = require("../../middlewares/viewLocals");

function handleCategoryValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const firstMessage = errors.array().find((error) => typeof error.msg === "string" && error.msg)?.msg;
  setFlash(req, "error", firstMessage || "Catégorie invalide.");
  return res.redirect("/admin/categories");
}

const categoryValidators = [
  body("name").trim().notEmpty().withMessage("Le nom de catégorie est requis."),
  body("parentId").optional({ values: "falsy" }).isUUID().withMessage("Le parent sélectionné est invalide."),
  handleCategoryValidation
];

const categoriesPage = asyncHandler(async (_req, res) => {
  const categories = await adminCategoryService.listCategories();
  res.render("pages/admin/categories", { title: "Admin Catégories", categories });
});

const createCategory = asyncHandler(async (req, res) => {
  await adminCategoryService.createCategory(req.body);
  res.redirect("/admin/categories");
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await adminCategoryService.updateCategory(req.params.id, req.body);
  if (!category) return res.status(404).render("pages/errors/404", { title: "Catégorie introuvable" });
  res.redirect("/admin/categories");
});

const deleteCategory = asyncHandler(async (req, res) => {
  await adminCategoryService.deleteCategory(req.params.id);
  res.redirect("/admin/categories");
});

module.exports = {
  categoryValidators,
  categoriesPage,
  createCategory,
  updateCategory,
  deleteCategory
};
