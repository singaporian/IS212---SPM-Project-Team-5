// US-013 - Approve/Reject Event Request
// Integration tests for PATCH /api/events/:id/decision against an isolated
// PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-013 Event Coordinator approves or rejects an assigned event request', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us013_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const organiser = randomUUID(), coordinator = randomUUID(), otherCoordinator = randomUUID();

  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'events', 'event_changes', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }

    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool;
    db.query = (...args) => pool.query(...args);

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES
        ($1, 'Organiser', 'organiser-us013@test.local', 'x', 'event_organiser'),
        ($2, 'Coordinator', 'coordinator-us013@test.local', 'x', 'event_coordinator'),
        ($3, 'Other Coordinator', 'other-coordinator-us013@test.local', 'x', 'event_coordinator')`,
      [organiser, coordinator, otherCoordinator]
    );

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
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }

    async function seedEvent(title, status = 'submitted') {
      const result = await pool.query(
        `INSERT INTO events (title, status, organiser_id, assigned_coordinator_id, preferred_start, preferred_end, expected_attendance)
         VALUES ($1, $2, $3, $4, now() + interval '5 days', now() + interval '5 days 2 hours', 50)
         RETURNING id`,
        [title, status, organiser, coordinator]
      );
      return result.rows[0].id;
    }

    await t.test('an unauthenticated request is rejected', async () => {
      const result = await call(`/events/${await seedEvent('No Auth')}/decision`, 'PATCH', { decision: 'approved' });
      assert.equal(result.status, 401);
    });

    await t.test('a non-coordinator role is rejected', async () => {
      const event = await seedEvent('Wrong Role');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'approved' }, token(organiser, 'event_organiser'));
      assert.equal(result.status, 403);
    });

    await t.test('an invalid decision value is rejected with 400 and changes nothing', async () => {
      const event = await seedEvent('Bad Decision');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'maybe' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 400);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'submitted');
    });

    await t.test('rejecting without a valid reason is rejected with 400 and changes nothing', async () => {
      const event = await seedEvent('No Reason');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'rejected' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 400);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'submitted');
    });

    await t.test('rejecting with reason "other" and no detail is rejected with 400', async () => {
      const event = await seedEvent('Other No Detail');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'rejected', reason: 'other' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 400);
    });

    await t.test('approving an assigned request updates status, writes an audit row, and notifies the organiser', async () => {
      const event = await seedEvent('Approve Me');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'approved' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'approved');

      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'approved');

      const change = await pool.query('SELECT change_summary FROM event_changes WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.match(change.rows[0].change_summary, /approved by coordinator/i);

      const notification = await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.equal(notification.rows[0].user_id, organiser);
      assert.match(notification.rows[0].message, /approved/i);
    });

    await t.test('rejecting with a known reason and a detail updates status and includes the detail in the audit trail and notification', async () => {
      const event = await seedEvent('Reject Me');
      const result = await call(
        `/events/${event}/decision`,
        'PATCH',
        { decision: 'rejected', reason: 'other', reasonDetail: 'Venue unavailable that week' },
        token(coordinator, 'event_coordinator')
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'rejected');

      const change = await pool.query('SELECT change_summary FROM event_changes WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.match(change.rows[0].change_summary, /Other Details: Venue unavailable that week/);

      const notification = await pool.query('SELECT message FROM notifications WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [event]);
      assert.match(notification.rows[0].message, /Other Details: Venue unavailable that week/);
    });

    await t.test('a coordinator the request is not assigned to cannot decide it, and nothing changes', async () => {
      const event = await seedEvent('Not Mine');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'approved' }, token(otherCoordinator, 'event_coordinator'));
      assert.equal(result.status, 404);
      const row = await pool.query('SELECT status FROM events WHERE id = $1', [event]);
      assert.equal(row.rows[0].status, 'submitted');
    });

    await t.test('a request that is not in "submitted" status cannot be decided again', async () => {
      const event = await seedEvent('Already Approved', 'approved');
      const result = await call(`/events/${event}/decision`, 'PATCH', { decision: 'rejected', reason: 'duplicate_request' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 404);
    });

    await t.test('an unknown event id returns 404 and writes nothing', async () => {
      const result = await call(`/events/${randomUUID()}/decision`, 'PATCH', { decision: 'approved' }, token(coordinator, 'event_coordinator'));
      assert.equal(result.status, 404);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
