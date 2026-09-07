const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await db.pool.query(sql);
    console.log('Schema executed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  }
}

run();
