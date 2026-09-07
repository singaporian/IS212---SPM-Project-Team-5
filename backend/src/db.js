const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const configuredHost = (process.env.DB_HOST === 'localhost') ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1');

const pool = new Pool({
  host: configuredHost,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME || 'connectsphere',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
