// US-031 integration tests: edit a submitted request before approval, return it for clarification, resubmit it.
// Real router and auth middleware against PostgreSQL, on temporary tables rolled back at the end.
// [IT-xx] ids link to docs/testing/US-031-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const { router } = require('../../src/submissions');

// The request as the Organiser submitted it (US-006 form fields).
const FORM = {
  eventName: 'Orientation', purpose: 'Welcome new students', description: 'Talks and booths',
  startDate: '2099-03-01', startTime: '09:00', endDate: '2099-03-01', endTime: '12:00',
  expectedAttendance: '100', venueRequirements: 'Theatre', accessibilityNeeds: 'None',
  equipmentRequirements: 'Projector', registrationNeeds: 'no'
};

test('US-031 edit before approval', async (t) => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['events', 'event_change_requests', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // Routes open their own transaction; run it as a savepoint so its ROLLBACK is real.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us031');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us031');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us031');
        return client.query(sql, params);
      },
      release() {}
    }) };

    const app = express();
    app.use(express.json());
    app.use('/api', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const organiser = randomUUID(), otherOrganiser = randomUUID(), coordinator = randomUUID();
    const token = (sub, role = 'event_organiser') =>
      jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token(organiser)) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    async function makeRequest(status, assigned = coordinator) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, expected_attendance, draft_data, submitted_at)
         VALUES ($1, 'Orientation', $2, $3, $4, 100, $5::jsonb, now())`,
        [id, status, organiser, assigned, JSON.stringify(FORM)]);
      return id;
    }
    const eventRow = async (id) => (await client.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
    const inbox = async (userId, eventId) => (await client.query(
      'SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2', [userId, eventId])).rows.map((row) => row.message);

    await t.test('[IT-01] PUT /requests/:id saves a valid edit straight away and creates no change request', async () => {
      const id = await makeRequest('submitted');
      const result = await call('PUT', `/requests/${id}`, { ...FORM, expectedAttendance: '150' });
      assert.equal(result.status, 200);
      const row = await eventRow(id);
      assert.equal(row.expected_attendance, 150);
      assert.equal(row.draft_data.expectedAttendance, '150');
      assert.equal(row.status, 'submitted');
      const changeRequests = await client.query('SELECT 1 FROM event_change_requests WHERE event_id = $1', [id]);
      assert.equal(changeRequests.rowCount, 0);
    });

    await t.test('[IT-02] PUT /requests/:id on an approved request returns 409 and changes nothing', async () => {
      const id = await makeRequest('approved');
      const result = await call('PUT', `/requests/${id}`, { ...FORM, expectedAttendance: '150' });
      assert.equal(result.status, 409);
      assert.equal((await eventRow(id)).expected_attendance, 100);
    });

    await t.test('[IT-03] PUT /requests/:id with an invalid value returns 422 with the field and changes nothing', async () => {
      const id = await makeRequest('submitted');
      const result = await call('PUT', `/requests/${id}`, { ...FORM, expectedAttendance: '-5' });
      assert.equal(result.status, 422);
      assert.ok(result.body.fields.expectedAttendance);
      const row = await eventRow(id);
      assert.equal(row.expected_attendance, 100);
      assert.equal(row.draft_data.expectedAttendance, '100');
    });

    await t.test("[IT-04] after the Coordinator returns a request with a note, the Organiser's view shows the status and note", async () => {
      const id = await makeRequest('submitted');
      const returned = await call('PATCH', `/events/${id}/return`, { note: 'Please confirm the date.' },
        token(coordinator, 'event_coordinator'));
      assert.equal(returned.status, 200);
      const view = await call('GET', `/requests/${id}`);
      assert.equal(view.status, 200);
      assert.equal(view.body.status, 'clarification_requested');
      assert.equal(view.body.clarification_note, 'Please confirm the date.');
    });

    await t.test('[IT-05] POST /requests/:id/resubmit sets a returned request back to submitted', async () => {
      const id = await makeRequest('clarification_requested');
      const result = await call('POST', `/requests/${id}/resubmit`);
      assert.equal(result.status, 200);
      assert.equal((await eventRow(id)).status, 'submitted');
    });

    await t.test("[IT-06] PUT /requests/:id by another Organiser returns 404 and changes nothing", async () => {
      const id = await makeRequest('submitted');
      const result = await call('PUT', `/requests/${id}`, { ...FORM, expectedAttendance: '150' }, token(otherOrganiser));
      assert.equal(result.status, 404);
      assert.equal((await eventRow(id)).expected_attendance, 100);
    });
    // US-002 notifications triggered by these routes (Week 4 Notification System).
    await t.test('[IT-US031-N01] returning a request notifies the Organiser, naming the event and including the note', async () => {
      const id = await makeRequest('submitted');
      const returned = await call('PATCH', `/events/${id}/return`, { note: 'Please confirm the date.' },
        token(coordinator, 'event_coordinator'));
      assert.equal(returned.status, 200);
      assert.deepEqual(await inbox(organiser, id),
        ['Your event request "Orientation" was returned for clarification: Please confirm the date.']);
    });

    await t.test('[IT-US031-N02] editing a request notifies the assigned Coordinator, and nobody when none is assigned', async () => {
      const id = await makeRequest('submitted');
      assert.equal((await call('PUT', `/requests/${id}`, { ...FORM, expectedAttendance: '150' })).status, 200);
      assert.deepEqual(await inbox(coordinator, id),
        ['"Orientation" was edited by the organiser before approval. Please review the latest details.']);

      const unassigned = await makeRequest('submitted', null);
      assert.equal((await call('PUT', `/requests/${unassigned}`, { ...FORM, expectedAttendance: '150' })).status, 200);
      const count = await client.query('SELECT count(*)::int AS n FROM notifications WHERE event_id = $1', [unassigned]);
      assert.equal(count.rows[0].n, 0);
    });

    await t.test('[IT-US031-N03] resubmitting a returned request notifies the assigned Coordinator', async () => {
      const id = await makeRequest('clarification_requested');
      assert.equal((await call('POST', `/requests/${id}/resubmit`)).status, 200);
      assert.deepEqual(await inbox(coordinator, id),
        ['"Orientation" was resubmitted by the organiser and is ready for your review.']);
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
