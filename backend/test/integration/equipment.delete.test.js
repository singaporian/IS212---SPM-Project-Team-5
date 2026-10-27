// US-025: remove equipment records; deletion needs a typed confirmation, is blocked by upcoming reservations and notifies staff.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const equipment = require('../../src/equipment');
const reservations = require('../../src/equipmentReservations');

const at = (day, time) => `${day}T${time}:00Z`;

test('equipment delete API confirms, blocks on upcoming reservations, and notifies staff', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['equipment', 'equipment_reservations', 'events', 'bookings', 'users', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    // LIKE does not copy foreign keys. Copy the real reservation -> equipment key so deleting equipment cascades as it does in production.
    const fk = (await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       WHERE c.conrelid = 'public.equipment_reservations'::regclass AND c.contype = 'f'
         AND c.confrelid = 'public.equipment'::regclass`)).rows[0];
    assert.ok(fk, 'equipment_reservations has a foreign key to equipment');
    await client.query(`ALTER TABLE pg_temp.equipment_reservations ADD ${fk.def.replace(/REFERENCES (public\.)?equipment\(/, 'REFERENCES pg_temp.equipment(')}`);

    db.query = (sql, params) => client.query(sql, params);
    // Routes open their own transaction; run it as a savepoint inside the test's transaction.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us025');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us025');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us025');
        return client.query(sql, params);
      },
      release() {}
    }) };

    // Mounted in the same order as src/index.js.
    const app = express();
    app.use(express.json());
    app.use('/api/equipment', equipment.router);
    app.use('/api/equipment', reservations.router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/equipment';
    const actor = randomUUID(), colleague = randomUUID();
    await client.query(`INSERT INTO users (id, name, email, role) VALUES
      ($1, 'Tan Wei Ling', 'wl@example.test', 'technical_support_staff'),
      ($2, 'Raj Kumar', 'raj@example.test', 'technical_support_staff'),
      ($3, 'Coordinator', 'co@example.test', 'event_coordinator')`, [actor, colleague, randomUUID()]);
    const notices = async () => (await client.query(
      'SELECT n.message, u.name FROM notifications n JOIN users u ON u.id = n.user_id ORDER BY n.created_at, u.name')).rows;
    const token = (role = 'technical_support_staff') => jwt.sign({ sub: role === 'technical_support_staff' ? actor : randomUUID(), role },
      process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token()) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, body: await res.json() };
    }
    const stored = async id => (await client.query('SELECT * FROM equipment WHERE id = $1', [id])).rows[0];
    const reservationsOf = async id => (await client.query(
      'SELECT r.quantity, e.title FROM equipment_reservations r JOIN events e ON e.id = r.event_id WHERE r.equipment_id = $1 ORDER BY e.title', [id])).rows;
    async function makeEvent(title, bookings, status = 'approved') {
      const id = randomUUID();
      await client.query('INSERT INTO events (id, title, status) VALUES ($1, $2, $3)', [id, title, status]);
      for (const [start, end, bookingStatus = 'confirmed'] of bookings) {
        await client.query('INSERT INTO bookings (event_id, start_time, end_time, status) VALUES ($1, $2, $3, $4)', [id, start, end, bookingStatus]);
      }
      return id;
    }
    // Inserted directly for events the reservation screen would not offer (unscheduled, past, released).
    const holdUnits = (equipmentId, eventId, quantity) =>
      client.query('INSERT INTO equipment_reservations (equipment_id, event_id, quantity) VALUES ($1, $2, $3) RETURNING id', [equipmentId, eventId, quantity]);
    async function create(name, quantity, specifications = {}) {
      const result = await call('POST', '', { name, type: 'Audio', quantity, specifications });
      assert.equal(result.status, 201);
      return result.body;
    }
    // What the delete dialog sends once the staff member has reviewed the record and typed its name.
    const confirmFor = record => ({ confirmName: record.name, expectedUpdatedAt: new Date(record.updated_at).toISOString() });

    const mic = await create('Wireless microphone', 10, { Range: '100 m', Battery: '8 h' });
    const projector = await create('Projector', 4);
    const mixer = await create('Mixer', 3);

    await t.test('staff can review name, quantity, type and specifications before deleting (AC1)', async () => {
      await call('PUT', '/' + mic.id, { name: 'Wireless microphone', quantity: 10, damagedQuantity: 2, maintenanceQuantity: 1, specifications: { Range: '100 m', Battery: '8 h' } });
      const check = await call('GET', `/${mic.id}/deletion-check`);
      assert.equal(check.status, 200);
      const { name, equipment_type, total_quantity, available_quantity, damaged_quantity, maintenance_quantity, specs } = check.body.equipment;
      assert.deepEqual({ name, equipment_type, total_quantity, available_quantity, damaged_quantity, maintenance_quantity, specs }, {
        name: 'Wireless microphone', equipment_type: 'Audio', total_quantity: 10, available_quantity: 7, damaged_quantity: 2, maintenance_quantity: 1,
        specs: { Range: '100 m', Battery: '8 h' }
      });
      assert.deepEqual(check.body.conflicts, []);
      assert.equal(check.body.message, '');
      assert.ok(check.body.equipment.updated_at, 'the version the dialog sends back with the deletion');
    });

    await t.test('nothing is deleted without the typed name confirmation (AC2)', async () => {
      const before = await stored(mic.id);
      const noticesBefore = (await notices()).length;
      for (const body of [undefined, {}, { confirmName: '' }, { confirmName: '   ' }]) {
        const result = await call('DELETE', '/' + mic.id, body);
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.body.error, 'Type the equipment name to confirm the deletion.');
      }
      for (const confirmName of ['wireless microphone', 'Wireless mic', 'Projector']) {
        const result = await call('DELETE', '/' + mic.id, { confirmName });
        assert.equal(result.status, 400, confirmName);
        assert.equal(result.body.code, 'name_mismatch');
        assert.equal(result.body.error, 'The name you typed does not match this equipment record. Nothing was deleted.');
      }
      assert.deepEqual(await stored(mic.id), before);
      assert.equal((await notices()).length, noticesBefore, 'refused deletions send no notification');
    });

    await t.test('a deletion based on an outdated copy is rejected with the latest details', async () => {
      const reviewed = (await call('GET', `/${mic.id}/deletion-check`)).body.equipment;
      const edited = await call('PUT', '/' + mic.id, { name: 'Wireless microphone', quantity: 12, damagedQuantity: 0, maintenanceQuantity: 0, specifications: { Range: '100 m' } });
      assert.equal(edited.status, 200);
      const result = await call('DELETE', '/' + mic.id, confirmFor(reviewed));
      assert.equal(result.status, 409);
      assert.equal(result.body.code, 'stale');
      assert.match(result.body.error, /changed by someone else.*Review the latest details/);
      assert.equal(result.body.equipment.total_quantity, 12);
      assert.deepEqual(result.body.equipment.specs, { Range: '100 m' });
      assert.ok(await stored(mic.id));
    });

    const gala = await makeEvent('Annual Gala', [[at('2099-05-01', '10:00'), at('2099-05-01', '12:00')]]);
    const summit = await makeEvent('Tech Summit', [[at('2099-04-01', '09:00'), at('2099-04-01', '17:00')]]);

    await t.test('equipment reserved for upcoming events cannot be deleted, and every conflict is identified (AC4)', async () => {
      // Reserved through the same API the reservation screen uses.
      assert.equal((await call('POST', '/reservations', { eventId: gala, equipmentId: projector.id, quantity: 2 })).status, 201);
      assert.equal((await call('POST', '/reservations', { eventId: summit, equipmentId: projector.id, quantity: 1 })).status, 201);

      const check = await call('GET', `/${projector.id}/deletion-check`);
      assert.equal(check.status, 200);
      assert.deepEqual(check.body.conflicts.map(c => [c.title, c.quantity, c.eventId]), [['Tech Summit', 1, summit], ['Annual Gala', 2, gala]]);
      assert.equal(new Date(check.body.conflicts[0].startsAt).toISOString(), '2099-04-01T09:00:00.000Z');
      assert.equal(check.body.message, '"Projector" cannot be deleted because it is reserved for 2 upcoming events: "Tech Summit", "Annual Gala". ' +
        'Remove those reservations first, then try again.');

      const before = await stored(projector.id);
      const noticesBefore = (await notices()).length;
      const result = await call('DELETE', '/' + projector.id, confirmFor(before));
      assert.equal(result.status, 409);
      assert.equal(result.body.code, 'reserved');
      assert.equal(result.body.error, check.body.message);
      assert.deepEqual(result.body.conflicts.map(c => c.title), ['Tech Summit', 'Annual Gala']);
      assert.deepEqual(await stored(projector.id), before);
      assert.deepEqual(await reservationsOf(projector.id), [{ quantity: 2, title: 'Annual Gala' }, { quantity: 1, title: 'Tech Summit' }]);
      assert.equal((await notices()).length, noticesBefore, 'a blocked deletion sends no notification');
    });

    await t.test('events in progress, unscheduled or awaiting booking approval also block deletion (AC4)', async () => {
      const cases = [
        ['Running Now', [[at('2000-01-01', '00:00'), at('2099-01-01', '00:00')]]],
        ['Not Yet Scheduled', []],
        // A past confirmed session plus a future session still awaiting venue approval: the pending one keeps the event upcoming.
        ['Pending Venue', [[at('2020-06-01', '10:00'), at('2020-06-01', '12:00')], [at('2099-06-01', '10:00'), at('2099-06-01', '12:00'), 'pending']]]
      ];
      for (const [title, bookings] of cases) {
        const item = await create('Speaker for ' + title, 2);
        await holdUnits(item.id, await makeEvent(title, bookings), 1);
        const result = await call('DELETE', '/' + item.id, confirmFor(item));
        assert.equal(result.status, 409, title);
        assert.deepEqual(result.body.conflicts.map(c => c.title), [title]);
        assert.ok(await stored(item.id), title);
      }
      const unscheduled = (await client.query("SELECT id FROM equipment WHERE name = 'Speaker for Not Yet Scheduled'")).rows[0];
      assert.equal((await call('GET', `/${unscheduled.id}/deletion-check`)).body.conflicts[0].startsAt, null);
    });

    await t.test('removing the reservations on the reservation screen lets the deletion go ahead', async () => {
      const ids = (await client.query('SELECT id FROM equipment_reservations WHERE equipment_id = $1', [projector.id])).rows.map(r => r.id);
      for (const id of ids) assert.equal((await call('DELETE', '/reservations/' + id)).status, 200);
      assert.deepEqual((await call('GET', `/${projector.id}/deletion-check`)).body.conflicts, []);
      const result = await call('DELETE', '/' + projector.id, confirmFor(await stored(projector.id)));
      assert.equal(result.status, 200);
      assert.equal(await stored(projector.id), undefined);
    });

    await t.test('a successful deletion removes the record and its past reservations and confirms it (AC3)', async () => {
      await holdUnits(mixer.id, await makeEvent('Last Year', [[at('2020-01-01', '10:00'), at('2020-01-01', '12:00')]]), 2);
      await holdUnits(mixer.id, await makeEvent('Cancelled Future', [[at('2099-01-01', '10:00'), at('2099-01-01', '12:00')]], 'cancelled'), 1);
      await holdUnits(mixer.id, await makeEvent('Completed', [[at('2099-02-01', '10:00'), at('2099-02-01', '12:00')]], 'completed'), 1);
      await holdUnits(mic.id, gala, 1); // another item's reservation for the same kind of event must survive
      assert.deepEqual((await call('GET', `/${mixer.id}/deletion-check`)).body.conflicts, [], 'past and released events do not block');

      const result = await call('DELETE', '/' + mixer.id, confirmFor(await stored(mixer.id)));
      assert.equal(result.status, 200);
      assert.equal(result.body.message, '"Mixer" (Audio, 3 units) was deleted from the inventory.');
      assert.deepEqual(result.body.deleted, { id: mixer.id, name: 'Mixer', equipment_type: 'Audio', total_quantity: 3 });

      assert.equal(await stored(mixer.id), undefined);
      assert.deepEqual(await reservationsOf(mixer.id), [], 'reservation history goes with the record');
      assert.equal((await call('GET', '/' + mixer.id)).status, 404);
      const inventory = await call('GET', '');
      assert.equal(inventory.body.some(item => item.id === mixer.id), false);
      assert.ok(inventory.body.some(item => item.id === mic.id), 'other records are untouched');
      assert.deepEqual(await reservationsOf(mic.id), [{ quantity: 1, title: 'Annual Gala' }]);
    });

    await t.test('every deletion notifies all technical support staff, and nobody else (AC5)', async () => {
      // created_at is the same for every row inside the test's transaction, so sort by content instead.
      const sent = (await notices()).filter(n => n.message.includes('removed from the inventory'))
        .map(n => [n.message, n.name]).sort((a, b) => a.join().localeCompare(b.join()));
      assert.deepEqual(sent, [
        ['Equipment "Mixer" (Audio, 3 units) was removed from the inventory by Tan Wei Ling.', 'Raj Kumar'],
        ['Equipment "Mixer" (Audio, 3 units) was removed from the inventory by Tan Wei Ling.', 'Tan Wei Ling'],
        ['Equipment "Projector" (Audio, 4 units) was removed from the inventory by Tan Wei Ling.', 'Raj Kumar'],
        ['Equipment "Projector" (Audio, 4 units) was removed from the inventory by Tan Wei Ling.', 'Tan Wei Ling']
      ]);
    });

    await t.test('a record that is already gone, or an invalid id, is reported as not found', async () => {
      const again = await call('DELETE', '/' + mixer.id, { confirmName: 'Mixer' });
      assert.equal(again.status, 404);
      assert.equal(again.body.error, 'Equipment not found. It may already have been removed.');
      assert.equal((await call('GET', `/${mixer.id}/deletion-check`)).status, 404);
      assert.equal((await call('DELETE', '/not-an-id', { confirmName: 'Mixer' })).status, 404);
      assert.equal((await call('GET', '/not-an-id/deletion-check')).status, 404);
    });

    await t.test('a database failure deletes nothing and returns a retryable error', async () => {
      const lectern = await create('Lectern', 1);
      await holdUnits(lectern.id, await makeEvent('Old Forum', [[at('2020-02-01', '10:00'), at('2020-02-01', '12:00')]]), 1);
      // The DELETE succeeds but the notification that follows it fails, so the whole transaction must roll back.
      await client.query("ALTER TABLE notifications ADD CONSTRAINT test_delete_failure CHECK (message NOT LIKE '%\"Lectern\"%')");
      const noticesBefore = (await notices()).length;
      const result = await call('DELETE', '/' + lectern.id, confirmFor(lectern));
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'Unable to delete the equipment record. Nothing was changed. Please retry.');
      assert.equal(result.body.code, undefined);
      assert.ok(await stored(lectern.id), 'the record is still there');
      assert.deepEqual(await reservationsOf(lectern.id), [{ quantity: 1, title: 'Old Forum' }], 'its reservations are still there');
      assert.equal((await notices()).length, noticesBefore);

      await client.query('ALTER TABLE notifications DROP CONSTRAINT test_delete_failure');
      assert.equal((await call('DELETE', '/' + lectern.id, confirmFor(lectern))).status, 200, 'the same request succeeds on retry');
    });

  } finally {
    db.query = originalQuery;
    db.pool = originalPool;
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.pool.end();
  }
});
