process.env.NODE_ENV = "test";
if (!process.env.DB_NAME) process.env.DB_NAME = "zando243_test";
if (!process.env.DB_HOST) process.env.DB_HOST = "127.0.0.1";
if (!process.env.DB_PORT) process.env.DB_PORT = "5432";
if (!process.env.DB_USER) process.env.DB_USER = "postgres";
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = "postgres";
process.env.DB_LOG = process.env.DB_LOG || "false";

if (!process.env.JWT_ACCESS_SECRET)  process.env.JWT_ACCESS_SECRET  = "test_access_secret_for_jwt_signing_xxxxx";
if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = "test_refresh_secret_for_jwt_signing_xxxx";
if (!process.env.COOKIE_SECRET)      process.env.COOKIE_SECRET      = "test_cookie_secret_xxxxxxxxxxxxxxxxxxx";
if (!process.env.SESSION_SECRET)     process.env.SESSION_SECRET     = "test_session_secret_xxxxxxxxxxxxxxxxxx";
if (process.env.CSRF_ENABLED === undefined) process.env.CSRF_ENABLED = "false";

const pg = require("pg");

async function ensureTestDatabaseExists() {
  const target = process.env.DB_NAME;
  const admin = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "postgres"
  });
  await admin.connect();
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${target}"`);
    }
  } finally {
    await admin.end();
  }
}

module.exports = { ensureTestDatabaseExists };
