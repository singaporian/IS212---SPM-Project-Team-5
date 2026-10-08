// US-034: the Event Coordinator Lead assigns and reassigns Event Coordinators to event requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, validateAssignment } = require('../src/coordinatorAssignments');

test('assignment input requires a coordinator and the coordinator the Lead last saw', () => {
  const coordinatorId = randomUUID();
  assert.deepEqual(validateAssignment({ coordinatorId, currentCoordinatorId: null }), { coordinatorId, currentCoordinatorId: null });
  const currentCoordinatorId = randomUUID();
  assert.deepEqual(validateAssignment({ coordinatorId, currentCoordinatorId }), { coordinatorId, currentCoordinatorId });
  for (const body of [null, [], {}, { coordinatorId: 'abc', currentCoordinatorId: null }, { coordinatorId: '', currentCoordinatorId: null }]) {
    assert.throws(() => validateAssignment(body), /Choose an Event Coordinator|Invalid/, JSON.stringify(body));
  }
  assert.throws(() => validateAssignment({ coordinatorId }), /Refresh/, 'currentCoordinatorId must be sent');
  assert.throws(() => validateAssignment({ coordinatorId, currentCoordinatorId: 'abc' }), /Refresh/);
});

test('coordinator assignment API assigns, reassigns, notifies and records the current coordinator', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['users', 'events', 'notifications', 'event_changes']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // The assignment route opens its own transaction; run it as a savepoint inside the test's transaction.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us034');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us034');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us034');
        return client.query(sql, params);
      },
      release() {}
    }) };

    const app = express();
    app.use(express.json());
    app.use('/api/coordinator-lead', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/coordinator-lead';

    async function makeUser(name, role) {
      const id = randomUUID();
      await client.query('INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4)', [id, name, `${id}@test.local`, role]);
      return id;
    }
    const lead = await makeUser('Lead Lee', 'event_coordinator_lead');
    const organiser = await makeUser('Olive Organiser', 'event_organiser');
    const alice = await makeUser('Alice Coordinator', 'event_coordinator');
    const bob = await makeUser('Bob Coordinator', 'event_coordinator');
    const venueStaff = await makeUser('Vic Venue', 'venue_staff');

    const token = (role = 'event_coordinator_lead', sub = lead) => jwt.sign({ sub, role },
      process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token()) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, body: await res.json() };
    }
    const assign = (eventId, coordinatorId, currentCoordinatorId = null, bearer) =>
      call('PATCH', `/events/${eventId}/coordinator`, { coordinatorId, currentCoordinatorId }, bearer);

    async function makeEvent(title, { status = 'submitted', coordinator = null, hoursAgo = 1 } = {}) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, purpose, expected_attendance, submitted_at)
         VALUES ($1, $2, $3, $4, $5, 'Demo purpose', 50, now() - make_interval(hours => $6))`,
        [id, title, status, organiser, coordinator, hoursAgo]);
      return id;
    }
    const currentCoordinator = async id => (await client.query('SELECT assigned_coordinator_id FROM events WHERE id = $1', [id])).rows[0].assigned_coordinator_id;
    const notificationsFor = async (userId, eventId) => (await client.query(
      'SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2 ORDER BY created_at', [userId, eventId])).rows.map(r => r.message);

    const newer = await makeEvent('Newer Workshop', { hoursAgo: 2 });
    const older = await makeEvent('Older Conference', { hoursAgo: 10 });
    const approvedForBob = await makeEvent('Approved Gala', { status: 'approved', coordinator: bob });
    const rejected = await makeEvent('Rejected Talk', { status: 'rejected', coordinator: alice });
    await makeEvent('Organiser Draft', { status: 'draft' });

    await t.test('the Lead sees the unassigned queue oldest first with basic information, plus every coordinator and active assignment', async () => {
      const { status, body } = await call('GET', '/overview');
      assert.equal(status, 200);
      assert.deepEqual(body.unassigned.map(e => e.title), ['Older Conference', 'Newer Workshop'], 'drafts and closed requests stay out of the queue');
      assert.equal(body.unassigned[0].organiser_name, 'Olive Organiser');
      assert.equal(body.unassigned[0].purpose, 'Demo purpose');
      assert.equal(body.unassigned[0].expected_attendance, 50);
      assert.deepEqual(body.assignments.map(e => [e.title, e.coordinator_name]), [['Approved Gala', 'Bob Coordinator']], 'rejected requests are not active');
      assert.deepEqual(body.coordinators.map(c => [c.name, c.active_count]), [['Alice Coordinator', 0], ['Bob Coordinator', 1]], 'only Event Coordinators are listed');
    });

    await t.test('assigning an unassigned request records the coordinator, notifies them and leaves the queue', async () => {
      const result = await assign(older, alice);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.event.assigned_coordinator_id, alice);
      assert.equal(result.body.previous_coordinator_id, null);
      assert.match(result.body.message, /Assigned "Older Conference" to Alice Coordinator/);
      assert.equal(await currentCoordinator(older), alice);
      assert.deepEqual(await notificationsFor(alice, older), ['Event request "Older Conference" has been assigned to you by Lead Lee.']);
      const audit = await client.query('SELECT changed_by, change_summary FROM event_changes WHERE event_id = $1', [older]);
      assert.deepEqual(audit.rows, [{ changed_by: lead, change_summary: 'Coordinator assigned: Alice Coordinator' }]);
      const overview = (await call('GET', '/overview')).body;
      assert.deepEqual(overview.unassigned.map(e => e.title), ['Newer Workshop']);
      assert.equal(overview.coordinators.find(c => c.id === alice).active_count, 1);
    });

    await t.test('reassigning moves the request and notifies both the new and previous coordinator', async () => {
      const result = await assign(older, bob, alice);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.previous_coordinator_id, alice);
      assert.match(result.body.message, /Reassigned "Older Conference" from Alice Coordinator to Bob Coordinator/);
      assert.equal(await currentCoordinator(older), bob);
      assert.deepEqual(await notificationsFor(bob, older), ['Event request "Older Conference" has been reassigned to you from Alice Coordinator by Lead Lee.']);
      assert.equal((await notificationsFor(alice, older)).at(-1),
        'Event request "Older Conference" has been reassigned from you to Bob Coordinator by Lead Lee. It is no longer in your assigned requests.');
    });

    await t.test('an approved request can be reassigned; closed requests cannot', async () => {
      assert.equal((await assign(approvedForBob, alice, bob)).status, 200);
      assert.equal(await currentCoordinator(approvedForBob), alice);
      const closed = await assign(rejected, bob, alice);
      assert.equal(closed.status, 409);
      assert.match(closed.body.error, /rejected/);
      assert.equal(await currentCoordinator(rejected), alice);
    });

    await t.test('a change based on an out-of-date view is refused without changing anything', async () => {
      // Someone else assigned "Newer Workshop" after this Lead loaded the queue.
      assert.equal((await assign(newer, alice)).status, 200);
      const stale = await assign(newer, bob, null);
      assert.equal(stale.status, 409);
      assert.match(stale.body.error, /assigned by someone else/);
      assert.equal(await currentCoordinator(newer), alice);
      assert.deepEqual(await notificationsFor(bob, newer), []);
    });

    await t.test('reassigning to the same coordinator or to a non-coordinator is rejected', async () => {
      assert.equal((await assign(newer, alice, alice)).status, 409);
      assert.equal((await assign(newer, venueStaff, alice)).status, 400);
      assert.equal((await assign(newer, randomUUID(), alice)).status, 400);
      assert.equal((await assign(randomUUID(), alice)).status, 404);
      assert.equal((await call('PATCH', '/events/not-a-uuid/coordinator', { coordinatorId: alice, currentCoordinatorId: null })).status, 404);
      assert.equal(await currentCoordinator(newer), alice);
    });

    await t.test('only the Event Coordinator Lead can view or change assignments', async () => {
      assert.equal((await call('GET', '/overview', undefined, '')).status, 401);
      for (const role of ['event_coordinator', 'event_organiser', 'venue_staff', 'technical_support_staff', 'safety_officer', 'attendee']) {
        assert.equal((await call('GET', '/overview', undefined, token(role, alice))).status, 403, role);
        assert.equal((await assign(newer, bob, alice, token(role, alice))).status, 403, role);
      }
      assert.equal(await currentCoordinator(newer), alice);
    });

    await t.test('a save failure returns a retryable error and leaves the assignment unchanged', async () => {
      await client.query("ALTER TABLE notifications ADD CONSTRAINT test_write_failure CHECK (message NOT LIKE '%reassigned%') NOT VALID");
      const failed = await assign(newer, bob, alice);
      assert.equal(failed.status, 500);
      assert.match(failed.body.error, /Nothing was changed\. Please retry\./);
      assert.equal(await currentCoordinator(newer), alice);
      await client.query('ALTER TABLE notifications DROP CONSTRAINT test_write_failure');
      assert.equal((await assign(newer, bob, alice)).status, 200);
      assert.equal(await currentCoordinator(newer), bob);
    });
  } finally {
    db.query = originalQuery;
    db.pool = originalPool;
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await originalPool.end();
  }
});
