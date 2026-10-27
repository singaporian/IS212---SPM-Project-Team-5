// US-024: view and update equipment records; damaged / under-maintenance units leave available stock immediately.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const equipment = require('../../src/equipment');
const reservations = require('../../src/equipmentReservations');

const w = (start, end) => ({ start: `2099-03-01T${start}:00Z`, end: `2099-03-01T${end}:00Z` });

test('equipment update API saves, cancels nothing, and protects reservations', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['equipment', 'equipment_reservations', 'events', 'bookings', 'users', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // Routes open their own transaction; run it as a savepoint inside the test's transaction.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us024');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us024');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us024');
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
    async function makeEvent(title, windows) {
      const id = randomUUID();
      await client.query("INSERT INTO events (id, title, status) VALUES ($1, $2, 'approved')", [id, title]);
      for (const window of windows) {
        await client.query("INSERT INTO bookings (event_id, start_time, end_time, status) VALUES ($1, $2, $3, 'confirmed')", [id, window.start, window.end]);
      }
      return id;
    }

    const created = await call('POST', '', { name: 'Wireless microphone', type: 'Audio', quantity: 10, specifications: { Range: '100 m' } });
    assert.equal(created.status, 201);
    const mic = created.body.id;
    const update = (overrides = {}) => ({ name: 'Wireless microphone', quantity: 10, damagedQuantity: 0, maintenanceQuantity: 0, specifications: { Range: '100 m' }, ...overrides });

    await t.test('new records start fully in service', async () => {
      assert.equal(created.body.damaged_quantity, 0);
      assert.equal(created.body.maintenance_quantity, 0);
      assert.equal(created.body.available_quantity, 10);
    });

    await t.test('staff can view each record with type, quantity and status breakdown', async () => {
      const list = await call('GET', '');
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 1);
      assert.deepEqual(
        (({ name, equipment_type, total_quantity, available_quantity, damaged_quantity, maintenance_quantity }) =>
          ({ name, equipment_type, total_quantity, available_quantity, damaged_quantity, maintenance_quantity }))(list.body[0]),
        { name: 'Wireless microphone', equipment_type: 'Audio', total_quantity: 10, available_quantity: 10, damaged_quantity: 0, maintenance_quantity: 0 });
      const one = await call('GET', '/' + mic);
      assert.equal(one.status, 200);
      assert.deepEqual(one.body.specs, { Range: '100 m' });
      assert.equal((await call('GET', '/' + randomUUID())).status, 404);
    });

    await t.test('name, quantity and specifications can be edited and the save is confirmed', async () => {
      const before = await stored(mic);
      const result = await call('PUT', '/' + mic, update({ name: 'Handheld mic', quantity: 12, specifications: { Range: '120 m', Battery: 'AA' }, expectedUpdatedAt: before.updated_at.toISOString() }));
      assert.equal(result.status, 200);
      assert.equal(result.body.message, 'Changes to "Handheld mic" were saved. 12 of 12 units available for events.');
      const after = await stored(mic);
      assert.equal(after.name, 'Handheld mic');
      assert.equal(after.total_quantity, 12);
      assert.deepEqual(after.specs, { Range: '120 m', Battery: 'AA' });
      assert.equal(after.equipment_type, 'Audio');
      assert.ok(after.updated_at > before.updated_at);
    });

    await t.test('every saved edit notifies all technical support staff, and nobody else', async () => {
      const sent = await notices();
      assert.deepEqual(sent.map(n => n.name), ['Raj Kumar', 'Tan Wei Ling']);
      assert.equal(sent[0].message, 'Equipment "Handheld mic" was updated by Tan Wei Ling: Renamed from "Wireless microphone" to "Handheld mic"; ' +
        'total quantity changed from 10 to 12; specifications updated. 12 of 12 units now available for events.');
    });

    await t.test('the type cannot be changed through an update', async () => {
      const result = await call('PUT', '/' + mic, update({ name: 'Handheld mic', quantity: 12, specifications: { Range: '120 m', Battery: 'AA' }, type: 'Lighting' }));
      assert.equal(result.status, 200);
      assert.equal((await stored(mic)).equipment_type, 'Audio');
      assert.equal((await notices()).length, 2, 'an edit that changes nothing sends no notification');
    });

    await t.test('marking units damaged or under maintenance removes them from reservable stock immediately', async () => {
      const event = await makeEvent('Product Launch', [w('10:00', '12:00')]);
      const result = await call('PUT', '/' + mic, update({ name: 'Handheld mic', quantity: 12, damagedQuantity: 3, maintenanceQuantity: 2 }));
      assert.equal(result.status, 200);
      assert.equal(result.body.equipment.available_quantity, 7);
      assert.match(result.body.message, /7 of 12 units available for events \(3 damaged, 2 under maintenance\)/);
      const availability = await call('GET', '/availability?eventId=' + event);
      assert.equal(availability.status, 200);
      const item = availability.body.equipment.find(e => e.id === mic);
      assert.equal(item.in_service_quantity, 7);
      assert.equal(item.available, 7);
      const tooMany = await call('POST', '/reservations', { eventId: event, equipmentId: mic, quantity: 8 });
      assert.equal(tooMany.status, 409);
      assert.match(tooMany.body.error, /in service/);
      assert.equal((await call('POST', '/reservations', { eventId: event, equipmentId: mic, quantity: 6 })).status, 201);
    });

    await t.test('reducing stock below upcoming reservations needs confirmation, then flags them', async () => {
      // 6 units are reserved for Product Launch; leaving 5 in service would over-commit it.
      const reduce = update({ name: 'Handheld mic', quantity: 12, damagedQuantity: 5, maintenanceQuantity: 2 });
      const before = await stored(mic);
      const warned = await call('PUT', '/' + mic, reduce);
      assert.equal(warned.status, 409);
      assert.equal(warned.body.code, 'reservations_affected');
      assert.equal(warned.body.impact.inService, 5);
      assert.deepEqual(warned.body.impact.reservations.map(r => [r.title, r.quantity]), [['Product Launch', 6]]);
      assert.deepEqual(await stored(mic), before);

      const confirmed = await call('PUT', '/' + mic, { ...reduce, confirmReconsideration: true });
      assert.equal(confirmed.status, 200);
      assert.match(confirmed.body.message, /1 reservation was flagged for reconsideration: "Product Launch"/);
      assert.equal((await stored(mic)).damaged_quantity, 5);
      const flagged = (await client.query('SELECT requires_reconsideration, quantity FROM equipment_reservations WHERE equipment_id = $1', [mic])).rows[0];
      assert.deepEqual(flagged, { requires_reconsideration: true, quantity: 6 });
      const latest = (await notices()).filter(n => /damaged units changed from 3 to 5/i.test(n.message));
      assert.equal(latest.length, 2);
      assert.match(latest[0].message, /5 of 12 units now available for events\. 1 reservation was flagged for reconsideration\.$/);
      assert.equal((await notices()).filter(n => n.message.includes('from 3 to 5')).length, 2, 'the unconfirmed attempt sent nothing');
    });

    await t.test('restoring repaired units never needs confirmation', async () => {
      const result = await call('PUT', '/' + mic, update({ name: 'Handheld mic', quantity: 12 }));
      assert.equal(result.status, 200);
      assert.equal(result.body.equipment.available_quantity, 12);
    });

    await t.test('invalid updates are rejected and leave the record unchanged', async () => {
      const before = await stored(mic);
      const noticesBefore = (await notices()).length;
      for (const body of [update({ name: '' }), update({ quantity: 0 }), update({ damagedQuantity: -1 }), update({ quantity: 3, damagedQuantity: 2, maintenanceQuantity: 2 }),
        update({ specifications: { A: '' } }), { name: 'No counts', quantity: 2 }]) {
        const result = await call('PUT', '/' + mic, body);
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.ok(result.body.error);
      }
      assert.deepEqual(await stored(mic), before);
      assert.equal((await call('PUT', '/' + randomUUID(), update())).status, 404);
      assert.equal((await notices()).length, noticesBefore, 'rejected edits send no notification');
      assert.equal((await call('PUT', '/not-an-id', update())).status, 404);
    });

    await t.test('an edit based on an outdated copy is rejected', async () => {
      const result = await call('PUT', '/' + mic, update({ name: 'Old copy', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }));
      assert.equal(result.status, 409);
      assert.equal(result.body.code, 'stale');
      assert.notEqual((await stored(mic)).name, 'Old copy');
    });

    await t.test('a database failure saves nothing and returns a retryable error', async () => {
      await client.query("ALTER TABLE equipment ADD CONSTRAINT test_update_failure CHECK (name <> 'force failure')");
      const before = await stored(mic);
      const result = await call('PUT', '/' + mic, update({ name: 'force failure' }));
      assert.equal(result.status, 500);
      assert.match(result.body.error, /not changed.*retry/);
      assert.equal(result.body.code, undefined);
      assert.deepEqual(await stored(mic), before);
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
