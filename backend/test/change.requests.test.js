const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, parseChangeRequestInput } = require('../src/changeRequests');
const { EventRequest } = require('../src/domain');

// ---------- Unit: input validation (AC-008-002) ----------
test('parseChangeRequestInput accepts valid fields', () => {
  assert.deepEqual(parseChangeRequestInput({ expectedAttendance: 150 }), { expectedAttendance: 150 });
  assert.deepEqual(parseChangeRequestInput({ equipmentRequirements: ['projector', ' mic ', ''] }),
    { equipmentRequirements: ['projector', 'mic'] });
  assert.deepEqual(parseChangeRequestInput({ venueLayoutPreference: '  Theatre style  ' }),
    { venueLayoutPreference: 'Theatre style' });
  assert.deepEqual(
    parseChangeRequestInput({ preferredStart: '2099-01-02T09:00:00Z', preferredEnd: '2099-01-02T10:00:00Z' }),
    { preferredStart: '2099-01-02T09:00:00.000Z', preferredEnd: '2099-01-02T10:00:00.000Z' });
  // several fields in one request
  const multi = parseChangeRequestInput({ expectedAttendance: 80, venueLayoutPreference: 'Classroom' });
  assert.deepEqual(Object.keys(multi).sort(), ['expectedAttendance', 'venueLayoutPreference']);
});

test('parseChangeRequestInput rejects invalid or empty input', () => {
  for (const input of [
    null, [], 'text', {},                                                  // not an object / nothing proposed
    { unknownField: 'x' }, { status: 'approved' },                         // unknown fields
    { expectedAttendance: -1 }, { expectedAttendance: 0 }, { expectedAttendance: 1.5 }, { expectedAttendance: 'abc' },
    { preferredStart: '2099-01-02T10:00:00Z', preferredEnd: '2099-01-02T09:00:00Z' },   // end before start
    { preferredStart: '2099-01-02T10:00:00Z', preferredEnd: '2099-01-02T10:00:00Z' },   // end equals start
    { preferredStart: '2099-01-02T10:00:00Z' },                                          // missing end
    { preferredStart: 'not-a-date', preferredEnd: '2099-01-02T10:00:00Z' },
    { venueLayoutPreference: '   ' }, { venueLayoutPreference: 'x'.repeat(2001) },
    { equipmentRequirements: 'not-an-array' },
    { equipmentRequirements: Array.from({ length: 51 }, (_, i) => 'item' + i) }
  ]) {
    assert.throws(() => parseChangeRequestInput(input), undefined, JSON.stringify(input));
  }
});

// ---------- Unit: status rule (AC-008-001, revised) ----------
test('EventRequest only accepts change requests after approval', () => {
  for (const status of ['planning', 'confirmed']) {
    assert.equal(new EventRequest({ status }).canRequestChanges(), true, status);
  }
  for (const status of ['draft', 'submitted', 'rejected', 'cancelled', 'completed']) {
    assert.equal(new EventRequest({ status }).canRequestChanges(), false, status);
  }
});

// ---------- Integration: POST /:id/change-requests ----------
test('change request API enforces status, ownership and leaves the event unchanged', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['events', 'event_change_requests', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);

    const app = express();
    app.use(express.json());
    app.use('/api/events', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/events';

    const owner = randomUUID(), other = randomUUID(), coordinator = randomUUID();
    const token = (sub, role = 'event_organiser', options) =>
      jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me', options);

    async function post(eventId, body, bearer = token(owner)) {
      const res = await fetch(`${base}/${eventId}/change-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    async function makeEvent(status, { organiser = owner, assigned = coordinator } = {}) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, expected_attendance)
         VALUES ($1, $2, $3, $4, $5, 100)`,
        [id, `Test ${status}`, status, organiser, assigned]);
      return id;
    }
    const eventRow = async id => (await client.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
    const crCount = async id =>
      Number((await client.query('SELECT count(*) FROM event_change_requests WHERE event_id = $1', [id])).rows[0].count);
    const notes = async id => (await client.query('SELECT * FROM notifications WHERE event_id = $1', [id])).rows;
    // US-010: attendance/duration changes are now "major", so the ordinary change used here is venue-only.
    const valid = { venueLayoutPreference: 'Theatre style' };

    await t.test('approved events (planning/confirmed) accept a change request (AC-008-001, 005)', async () => {
      for (const status of ['planning', 'confirmed']) {
        const id = await makeEvent(status);
        const result = await post(id, valid);
        assert.equal(result.status, 201, status);
        assert.equal(result.body.status, 'pending');
        assert.deepEqual(result.body.proposed_changes, valid);
        assert.equal(await crCount(id), 1);
      }
    });

    await t.test('events not yet approved or already closed are rejected with 409 (AC-008-001)', async () => {
      for (const status of ['draft', 'submitted', 'rejected', 'cancelled', 'completed']) {
        const id = await makeEvent(status);
        const result = await post(id, valid);
        assert.equal(result.status, 409, status);
        assert.ok(result.body.error);
        assert.equal(await crCount(id), 0, status);
      }
    });

    await t.test('existing event information is unchanged after the request (AC-008-004)', async () => {
      const id = await makeEvent('planning');
      const before = await eventRow(id);
      assert.equal((await post(id, { venueLayoutPreference: 'Banquet', equipmentRequirements: ['stage'] })).status, 201);
      assert.deepEqual(await eventRow(id), before);
    });

    await t.test('assigned coordinator is notified; no notification when unassigned (AC-008-003)', async () => {
      const assignedId = await makeEvent('planning');
      await post(assignedId, valid);
      const sent = await notes(assignedId);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].user_id, coordinator);

      const unassignedId = await makeEvent('planning', { assigned: null });
      assert.equal((await post(unassignedId, valid)).status, 201);
      assert.equal((await notes(unassignedId)).length, 0);
    });

    await t.test("another organiser's event returns a generic 404", async () => {
      const id = await makeEvent('planning', { organiser: other });
      const result = await post(id, valid);
      assert.deepEqual(result, { status: 404, body: { error: 'Event not found.' } });
      assert.equal(await crCount(id), 0);
    });

    await t.test('malformed and unknown event IDs return 404', async () => {
      assert.equal((await post('not-a-uuid', valid)).status, 404);
      assert.equal((await post(randomUUID(), valid)).status, 404);
    });

    await t.test('invalid input returns 400 and creates nothing', async () => {
      const id = await makeEvent('planning');
      for (const body of [{}, { expectedAttendance: -5 }, { unknownField: 1 }]) {
        assert.equal((await post(id, body)).status, 400, JSON.stringify(body));
      }
      assert.equal(await crCount(id), 0);
    });

    await t.test('missing/expired tokens get 401 and other roles get 403', async () => {
      const id = await makeEvent('planning');
      assert.equal((await post(id, valid, '')).status, 401);
      assert.equal((await post(id, valid, token(owner, 'event_organiser', { expiresIn: -1 }))).status, 401);
      for (const role of ['attendee', 'event_coordinator', 'venue_staff', 'technical_support_staff']) {
        assert.equal((await post(id, valid, token(owner, role))).status, 403, role);
      }
      assert.equal(await crCount(id), 0);
    });

    await t.test('a database failure returns a retryable error and saves nothing', async () => {
      const id = await makeEvent('planning');
      await client.query(`ALTER TABLE event_change_requests ADD CONSTRAINT test_write_failure
                          CHECK (proposed_changes->>'venueLayoutPreference' IS DISTINCT FROM 'force failure')`);
      await client.query('SAVEPOINT failure');
      const result = await post(id, { venueLayoutPreference: 'force failure' });
      await client.query('ROLLBACK TO SAVEPOINT failure');
      assert.equal(result.status, 500);
      assert.match(result.body.error, /retry/i);
      assert.equal(await crCount(id), 0);
    });
  } finally {
    db.query = originalQuery;
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.pool.end();
  }
});