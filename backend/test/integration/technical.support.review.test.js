const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';

test('US-022 technical support queue shows availability, review labels, and safety re-review flags', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query;
  const originalPool = db.pool;
  let server;
  const ids = {
    tech: randomUUID(),
    coordinator: randomUUID(),
    safety: randomUUID(),
    eventMain: randomUUID(),
    eventOverlap: randomUUID(),
    venueMain: randomUUID(),
    venueOverlap: randomUUID(),
    equipmentA: randomUUID(),
    equipmentB: randomUUID()
  };
  try {
    await client.query('BEGIN');
    for (const table of [
      'users',
      'events',
      'venues',
      'bookings',
      'technical_support_requirements',
      'operational_safety_checks',
      'equipment',
      'equipment_reservations',
      'notifications'
    ]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    db.pool = {
      connect: async () => ({
        query: (sql, params) => client.query(({ BEGIN: 'SAVEPOINT tx', COMMIT: 'RELEASE SAVEPOINT tx', ROLLBACK: 'ROLLBACK TO SAVEPOINT tx' })[sql] || sql, params),
        release() {}
      })
    };

    await client.query(
      `INSERT INTO users (id, name, email, role) VALUES
       ($1, 'Tech Staff', 'tech@us022.test', 'technical_support_staff'),
       ($2, 'Coordinator', 'coordinator@us022.test', 'event_coordinator'),
       ($3, 'Safety Officer', 'safety@us022.test', 'safety_officer')`,
      [ids.tech, ids.coordinator, ids.safety]
    );

    await client.query(
      `INSERT INTO events (id, title, organiser_id, assigned_coordinator_id, status, preferred_start, preferred_end)
       VALUES
       ($1, 'Main Expo', $2, $2, 'planning', '2099-05-01T10:00:00Z', '2099-05-01T12:00:00Z'),
       ($3, 'Overlap Demo', $2, $2, 'approved', '2099-05-01T10:30:00Z', '2099-05-01T11:30:00Z')`,
      [ids.eventMain, ids.coordinator, ids.eventOverlap]
    );
    await client.query(
      `INSERT INTO venues (id, name, capacity, facilities, accessibility, supported_layouts) VALUES
       ($1, 'Grand Hall', 200, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb),
       ($2, 'Studio A', 80, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb)`,
      [ids.venueMain, ids.venueOverlap]
    );
    await client.query(
      `INSERT INTO bookings (event_id, venue_id, requested_by, status, start_time, end_time)
       VALUES
       ($1, $2, $3, 'confirmed', '2099-05-01T10:00:00Z', '2099-05-01T12:00:00Z'),
       ($4, $5, $3, 'confirmed', '2099-05-01T10:30:00Z', '2099-05-01T11:30:00Z')`,
      [ids.eventMain, ids.venueMain, ids.coordinator, ids.eventOverlap, ids.venueOverlap]
    );

    await client.query(
      `INSERT INTO technical_support_requirements (event_id, equipment_requirements, staff_required, support_required, status)
       VALUES ($1, $2::jsonb, 2, true, 'pending')`,
      [ids.eventMain, JSON.stringify([{ type: 'Audio', quantity: 5 }])]
    );
    await client.query(
      `INSERT INTO operational_safety_checks (event_id, status, change_scope, comments)
       VALUES ($1, 'changes_requested', ARRAY['technical']::text[], 'Adjust cable routes near emergency exits.')`,
      [ids.eventMain]
    );

    await client.query(
      `INSERT INTO equipment (id, name, equipment_type, total_quantity, status, damaged_quantity, maintenance_quantity)
       VALUES
       ($1, 'Wireless Microphone Set', 'Audio', 5, 'available', 0, 0),
       ($2, 'Mixer Console', 'Audio', 3, 'available', 0, 0)`,
      [ids.equipmentA, ids.equipmentB]
    );
    await client.query(
      `INSERT INTO equipment_reservations (equipment_id, event_id, quantity, status, reserved_by)
       VALUES ($1, $2, 4, 'reserved', $3)`,
      [ids.equipmentA, ids.eventOverlap, ids.tech]
    );

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const authToken = (role, userId) => jwt.sign({ sub: userId, role }, JWT_SECRET);
    async function api(path, { method = 'GET', role = 'technical_support_staff', userId = ids.tech, body } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + authToken(role, userId),
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, body: await response.json() };
    }

    await t.test('queue includes event details, venue, availability, and safety re-review marker', async () => {
      const result = await api('/technical-support/requirements');
      assert.equal(result.status, 200);
      assert.equal(result.body.length, 1);
      const request = result.body[0];
      assert.equal(request.event_title, 'Main Expo');
      assert.equal(request.staff_required, 2);
      assert.deepEqual(request.venues, ['Grand Hall']);
      assert.equal(request.re_review_safety_check, true);
      assert.equal(request.safety_comments, 'Adjust cable routes near emergency exits.');
      const audio = request.equipment_availability.find((item) => item.type === 'Audio');
      assert.deepEqual(audio, {
        type: 'Audio',
        requested_quantity: 5,
        available_quantity: 4,
        in_service_quantity: 8,
        committed_elsewhere: 4,
        sufficient: false
      });
    });

    await t.test('insufficient decision label maps to existing status and notifies coordinator', async () => {
      const result = await api(`/events/${ids.eventMain}/technical-support/decision`, {
        method: 'PATCH',
        body: { decision: 'Insufficient Resources', comments: 'Need one more microphone set.' }
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'changes_requested');
      assert.equal(result.body.resource_decision, 'Insufficient Resources');
      const stored = (await client.query(
        'SELECT status, decision_comments FROM technical_support_requirements WHERE event_id = $1',
        [ids.eventMain]
      )).rows[0];
      assert.deepEqual(stored, { status: 'changes_requested', decision_comments: 'Need one more microphone set.' });
      const notification = (await client.query(
        'SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2 ORDER BY created_at DESC LIMIT 1',
        [ids.coordinator, ids.eventMain]
      )).rows[0];
      assert.match(notification.message, /Insufficient Resources/);
      assert.match(notification.message, /Need one more microphone set\./);
    });

    await t.test('coordinator update clears insufficient status back to pending for re-review', async () => {
      const update = await api(`/events/${ids.eventMain}/technical-support`, {
        method: 'PUT',
        role: 'event_coordinator',
        userId: ids.coordinator,
        body: { equipment: [{ type: 'Audio', quantity: 2 }], staffRequired: 1, noSupportRequired: false }
      });
      assert.equal(update.status, 200);
      const stored = (await client.query(
        'SELECT status, decision_comments FROM technical_support_requirements WHERE event_id = $1',
        [ids.eventMain]
      )).rows[0];
      assert.deepEqual(stored, { status: 'pending', decision_comments: null });
      const queue = await api('/technical-support/requirements');
      const request = queue.body.find((item) => item.event_id === ids.eventMain);
      assert.equal(request.status, 'pending');
      assert.equal(request.resource_decision, 'Pending Review');
      assert.equal(request.re_review_safety_check, true);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.query = originalQuery;
    db.pool = originalPool;
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});
