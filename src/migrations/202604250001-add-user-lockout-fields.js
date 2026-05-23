"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable("users");
    if (!desc.failed_login_attempts) {
      await queryInterface.addColumn("users", "failed_login_attempts", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
    if (!desc.locked_until) {
      await queryInterface.addColumn("users", "locked_until", {
        type: Sequelize.DATE,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const desc = await queryInterface.describeTable("users");
    if (desc.locked_until) await queryInterface.removeColumn("users", "locked_until");
    if (desc.failed_login_attempts) await queryInterface.removeColumn("users", "failed_login_attempts");
  }
};
