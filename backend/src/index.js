const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./db');

dotenv.config();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Simple endpoint to list venues (for UI scaffold)
app.get('/api/venues', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, location, capacity, facilities FROM venues ORDER BY name LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

// dev-only: run schema SQL via HTTP (idempotent if schema includes IF NOT EXISTS)
app.post('/api/init', async (req, res) => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await db.pool.query(sql);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'init failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend listening on port ${port}`));
