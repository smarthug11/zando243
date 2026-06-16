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
  if (!user) return { error: "NOT_FOUND" };
  // On ne bloque/débloque que des clients : empêche un admin de désactiver
  // un autre admin (ou lui-même) via un id forgé.
  if (user.role !== "CUSTOMER") return { error: "NOT_A_CUSTOMER" };

  await user.update({ isActive: action !== "block" });
  return { user };
}

module.exports = {
  listCustomerUsers,
  toggleUserBlock
};
