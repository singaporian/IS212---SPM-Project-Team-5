// US-010: Inform the Organiser when a requested change is major (cancel and resubmit).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, applyChangesToDraft } = require('../src/changeRequests');
const { EventRequest } = require('../src/domain');

// Current event used by the unit tests: 100 people, 09:00-12:00 SGT (3 hours).
const current = new EventRequest({
  status: 'planning', expected_attendance: 100,
  preferred_start: '2099-03-01T01:00:00.000Z', preferred_end: '2099-03-01T04:00:00.000Z'
});
const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// ---------- Unit: classification (AC-010-001, AC-010-002) ----------
test('only Expected Attendance and Duration are major', () => {
  assert.deepEqual(current.majorChangesIn({ expectedAttendance: 150 }), ['expectedAttendance']);
  assert.deepEqual(current.majorChangesIn({ expectedAttendance: 50 }), ['expectedAttendance'], 'a decrease is also major');
  assert.deepEqual(current.majorChangesIn({ preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '13:00') }), ['duration']);
  assert.deepEqual(current.majorChangesIn({ preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '11:00') }), ['duration'], 'shorter is also major');
  for (const changes of [
    { venueLayoutPreference: 'Classroom' },
    { equipmentRequirements: ['projector'] },
    { expectedAttendance: 100 },                                                          // same number: no change
    { preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00') } // moved, still 3 hours
  ]) {
    assert.deepEqual(current.majorChangesIn(changes), [], JSON.stringify(changes));
  }
});

test('a major aspect combined with ordinary ones makes the whole request major', () => {
  assert.deepEqual(current.majorChangesIn({ expectedAttendance: 150, venueLayoutPreference: 'Banquet' }), ['expectedAttendance']);
  assert.deepEqual(current.majorChangesIn({
    expectedAttendance: 150, equipmentRequirements: ['mic'],
    preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '13:00')
  }), ['expectedAttendance', 'duration']);
});

test('a time change on an event with no stored times is treated as major', () => {
  const noTimes = new EventRequest({ status: 'planning', expected_attendance: 100 });
  assert.deepEqual(noTimes.majorChangesIn({ preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '12:00') }), ['duration']);
});

// ---------- Unit: new draft contents (AC-010-004) ----------
test('applyChangesToDraft keeps old details and applies the proposed changes in Singapore time', () => {
  const old = { eventName: 'Orientation', purpose: 'Welcome', startDate: '2099-03-01', startTime: '09:00',
    endDate: '2099-03-01', endTime: '12:00', expectedAttendance: '100', venueRequirements: 'Theatre', equipmentRequirements: 'projector' };
  const next = applyChangesToDraft(old, {
    expectedAttendance: 150, equipmentRequirements: ['projector', 'mic'],
    preferredStart: at('2099-03-02', '23:30'), preferredEnd: at('2099-03-03', '01:00')
  });
  assert.deepEqual(next, { ...old, expectedAttendance: '150', equipmentRequirements: 'projector, mic',
    startDate: '2099-03-02', startTime: '23:30', endDate: '2099-03-03', endTime: '01:00' });
  assert.equal(old.expectedAttendance, '100', 'the original draft data is not mutated');
  assert.deepEqual(applyChangesToDraft(null, { venueLayoutPreference: 'Classroom' }), { venueRequirements: 'Classroom' });
});

// ---------- Integration: API (AC-010-002 to AC-010-004) ----------
test('major-change API blocks change requests and runs cancel-and-resubmit atomically', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['events', 'event_change_requests', 'notifications', 'event_changes', 'equipment_reservations']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // The route opens its own transaction. Run it as a savepoint inside the test's transaction,
    // so a ROLLBACK in the route really undoes its writes and everything is dropped at the end.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us010');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us010');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us010');
        return client.query(sql, params);
      },
      release() {}
    }) };

    const app = express();
    app.use(express.json());
    app.use('/api/events', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/events';

    const owner = randomUUID(), other = randomUUID(), coordinator = randomUUID();
    const token = (sub = owner, role = 'event_organiser') =>
      jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function post(path, body, bearer = token()) {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    const draftData = { eventName: 'Orientation', purpose: 'Welcome', startDate: '2099-03-01', startTime: '09:00',
      endDate: '2099-03-01', endTime: '12:00', expectedAttendance: '100', venueRequirements: 'Theatre',
      equipmentRequirements: 'projector', registrationNeeds: 'no' };
    async function makeEvent(status = 'planning', { organiser = owner, assigned = coordinator } = {}) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, expected_attendance,
                             preferred_start, preferred_end, draft_data)
         VALUES ($1, 'Orientation', $2, $3, $4, 100, $5, $6, $7::jsonb)`,
        [id, status, organiser, assigned, at('2099-03-01', '09:00'), at('2099-03-01', '12:00'), JSON.stringify(draftData)]);
      return id;
    }
    const eventRow = async id => (await client.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
    const count = async (table, id) =>
      Number((await client.query(`SELECT count(*) FROM ${table} WHERE event_id = $1`, [id])).rows[0].count);
    const eventCount = async () => Number((await client.query('SELECT count(*) FROM events')).rows[0].count);

    const attendance = { expectedAttendance: 150 };
    const longer = { preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '13:00') };

    await t.test('a major change request is refused with an explanation and nothing is saved (AC-010-002, 003)', async () => {
      const cases = [
        [attendance, ['expectedAttendance'], /^Expected Attendance changes can't be made through a change request\. The event must be cancelled and resubmitted\.$/],
        [longer, ['duration'], /^Duration changes can't be made/],
        [{ ...attendance, ...longer, venueLayoutPreference: 'Banquet' }, ['expectedAttendance', 'duration'], /^Expected Attendance and Duration changes/]
      ];
      for (const [body, majorChanges, message] of cases) {
        const id = await makeEvent();
        const before = await eventRow(id);
        const result = await post(`/${id}/change-requests`, body);
        assert.equal(result.status, 422, JSON.stringify(body));
        assert.equal(result.body.code, 'MAJOR_CHANGE');
        assert.deepEqual(result.body.majorChanges, majorChanges);
        assert.match(result.body.error, message);
        assert.equal(await count('event_change_requests', id), 0);
        assert.equal(await count('notifications', id), 0);
        assert.deepEqual(await eventRow(id), before);
      }
    });

    await t.test('ordinary changes, including a same-length move, still go through as change requests', async () => {
      const id = await makeEvent();
      for (const body of [{ venueLayoutPreference: 'Classroom' }, { expectedAttendance: 100 },
        { preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00') }]) {
        assert.equal((await post(`/${id}/change-requests`, body)).status, 201, JSON.stringify(body));
      }
      assert.equal(await count('event_change_requests', id), 3);
    });

    await t.test('proceeding cancels the event and opens a pre-filled draft (AC-010-004)', async () => {
      const id = await makeEvent();
      await client.query('INSERT INTO equipment_reservations (equipment_id, event_id, quantity) VALUES ($1, $2, 3)', [randomUUID(), id]);
      const draftsBefore = await eventCount();
      const result = await post(`/${id}/cancel-and-resubmit`, { ...attendance, ...longer, equipmentRequirements: ['projector', 'mic'] });
      assert.equal(result.status, 201);
      assert.equal(result.body.cancelledEventId, id);
      assert.deepEqual(result.body.majorChanges, ['expectedAttendance', 'duration']);
      assert.equal(await eventCount(), draftsBefore + 1, 'exactly one new draft');

      assert.equal((await eventRow(id)).status, 'cancelled');
      assert.equal(await count('equipment_reservations', id), 0, 'US-023: reserved equipment returns to stock on cancellation');
      const draft = await eventRow(result.body.draftId);
      assert.equal(draft.status, 'draft');
      assert.equal(draft.organiser_id, owner);
      assert.equal(draft.title, 'Orientation');
      assert.deepEqual(draft.draft_data, { ...draftData, expectedAttendance: '150', endTime: '13:00', equipmentRequirements: 'projector, mic' });

      const [audit] = (await client.query('SELECT * FROM event_changes WHERE event_id = $1', [id])).rows;
      assert.equal(audit.changed_by, owner);
      assert.match(audit.change_summary, /Expected Attendance and Duration/);
      assert.ok(audit.change_summary.includes(result.body.draftId));
      const notes = (await client.query('SELECT * FROM notifications WHERE event_id = $1', [id])).rows;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].user_id, coordinator);
      assert.match(notes[0].message, /was cancelled by the organiser because of a major change/);
    });

    await t.test('no coordinator assigned: still works, nobody notified', async () => {
      const id = await makeEvent('confirmed', { assigned: null });
      assert.equal((await post(`/${id}/cancel-and-resubmit`, attendance)).status, 201);
      assert.equal(await count('notifications', id), 0);
    });

    await t.test('cancel-and-resubmit is refused for non-major changes, unapproved events and repeats', async () => {
      const id = await makeEvent();
      const ordinary = await post(`/${id}/cancel-and-resubmit`, { venueLayoutPreference: 'Classroom' });
      assert.deepEqual(ordinary, { status: 400, body: { error: 'These changes are not major. Submit them as a change request instead.' } });
      assert.equal((await eventRow(id)).status, 'planning');

      for (const status of ['draft', 'submitted', 'rejected', 'cancelled', 'completed']) {
        const other = await makeEvent(status);
        const before = await eventCount();
        const result = await post(`/${other}/cancel-and-resubmit`, attendance);
        assert.equal(result.status, 409, status);
        assert.equal(result.body.error, 'Only approved events can be cancelled and resubmitted.');
        assert.equal((await eventRow(other)).status, status);
        assert.equal(await eventCount(), before, 'no draft created');
      }

      assert.equal((await post(`/${id}/cancel-and-resubmit`, attendance)).status, 201);
      assert.equal((await post(`/${id}/cancel-and-resubmit`, attendance)).status, 409, 'a cancelled event cannot be cancelled again');
    });

    await t.test("another organiser's event, bad ids, bad input and bad tokens change nothing", async () => {
      const theirs = await makeEvent('planning', { organiser: other });
      assert.deepEqual(await post(`/${theirs}/cancel-and-resubmit`, attendance), { status: 404, body: { error: 'Event not found.' } });
      assert.equal((await eventRow(theirs)).status, 'planning');
      assert.equal((await post('/not-a-uuid/cancel-and-resubmit', attendance)).status, 404);
      assert.equal((await post(`/${randomUUID()}/cancel-and-resubmit`, attendance)).status, 404);

      const id = await makeEvent();
      for (const body of [{}, { expectedAttendance: -5 }, { status: 'cancelled' }]) {
        assert.equal((await post(`/${id}/cancel-and-resubmit`, body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await post(`/${id}/cancel-and-resubmit`, attendance, '')).status, 401);
      for (const role of ['attendee', 'event_coordinator', 'venue_staff', 'technical_support_staff']) {
        assert.equal((await post(`/${id}/cancel-and-resubmit`, attendance, token(owner, role))).status, 403, role);
      }
      assert.equal((await eventRow(id)).status, 'planning');
    });

    await t.test('a failure part-way rolls everything back', async () => {
      const id = await makeEvent();
      const before = await eventCount();
      // Make the audit insert (after the cancel and the draft insert) fail.
      await client.query(`ALTER TABLE event_changes ADD CONSTRAINT test_write_failure CHECK (change_summary NOT LIKE '%major change%') NOT VALID`);
      const result = await post(`/${id}/cancel-and-resubmit`, attendance);
      await client.query('ALTER TABLE event_changes DROP CONSTRAINT test_write_failure');
      assert.equal(result.status, 500);
      assert.match(result.body.error, /Nothing was changed\. Please retry\./);
      assert.equal((await eventRow(id)).status, 'planning', 'event not cancelled');
      assert.equal(await eventCount(), before, 'no orphan draft');
      assert.equal(await count('notifications', id), 0);
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