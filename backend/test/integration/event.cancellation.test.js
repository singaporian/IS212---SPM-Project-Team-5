// US-042 - Cancel an Event
// Integration tests for PATCH /api/events/:id/cancel against an isolated schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-042 Event Coordinator cancels an event assigned to them', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us042_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const organiser = randomUUID(), coordinator = randomUUID(), otherCoordinator = randomUUID();
  const equipment = randomUUID();

  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'events', 'equipment', 'equipment_reservations', 'event_changes', 'notifications', 'event_change_requests']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }

    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool;
    db.query = (...args) => pool.query(...args);

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES
        ($1, 'Organiser', 'organiser-us042@test.local', 'x', 'event_organiser'),
        ($2, 'Coordinator', 'coordinator-us042@test.local', 'x', 'event_coordinator'),
        ($3, 'Other Coordinator', 'other-coordinator-us042@test.local', 'x', 'event_coordinator')`,
      [organiser, coordinator, otherCoordinator]
    );
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

    async function seedEvent(status = 'confirmed') {
      const event = randomUUID();
      await pool.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, preferred_start, preferred_end, expected_attendance)
         VALUES ($1, 'Event', $2, $3, $4, now() + interval '5 days', now() + interval '5 days 2 hours', 40)`,
        [event, status, organiser, coordinator]
      );
      return event;
    }

    await t.test('an unauthenticated request is rejected', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/cancel`, 'PATCH');
      assert.equal(result.status, 401);
    });

    await t.test('a non-coordinator role is rejected', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(organiser, 'event_organiser'));
      assert.equal(result.status, 403);
    });

    await t.test('AC-042-005: a coordinator the event is not assigned to is rejected as not authorised, nothing changes', async () => {
      const event = await seedEvent();
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(otherCoordinator, 'event_coordinator'));
      assert.equal(result.status, 403);
      assert.match(result.body.error, /not authorised/i);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'confirmed');
    });

    await t.test('an unknown event id returns 404', async () => {
      const result = await call(`/events/${randomUUID()}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 404);
    });

    await t.test('AC-042-001: every pre-completion status can be cancelled by the assigned coordinator', async () => {
      for (const status of ['draft', 'submitted', 'approved', 'planning', 'confirmed']) {
        const event = await seedEvent(status);
        const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
        assert.equal(result.status, 200, `expected ${status} to be cancellable (got ${result.status}: ${JSON.stringify(result.body)})`);
        assert.equal(result.body.status, 'cancelled');
      }
    });

    await t.test('AC-042-001: an already-completed event cannot be cancelled, nothing changes', async () => {
      const event = await seedEvent('completed');
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 409);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'completed');
    });

    await t.test('AC-042-001: an already-cancelled event cannot be cancelled again', async () => {
      const event = await seedEvent('cancelled');
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 409);
    });

    await t.test("AC-042-003: cancelling frees the event's reserved equipment (reservation row untouched, no longer counted)", async () => {
      const event = await seedEvent('confirmed');
      await pool.query(
        `INSERT INTO equipment_reservations (equipment_id, event_id, quantity, status) VALUES ($1, $2, 2, 'reserved')`,
        [equipment, event]
      );
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 200);

      const stillCommitted = await pool.query(
        `SELECT er.quantity FROM equipment_reservations er
         JOIN events e ON e.id = er.event_id
         WHERE er.event_id = $1 AND e.status <> ALL($2::text[])`,
        [event, ['cancelled', 'rejected', 'completed']]
      );
      assert.equal(stillCommitted.rows.length, 0, "a cancelled event's reservation should no longer count as committed stock");
      const rowStillExists = await pool.query('SELECT quantity FROM equipment_reservations WHERE event_id = $1', [event]);
      assert.equal(rowStillExists.rows[0].quantity, 2, 'the reservation row itself is left untouched, not deleted');
    });

    await t.test('cancelling records an audit entry and notifies the organiser', async () => {
      const event = await seedEvent('confirmed');
      const result = await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 200);

      const change = await pool.query('SELECT change_summary FROM event_changes WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.match(change.rows[0].change_summary, /cancelled/i);

      const notification = await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.equal(notification.rows[0].user_id, organiser);
      assert.match(notification.rows[0].message, /cancelled/i);
    });

    await t.test('AC-042-004: a cancelled event cannot receive a new change request', async () => {
      const event = await seedEvent('confirmed');
      await call(`/events/${event}/cancel`, 'PATCH', undefined, token(coordinator, 'event_coordinator'));

      const changeRequest = await call(`/events/${event}/change-requests`, 'POST', { venueLayoutPreference: 'Theatre style' }, token(organiser, 'event_organiser'));
      assert.ok([400, 403, 404, 409].includes(changeRequest.status), `expected a cancelled event to refuse a change request (got ${changeRequest.status})`);
      const requests = await pool.query('SELECT count(*) FROM event_change_requests WHERE event_id = $1', [event]);
      assert.equal(Number(requests.rows[0].count), 0);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
