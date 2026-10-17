// US-034: the Event Coordinator Lead assigns and reassigns Event Coordinators to event requests.
// Unit tests: no database. The functions and routes run against an in-memory stand-in for their queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const { router, validateAssignment, loadAssignmentOverview, assignEventCoordinator } = require('../../src/coordinatorAssignments');
const { ACTIVE_STATUSES } = require('../../src/domain');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LEAD = { id: id(1), name: 'Lead Lee', role: 'event_coordinator_lead' };
const ALICE = { id: id(2), name: 'Alice Coordinator', role: 'event_coordinator' };
const BOB = { id: id(3), name: 'Bob Coordinator', role: 'event_coordinator' };
const VIC = { id: id(4), name: 'Vic Venue', role: 'venue_staff' };
const ORGANISER = id(5);
const EVENT = { id: id(10), title: 'Older Conference', status: 'submitted', organiser_id: ORGANISER, assigned_coordinator_id: null };
const OVERVIEW = {
  unassigned: [{ id: id(11), title: 'Newer Workshop', organiser_name: 'Olive Organiser', purpose: 'Demo purpose', expected_attendance: 50 }],
  assignments: [{ id: id(12), title: 'Approved Gala', coordinator_name: 'Bob Coordinator' }],
  coordinators: [{ id: ALICE.id, name: 'Alice Coordinator', active_count: 0 }, { id: BOB.id, name: 'Bob Coordinator', active_count: 1 }]
};

// Answers the queries the module makes, applies its writes to an in-memory event, and records everything.
function fakeDb({ event = EVENT, users = [LEAD, ALICE, BOB, VIC], failOn = null, rollbackFails = false } = {}) {
  const fake = { event: event && { ...event }, transaction: [], peopleLookups: [], overviewQueries: [], changes: [], notifications: [], released: 0 };
  fake.query = async (sql, params) => {
    const command = sql.trim();
    if (failOn && failOn.test(sql)) throw new Error('simulated database failure');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(command)) {
      fake.transaction.push(command);
      if (command === 'ROLLBACK' && rollbackFails) throw new Error('simulated rollback failure');
      return { rows: [] };
    }
    if (/FROM events WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: fake.event && fake.event.id === params[0] ? [{ ...fake.event }] : [] };
    if (/FROM users WHERE id = ANY/.test(sql)) {
      fake.peopleLookups.push(params[0]);
      return { rows: users.filter(user => params[0].includes(user.id)) };
    }
    if (/^UPDATE events SET assigned_coordinator_id/.test(command)) {
      fake.event.assigned_coordinator_id = params[0];
      return { rows: [] };
    }
    if (/^INSERT INTO event_changes/.test(command)) { fake.changes.push(params); return { rows: [] }; }
    if (/^INSERT INTO notifications/.test(command)) {
      fake.notifications.push({ user_id: params[0], event_id: params[1], message: params[2] });
      return { rows: [] };
    }
    for (const [key, pattern] of [['unassigned', /assigned_coordinator_id IS NULL/], ['assignments', /ORDER BY c\.name/], ['coordinators', /FROM users u/]]) {
      if (pattern.test(sql)) { fake.overviewQueries.push({ key, sql, params }); return { rows: OVERVIEW[key] }; }
    }
    throw new Error('Unexpected query: ' + sql);
  };
  fake.writes = () => fake.changes.length + fake.notifications.length;
  return fake;
}

const assign = (fake, coordinatorId, currentCoordinatorId = null, leadId = LEAD.id, eventId = EVENT.id) =>
  assignEventCoordinator(fake.query, eventId, { coordinatorId, currentCoordinatorId }, leadId);

// ---------- validateAssignment ----------
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

test('US-034: assignment input rejects values of the wrong type', () => {
  assert.throws(() => validateAssignment({ coordinatorId: 42, currentCoordinatorId: null }), /Choose an Event Coordinator/);
  assert.throws(() => validateAssignment({ coordinatorId: randomUUID(), currentCoordinatorId: 42 }), /Refresh/);
  assert.throws(() => validateAssignment({ coordinatorId: randomUUID(), currentCoordinatorId: undefined }), /Refresh/);
});

// ---------- loadAssignmentOverview ----------
test('US-034: the Lead\'s overview returns the unassigned queue, every active assignment and each coordinator\'s workload', async t => {
  await t.test('all three lists are returned together', async () => {
    const fake = fakeDb();
    assert.deepEqual(await loadAssignmentOverview(fake.query), OVERVIEW);
    assert.deepEqual(fake.overviewQueries.map(q => q.key).sort(), ['assignments', 'coordinators', 'unassigned']);
  });

  await t.test('every list counts only active requests', async () => {
    const fake = fakeDb();
    await loadAssignmentOverview(fake.query);
    assert.deepEqual(ACTIVE_STATUSES, ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed']);
    for (const q of fake.overviewQueries) assert.deepEqual(q.params, [ACTIVE_STATUSES], q.key);
  });

  await t.test('the queue and assignments include the basic information the Lead reviews', async () => {
    const fake = fakeDb();
    await loadAssignmentOverview(fake.query);
    for (const q of fake.overviewQueries.filter(q => q.key !== 'coordinators')) {
      for (const field of ['e.title', 'e.event_type', 'e.status', 'e.preferred_start', 'e.preferred_end', 'e.expected_attendance',
        'e.purpose', 'e.description', 'e.submitted_at', 'o.name AS organiser_name', 'o.email AS organiser_email', 'c.name AS coordinator_name']) {
        assert.ok(q.sql.includes(field), `${q.key} selects ${field}`);
      }
    }
  });
});

// ---------- assignEventCoordinator: assign ----------
test('US-034: assigning an unassigned request', async t => {
  await t.test('records the coordinator, notifies them, logs the change and confirms it', async () => {
    const fake = fakeDb();
    const result = await assign(fake, ALICE.id);
    assert.deepEqual(result, {
      event: { id: EVENT.id, title: 'Older Conference', status: 'submitted', assigned_coordinator_id: ALICE.id, coordinator_name: 'Alice Coordinator' },
      previous_coordinator_id: null,
      message: 'Assigned "Older Conference" to Alice Coordinator. They have been notified.'
    });
    assert.equal(fake.event.assigned_coordinator_id, ALICE.id);
    assert.deepEqual(fake.changes, [[EVENT.id, LEAD.id, 'Coordinator assigned: Alice Coordinator']]);
    assert.deepEqual(fake.notifications, [{ user_id: ALICE.id, event_id: EVENT.id, message: 'Event request "Older Conference" has been assigned to you by Lead Lee.' }]);
  });

  await t.test('looks up only the chosen coordinator and the Lead', async () => {
    const fake = fakeDb();
    await assign(fake, ALICE.id);
    assert.deepEqual(fake.peopleLookups, [[ALICE.id, LEAD.id]]);
  });

  await t.test('every active status can be assigned', async () => {
    for (const status of ACTIVE_STATUSES) {
      const fake = fakeDb({ event: { ...EVENT, status } });
      assert.equal((await assign(fake, ALICE.id)).event.status, status);
      assert.equal(fake.event.assigned_coordinator_id, ALICE.id, status);
    }
  });
});

// ---------- assignEventCoordinator: reassign ----------
test('US-034: reassigning a request to another coordinator', async t => {
  const assignedToAlice = { ...EVENT, assigned_coordinator_id: ALICE.id };

  await t.test('moves the request and notifies both the new and the previous coordinator', async () => {
    const fake = fakeDb({ event: assignedToAlice });
    const result = await assign(fake, BOB.id, ALICE.id);
    assert.equal(result.previous_coordinator_id, ALICE.id);
    assert.equal(result.event.assigned_coordinator_id, BOB.id);
    assert.equal(result.message, 'Reassigned "Older Conference" from Alice Coordinator to Bob Coordinator. Both coordinators have been notified.');
    assert.equal(fake.event.assigned_coordinator_id, BOB.id);
    assert.deepEqual(fake.peopleLookups, [[BOB.id, LEAD.id, ALICE.id]]);
    assert.deepEqual(fake.changes, [[EVENT.id, LEAD.id, 'Coordinator reassigned from Alice Coordinator to Bob Coordinator']]);
    assert.deepEqual(fake.notifications, [
      { user_id: BOB.id, event_id: EVENT.id, message: 'Event request "Older Conference" has been reassigned to you from Alice Coordinator by Lead Lee.' },
      { user_id: ALICE.id, event_id: EVENT.id,
        message: 'Event request "Older Conference" has been reassigned from you to Bob Coordinator by Lead Lee. It is no longer in your assigned requests.' }
    ]);
  });

  await t.test('still notifies the previous coordinator when their name cannot be found', async () => {
    const fake = fakeDb({ event: assignedToAlice, users: [LEAD, BOB] });
    const result = await assign(fake, BOB.id, ALICE.id);
    assert.equal(result.message, 'Reassigned "Older Conference" from the previous coordinator to Bob Coordinator. Both coordinators have been notified.');
    assert.deepEqual(fake.notifications.map(n => n.user_id), [BOB.id, ALICE.id]);
    assert.match(fake.notifications[0].message, /from the previous coordinator by Lead Lee\.$/);
  });

  await t.test('names the Lead generically when their name cannot be found', async () => {
    const fake = fakeDb({ event: assignedToAlice, users: [ALICE, BOB] });
    await assign(fake, BOB.id, ALICE.id);
    assert.match(fake.notifications[0].message, /by the Event Coordinator Lead\.$/);
    assert.match(fake.notifications[1].message, /by the Event Coordinator Lead\. It is no longer in your assigned requests\.$/);
  });
});

// ---------- assignEventCoordinator: refusals ----------
test('US-034: an assignment that is not allowed is refused and nothing is changed', async t => {
  async function refused(fake, promise, expected) {
    await assert.rejects(promise, expected);
    assert.equal(fake.writes(), 0, 'nothing logged or notified');
  }

  await t.test('an event request that does not exist', async () => {
    const fake = fakeDb();
    await refused(fake, assign(fake, ALICE.id, null, LEAD.id, id(99)), { status: 404, message: 'Event request not found.' });
  });

  await t.test('someone else assigned the request after the Lead loaded the queue', async () => {
    const fake = fakeDb({ event: { ...EVENT, assigned_coordinator_id: ALICE.id } });
    await refused(fake, assign(fake, BOB.id, null), { status: 409,
      message: '"Older Conference" was assigned by someone else while you were viewing it. The list has been refreshed; review it and try again.' });
    assert.equal(fake.event.assigned_coordinator_id, ALICE.id);
  });

  await t.test('someone else reassigned the request after the Lead loaded it', async () => {
    const fake = fakeDb({ event: { ...EVENT, assigned_coordinator_id: BOB.id } });
    await refused(fake, assign(fake, BOB.id, ALICE.id), { status: 409, message: /assigned by someone else/ });
    assert.equal(fake.event.assigned_coordinator_id, BOB.id);
  });

  await t.test('the chosen person is not an Event Coordinator', async () => {
    for (const person of [VIC, LEAD, { id: id(98) }]) {
      const fake = fakeDb();
      await refused(fake, assign(fake, person.id), { status: 400, message: 'Choose an Event Coordinator.' });
      assert.equal(fake.event.assigned_coordinator_id, null);
    }
  });

  await t.test('the request is already assigned to the chosen coordinator', async () => {
    const fake = fakeDb({ event: { ...EVENT, assigned_coordinator_id: ALICE.id } });
    await refused(fake, assign(fake, ALICE.id, ALICE.id), { status: 409, message: '"Older Conference" is already assigned to this coordinator.' });
  });

  await t.test('the request is a draft or has been closed', async () => {
    for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
      const fake = fakeDb({ event: { ...EVENT, status } });
      await refused(fake, assign(fake, ALICE.id), { status: 409, message: `"Older Conference" is ${status}, so its coordinator cannot be changed.` });
      assert.equal(fake.event.assigned_coordinator_id, null, status);
    }
  });
});

// ---------- Routes, run in-process against the same in-memory stand-in ----------
const token = (role = LEAD.role, sub = LEAD.id) => jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');

async function withApi(fake, fn) {
  const originalQuery = db.query, originalPool = db.pool;
  db.query = fake.query;
  db.pool = fake.pool || { connect: async () => ({ query: fake.query, release: () => { fake.released++; } }) };
  const app = express();
  app.use(express.json());
  app.use('/api/coordinator-lead', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/coordinator-lead`;
  async function call(method, path, body, bearer = token()) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
  }
  try { await fn(call); }
  finally {
    db.query = originalQuery;
    db.pool = originalPool;
    await new Promise(resolve => server.close(resolve));
  }
}
const patch = (call, body = { coordinatorId: ALICE.id, currentCoordinatorId: null }, eventId = EVENT.id, bearer) =>
  call('PATCH', `/events/${eventId}/coordinator`, body, bearer);

test('US-034: only the Event Coordinator Lead can use the assignment routes', async () => {
  const fake = fakeDb();
  await withApi(fake, async call => {
    assert.equal((await call('GET', '/overview', undefined, '')).status, 401);
    assert.equal((await patch(call, undefined, EVENT.id, '')).status, 401);
    for (const role of ['event_coordinator', 'event_organiser', 'venue_staff', 'technical_support_staff', 'safety_officer', 'attendee']) {
      assert.equal((await call('GET', '/overview', undefined, token(role, ALICE.id))).status, 403, role);
      assert.equal((await patch(call, undefined, EVENT.id, token(role, ALICE.id))).status, 403, role);
    }
  });
  assert.equal(fake.transaction.length, 0);
  assert.equal(fake.event.assigned_coordinator_id, null);
});

test('US-034: GET /overview', async t => {
  await t.test('returns the overview and is never cached', async () => {
    await withApi(fakeDb(), async call => {
      const result = await call('GET', '/overview');
      assert.equal(result.status, 200);
      assert.equal(result.cache, 'no-store');
      assert.deepEqual(result.body, OVERVIEW);
    });
  });

  await t.test('a database failure shows a retryable error', async t => {
    const logged = t.mock.method(console, 'error', () => {});
    await withApi(fakeDb({ failOn: /FROM users u/ }), async call => {
      const result = await call('GET', '/overview');
      assert.deepEqual([result.status, result.body], [500, { error: 'Unable to load coordinator assignments. Please retry.' }]);
    });
    assert.equal(logged.mock.callCount(), 1);
  });
});

test('US-034: PATCH /events/:id/coordinator', async t => {
  await t.test('a successful assignment is committed and confirmed', async () => {
    const fake = fakeDb();
    await withApi(fake, async call => {
      const result = await patch(call);
      assert.equal(result.status, 200);
      assert.equal(result.body.message, 'Assigned "Older Conference" to Alice Coordinator. They have been notified.');
      assert.equal(result.body.event.assigned_coordinator_id, ALICE.id);
    });
    assert.deepEqual(fake.transaction, ['BEGIN', 'COMMIT']);
    assert.equal(fake.released, 1);
  });

  await t.test('a malformed event ID is not found, without touching the database', async () => {
    const fake = fakeDb();
    await withApi(fake, async call => {
      assert.deepEqual(await patch(call, undefined, 'not-a-uuid').then(r => [r.status, r.body]), [404, { error: 'Event request not found.' }]);
    });
    assert.equal(fake.transaction.length, 0);
  });

  await t.test('invalid input is rejected without touching the database', async () => {
    const fake = fakeDb();
    await withApi(fake, async call => {
      const result = await patch(call, { coordinatorId: 'abc', currentCoordinatorId: null });
      assert.deepEqual([result.status, result.body], [400, { error: 'Choose an Event Coordinator.' }]);
    });
    assert.equal(fake.transaction.length, 0);
  });

  await t.test('a refused assignment is rolled back and explained', async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const fake = fakeDb({ event: { ...EVENT, assigned_coordinator_id: BOB.id } });
    await withApi(fake, async call => {
      const result = await patch(call);
      assert.equal(result.status, 409);
      assert.match(result.body.error, /assigned by someone else/);
    });
    assert.deepEqual(fake.transaction, ['BEGIN', 'ROLLBACK']);
    assert.equal(fake.released, 1);
    assert.equal(logged.mock.callCount(), 0, 'expected refusals are not logged as errors');
  });

  await t.test('a save failure is rolled back with a retryable error, leaving the assignment unchanged', async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const fake = fakeDb({ failOn: /INSERT INTO notifications/ });
    await withApi(fake, async call => {
      const result = await patch(call);
      assert.deepEqual([result.status, result.body], [500, { error: 'Unable to save the assignment. Nothing was changed. Please retry.' }]);
    });
    assert.deepEqual(fake.transaction, ['BEGIN', 'ROLLBACK']);
    assert.equal(fake.released, 1);
    assert.equal(logged.mock.callCount(), 1);
  });

  await t.test('a failed rollback still returns the retryable error', async t => {
    t.mock.method(console, 'error', () => {});
    const fake = fakeDb({ failOn: /INSERT INTO notifications/, rollbackFails: true });
    await withApi(fake, async call => {
      assert.equal((await patch(call)).status, 500);
    });
    assert.equal(fake.released, 1);
  });

  await t.test('a database that cannot be reached returns the retryable error', async t => {
    t.mock.method(console, 'error', () => {});
    const fake = fakeDb();
    fake.pool = { connect: async () => { throw new Error('connection refused'); } };
    await withApi(fake, async call => {
      const result = await patch(call);
      assert.deepEqual([result.status, result.body], [500, { error: 'Unable to save the assignment. Nothing was changed. Please retry.' }]);
    });
    assert.equal(fake.released, 0);
  });
});
