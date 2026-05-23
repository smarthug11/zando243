"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("auth_user", {
      id:             { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      name:           { type: Sequelize.STRING, allowNull: false },
      email:          { type: Sequelize.STRING, allowNull: false, unique: true },
      emailVerified:  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      image:          { type: Sequelize.STRING, allowNull: true },
      role:           { type: Sequelize.STRING, allowNull: false, defaultValue: "CUSTOMER" },
      firstName:      { type: Sequelize.STRING, allowNull: false },
      lastName:       { type: Sequelize.STRING, allowNull: false },
      phone:          { type: Sequelize.STRING, allowNull: true },
      createdAt:      { type: Sequelize.DATE, allowNull: false },
      updatedAt:      { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable("auth_session", {
      id:        { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      userId:    { type: Sequelize.UUID, allowNull: false, references: { model: "auth_user", key: "id" }, onDelete: "CASCADE" },
      token:     { type: Sequelize.STRING, allowNull: false, unique: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      ipAddress: { type: Sequelize.STRING, allowNull: true },
      userAgent: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable("auth_account", {
      id:                    { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      userId:                { type: Sequelize.UUID, allowNull: false, references: { model: "auth_user", key: "id" }, onDelete: "CASCADE" },
      providerId:            { type: Sequelize.STRING, allowNull: false },
      accountId:             { type: Sequelize.STRING, allowNull: false },
      password:              { type: Sequelize.STRING, allowNull: true },
      accessToken:           { type: Sequelize.TEXT, allowNull: true },
      refreshToken:          { type: Sequelize.TEXT, allowNull: true },
      accessTokenExpiresAt:  { type: Sequelize.DATE, allowNull: true },
      refreshTokenExpiresAt: { type: Sequelize.DATE, allowNull: true },
      scope:                 { type: Sequelize.STRING, allowNull: true },
      idToken:               { type: Sequelize.TEXT, allowNull: true },
      createdAt:             { type: Sequelize.DATE, allowNull: false },
      updatedAt:             { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable("auth_verification", {
      id:         { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      identifier: { type: Sequelize.STRING, allowNull: false },
      value:      { type: Sequelize.STRING, allowNull: false },
      expiresAt:  { type: Sequelize.DATE, allowNull: false },
      createdAt:  { type: Sequelize.DATE, allowNull: false },
      updatedAt:  { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex("auth_session", ["userId"], { name: "auth_session_user_id_idx" });
    await queryInterface.addIndex("auth_account", ["userId"], { name: "auth_account_user_id_idx" });
    await queryInterface.addIndex("auth_account", ["providerId", "accountId"], { name: "auth_account_provider_account_idx" });
    await queryInterface.addIndex("auth_verification", ["identifier"], { name: "auth_verification_identifier_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("auth_verification");
    await queryInterface.dropTable("auth_account");
    await queryInterface.dropTable("auth_session");
    await queryInterface.dropTable("auth_user");
  }
};
