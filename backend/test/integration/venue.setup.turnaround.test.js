// US-035 - Configure Venue Setup and Turnaround Time
// These tests call the real PUT /api/venues/:id/setup-turnaround endpoint
// against an isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-035 venue staff configure venue setup and turnaround defaults', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us035_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const staff = randomUUID(), otherStaff = randomUUID(), coordinator = randomUUID();
  const venue = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'venues', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);

    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [staff, 'venue_staff', 'staff@us035.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [otherStaff, 'venue_staff', 'other-staff@us035.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [coordinator, 'event_coordinator', 'coordinator@us035.test']);
    await pool.query(
      "INSERT INTO venues(id,name,capacity,default_setup_minutes,default_turnaround_minutes) VALUES($1,'Setup Hall',100,30,30)",
      [venue]
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
    const path = `/venues/${venue}/setup-turnaround`;

    await t.test('AC-035-001/002: venue staff can set valid setup/turnaround minutes', async () => {
      const result = await call(path, 'PUT', { setupMinutes: 45, turnaroundMinutes: 20 });
      assert.equal(result.status, 200);
      assert.equal(result.body.default_setup_minutes, 45);
      assert.equal(result.body.default_turnaround_minutes, 20);

      const row = await pool.query('SELECT default_setup_minutes, default_turnaround_minutes FROM venues WHERE id = $1', [venue]);
      assert.equal(row.rows[0].default_setup_minutes, 45);
      assert.equal(row.rows[0].default_turnaround_minutes, 20);

      // Every Venue Staff member is notified, not just the one who made the change.
      const notifications = await pool.query('SELECT user_id, message FROM notifications ORDER BY created_at ASC');
      const recipients = notifications.rows.map((n) => n.user_id);
      assert.ok(recipients.includes(staff), 'the acting staff member should also be notified');
      assert.ok(recipients.includes(otherStaff), 'other venue staff should be notified too');
      assert.ok(!recipients.includes(coordinator), 'only venue staff are notified, not coordinators');
      assert.match(notifications.rows[0].message, /Setup Hall.*45 minutes setup.*20 minutes turnaround/s);
    });

    await t.test('invalid (negative, fractional, missing) input is rejected and nothing changes', async () => {
      for (const body of [{ setupMinutes: -5, turnaroundMinutes: 10 }, { setupMinutes: 10.5, turnaroundMinutes: 10 }, { setupMinutes: 10 }]) {
        const result = await call(path, 'PUT', body);
        assert.equal(result.status, 400);
      }
      const row = await pool.query('SELECT default_setup_minutes, default_turnaround_minutes FROM venues WHERE id = $1', [venue]);
      assert.equal(row.rows[0].default_setup_minutes, 45);
      assert.equal(row.rows[0].default_turnaround_minutes, 20);
      const notificationCount = await pool.query('SELECT count(*) FROM notifications');
      assert.equal(Number(notificationCount.rows[0].count), 2, 'rejected input should send no new notifications');
    });

    await t.test('an unknown venue id returns 404', async () => {
      const result = await call(`/venues/${randomUUID()}/setup-turnaround`, 'PUT', { setupMinutes: 10, turnaroundMinutes: 10 });
      assert.equal(result.status, 404);
    });

    await t.test('a malformed venue id returns 400', async () => {
      const result = await call('/venues/not-a-uuid/setup-turnaround', 'PUT', { setupMinutes: 10, turnaroundMinutes: 10 });
      assert.equal(result.status, 400);
    });

    await t.test('only venue staff may configure setup/turnaround', async () => {
      const result = await call(path, 'PUT', { setupMinutes: 10, turnaroundMinutes: 10 }, 'event_coordinator', coordinator);
      assert.equal(result.status, 403);
    });

    await t.test('an unauthenticated request is rejected', async () => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupMinutes: 10, turnaroundMinutes: 10 })
      });
      assert.equal(r.status, 401);
    });

    await t.test('zero is accepted for both values', async () => {
      const result = await call(path, 'PUT', { setupMinutes: 0, turnaroundMinutes: 0 });
      assert.equal(result.status, 200);
      assert.equal(result.body.default_setup_minutes, 0);
      assert.equal(result.body.default_turnaround_minutes, 0);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    db.pool = originalPool;
    db.query = originalQuery;
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  }
});
