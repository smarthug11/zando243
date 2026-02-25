"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const isPostgres = queryInterface.sequelize.getDialect() === "postgres";
    const jsonType = isPostgres ? Sequelize.JSONB : Sequelize.JSON;
    const nowDefault = isPostgres ? Sequelize.fn("NOW") : Sequelize.literal("CURRENT_TIMESTAMP");
    await queryInterface.createTable("audit_logs", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      category: { type: Sequelize.STRING, allowNull: false },
      level: { type: Sequelize.STRING, allowNull: false, defaultValue: "INFO" },
      action: { type: Sequelize.STRING, allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      meta: { type: jsonType, allowNull: true },
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL"
      },
      actor_email: { type: Sequelize.STRING, allowNull: true },
      request_id: { type: Sequelize.STRING, allowNull: true },
      ip: { type: Sequelize.STRING, allowNull: true },
      user_agent: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault }
    });

    await queryInterface.addIndex("audit_logs", ["category"]);
    await queryInterface.addIndex("audit_logs", ["level"]);
    await queryInterface.addIndex("audit_logs", ["created_at"]);
    await queryInterface.addIndex("audit_logs", ["actor_user_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("audit_logs");
  }
};
