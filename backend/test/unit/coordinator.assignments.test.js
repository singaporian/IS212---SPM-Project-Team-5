// US-034: the Event Coordinator Lead assigns and reassigns Event Coordinators to event requests.
// Unit tests: no database. The functions run against an in-memory stand-in for their queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateAssignment, loadAssignmentOverview, assignEventCoordinator } = require('../../src/coordinatorAssignments');
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
