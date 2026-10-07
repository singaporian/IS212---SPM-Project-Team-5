// US-023: reserve available equipment for an event without double-committing it to overlapping events.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, validateReservation, mergeWindows, windowsOverlap, peakCommitted } = require('../src/equipmentReservations');

const w = (start, end) => ({ start: `2099-03-01T${start}:00Z`, end: `2099-03-01T${end}:00Z` });

// ---------- Unit: overlap definition ----------
test('events overlap only when their scheduled windows intersect', () => {
  assert.equal(windowsOverlap([w('09:00', '11:00')], [w('10:00', '12:00')]), true);
  assert.equal(windowsOverlap([w('09:00', '11:00')], [w('09:30', '10:00')]), true, 'contained');
  assert.equal(windowsOverlap([w('09:00', '11:00')], [w('11:00', '12:00')]), false, 'touching end-to-start is not overlapping');
  assert.equal(windowsOverlap([w('09:00', '11:00')], [w('13:00', '14:00')]), false);
  assert.equal(windowsOverlap([w('09:00', '10:00'), w('14:00', '15:00')], [w('11:00', '12:00')]), false, 'gap between an event\'s bookings');
  assert.equal(windowsOverlap([w('09:00', '10:00'), w('14:00', '15:00')], [w('14:30', '16:00')]), true, 'any window counts');
  assert.equal(windowsOverlap([], [w('09:00', '10:00')]), false, 'an event without bookings has no schedule');
});

test('mergeWindows joins overlapping windows of one event', () => {
  assert.deepEqual(mergeWindows([w('10:00', '12:00'), w('09:00', '11:00'), w('13:00', '14:00')]).length, 2);
  assert.deepEqual(mergeWindows([w('09:00', '10:00'), w('10:00', '11:00')]).length, 2, 'touching windows stay separate');
});

test('peakCommitted counts units held at the same moment, not a plain sum', () => {
  const target = [w('10:00', '12:00')];
  // Two other events overlap the target but not each other: at most 1 unit is in use at once.
  assert.equal(peakCommitted(target, [{ quantity: 1, windows: [w('09:00', '11:00')] }, { quantity: 1, windows: [w('11:30', '13:00')] }]), 1);
  // Overlapping each other as well: both are held together.
  assert.equal(peakCommitted(target, [{ quantity: 1, windows: [w('09:00', '11:00')] }, { quantity: 2, windows: [w('10:30', '13:00')] }]), 3);
  // Back-to-back holds do not stack.
  assert.equal(peakCommitted(target, [{ quantity: 2, windows: [w('10:00', '11:00')] }, { quantity: 3, windows: [w('11:00', '12:00')] }]), 3);
  // An event with two overlapping bookings (two venues at once) is only counted once.
  assert.equal(peakCommitted(target, [{ quantity: 2, windows: [w('10:00', '11:00'), w('10:30', '11:30')] }]), 2);
  assert.equal(peakCommitted(target, [{ quantity: 5, windows: [w('13:00', '14:00')] }]), 0);
  assert.equal(peakCommitted(target, []), 0);
});

test('reservation input requires an event, equipment and a positive whole quantity', () => {
  const valid = { eventId: randomUUID(), equipmentId: randomUUID(), quantity: 2 };
  assert.deepEqual(validateReservation(valid), valid);
  for (const quantity of [0, -1, 1.5, '2', null, undefined, '', NaN, 2147483648]) {
    assert.throws(() => validateReservation({ ...valid, quantity }), /Quantity/, String(quantity));
  }
  assert.throws(() => validateReservation({ ...valid, eventId: 'abc' }), /event/);
  assert.throws(() => validateReservation({ ...valid, equipmentId: undefined }), /equipment/);
  assert.throws(() => validateReservation(null));
});

// ---------- Integration: API ----------
test('reservation API reserves, rejects conflicts, releases stock and survives failures', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['equipment', 'equipment_reservations', 'events', 'bookings']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // The reserve route opens its own transaction; run it as a savepoint inside the test's transaction.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us023');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us023');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us023');
        return client.query(sql, params);
      },
      release() {}
    }) };

    const app = express();
    app.use(express.json());
    app.use('/api/equipment', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/equipment';
    const token = (role = 'technical_support_staff') => jwt.sign({ sub: randomUUID(), role },
      process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, body, bearer = token()) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, body: await res.json() };
    }
    const reserve = (eventId, equipmentId, quantity) => call('POST', '/reservations', { eventId, equipmentId, quantity });

    async function makeEquipment(name, quantity, status = 'available') {
      const id = randomUUID();
      await client.query('INSERT INTO equipment (id, name, total_quantity, status) VALUES ($1, $2, $3, $4)', [id, name, quantity, status]);
      return id;
    }
    async function makeEvent(title, windows, status = 'approved', bookingStatus = 'confirmed') {
      const id = randomUUID();
      await client.query('INSERT INTO events (id, title, status) VALUES ($1, $2, $3)', [id, title, status]);
      for (const window of windows) {
        await client.query('INSERT INTO bookings (event_id, start_time, end_time, status) VALUES ($1, $2, $3, $4)',
          [id, window.start, window.end, bookingStatus]);
      }
      return id;
    }
    const reserved = async (equipmentId, eventId) => (await client.query(
      'SELECT quantity FROM equipment_reservations WHERE equipment_id = $1 AND event_id = $2', [equipmentId, eventId])).rows[0]?.quantity ?? 0;

    const mics = await makeEquipment('Wireless microphone', 4);
    const projectors = await makeEquipment('Projector', 2);
    const morning = await makeEvent('Morning Conference', [w('09:00', '11:00')]);
    const midday = await makeEvent('Midday Workshop', [w('11:30', '13:00')]);
    const launch = await makeEvent('Product Launch', [w('10:00', '12:00')]);
    const evening = await makeEvent('Evening Seminar', [w('17:00', '18:00')]);

    await t.test('reserving available equipment succeeds and confirms the reservation', async () => {
      const result = await reserve(morning, mics, 3);
      assert.equal(result.status, 201);
      assert.equal(result.body.reservation.status, 'reserved');
      assert.equal(result.body.reservation.quantity, 3);
      assert.equal(result.body.remaining, 1);
      assert.match(result.body.message, /Reserved 3 "Wireless microphone" units for "Morning Conference"/);
      assert.equal(await reserved(mics, morning), 3);
    });

    await t.test('reserving again for the same event adds to the existing reservation', async () => {
      const result = await reserve(morning, mics, 1);
      assert.equal(result.status, 200);
      assert.equal(result.body.reservation.quantity, 4);
      assert.equal(await reserved(mics, morning), 4);
      const count = (await client.query('SELECT count(*)::int AS n FROM equipment_reservations WHERE event_id = $1', [morning])).rows[0].n;
      assert.equal(count, 1);
    });

    await t.test('equipment fully committed to an overlapping event is rejected with a conflict message', async () => {
      const result = await reserve(launch, mics, 1);
      assert.equal(result.status, 409);
      assert.match(result.body.error, /conflict/i);
      assert.match(result.body.error, /Morning Conference/);
      assert.equal(result.body.conflict.available, 0);
      assert.equal(await reserved(mics, launch), 0, 'nothing saved');
    });

    await t.test('requesting more than is free during the event is rejected; the rest of the stock still works', async () => {
      assert.equal((await reserve(morning, mics, 1)).status, 409, 'own event cannot exceed the total either');
      assert.equal(await reserved(mics, morning), 4, 'prior reservation unchanged');
    });

    await t.test('non-overlapping events can use the same units', async () => {
      assert.equal((await reserve(evening, mics, 4)).status, 201);
      assert.equal((await reserve(midday, mics, 4)).status, 201, 'touching is not overlapping: 11:00 end vs 11:30 start');
    });

    await t.test('two overlapping events that do not overlap each other only block their peak usage', async () => {
      assert.equal((await reserve(morning, projectors, 1)).status, 201);
      assert.equal((await reserve(midday, projectors, 1)).status, 201);
      const ok = await reserve(launch, projectors, 1);
      assert.equal(ok.status, 201, 'only one projector is in use at any moment of the launch');
      const tooMany = await reserve(launch, projectors, 1);
      assert.equal(tooMany.status, 409);
    });

    await t.test('availability reports committed, reserved and free units for the chosen event', async () => {
      const result = await call('GET', `/availability?eventId=${launch}`);
      assert.equal(result.status, 200);
      const mic = result.body.equipment.find(item => item.id === mics);
      assert.deepEqual([mic.total_quantity, mic.committed_elsewhere, mic.reserved_for_event, mic.available], [4, 4, 0, 0]);
      assert.deepEqual(mic.overlapping_events.map(e => e.title).sort(), ['Midday Workshop', 'Morning Conference']);
      const projector = result.body.equipment.find(item => item.id === projectors);
      assert.equal(projector.reservation.status, 'reserved');
      assert.deepEqual([projector.committed_elsewhere, projector.reserved_for_event, projector.available], [1, 1, 0]);
    });

    await t.test('removing a reservation returns its units to available stock immediately', async () => {
      const id = (await client.query('SELECT id FROM equipment_reservations WHERE equipment_id = $1 AND event_id = $2', [mics, morning])).rows[0].id;
      const removed = await call('DELETE', `/reservations/${id}`);
      assert.equal(removed.status, 200);
      assert.match(removed.body.message, /back in available stock/);
      assert.equal(await reserved(mics, morning), 0);
      // The Midday Workshop still holds all 4 between 11:30 and 12:00, so the launch is still blocked...
      assert.equal((await reserve(launch, mics, 1)).status, 409);
      const again = await call('DELETE', `/reservations/${id}`);
      assert.equal(again.status, 404);
    });

    await t.test('a cancelled event no longer holds stock', async () => {
      await client.query(`UPDATE events SET status = 'cancelled' WHERE id = $1`, [midday]);
      const result = await reserve(launch, mics, 4);
      assert.equal(result.status, 201);
    });

    await t.test('only approved events with an approved booking that has not ended can be reserved for', async () => {
      const draft = await makeEvent('Draft', [w('09:00', '10:00')], 'draft');
      const pendingBooking = await makeEvent('Pending booking', [w('09:00', '10:00')], 'approved', 'pending');
      const past = await makeEvent('Past', [{ start: '2000-01-01T09:00:00Z', end: '2000-01-01T10:00:00Z' }]);
      for (const id of [draft, pendingBooking, past]) assert.equal((await reserve(id, projectors, 1)).status, 409);
      assert.equal((await reserve(randomUUID(), projectors, 1)).status, 404);
      assert.equal((await reserve(evening, randomUUID(), 1)).status, 404);
      const retired = await makeEquipment('Broken mixer', 2, 'retired');
      assert.equal((await reserve(evening, retired, 1)).status, 409);

      const events = await call('GET', '/reservable-events');
      assert.equal(events.status, 200);
      const titles = events.body.map(e => e.title);
      assert.ok(titles.includes('Product Launch'));
      for (const hidden of ['Draft', 'Pending booking', 'Past', 'Midday Workshop']) assert.ok(!titles.includes(hidden), hidden);
    });

    await t.test('invalid input is rejected without saving anything', async () => {
      for (const body of [{}, { eventId: evening, equipmentId: projectors }, { eventId: evening, equipmentId: projectors, quantity: 0 },
        { eventId: evening, equipmentId: projectors, quantity: '1' }, { eventId: 'x', equipmentId: projectors, quantity: 1 }]) {
        assert.equal((await call('POST', '/reservations', body)).status, 400, JSON.stringify(body));
      }
      assert.equal(await reserved(projectors, evening), 0);
    });

    await t.test('only Technical Support Staff can reserve or remove equipment', async () => {
      assert.equal((await call('POST', '/reservations', { eventId: evening, equipmentId: projectors, quantity: 1 }, '')).status, 401);
      for (const role of ['attendee', 'event_organiser', 'event_coordinator', 'venue_staff']) {
        assert.equal((await call('POST', '/reservations', { eventId: evening, equipmentId: projectors, quantity: 1 }, token(role))).status, 403, role);
        assert.equal((await call('GET', '/reservable-events', undefined, token(role))).status, 403, role);
      }
      assert.equal(await reserved(projectors, evening), 0);
    });

    await t.test('a save failure returns a retryable error and leaves the prior reservation unchanged', async () => {
      assert.equal((await reserve(evening, projectors, 1)).status, 201);
      await client.query('ALTER TABLE equipment_reservations ADD CONSTRAINT test_write_failure CHECK (quantity < 2) NOT VALID');
      const failed = await reserve(evening, projectors, 1);
      assert.equal(failed.status, 500);
      assert.match(failed.body.error, /Nothing was changed\. Please retry\./);
      assert.equal(await reserved(projectors, evening), 1);
      await client.query('ALTER TABLE equipment_reservations DROP CONSTRAINT test_write_failure');
      const retry = await reserve(evening, projectors, 1);
      assert.equal(retry.status, 200);
      assert.equal(await reserved(projectors, evening), 2);
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
