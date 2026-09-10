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

app.get('/api/venues', auth.authenticate, auth.requireRoles('event_coordinator', 'venue_staff'), async (req, res) => {
  try {
    const {
      search,
      date,
      startTime,
      endTime,
      attendance,
      layout,
      facility,
      accessibility,
      setupMinutes = '30',
      turnaroundMinutes = '30'
    } = req.query;
    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(v.name ILIKE $${params.length} OR v.location ILIKE $${params.length})`);
    }
    if (attendance) {
      params.push(Number(attendance));
      filters.push(`v.capacity >= $${params.length}`);
    }
    if (layout) {
      params.push(JSON.stringify([layout]));
      filters.push(`v.supported_layouts @> $${params.length}::jsonb`);
    }
    if (facility) {
      params.push(JSON.stringify([facility]));
      filters.push(`v.facilities @> $${params.length}::jsonb`);
    }
    if (accessibility) {
      params.push(`%${accessibility}%`);
      filters.push(`v.accessibility::text ILIKE $${params.length}`);
    }

    const hasDate = Boolean(date);
    const hasTime = Boolean(startTime || endTime);
    if (hasDate && hasTime && (!startTime || !endTime)) {
      return res.status(400).json({ error: 'Both startTime and endTime are required when filtering by time' });
    }
    if (hasTime && !hasDate) {
      return res.status(400).json({ error: 'Date is required when filtering by time' });
    }
    if (hasTime && endTime <= startTime) {
      return res.status(400).json({ error: 'End time must be later than start time' });
    }
    if (hasDate) {
      const startExpression = hasTime ? `${date} ${startTime}` : `${date} 00:00`;
      const endExpression = hasTime ? `${date} ${endTime}` : `${date} 24:00`;
      params.push(startExpression, endExpression, Number(setupMinutes), Number(turnaroundMinutes));
      const startParam = params.length - 3;
      const endParam = params.length - 2;
      const setupParam = params.length - 1;
      const turnaroundParam = params.length;
      filters.push(`NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.venue_id = v.id
          AND b.status = 'confirmed'
          AND b.start_time - (b.setup_minutes * interval '1 minute') < ($${endParam}::timestamptz + ($${turnaroundParam} * interval '1 minute'))
          AND b.end_time + (b.turnaround_minutes * interval '1 minute') > ($${startParam}::timestamptz - ($${setupParam} * interval '1 minute'))
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT id, name, location, capacity, facilities, accessibility, supported_layouts
       FROM venues v ${where} ORDER BY name LIMIT 100`,
      params
    );
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
