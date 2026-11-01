// US-012 - View Submitted Event Request Details
// These tests call the real GET /api/events/assigned and GET /api/events/:id
// endpoints against an isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-012 Event Coordinator views the details of a request assigned to them', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us012_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const organiser = randomUUID(), coordinator = randomUUID(), otherCoordinator = randomUUID();
  const assignedEvent = randomUUID(), unassignedEvent = randomUUID(), otherCoordinatorEvent = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'events', 'event_changes', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);

    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Organiser',$2,'event_organiser')", [organiser, 'organiser@us012.test']);
    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Coordinator',$2,'event_coordinator')", [coordinator, 'coordinator@us012.test']);
    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Other Coordinator',$2,'event_coordinator')", [otherCoordinator, 'other-coordinator@us012.test']);

    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, purpose, preferred_start, preferred_end, expected_attendance)
       VALUES ($1,$2,$3,'Assigned Event','submitted','Demo','2027-03-01T10:00:00+08:00','2027-03-01T11:00:00+08:00',40)`,
      [assignedEvent, organiser, coordinator]);
    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, expected_attendance)
       VALUES ($1,$2,NULL,'Unassigned Event','submitted',40)`,
      [unassignedEvent, organiser]);
    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, expected_attendance)
       VALUES ($1,$2,$3,'Other Coordinator Event','submitted',40)`,
      [otherCoordinatorEvent, organiser, otherCoordinator]);

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
    const token = (role, user) => jwt.sign({ role, sub: user }, secret);

    async function call(path, method = 'GET', body, role = 'event_coordinator', user = coordinator) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: role ? { Authorization: 'Bearer ' + token(role, user), 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (r.status === 204) return { status: r.status, body: null };
      const text = await r.text();
      try { return { status: r.status, body: JSON.parse(text) }; }
      catch { return { status: r.status, body: text }; }
    }

    await t.test('an unauthenticated request is rejected', async () => {
      const res = await call(`/events/${assignedEvent}`, 'GET', undefined, null);
      assert.equal(res.status, 401);
    });

    await t.test('a non-coordinator role is rejected', async () => {
      const res = await call(`/events/${assignedEvent}`, 'GET', undefined, 'event_organiser', organiser);
      assert.equal(res.status, 403);
    });

    await t.test('AC-012-001: requesting a request currently assigned to this coordinator succeeds with full details', async () => {
      const res = await call(`/events/${assignedEvent}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Assigned Event');
      assert.equal(res.body.purpose, 'Demo');
      assert.equal(res.body.expected_attendance, 40);
    });

    await t.test('AC-012-001: requesting an unassigned request is rejected', async () => {
      const res = await call(`/events/${unassignedEvent}`);
      assert.equal(res.status, 403);
    });

    await t.test('AC-012-001: requesting a request assigned to a different coordinator is rejected', async () => {
      const res = await call(`/events/${otherCoordinatorEvent}`);
      assert.equal(res.status, 403);
    });

    await t.test('an unknown event id is rejected the same way as an unassigned one', async () => {
      const res = await call(`/events/${randomUUID()}`);
      assert.equal(res.status, 403);
    });

    await t.test('AC-012-004: before any organiser edit, the detail view shows no update and empty history', async () => {
      const res = await call(`/events/${assignedEvent}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.updated, false);
      assert.deepEqual(res.body.change_history, []);
    });

    await t.test('AC-012-004: after the organiser edits the request, the Coordinator sees an "Updated" indicator and change history', async () => {
      const editRes = await call(`/requests/${assignedEvent}`, 'PUT', {
        eventName: 'Assigned Event (Updated)', startDate: '2027-03-01', endDate: '2027-03-01',
        startTime: '10:00', endTime: '11:00', expectedAttendance: '45'
      }, 'event_organiser', organiser);
      assert.equal(editRes.status, 200, JSON.stringify(editRes.body));

      const res = await call(`/events/${assignedEvent}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.updated, true);
      assert.equal(res.body.change_history.length, 1);
      assert.match(res.body.change_history[0].change_summary, /Assigned Event \(Updated\)/);
    });

    await t.test('AC-012-005: the detail view is read-only — no PUT route for the Coordinator exists on this path', async () => {
      const res = await call(`/events/${assignedEvent}`, 'PUT', { title: 'Coordinator cannot edit this' });
      assert.notEqual(res.status, 200);
    });

    await t.test('US-012 list: GET /events/assigned returns only this coordinator\'s requests', async () => {
      const res = await call('/events/assigned');
      assert.equal(res.status, 200);
      const ids = res.body.map(r => r.id);
      assert.ok(ids.includes(assignedEvent));
      assert.ok(!ids.includes(unassignedEvent));
      assert.ok(!ids.includes(otherCoordinatorEvent));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.pool = originalPool; db.query = originalQuery;
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
