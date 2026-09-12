const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

dotenv.config();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/api/drafts', require('./drafts').router);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    res.status(201).json(await auth.register(req.body));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    res.json(await auth.login(req.body));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Login failed' });
  }
});

app.get('/api/auth/me', auth.authenticate, async (req, res) => {
  const result = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.auth.sub]);
  if (!result.rows[0]) return res.status(401).json({ error: 'User no longer exists' });
  res.json({ user: result.rows[0] });
});

// Simple endpoint to list venues (for UI scaffold)
app.get('/api/venues', auth.authenticate, auth.requireRoles('event_coordinator', 'venue_staff'), async (req, res) => {
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
