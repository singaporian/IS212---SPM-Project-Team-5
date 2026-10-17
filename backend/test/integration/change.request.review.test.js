// Integration tests for the change request review endpoints (US-032):
// the real router and auth middleware against PostgreSQL, using temporary tables
// inside a transaction that is rolled back at the end, so no real data is touched.
// [IT-xx] ids link each test to docs/testing/US-032-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const { router } = require('../../src/changeRequests');

const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
// Current event used throughout: 1 March 2099, 09:00-12:00 SGT.
const START = at('2099-03-01', '09:00');
const END = at('2099-03-01', '12:00');
const MOVED = { preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00') };

test('change request review endpoints', async (t) => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  let failOn = null; // [IT-10] when set, any matching SQL statement fails, to simulate a database error
  try {
    await client.query('BEGIN');
    for (const table of ['users', 'events', 'event_change_requests', 'venues', 'bookings', 'equipment', 'equipment_reservations', 'notifications', 'event_changes']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // The decision route opens its own transaction; run it as a savepoint so its ROLLBACK is real.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us032');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us032');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us032');
        if (failOn && failOn.test(sql)) return Promise.reject(new Error('forced database failure'));
        return client.query(sql, params);
      },
      release() {}
    }) };

    const app = express();
    app.use(express.json());
    app.use('/api/events', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/events`;

    const organiser = randomUUID(), coordA = randomUUID(), coordB = randomUUID();
    const token = (sub, role = 'event_coordinator') =>
      jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token(coordA)) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    const list = (bearer) => call('GET', '/change-requests/pending', undefined, bearer);
    const decide = (id, decision, bearer) => call('PATCH', `/change-requests/${id}/decision`, { decision }, bearer);

    async function makeEvent({ coordinator = coordA, title = 'Orientation' } = {}) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, expected_attendance,
                             preferred_start, preferred_end, venue_layout_preference, equipment_requirements)
         VALUES ($1, $2, 'planning', $3, $4, 100, $5, $6, 'Theatre', '["projector"]'::jsonb)`,
        [id, title, organiser, coordinator, START, END]);
      return id;
    }
    async function makeChangeRequest(eventId, proposed, status = 'pending') {
      const result = await client.query(
        `INSERT INTO event_change_requests (event_id, organiser_id, proposed_changes, status)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [eventId, organiser, JSON.stringify(proposed), status]);
      return result.rows[0].id;
    }
    const venueId = randomUUID(), equipmentId = randomUUID();
    await client.query(`INSERT INTO venues (id, name, capacity) VALUES ($1, 'Main Hall', 200)`, [venueId]);
    await client.query(`INSERT INTO equipment (id, name, total_quantity) VALUES ($1, 'Projector', 5)`, [equipmentId]);
    async function arrangeFor(eventId) {
      const booking = await client.query(
        `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING id`, [eventId, venueId, coordA, START, END]);
      const reservation = await client.query(
        `INSERT INTO equipment_reservations (equipment_id, event_id, quantity) VALUES ($1, $2, 2) RETURNING id`,
        [equipmentId, eventId]);
      return { bookingId: booking.rows[0].id, reservationId: reservation.rows[0].id };
    }
    const one = async (sql, params) => (await client.query(sql, params)).rows[0];
    const eventRow = (id) => one('SELECT * FROM events WHERE id = $1', [id]);
    const crRow = (id) => one('SELECT * FROM event_change_requests WHERE id = $1', [id]);
    const bookingRow = (id) => one('SELECT * FROM bookings WHERE id = $1', [id]);
    const reservationRow = (id) => one('SELECT * FROM equipment_reservations WHERE id = $1', [id]);

    await t.test('[IT-01] GET pending: returns only pending requests for my events, with current and proposed values', async () => {
      const mine = await makeEvent({ title: 'Mine' });
      const theirs = await makeEvent({ coordinator: coordB, title: 'Theirs' });
      const pendingId = await makeChangeRequest(mine, { ...MOVED, venueLayoutPreference: 'Classroom' });
      await makeChangeRequest(mine, { venueLayoutPreference: 'Banquet' }, 'approved');
      await makeChangeRequest(mine, { venueLayoutPreference: 'Banquet' }, 'rejected');
      await makeChangeRequest(theirs, { venueLayoutPreference: 'Banquet' });

      const result = await list(token(coordA));
      assert.equal(result.status, 200);
      const ids = result.body.map((row) => row.id);
      assert.ok(ids.includes(pendingId));
      assert.equal(result.body.filter((row) => row.event_id === mine).length, 1, 'processed requests are excluded');
      assert.ok(!result.body.some((row) => row.event_id === theirs), "another coordinator's event is excluded");

      const row = result.body.find((item) => item.id === pendingId);
      assert.equal(row.event_title, 'Mine');
      assert.equal(row.status, 'pending');
      assert.deepEqual(row.proposed_changes, { ...MOVED, venueLayoutPreference: 'Classroom' });
      assert.deepEqual(row.current, {
        preferredStart: START, preferredEnd: END, expectedAttendance: 100,
        venueLayoutPreference: 'Theatre', equipmentRequirements: ['projector']
      });
    });

    await t.test('[IT-03] PATCH decision approve: writes the proposed values onto the event', async () => {
      const eventId = await makeEvent();
      const id = await makeChangeRequest(eventId, { venueLayoutPreference: 'Classroom', equipmentRequirements: ['projector', 'mic'] });
      const result = await decide(id, 'approved');
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'approved');
      const event = await eventRow(eventId);
      assert.equal(event.venue_layout_preference, 'Classroom');
      assert.deepEqual(event.equipment_requirements, ['projector', 'mic']);
      assert.equal(event.expected_attendance, 100, 'fields not in the request are unchanged');
      assert.equal(event.draft_data.venueRequirements, 'Classroom', "the organiser's view shows the new value too");
      assert.equal(event.preferred_start.toISOString(), START);
      const cr = await crRow(id);
      assert.equal(cr.status, 'approved');
      assert.equal(cr.decided_by, coordA);
      assert.ok(cr.decided_at instanceof Date);
    });

    await t.test('[IT-04] PATCH decision reject: leaves every event detail unchanged', async () => {
      const eventId = await makeEvent();
      const id = await makeChangeRequest(eventId, { ...MOVED, venueLayoutPreference: 'Classroom' });
      const before = await eventRow(eventId);
      const result = await decide(id, 'rejected');
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'rejected');
      assert.deepEqual(await eventRow(eventId), before);
      const cr = await crRow(id);
      assert.equal(cr.status, 'rejected');
      assert.equal(cr.decided_by, coordA);
    });

    await t.test('[IT-05] PATCH decision approve: only a time move flags bookings and equipment, without changing them', async () => {
      const eventId = await makeEvent();
      const { bookingId, reservationId } = await arrangeFor(eventId);
      const unrelated = await arrangeFor(await makeEvent({ title: 'Unrelated' }));

      // A change without new times flags nothing.
      const layoutOnly = await decide(await makeChangeRequest(eventId, { venueLayoutPreference: 'Classroom' }), 'approved');
      assert.deepEqual(layoutOnly.body.reconsider, { bookings: [], equipment: [] });
      assert.equal((await bookingRow(bookingId)).requires_reconsideration, false);

      // A time move flags them.
      const bookingBefore = await bookingRow(bookingId);
      const reservationBefore = await reservationRow(reservationId);
      const result = await decide(await makeChangeRequest(eventId, MOVED), 'approved');
      assert.equal(result.status, 200);
      const event = await eventRow(eventId);
      assert.equal(event.preferred_start.toISOString(), MOVED.preferredStart);
      assert.equal(event.preferred_end.toISOString(), MOVED.preferredEnd);

      const booking = await bookingRow(bookingId);
      assert.equal(booking.requires_reconsideration, true);
      assert.deepEqual({ ...booking, requires_reconsideration: false }, bookingBefore, 'status and times are not changed');
      const reservation = await reservationRow(reservationId);
      assert.equal(reservation.requires_reconsideration, true);
      assert.deepEqual({ ...reservation, requires_reconsideration: false }, reservationBefore, 'quantity and status are not changed');

      assert.equal((await bookingRow(unrelated.bookingId)).requires_reconsideration, false);
      assert.equal((await reservationRow(unrelated.reservationId)).requires_reconsideration, false);

      assert.deepEqual(result.body.reconsider.bookings.map((b) => [b.id, b.venue_name, b.status]), [[bookingId, 'Main Hall', 'confirmed']]);
      assert.deepEqual(result.body.reconsider.equipment.map((r) => [r.id, r.equipment_name, r.quantity]), [[reservationId, 'Projector', 2]]);
    });

    await t.test('[IT-07] PATCH decision: an already processed request is refused with 409', async () => {
      for (const status of ['approved', 'rejected']) {
        const eventId = await makeEvent();
        const id = await makeChangeRequest(eventId, MOVED, status);
        const before = await eventRow(eventId);
        for (const decision of ['approved', 'rejected']) {
          assert.deepEqual(await decide(id, decision), { status: 409, body: { error: 'This change request has already been processed.' } }, `${status} -> ${decision}`);
        }
        assert.equal((await crRow(id)).status, status);
        assert.deepEqual(await eventRow(eventId), before);
      }
    });

    await t.test("[IT-08] PATCH decision: another coordinator's request is not found", async () => {
      const eventId = await makeEvent();
      const id = await makeChangeRequest(eventId, MOVED);
      const before = await eventRow(eventId);
      assert.deepEqual(await decide(id, 'approved', token(coordB)), { status: 404, body: { error: 'Change request not found.' } });
      assert.equal((await crRow(id)).status, 'pending');
      assert.deepEqual(await eventRow(eventId), before);
    });

    await t.test('[IT-10] PATCH decision: a database failure part-way saves nothing, and a retry succeeds', async () => {
      const eventId = await makeEvent();
      const { bookingId } = await arrangeFor(eventId);
      const id = await makeChangeRequest(eventId, MOVED);
      const eventBefore = await eventRow(eventId);
      const bookingBefore = await bookingRow(bookingId);

      failOn = /UPDATE\s+bookings/i; // fails after the event and request have been updated
      const failed = await decide(id, 'approved');
      failOn = null;
      assert.deepEqual(failed, { status: 500, body: { error: 'Unable to save your decision. Nothing was changed. Please retry.' } });
      assert.deepEqual(await eventRow(eventId), eventBefore);
      assert.equal((await crRow(id)).status, 'pending');
      assert.equal((await crRow(id)).decided_by, null);
      assert.deepEqual(await bookingRow(bookingId), bookingBefore);

      const retry = await decide(id, 'approved');
      assert.equal(retry.status, 200);
      assert.equal((await crRow(id)).status, 'approved');
      assert.equal((await eventRow(eventId)).preferred_start.toISOString(), MOVED.preferredStart);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.query = originalQuery;
    db.pool = originalPool;
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await originalPool.end();
  }
});
