// US-011 - Self-Assign to Event Request (superseded by US-034)
// US-011 originally let an Event Coordinator pick up an unassigned request themselves.
// That was deliberately replaced by US-034: only the Event Coordinator Lead assigns or
// reassigns coordinators. These tests prove the supersession holds: no self-assignment
// path exists for a plain coordinator, and the Lead-driven US-034 flow is what makes a
// request appear in a coordinator's own "assigned to me" list (US-012).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-011 is superseded by US-034: coordinators cannot self-assign, only the Lead can assign them', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us011_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const lead = randomUUID(), organiser = randomUUID();
  const alice = randomUUID(), bob = randomUUID();
  const unassignedEvent = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'events', 'event_changes', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);

    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Lead Lee',$2,'event_coordinator_lead')", [lead, 'lead@us011.test']);
    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Organiser',$2,'event_organiser')", [organiser, 'organiser@us011.test']);
    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Alice Coordinator',$2,'event_coordinator')", [alice, 'alice@us011.test']);
    await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,'Bob Coordinator',$2,'event_coordinator')", [bob, 'bob@us011.test']);

    await pool.query(
      `INSERT INTO events (id, organiser_id, assigned_coordinator_id, title, status, purpose, expected_attendance, submitted_at)
       VALUES ($1,$2,NULL,'Unassigned Event','submitted','Demo',40, now())`,
      [unassignedEvent, organiser]);

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
    const token = ((role, user) => jwt.sign({ role, sub: user }, secret));

    async function call(path, method = 'GET', body, role, user) {
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

    await t.test('a plain Event Coordinator cannot call the Lead-only assignment endpoint to pick up a request themselves', async () => {
      const res = await call(`/coordinator-lead/events/${unassignedEvent}/coordinator`, 'PATCH',
        { coordinatorId: alice, currentCoordinatorId: null }, 'event_coordinator', alice);
      assert.equal(res.status, 403, JSON.stringify(res.body));
    });

    await t.test('there is no separate self-assign endpoint left over from US-011', async () => {
      const guesses = ['/events/' + unassignedEvent + '/claim', '/events/' + unassignedEvent + '/self-assign', '/events/' + unassignedEvent + '/assign'];
      for (const path of guesses) {
        const res = await call(path, 'POST', {}, 'event_coordinator', alice);
        assert.ok([404, 403].includes(res.status), `expected ${path} to not exist, got ${res.status}`);
      }
    });

    await t.test('the request stays out of a coordinator\'s "assigned to me" list until the Lead assigns it (US-034)', async () => {
      const before = await call('/events/assigned', 'GET', undefined, 'event_coordinator', alice);
      assert.equal(before.status, 200);
      assert.ok(!before.body.map(e => e.id).includes(unassignedEvent));
    });

    await t.test('only the Lead assigning the request (US-034) makes it appear, and only for that coordinator', async () => {
      const assignRes = await call(`/coordinator-lead/events/${unassignedEvent}/coordinator`, 'PATCH',
        { coordinatorId: alice, currentCoordinatorId: null }, 'event_coordinator_lead', lead);
      assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

      const aliceList = await call('/events/assigned', 'GET', undefined, 'event_coordinator', alice);
      assert.ok(aliceList.body.map(e => e.id).includes(unassignedEvent));

      const bobList = await call('/events/assigned', 'GET', undefined, 'event_coordinator', bob);
      assert.ok(!bobList.body.map(e => e.id).includes(unassignedEvent));

      const audit = await pool.query('SELECT changed_by, change_summary FROM event_changes WHERE event_id = $1', [unassignedEvent]);
      assert.equal(audit.rows[0].changed_by, lead, 'the assignment is attributed to the Lead, never a self-assignment by the coordinator');
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.pool = originalPool; db.query = originalQuery;
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
