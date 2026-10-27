// US-009 integration tests: the Organiser's request page shows the rejection reason and each change request's status.
// Full app (the US-013 decision endpoint lives in index.js) against PostgreSQL, on temporary tables rolled back at the end.
// [IT-xx] ids link to docs/testing/US-009-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const app = require('../../src/index');

test('US-009 track my request status', async (t) => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['events', 'event_change_requests', 'event_changes', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // Routes open their own transaction; run it as a savepoint so its ROLLBACK is real.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us009');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us009');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us009');
        return client.query(sql, params);
      },
      release() {}
    }) };

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const organiser = randomUUID(), coordinator = randomUUID();
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
    async function makeRequest(status) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO events (id, title, status, organiser_id, assigned_coordinator_id, expected_attendance, draft_data, submitted_at)
         VALUES ($1, 'Orientation', $2, $3, $4, 100, '{"expectedAttendance": "100"}'::jsonb, now())`,
        [id, status, organiser, coordinator]);
      return id;
    }

    await t.test('[IT-01] after the Coordinator rejects with "Other" and a detail, GET /requests/:id returns the reason', async () => {
      const id = await makeRequest('submitted');
      const rejected = await call('PATCH', `/events/${id}/decision`,
        { decision: 'rejected', reason: 'other', reasonDetail: 'Venue closed for renovation' }, token(coordinator, 'event_coordinator'));
      assert.equal(rejected.status, 200);
      const view = await call('GET', `/requests/${id}`);
      assert.equal(view.status, 200);
      assert.equal(view.body.status, 'rejected');
      assert.equal(view.body.rejection_reason, 'Other: Venue closed for renovation');
    });

    await t.test('[IT-02] GET /requests/:id returns the change requests newest first, each with its own status', async () => {
      const id = await makeRequest('approved');
      await client.query(
        `INSERT INTO event_change_requests (event_id, organiser_id, proposed_changes, status, created_at) VALUES
         ($1, $2, '{"expectedAttendance": 150}'::jsonb, 'approved', now() - interval '1 day'),
         ($1, $2, '{"venueLayoutPreference": "Classroom"}'::jsonb, 'pending', now())`, [id, organiser]);
      const view = await call('GET', `/requests/${id}`);
      assert.equal(view.status, 200);
      assert.equal(view.body.status, 'approved');
      assert.deepEqual(view.body.change_requests.map((change) => change.status), ['pending', 'approved']);
    });

    await t.test('[IT-03] a comment added to any rejection reason is returned with the reason', async () => {
      const id = await makeRequest('submitted');
      const rejected = await call('PATCH', `/events/${id}/decision`,
        { decision: 'rejected', reason: 'insufficient_information', reasonDetail: 'Please add the event programme.' },
        token(coordinator, 'event_coordinator'));
      assert.equal(rejected.status, 200);
      const view = await call('GET', `/requests/${id}`);
      assert.equal(view.body.rejection_reason, 'Insufficient Information: Please add the event programme.');
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
