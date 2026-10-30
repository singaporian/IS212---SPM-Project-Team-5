// US-017 - View Upcoming Bookings Calendar
// Integration tests for GET /api/bookings against an isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-017 Venue Staff view the upcoming bookings calendar', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us017_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const venueStaff = randomUUID(), attendee = randomUUID();
  const venueOne = randomUUID(), venueTwo = randomUUID();
  const eventConfirmedOne = randomUUID(), eventPendingOne = randomUUID(), eventConfirmedTwo = randomUUID();

  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'venues', 'events', 'bookings']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }

    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool;
    db.query = (...args) => pool.query(...args);

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES
        ($1, 'Venue Staff', 'venue-us017@test.local', 'x', 'venue_staff'),
        ($2, 'Attendee', 'attendee-us017@test.local', 'x', 'attendee')`,
      [venueStaff, attendee]
    );
    await pool.query(
      `INSERT INTO venues (id, name, default_setup_minutes, default_turnaround_minutes) VALUES
        ($1, 'Venue One', 15, 15),
        ($2, 'Venue Two', 20, 20)`,
      [venueOne, venueTwo]
    );
    await pool.query(
      `INSERT INTO events (id, title, status, expected_attendance) VALUES
        ($1, 'Confirmed One', 'approved', 40),
        ($2, 'Pending One', 'approved', 41),
        ($3, 'Confirmed Two', 'approved', 42)`,
      [eventConfirmedOne, eventPendingOne, eventConfirmedTwo]
    );

    const confirmedOne = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
       VALUES ($1, $2, now() + interval '7 days', now() + interval '7 days 2 hours', 'confirmed', 21, 36)
       RETURNING id, start_time, end_time`,
      [eventConfirmedOne, venueOne]
    );
    const pendingOne = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
       VALUES ($1, $2, now() + interval '8 days', now() + interval '8 days 2 hours', 'pending', 22, 37)
       RETURNING id`,
      [eventPendingOne, venueOne]
    );
    const confirmedTwo = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
       VALUES ($1, $2, now() + interval '9 days', now() + interval '9 days 2 hours', 'confirmed', 23, 38)
       RETURNING id`,
      [eventConfirmedTwo, venueTwo]
    );

    // A close-gap booking at venueOne: starts just 20 minutes after confirmedOne ends.
    const gapStart = new Date(new Date(confirmedOne.rows[0].end_time).getTime() + 20 * 60 * 1000);
    const gapEnd = new Date(gapStart.getTime() + 60 * 60 * 1000);
    const closeGapEvent = randomUUID();
    await pool.query(
      `INSERT INTO events (id, title, status, expected_attendance) VALUES ($1, 'Close Gap', 'approved', 30)`,
      [closeGapEvent]
    );
    const closeGap = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
       VALUES ($1, $2, $3, $4, 'confirmed', 10, 10)
       RETURNING id`,
      [closeGapEvent, venueOne, gapStart.toISOString(), gapEnd.toISOString()]
    );

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    function token(userId, role) {
      return jwt.sign({ id: userId, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    }

    async function call(path, authToken) {
      const r = await fetch(`${base}/api${path}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }

    await t.test('AC-017: no token is rejected with 401', async () => {
      const result = await call('/bookings');
      assert.equal(result.status, 401);
    });

    await t.test('AC-017: wrong role (attendee) is rejected with 403', async () => {
      const result = await call('/bookings', token(attendee, 'attendee'));
      assert.equal(result.status, 403);
    });

    await t.test('AC-017: venue staff can view the calendar, confirmed bookings only', async () => {
      const result = await call('/bookings', token(venueStaff, 'venue_staff'));
      assert.equal(result.status, 200);
      const ids = result.body.map((b) => b.id);
      assert.ok(ids.includes(confirmedOne.rows[0].id));
      assert.ok(ids.includes(confirmedTwo.rows[0].id));
      assert.ok(!ids.includes(pendingOne.rows[0].id), 'pending booking should not appear on the calendar');
    });

    await t.test('AC-017: each row carries its own setup/turnaround minutes and the venue defaults', async () => {
      const result = await call('/bookings', token(venueStaff, 'venue_staff'));
      const row = result.body.find((b) => b.id === confirmedOne.rows[0].id);
      assert.equal(row.setup_minutes, 21);
      assert.equal(row.turnaround_minutes, 36);
      assert.equal(row.default_setup_minutes, 15);
      assert.equal(row.default_turnaround_minutes, 15);
    });

    await t.test('AC-017: filtering by venueId returns only that venue, confirmed-only', async () => {
      const result = await call(`/bookings?venueId=${venueOne}`, token(venueStaff, 'venue_staff'));
      assert.equal(result.status, 200);
      assert.ok(result.body.every((b) => b.venue_id === venueOne));
      assert.ok(result.body.some((b) => b.id === confirmedOne.rows[0].id));
      assert.ok(!result.body.some((b) => b.id === pendingOne.rows[0].id));
    });

    await t.test('AC-017: a 20-minute gap is flagged insufficient against a 30-minute venue requirement (15+15)', async () => {
      const result = await call(`/bookings?venueId=${venueOne}`, token(venueStaff, 'venue_staff'));
      const first = result.body.find((b) => b.id === confirmedOne.rows[0].id);
      const second = result.body.find((b) => b.id === closeGap.rows[0].id);
      const requiredGap = Number(first.default_turnaround_minutes) + Number(second.default_setup_minutes);
      const actualGap = (new Date(second.start_time) - new Date(first.end_time)) / 60000;
      assert.ok(actualGap < requiredGap, `expected gap ${actualGap} to be less than required ${requiredGap}`);
    });

    await t.test('AC-017: lowering the venue default makes the same 20-minute gap sufficient (live, not stale, data)', async () => {
      await pool.query(`UPDATE venues SET default_setup_minutes = 5, default_turnaround_minutes = 5 WHERE id = $1`, [venueOne]);
      const result = await call(`/bookings?venueId=${venueOne}`, token(venueStaff, 'venue_staff'));
      const first = result.body.find((b) => b.id === confirmedOne.rows[0].id);
      const second = result.body.find((b) => b.id === closeGap.rows[0].id);
      const requiredGap = Number(first.default_turnaround_minutes) + Number(second.default_setup_minutes);
      const actualGap = (new Date(second.start_time) - new Date(first.end_time)) / 60000;
      assert.equal(requiredGap, 10);
      assert.ok(actualGap >= requiredGap, `expected gap ${actualGap} to be at least required ${requiredGap}`);
    });

    await t.test('AC-017: date-range filters (from/to) narrow the calendar', async () => {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = await call(`/bookings?from=${farFuture}`, token(venueStaff, 'venue_staff'));
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, []);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
