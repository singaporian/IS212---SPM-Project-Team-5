// US-020 - Mark Venue Unavailable
// These tests call the real venue-unavailability endpoints against an
// isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-020 venue staff mark a venue unavailable, list periods, and end one early', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us020_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const staff = randomUUID(), coordinator = randomUUID(), organiser = randomUUID();
  const venue = randomUUID(), event = randomUUID(), affectedBooking = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'venues', 'events', 'bookings', 'venue_unavailabilities', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);

    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [staff, 'venue_staff', 'staff@us020.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [coordinator, 'event_coordinator', 'coordinator@us020.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [organiser, 'event_organiser', 'organiser@us020.test']);
    await pool.query("INSERT INTO venues(id,name,capacity) VALUES($1,'Unavailable Hall',100)", [venue]);
    await pool.query(
      "INSERT INTO events(id,title,status,organiser_id,assigned_coordinator_id) VALUES($1,'Affected Event','confirmed',$2,$3)",
      [event, organiser, coordinator]
    );
    // Booking sits inside the unavailability window we're about to create (2099-06-01 10:00-12:00).
    await pool.query(
      "INSERT INTO bookings(id,event_id,venue_id,requested_by,status,start_time,end_time,setup_minutes,turnaround_minutes) VALUES($1,$2,$3,$4,'confirmed','2099-06-01T10:30:00+08:00','2099-06-01T11:30:00+08:00',30,30)",
      [affectedBooking, event, venue, coordinator]
    );

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
    const token = (role, user) => jwt.sign({ role, sub: user }, secret);

    async function call(path, method = 'GET', body, role = 'venue_staff', user = staff) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: { Authorization: 'Bearer ' + token(role, user), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }

    let createdId;

    await t.test('AC-020-003: invalid period input (bad id, missing times, end before start) is rejected', async () => {
      assert.equal((await call(`/venues/not-a-uuid/unavailability`, 'POST', { startTime: '2099-01-01T10:00:00+08:00', endTime: '2099-01-01T11:00:00+08:00', reasonCode: 'maintenance' })).status, 400);
      assert.equal((await call(`/venues/${venue}/unavailability`, 'POST', { startTime: 'not-a-date', endTime: '2099-01-01T11:00:00+08:00', reasonCode: 'maintenance' })).status, 400);
      assert.equal((await call(`/venues/${venue}/unavailability`, 'POST', { startTime: '2099-01-01T11:00:00+08:00', endTime: '2099-01-01T10:00:00+08:00', reasonCode: 'maintenance' })).status, 400);
    });

    await t.test('AC-020-001/002: invalid or missing reason is rejected', async () => {
      const noReason = await call(`/venues/${venue}/unavailability`, 'POST', { startTime: '2099-01-01T10:00:00+08:00', endTime: '2099-01-01T11:00:00+08:00' });
      assert.equal(noReason.status, 400);
      const otherNoDetail = await call(`/venues/${venue}/unavailability`, 'POST', { startTime: '2099-01-01T10:00:00+08:00', endTime: '2099-01-01T11:00:00+08:00', reasonCode: 'other' });
      assert.equal(otherNoDetail.status, 400);
    });

    await t.test('an unknown venue returns 404', async () => {
      const result = await call(`/venues/${randomUUID()}/unavailability`, 'POST', { startTime: '2099-01-01T10:00:00+08:00', endTime: '2099-01-01T11:00:00+08:00', reasonCode: 'maintenance' });
      assert.equal(result.status, 404);
    });

    await t.test('AC-020-004/005: a valid period is recorded and notifies the coordinator of the affected booking', async () => {
      const result = await call(`/venues/${venue}/unavailability`, 'POST', {
        startTime: '2099-06-01T10:00:00+08:00', endTime: '2099-06-01T12:00:00+08:00', reasonCode: 'maintenance'
      });
      assert.equal(result.status, 201);
      assert.equal(result.body.reason_code, 'maintenance');
      assert.equal(result.body.venue_name, 'Unavailable Hall');
      assert.equal(result.body.affected_bookings.length, 1);
      assert.equal(result.body.affected_bookings[0].id, affectedBooking);
      createdId = result.body.id;

      const notif = await pool.query('SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2', [coordinator, event]);
      assert.equal(notif.rows.length, 1);
      assert.match(notif.rows[0].message, /unavailable/i);
    });

    await t.test('AC-020-002: "Other" with a detail is recorded using that detail as the reason text', async () => {
      const result = await call(`/venues/${venue}/unavailability`, 'POST', {
        startTime: '2099-07-01T10:00:00+08:00', endTime: '2099-07-01T11:00:00+08:00', reasonCode: 'other', reasonDetail: 'Pest control'
      });
      assert.equal(result.status, 201);
      assert.equal(result.body.reason, 'Pest control');
      assert.equal(result.body.reason_code, 'other');
    });

    await t.test('AC-020-006: the unavailability list includes recorded periods', async () => {
      const result = await call('/venues/unavailability');
      assert.equal(result.status, 200);
      assert.ok(result.body.some(row => row.id === createdId));
    });

    await t.test('only venue staff may record or list unavailability', async () => {
      assert.equal((await call(`/venues/${venue}/unavailability`, 'POST', { startTime: '2099-01-01T10:00:00+08:00', endTime: '2099-01-01T11:00:00+08:00', reasonCode: 'maintenance' }, 'event_coordinator', coordinator)).status, 403);
      assert.equal((await call('/venues/unavailability', 'GET', undefined, 'event_coordinator', coordinator)).status, 403);
    });

    let activePeriodId;

    await t.test('AC-020-007: ending an active period early marks it ended and stops it showing as active', async () => {
      // Needs a period that is already active right now (started in the past, not yet ended),
      // unlike the far-future periods above used to test the affected-booking notification.
      const inserted = await pool.query(
        `INSERT INTO venue_unavailabilities (venue_id, start_time, end_time, reason, reason_code, created_by)
         VALUES ($1, now() - interval '1 hour', now() + interval '1 hour', 'Maintenance', 'maintenance', $2)
         RETURNING id`,
        [venue, staff]
      );
      activePeriodId = inserted.rows[0].id;

      const result = await call(`/venues/unavailability/${activePeriodId}/end`, 'PATCH');
      assert.equal(result.status, 200);
      assert.equal(result.body.ended_early, true);

      const row = await pool.query('SELECT ended_early, end_time <= now() AS already_ended FROM venue_unavailabilities WHERE id = $1', [activePeriodId]);
      assert.equal(row.rows[0].ended_early, true);
      assert.equal(row.rows[0].already_ended, true);
    });

    await t.test('ending an already-ended period again returns 404', async () => {
      const result = await call(`/venues/unavailability/${activePeriodId}/end`, 'PATCH');
      assert.equal(result.status, 404);
    });

    await t.test('ending an unknown or malformed id is rejected', async () => {
      assert.equal((await call(`/venues/unavailability/${randomUUID()}/end`, 'PATCH')).status, 404);
      assert.equal((await call('/venues/unavailability/not-a-uuid/end', 'PATCH')).status, 400);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    db.pool = originalPool;
    db.query = originalQuery;
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  }
});
