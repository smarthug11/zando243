const { Sequelize } = require("sequelize");
const { env } = require("./env");

const commonConfig = {
  logging: env.db.logging ? console.log : false
};

const sequelize =
  env.db.dialect === "sqlite"
    ? new Sequelize({
        dialect: "sqlite",
        storage: env.db.sqliteStorage,
        ...commonConfig
      })
    : new Sequelize(env.db.name, env.db.user, env.db.password, {
        host: env.db.host,
        port: env.db.port,
        dialect: "postgres",
        ...commonConfig
      });

module.exports = { sequelize };
