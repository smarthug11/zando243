"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const S = Sequelize;
    await queryInterface.addColumn("orders", "payment_status", {
      type: S.STRING,
      allowNull: false,
      defaultValue: "PENDING"
    });
    await queryInterface.addColumn("orders", "payment_provider", {
      type: S.STRING
    });
    await queryInterface.addColumn("orders", "payment_reference", {
      type: S.STRING
    });
    await queryInterface.addColumn("orders", "paid_at", {
      type: S.DATE
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("orders", "paid_at");
    await queryInterface.removeColumn("orders", "payment_reference");
    await queryInterface.removeColumn("orders", "payment_provider");
    await queryInterface.removeColumn("orders", "payment_status");
  }
};
