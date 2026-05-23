require("dotenv").config();

const baseConfig = {
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  dialect: "postgres"
};

module.exports = {
  development: { ...baseConfig, database: process.env.DB_NAME || "zando243_db" },
  test:        { ...baseConfig, database: process.env.DB_NAME || "zando243_test" },
  production:  { ...baseConfig, database: process.env.DB_NAME }
};
