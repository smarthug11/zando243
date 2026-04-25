const { body } = require("express-validator");
const { asyncHandler } = require("../../utils/asyncHandler");
const adminCategoryService = require("../../services/adminCategoryService");
const { handleValidation } = require("../../middlewares/validators");

const categoryValidators = [body("name").notEmpty(), handleValidation];

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
