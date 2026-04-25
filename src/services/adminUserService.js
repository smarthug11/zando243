const { defineModels } = require("../models");

defineModels();

async function listCustomerUsers() {
  const models = defineModels();
  return models.User.findAll({
    where: { role: "CUSTOMER" },
    order: [["createdAt", "DESC"]],
    limit: 100
  });
}

async function toggleUserBlock(userId, action) {
  const models = defineModels();
  const user = await models.User.findByPk(userId);
  if (!user) return null;

  await user.update({ isActive: action !== "block" });
  return user;
}

module.exports = {
  listCustomerUsers,
  toggleUserBlock
};
