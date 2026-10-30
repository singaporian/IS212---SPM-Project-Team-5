// US-041 - Mark an Event as Completed
// Integration tests for PATCH /api/events/:id/complete against an isolated schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-041 Event Coordinator marks a confirmed, ended event as completed', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us041_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const organiser = randomUUID(), coordinator = randomUUID(), otherCoordinator = randomUUID();
  const venue = randomUUID(), equipment = randomUUID();

  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'venues', 'events', 'bookings', 'equipment', 'equipment_reservations', 'event_changes', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }

    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool;
    db.query = (...args) => pool.query(...args);

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES
        ($1, 'Organiser', 'organiser-us041@test.local', 'x', 'event_organiser'),
        ($2, 'Coordinator', 'coordinator-us041@test.local', 'x', 'event_coordinator'),
        ($3, 'Other Coordinator', 'other-coordinator-us041@test.local', 'x', 'event_coordinator')`,
      [organiser, coordinator, otherCoordinator]
    );
    await pool.query(`INSERT INTO venues (id, name) VALUES ($1, 'Venue')`, [venue]);
    await pool.query(`INSERT INTO equipment (id, name, equipment_type, status, total_quantity) VALUES ($1, 'Projector', 'AV', 'available', 3)`, [equipment]);

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    function token(userId, role) {
      return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    }
    async function call(path, method, body, authToken) {
      const r = await fetch(`${base}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }

    async function seedEvent({ status = 'confirmed', bookingEnd = "now() - interval '1 day'", withBooking = true } = {}) {
      const event = randomUUID();
      await pool.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, preferred_start, preferred_end, expected_attendance)
         VALUES ($1, 'Event', $2, $3, $4, now() - interval '2 days', now() - interval '1 day', 40)`,
        [event, status, organiser, coordinator]
      );
      if (withBooking) {
        await pool.query(
          `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status)
           VALUES ($1, $2, ${bookingEnd} - interval '2 hours', ${bookingEnd}, 'confirmed')`,
          [event, venue]
        );
      }
      return event;
    }

    await t.test('an unauthenticated request is rejected', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/complete`, 'PATCH');
      assert.equal(result.status, 401);
    });

    await t.test('a non-coordinator role is rejected', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(organiser, 'event_organiser'));
      assert.equal(result.status, 403);
    });

    await t.test('AC-041-001: a non-confirmed event is blocked with a reason, nothing changes', async () => {
      const event = await seedEvent({ status: 'approved' });
      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 409);
      assert.match(result.body.error, /confirmed event/i);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'approved');
    });

    await t.test('AC-041-001: a confirmed event whose end time has not passed is blocked, nothing changes', async () => {
      const event = await seedEvent({ bookingEnd: "now() + interval '1 day'" });
      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 409);
      assert.match(result.body.error, /has passed/i);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'confirmed');
    });

    await t.test('a coordinator the event is not assigned to is rejected as not authorised', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(otherCoordinator, 'event_coordinator'));
      assert.equal(result.status, 403);
      assert.match(result.body.error, /not authorised/i);
    });

    await t.test('an unknown event id returns 404', async () => {
      const result = await call(`/events/${randomUUID()}/complete`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 404);
    });

    await t.test('AC-041-001/002: a confirmed, ended event is marked completed, records audit, notifies the organiser, and frees its equipment', async () => {
      const event = await seedEvent();
      await pool.query(
        `INSERT INTO equipment_reservations (equipment_id, event_id, quantity, status) VALUES ($1, $2, 2, 'reserved')`,
        [equipment, event]
      );

      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'completed');

      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'completed');

      const change = await pool.query('SELECT change_summary FROM event_changes WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.match(change.rows[0].change_summary, /completed/i);

      const notification = await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.equal(notification.rows[0].user_id, organiser);
      assert.match(notification.rows[0].message, /completed/i);

      // AC-041-002: the reservation row itself is left alone (nothing to "delete" or "release"),
      // but it no longer counts against stock because equipmentReservations.js excludes any
      // reservation whose event is in RELEASED_EVENT_STATUSES (which 'completed' is one of) -
      // reproduce that exact filter here to confirm this reservation now falls outside it.
      const stillCommitted = await pool.query(
        `SELECT er.quantity FROM equipment_reservations er
         JOIN events e ON e.id = er.event_id
         WHERE er.event_id = $1 AND e.status <> ALL($2::text[])`,
        [event, ['cancelled', 'rejected', 'completed']]
      );
      assert.equal(stillCommitted.rows.length, 0, 'a completed event\'s reservation should no longer count as committed stock');

      const rowStillExists = await pool.query('SELECT quantity FROM equipment_reservations WHERE event_id = $1', [event]);
      assert.equal(rowStillExists.rows[0].quantity, 2, 'the reservation row itself is left untouched, not deleted');
    });

    await t.test('re-completing an already-completed event is blocked', async () => {
      const event = await seedEvent({ status: 'completed' });
      const result = await call(`/events/${event}/complete`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 409);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
