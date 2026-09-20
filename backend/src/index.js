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
    const layouts = (Array.isArray(layout) ? layout : layout ? [layout] : []).filter(Boolean);
    if (layouts.length) {
      params.push(layouts);
      filters.push(`v.supported_layouts ?| $${params.length}::text[]`);
    }
    const facilities = (Array.isArray(facility) ? facility : facility ? [facility] : []).filter(Boolean);
    if (facilities.length) {
      params.push(facilities);
      filters.push(`v.facilities ?| $${params.length}::text[]`);
    }
    const accessibilityNeeds = (Array.isArray(accessibility) ? accessibility : accessibility ? [accessibility] : []).filter(Boolean);
    if (accessibilityNeeds.length) {
      params.push(accessibilityNeeds);
      filters.push(`v.accessibility ?| $${params.length}::text[]`);
    }

    let dateParam;
    if (date) {
      params.push(date);
      dateParam = params.length;
      filters.push(`$${dateParam}::date BETWEEN v.available_from AND v.available_until`);
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
    if (hasDate && hasTime) {
      const startExpression = hasTime ? `${date} ${startTime}+08:00` : `${date} 00:00+08:00`;
      const endExpression = hasTime ? `${date} ${endTime}+08:00` : `${date} 24:00+08:00`;
      params.push(startExpression, endExpression, Number(setupMinutes), Number(turnaroundMinutes));
      const startParam = params.length - 3;
      const endParam = params.length - 2;
      const setupParam = params.length - 1;
      const turnaroundParam = params.length;
      filters.push(`EXISTS (
        SELECT 1 FROM venue_operating_hours voh
        WHERE voh.venue_id = v.id
          AND voh.day_of_week = EXTRACT(DOW FROM ($${startParam}::timestamptz AT TIME ZONE 'Asia/Singapore'))
          AND voh.opens_at <= (($${startParam}::timestamptz AT TIME ZONE 'Asia/Singapore')::time)
          AND voh.closes_at >= (($${endParam}::timestamptz AT TIME ZONE 'Asia/Singapore')::time)
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.venue_id = v.id
          AND b.status = 'confirmed'
          AND b.start_time - (b.setup_minutes * interval '1 minute') < ($${endParam}::timestamptz + ($${turnaroundParam} * interval '1 minute'))
          AND b.end_time + (b.turnaround_minutes * interval '1 minute') > ($${startParam}::timestamptz - ($${setupParam} * interval '1 minute'))
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM venue_unavailabilities vu
        WHERE vu.venue_id = v.id
          AND vu.start_time < ($${endParam}::timestamptz + ($${turnaroundParam} * interval '1 minute'))
          AND vu.end_time > ($${startParam}::timestamptz - ($${setupParam} * interval '1 minute'))
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const unavailablePeriods = hasDate ? `(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'start_time', vu.start_time,
          'end_time', vu.end_time,
          'reason', vu.reason
        ) ORDER BY vu.start_time), '[]'::jsonb)
        FROM venue_unavailabilities vu
        WHERE vu.venue_id = v.id
          AND vu.start_time < (($${dateParam}::date::text || ' 00:00:00+08:00')::timestamptz + interval '1 day')
          AND vu.end_time > ($${dateParam}::date::text || ' 00:00:00+08:00')::timestamptz
      ) AS unavailable_periods,` : "'[]'::jsonb AS unavailable_periods,";
    const result = await db.query(
      `SELECT id, name, location, capacity, facilities, accessibility, supported_layouts,
        ${unavailablePeriods}
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', vi.id,
          'url', vi.image_url,
          'alt_text', vi.alt_text,
          'is_primary', vi.is_primary
        ) ORDER BY vi.is_primary DESC, vi.sort_order, vi.created_at), '[]'::jsonb)
         FROM venue_images vi WHERE vi.venue_id = v.id) AS images
       FROM venues v ${where} ORDER BY name LIMIT 100`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

// US-011: unassigned queue (submitted, no coordinator yet), oldest first
app.get('/api/events/unassigned', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, status, created_at
       FROM events
       WHERE status = 'submitted' AND assigned_coordinator_id IS NULL
       ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch unassigned requests' });
  }
});

// US-012: requests currently assigned to the logged-in coordinator
app.get('/api/events/assigned', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, status, created_at
       FROM events
       WHERE assigned_coordinator_id = $1
       ORDER BY created_at DESC`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assigned requests' });
  }
});

// US-011: assign an unassigned request to self (fails gracefully if already taken)
app.patch('/api/events/:id/assign', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE events SET assigned_coordinator_id = $1
       WHERE id = $2 AND status = 'submitted' AND assigned_coordinator_id IS NULL
       RETURNING id, title, assigned_coordinator_id`,
      [req.auth.sub, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(409).json({ error: 'This request has already been assigned' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign request' });
  }
});

// US-011: release a request back to the unassigned queue
app.patch('/api/events/:id/unassign', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE events SET assigned_coordinator_id = NULL
       WHERE id = $1 AND assigned_coordinator_id = $2
       RETURNING id, title`,
      [req.params.id, req.auth.sub]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Request not found or not assigned to you' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unassign request' });
  }
});

// US-012: full read-only detail, only visible if assigned to this coordinator
app.get('/api/events/:id', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM events WHERE id = $1 AND assigned_coordinator_id = $2`,
      [req.params.id, req.auth.sub]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'Not authorised to view this request' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch request details' });
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
