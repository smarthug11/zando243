"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("product_images");
    if (!table.variant_id) {
      await queryInterface.addColumn("product_images", "variant_id", {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "product_variants", key: "id" },
        onDelete: "SET NULL"
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("product_images");
    if (table.variant_id) {
      await queryInterface.removeColumn("product_images", "variant_id");
    }
  }
};
