const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const db = require('../src/db');

const passwordSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';

function token(userId, role) {
  return jwt.sign({ sub: userId, role }, passwordSecret);
}

test('US-036 creates multiple independent venue bookings for one event and decides them separately', async () => {
  const originalPool = db.pool;
  const originalQuery = db.query;
  const schema = `us036_test_${randomUUID().replaceAll('-', '')}`;
  let pool;
  let server;

  try {
    await originalPool.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ['users', 'events', 'venues', 'bookings', 'notifications']) {
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

    const coordinatorId = randomUUID();
    const venueStaffId = randomUUID();
    const organiserId = randomUUID();
    const eventId = randomUUID();
    const venueOneId = randomUUID();
    const venueTwoId = randomUUID();

    await pool.query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)', [
      coordinatorId, 'Coordinator', 'coordinator@us036.test', 'unused', 'event_coordinator',
      venueStaffId, 'Venue Staff', 'venue@us036.test', 'unused', 'venue_staff',
      organiserId, 'Organiser', 'organiser@us036.test', 'unused', 'event_organiser'
    ]);
    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, expected_attendance)
       VALUES ($1, $2, $3, 'US-036 Multi-space Event', 'submitted', 120)`,
      [eventId, organiserId, coordinatorId]
    );
    await pool.query(
      `INSERT INTO venues (id, name, capacity, facilities, accessibility, supported_layouts)
       VALUES ($1, 'Main Auditorium', 200, '[]', '[]', '[]'), ($2, 'Breakout Room', 80, '[]', '[]', '[]')`,
      [venueOneId, venueTwoId]
    );

    const app = require('../src/index');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const coordinatorToken = token(coordinatorId, 'event_coordinator');
    const venueStaffToken = token(venueStaffId, 'venue_staff');

    async function request(path, options = {}) {
      const response = await fetch(base + path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      return { status: response.status, body: await response.json() };
    }

    const batch = await request('/api/bookings/requests/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      body: JSON.stringify({
        eventId,
        bookings: [
          { venueId: venueOneId, requiredCapacity: 120, startTime: '2027-01-15T10:00:00+08:00', endTime: '2027-01-15T12:00:00+08:00', setupMinutes: 30, turnaroundMinutes: 45, venueRequirements: { description: 'Main programme' } },
          { venueId: venueTwoId, requiredCapacity: 60, startTime: '2027-01-15T10:00:00+08:00', endTime: '2027-01-15T12:00:00+08:00', setupMinutes: 20, turnaroundMinutes: 30, venueRequirements: { description: 'Breakout session' } }
        ]
      })
    });
    assert.equal(batch.status, 201);
    assert.equal(batch.body.bookings.length, 2);
    assert.ok(batch.body.bookings.every((booking) => booking.event_id === eventId));
    assert.deepEqual(new Set(batch.body.bookings.map((booking) => booking.venue_id)), new Set([venueOneId, venueTwoId]));

    const stored = await pool.query('SELECT id, event_id, venue_id, status, required_capacity FROM bookings ORDER BY created_at');
    assert.equal(stored.rows.length, 2);
    assert.deepEqual(stored.rows.map((booking) => booking.required_capacity).sort((a, b) => a - b), [60, 120]);

    const firstBooking = batch.body.bookings[0];
    const decision = await request(`/api/bookings/${firstBooking.id}/decision`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${venueStaffToken}` },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(decision.status, 200);

    const statuses = await pool.query('SELECT venue_id, status FROM bookings ORDER BY venue_id');
    assert.equal(statuses.rows.find((row) => row.venue_id === firstBooking.venue_id).status, 'approved');
    assert.equal(statuses.rows.find((row) => row.venue_id !== firstBooking.venue_id).status, 'pending');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});
