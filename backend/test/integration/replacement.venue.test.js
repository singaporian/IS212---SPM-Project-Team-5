const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';

test('US-037 preserves affected bookings, notifies the Coordinator, and allows a replacement venue', async () => {
  const originalPool = db.pool;
  const originalQuery = db.query;
  const schema = `us037_test_${randomUUID().replaceAll('-', '')}`;
  let pool;
  let server;

  try {
    await originalPool.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ['users', 'events', 'venues', 'bookings', 'notifications', 'venue_unavailabilities']) {
      await originalPool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'connectsphere',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      options: `-c search_path=${schema},public`
    });
    db.pool = pool;
    db.query = (sql, params) => pool.query(sql, params);

    const organiserId = randomUUID();
    const coordinatorId = randomUUID();
    const venueStaffId = randomUUID();
    const eventId = randomUUID();
    const originalVenueId = randomUUID();
    const replacementVenueId = randomUUID();
    const originalBookingId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES
       ($1, 'Organiser', $2, 'unused', 'event_organiser'),
       ($3, 'Coordinator', $4, 'unused', 'event_coordinator'),
       ($5, 'Venue Staff', $6, 'unused', 'venue_staff')`,
      [organiserId, `${organiserId}@test.local`, coordinatorId, `${coordinatorId}@test.local`, venueStaffId, `${venueStaffId}@test.local`]
    );
    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, expected_attendance)
       VALUES ($1, $2, $3, 'US-037 affected event', 'submitted', 50)`,
      [eventId, organiserId, coordinatorId]
    );
    await pool.query(
      `INSERT INTO venues (id, name, capacity, facilities, accessibility, supported_layouts)
       VALUES ($1, 'Original venue', 100, '[]', '[]', '[]'), ($2, 'Replacement venue', 100, '[]', '[]', '[]')`,
      [originalVenueId, replacementVenueId]
    );
    await pool.query(
      `INSERT INTO bookings (id, event_id, venue_id, requested_by, required_capacity, start_time, end_time, status, setup_minutes, turnaround_minutes, venue_requirements)
       VALUES ($1, $2, $3, $4, 50, '2027-02-10T10:00:00+08:00', '2027-02-10T12:00:00+08:00', 'approved', 30, 30, '{"description":"Original arrangement"}')`,
      [originalBookingId, eventId, originalVenueId, coordinatorId]
    );

    const app = require('../../src/index');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const authToken = (id, role) => jwt.sign({ sub: id, role }, secret);
    async function request(path, options = {}) {
      const response = await fetch(base + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      return { status: response.status, body: await response.json() };
    }

    const unavailable = await request(`/api/venues/${originalVenueId}/unavailability`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken(venueStaffId, 'venue_staff')}` },
      body: JSON.stringify({ startTime: '2027-02-10T09:00:00+08:00', endTime: '2027-02-10T13:00:00+08:00', reason: 'Maintenance' })
    });
    assert.equal(unavailable.status, 201);
    assert.equal(unavailable.body.affected_bookings.length, 1);
    assert.equal(unavailable.body.affected_bookings[0].id, originalBookingId);

    const notifications = await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1', [eventId]);
    assert.equal(notifications.rows.length, 1);
    assert.equal(notifications.rows[0].user_id, coordinatorId);
    assert.match(notifications.rows[0].message, /replacement arrangements/i);

    const affected = await request('/api/bookings/affected', {
      headers: { Authorization: `Bearer ${authToken(coordinatorId, 'event_coordinator')}` }
    });
    assert.equal(affected.status, 200);
    assert.equal(affected.body.length, 1);
    assert.equal(affected.body[0].venue_name, 'Original venue');
    assert.equal(affected.body[0].unavailable_reason, 'Maintenance');

    const replacement = await request('/api/bookings/requests/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken(coordinatorId, 'event_coordinator')}` },
      body: JSON.stringify({
        eventId,
        bookings: [{ venueId: replacementVenueId, requiredCapacity: 50, startTime: '2027-02-10T10:00:00+08:00', endTime: '2027-02-10T12:00:00+08:00', venueRequirements: { description: 'Replacement arrangement' } }]
      })
    });
    assert.equal(replacement.status, 201);
    assert.equal(replacement.body.bookings.length, 1);

    const stored = await pool.query('SELECT id, venue_id, status FROM bookings WHERE event_id = $1 ORDER BY id', [eventId]);
    assert.equal(stored.rows.length, 2);
    assert.equal(stored.rows.find((row) => row.id === originalBookingId).status, 'approved');
    assert.equal(stored.rows.find((row) => row.id !== originalBookingId).status, 'pending');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});
