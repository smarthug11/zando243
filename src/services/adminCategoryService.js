const { defineModels } = require("../models");
const { toSlug } = require("../utils/slugify");

defineModels();

async function listCategories() {
  const models = defineModels();
  return models.Category.findAll({ order: [["name", "ASC"]] });
}

async function createCategory(payload) {
  const models = defineModels();
  return models.Category.create({
    name: payload.name,
    slug: toSlug(payload.name),
    parentId: payload.parentId || null
  });
}

async function updateCategory(categoryId, payload) {
  const models = defineModels();
  const category = await models.Category.findByPk(categoryId);
  if (!category) return null;

  Object.assign(category, {
    name: payload.name,
    slug: toSlug(payload.name),
    parentId: payload.parentId || null
  });
  await category.save();
  return category;
}

async function deleteCategory(categoryId) {
  const models = defineModels();
  await models.Category.destroy({ where: { id: categoryId } });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory
};
