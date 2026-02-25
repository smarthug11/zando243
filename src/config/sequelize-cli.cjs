require("dotenv").config();

module.exports = {
  development: {
    dialect: "sqlite",
    storage: process.env.SQLITE_STORAGE || "./storage/dev.sqlite"
  },
  test: {
    dialect: "sqlite",
    storage: process.env.SQLITE_STORAGE_TEST || "./storage/test.sqlite"
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    dialect: "postgres"
  }
};
