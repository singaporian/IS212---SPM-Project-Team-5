// US-026: reserve available equipment for an event without double-committing it to overlapping events.
// Unit tests: no database. reserveEquipment runs against an in-memory stand-in for its queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateReservation, mergeWindows, windowsOverlap, peakCommitted, checkEquipmentConflict, reserveEquipment } = require('../../src/equipmentReservations');

const w = (start, end) => ({ start: `2099-03-01T${start}:00Z`, end: `2099-03-01T${end}:00Z` });

const MIC = { id: 'mic', name: 'Wireless microphone', equipment_type: 'Audio', status: 'available', total_quantity: 4 };
const LAUNCH = { id: 'launch', title: 'Product Launch', status: 'approved', windows: [w('10:00', '12:00')] };
// Another live event's reservation of the microphones.
const held = (title, quantity, ...windows) => ({ equipment_id: MIC.id, event_id: title, title, quantity, windows });
const check = overrides => checkEquipmentConflict({ item: MIC, event: LAUNCH, others: [], alreadyReserved: 0, ...overrides });

// Answers the queries reserveEquipment makes and records every insert.
function fakeDb({ item = MIC, event = LAUNCH, existing = null, others = [] } = {}) {
  const inserts = [];
  async function query(sql, params) {
    if (/FROM equipment WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: item.id === params[0] ? [item] : [] };
    if (/WHERE e\.id = \$1/.test(sql)) return { rows: event.id === params[0] ? [event] : [] };
    if (/SELECT id, quantity FROM equipment_reservations/.test(sql)) return { rows: existing ? [existing] : [] };
    if (/FROM equipment_reservations r/.test(sql)) return { rows: others };
    if (/INSERT INTO equipment_reservations/.test(sql)) {
      inserts.push(params);
      const [equipmentId, eventId, quantity] = params;
      return { rows: [{ id: existing ? existing.id : 'reservation-1', equipment_id: equipmentId, event_id: eventId,
        quantity: (existing ? existing.quantity : 0) + quantity, status: 'reserved', updated_at: new Date() }] };
    }
    throw new Error('Unexpected query: ' + sql);
  }
  return { query, inserts };
}

// ---------- Overlap definition ----------
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

// ---------- checkEquipmentConflict ----------
test('US-026: reservation succeeds within the available quantity', async t => {
  await t.test('fewer units than are in stock', () => {
    const result = check({ requested: 3 });
    assert.equal(result.allowed, true);
    assert.equal(result.available, 4);
    assert.equal(result.message, null);
  });

  await t.test('exactly the available quantity', () => {
    assert.equal(check({ requested: 4 }).allowed, true);
    const result = check({ others: [held('Morning Conference', 1, w('09:00', '11:00'))], requested: 3 });
    assert.equal(result.allowed, true);
    assert.equal(result.available, 3);
  });

  await t.test('units held by an event at a different time stay available', () => {
    const result = check({ others: [held('Evening Seminar', 4, w('17:00', '18:00'))], requested: 4 });
    assert.equal(result.allowed, true);
    assert.equal(result.committedElsewhere, 0);
    assert.deepEqual(result.overlapping, []);
  });

  await t.test('an event that ends exactly when this one starts does not overlap', () => {
    assert.equal(check({ others: [held('Breakfast Briefing', 4, w('08:00', '10:00'))], requested: 4 }).allowed, true);
  });

  await t.test('two events that overlap this one but not each other only count their peak usage', () => {
    const others = [held('Morning Conference', 2, w('09:00', '11:00')), held('Midday Workshop', 2, w('11:30', '13:00'))];
    const result = check({ others, requested: 2 });
    assert.equal(result.allowed, true, 'a plain sum would wrongly leave 0 available');
    assert.equal(result.available, 2);
  });
});

test('US-026: reservation is blocked when the requested quantity exceeds availability', async t => {
  await t.test('one more unit than is in stock', () => {
    const result = check({ requested: 5 });
    assert.equal(result.allowed, false);
    assert.equal(result.available, 4);
    assert.equal(result.message,
      'Reservation conflict: only 4 "Wireless microphone" units are available during "Product Launch". Only 4 units are in inventory.');
  });

  await t.test('one more unit than is left after an overlapping event\'s reservation', () => {
    const others = [held('Morning Conference', 3, w('09:00', '11:00'))];
    assert.equal(check({ others, requested: 1 }).allowed, true, 'the last unit can still be reserved');
    const result = check({ others, requested: 2 });
    assert.equal(result.allowed, false);
    assert.equal(result.available, 1);
    assert.equal(result.committedElsewhere, 3);
    assert.match(result.message, /only 1 "Wireless microphone" unit is available/);
    assert.match(result.message, /3 of 4 are already committed to overlapping events: "Morning Conference" \(3\)\./);
  });

  await t.test('equipment fully committed to an overlapping event has nothing available', () => {
    const result = check({ others: [held('Morning Conference', 4, w('09:00', '11:00'))], requested: 1 });
    assert.equal(result.allowed, false);
    assert.equal(result.available, 0);
    assert.deepEqual(result.overlapping.map(o => o.title), ['Morning Conference']);
  });

  await t.test('availability never goes below zero when stock is over-committed', () => {
    const result = check({ others: [held('Morning Conference', 5, w('09:00', '11:00'))], requested: 1 });
    assert.equal(result.available, 0);
  });

  await t.test('units already reserved for this event count against it', () => {
    const result = check({ alreadyReserved: 3, requested: 2 });
    assert.equal(result.allowed, false);
    assert.equal(result.available, 1);
    assert.match(result.message, / 3 are already reserved for this event\.$/);
  });

  await t.test('two overlapping events that also overlap each other are held together', () => {
    const others = [held('Morning Conference', 2, w('09:00', '11:00')), held('Partner Lunch', 2, w('10:30', '13:00'))];
    const result = check({ others, requested: 1 });
    assert.equal(result.allowed, false);
    assert.equal(result.committedElsewhere, 4);
  });
});

// ---------- reserveEquipment ----------
test('US-026: reserveEquipment holds units for the event within the available quantity', async t => {
  await t.test('a new reservation is saved and confirmed', async () => {
    const db = fakeDb();
    const result = await reserveEquipment(db.query, { eventId: LAUNCH.id, equipmentId: MIC.id, quantity: 3 }, 'staff-1');
    assert.deepEqual(db.inserts, [[MIC.id, LAUNCH.id, 3, 'staff-1']]);
    assert.equal(result.created, true);
    assert.equal(result.reservation.quantity, 3);
    assert.equal(result.reservation.status, 'reserved');
    assert.equal(result.remaining, 1);
    assert.equal(result.message, 'Reserved 3 "Wireless microphone" units for "Product Launch". 3 now reserved for this event.');
  });

  await t.test('reserving the rest of the stock adds to the existing reservation', async () => {
    const db = fakeDb({ existing: { id: 'reservation-1', quantity: 1 } });
    const result = await reserveEquipment(db.query, { eventId: LAUNCH.id, equipmentId: MIC.id, quantity: 3 }, 'staff-1');
    assert.equal(db.inserts.length, 1);
    assert.equal(result.created, false);
    assert.equal(result.reservation.quantity, 4);
    assert.equal(result.remaining, 0);
  });
});

test('US-026: reserveEquipment rejects over-allocation without saving anything', async t => {
  await t.test('stock committed to an overlapping event', async () => {
    const db = fakeDb({ others: [held('Morning Conference', 3, w('09:00', '11:00'))] });
    await assert.rejects(reserveEquipment(db.query, { eventId: LAUNCH.id, equipmentId: MIC.id, quantity: 2 }, 'staff-1'), error => {
      assert.equal(error.status, 409);
      assert.match(error.message, /^Reservation conflict:/);
      assert.deepEqual(error.conflict, {
        available: 1, requested: 2,
        overlappingEvents: [{ id: 'Morning Conference', title: 'Morning Conference', quantity: 3 }]
      });
      return true;
    });
    assert.equal(db.inserts.length, 0);
  });

  await t.test('stock already fully reserved for this event', async () => {
    const db = fakeDb({ existing: { id: 'reservation-1', quantity: 4 } });
    await assert.rejects(reserveEquipment(db.query, { eventId: LAUNCH.id, equipmentId: MIC.id, quantity: 1 }, 'staff-1'),
      { status: 409, conflict: { available: 0, requested: 1, overlappingEvents: [] } });
    assert.equal(db.inserts.length, 0);
  });
});
