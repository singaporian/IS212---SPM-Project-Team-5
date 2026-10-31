// US-007 integration tests: the Organiser's request page (GET /api/requests/:id) lists the event's confirmed venues.
// Full app (the US-020 unavailability endpoint lives in index.js) against PostgreSQL, on temporary tables rolled back at the end.
// [IT-xx] ids link to docs/testing/US-007-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const app = require('../../src/index');

const at = (time) => new Date(`2099-03-01T${time}:00+08:00`).toISOString();

test('US-007 view confirmed venue details', async (t) => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['events', 'event_change_requests', 'event_changes', 'venues', 'bookings', 'venue_unavailabilities', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // Routes open their own transaction; run it as a savepoint so its ROLLBACK is real.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us007');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us007');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us007');
        return client.query(sql, params);
      },
      release() {}
    }) };

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const organiser = randomUUID(), venueStaff = randomUUID();
    const token = (sub, role = 'event_organiser') =>
      jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token(organiser)) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
    }
    async function makeEvent(status = 'confirmed') {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, expected_attendance, draft_data, submitted_at)
         VALUES ($1, 'Orientation', $2, $3, 100, '{}'::jsonb, now())`,
        [id, status, organiser]);
      return id;
    }
    async function makeVenue(name, location) {
      const id = randomUUID();
      await client.query('INSERT INTO venues (id, name, location, capacity) VALUES ($1, $2, $3, 200)', [id, name, location]);
      return id;
    }
    async function makeBooking(eventId, venueId, status, start = at('09:00'), end = at('12:00')) {
      await client.query(
        `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
         VALUES ($1, $2, $3, $4, $5, 30, 30)`,
        [eventId, venueId, start, end, status]);
    }

    await t.test('[IT-01] an event with two confirmed venues returns both, with name, location and booking times', async () => {
      const eventId = await makeEvent();
      await makeBooking(eventId, await makeVenue('Main Hall', 'Level 1'), 'approved');
      await makeBooking(eventId, await makeVenue('Room B', 'Level 2'), 'confirmed', at('13:00'), at('15:00'));

      const view = await call('GET', `/requests/${eventId}`);
      assert.equal(view.status, 200);
      assert.deepEqual(view.body.venues, [
        { venue_name: 'Main Hall', location: 'Level 1', start_time: at('09:00'), end_time: at('12:00'), being_rearranged: false },
        { venue_name: 'Room B', location: 'Level 2', start_time: at('13:00'), end_time: at('15:00'), being_rearranged: false }
      ]);
    });

    await t.test('[IT-02] bookings that are not confirmed (pending, rejected, alternative suggested) are not listed', async () => {
      const eventId = await makeEvent('planning');
      for (const status of ['pending', 'rejected', 'alternative_suggested']) {
        await makeBooking(eventId, await makeVenue(`Room ${status}`, 'Level 3'), status);
      }

      const view = await call('GET', `/requests/${eventId}`);
      assert.equal(view.status, 200);
      assert.deepEqual(view.body.venues, []);
    });

    await t.test('[IT-03] after Venue Staff mark a confirmed venue unavailable, it stays listed as being re-arranged and the event stays confirmed', async () => {
      const eventId = await makeEvent('confirmed');
      const venueId = await makeVenue('Auditorium', 'Level 4');
      await makeBooking(eventId, venueId, 'approved');

      const marked = await call('POST', `/venues/${venueId}/unavailability`,
        { startTime: at('10:00'), endTime: at('11:00'), reasonCode: 'maintenance' }, token(venueStaff, 'venue_staff'));
      assert.equal(marked.status, 201);

      const view = await call('GET', `/requests/${eventId}`);
      assert.equal(view.body.status, 'confirmed');
      assert.deepEqual(view.body.venues.map(({ venue_name, being_rearranged }) => ({ venue_name, being_rearranged })),
        [{ venue_name: 'Auditorium', being_rearranged: true }]);
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
