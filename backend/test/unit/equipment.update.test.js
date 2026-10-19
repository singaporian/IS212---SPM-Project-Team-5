// US-024: update equipment records and keep damaged / under-maintenance units out of available stock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEquipmentUpdate, findAffectedReservations, presentEquipment, describeChanges, updateEquipment } = require('../../src/equipment');

const valid = { name: 'Wireless microphone', quantity: 10, damagedQuantity: 2, maintenanceQuantity: 1, specifications: { Range: '100 m' } };
const w = (start, end) => ({ start: `2099-03-01T${start}:00Z`, end: `2099-03-01T${end}:00Z` });
const reservation = (title, quantity, ...windows) => ({ id: title, event_id: title, title, quantity, windows, starts_at: windows[0].start });

test('validateEquipmentUpdate accepts a complete update and trims text', () => {
  assert.deepEqual(validateEquipmentUpdate({ ...valid, name: '  Wireless microphone ', specifications: { ' Range ': ' 100 m ' } }), {
    name: 'Wireless microphone', quantity: 10, damagedQuantity: 2, maintenanceQuantity: 1,
    specifications: { Range: '100 m' }, expectedUpdatedAt: null, confirmReconsideration: false
  });
  assert.deepEqual(validateEquipmentUpdate({ ...valid, specifications: undefined }).specifications, {});
  assert.equal(validateEquipmentUpdate({ ...valid, damagedQuantity: 0, maintenanceQuantity: 0 }).damagedQuantity, 0);
  assert.equal(validateEquipmentUpdate({ ...valid, damagedQuantity: 5, maintenanceQuantity: 5 }).maintenanceQuantity, 5);
  assert.equal(validateEquipmentUpdate({ ...valid, confirmReconsideration: true }).confirmReconsideration, true);
  assert.equal(validateEquipmentUpdate({ ...valid, confirmReconsideration: 'yes' }).confirmReconsideration, false);
  assert.equal(validateEquipmentUpdate({ ...valid, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }).expectedUpdatedAt, '2026-01-01T00:00:00.000Z');
});

test('validateEquipmentUpdate ignores the type, which cannot be edited', () => {
  assert.equal('type' in validateEquipmentUpdate({ ...valid, type: 'Lighting' }), false);
});

test('validateEquipmentUpdate rejects missing or invalid fields', () => {
  for (const [field, pattern] of [['name', /name/], ['quantity', /Quantity/], ['damagedQuantity', /Damaged/], ['maintenanceQuantity', /maintenance/]]) {
    const input = { ...valid };
    delete input[field];
    assert.throws(() => validateEquipmentUpdate(input), pattern, field);
  }
  for (const quantity of [0, -1, 1.5, '10', 2147483648]) assert.throws(() => validateEquipmentUpdate({ ...valid, quantity }), /Quantity/, String(quantity));
  for (const damagedQuantity of [-1, 0.5, '1', null, true]) assert.throws(() => validateEquipmentUpdate({ ...valid, damagedQuantity }), /Damaged/, String(damagedQuantity));
  assert.throws(() => validateEquipmentUpdate({ ...valid, name: '   ' }), /name is required/);
  assert.throws(() => validateEquipmentUpdate({ ...valid, specifications: { A: '1', a: '2' } }), /more than once/);
  assert.throws(() => validateEquipmentUpdate({ ...valid, expectedUpdatedAt: 'yesterday' }), /version/);
  assert.throws(() => validateEquipmentUpdate(null), /Invalid/);
  assert.throws(() => validateEquipmentUpdate([]), /Invalid/);
});

test('out-of-service units cannot exceed the total quantity', () => {
  assert.throws(() => validateEquipmentUpdate({ ...valid, quantity: 3, damagedQuantity: 2, maintenanceQuantity: 2 }),
    { message: 'Damaged and under-maintenance units (4) cannot exceed the total quantity (3).' });
});

test('presentEquipment excludes damaged and under-maintenance units from available stock', () => {
  const row = { name: 'Mic', status: 'available', total_quantity: 10, damaged_quantity: 2, maintenance_quantity: 1 };
  assert.equal(presentEquipment(row).available_quantity, 7);
  assert.equal(presentEquipment({ ...row, damaged_quantity: 10, maintenance_quantity: 0 }).available_quantity, 0);
  assert.equal(presentEquipment({ ...row, status: 'retired' }).available_quantity, 0);
});

test('findAffectedReservations flags only reservations that no longer fit', async t => {
  const morning = reservation('Morning', 3, w('09:00', '11:00'));
  const launch = reservation('Launch', 2, w('10:00', '12:00'));
  const evening = reservation('Evening', 4, w('17:00', '18:00'));
  const all = [morning, launch, evening];

  await t.test('nothing is affected while every peak still fits', () => {
    assert.deepEqual(findAffectedReservations(all, 5), []);
  });
  await t.test('overlapping reservations are affected together when their combined peak no longer fits', () => {
    assert.deepEqual(findAffectedReservations(all, 4).map(r => r.title), ['Morning', 'Launch']);
  });
  await t.test('a single reservation larger than the stock is affected on its own', () => {
    assert.deepEqual(findAffectedReservations(all, 3).map(r => r.title), ['Morning', 'Launch', 'Evening']);
  });
  await t.test('events that only touch end-to-start do not stack', () => {
    assert.deepEqual(findAffectedReservations([reservation('A', 2, w('09:00', '10:00')), reservation('B', 2, w('10:00', '11:00'))], 2), []);
  });
  await t.test('two events that each overlap a third but not each other are not double counted', () => {
    const long = reservation('Long', 1, w('09:00', '17:00'));
    const early = reservation('Early', 2, w('09:00', '10:00'));
    const late = reservation('Late', 2, w('15:00', '16:00'));
    assert.deepEqual(findAffectedReservations([long, early, late], 3), []);
  });
});

test('describeChanges lists every field that changed', () => {
  const before = { name: 'Mic', total_quantity: 4, damaged_quantity: 0, maintenance_quantity: 1, specs: { Range: '100 m' } };
  assert.deepEqual(describeChanges(before, { ...before }), []);
  assert.deepEqual(describeChanges(before, { name: 'Handheld mic', total_quantity: 6, damaged_quantity: 2, maintenance_quantity: 0, specs: { Range: '120 m' } }), [
    'renamed from "Mic" to "Handheld mic"', 'total quantity changed from 4 to 6', 'damaged units changed from 0 to 2',
    'units under maintenance changed from 1 to 0', 'specifications updated'
  ]);
});

test('updateEquipment asks for confirmation before reducing stock below upcoming reservations', async t => {
  const item = { id: 'mic', name: 'Mic', status: 'available', total_quantity: 4, damaged_quantity: 0, maintenance_quantity: 0, updated_at: new Date('2026-01-01T00:00:00Z') };
  function fakeQuery(reservations) {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT') && sql.includes('FROM equipment WHERE')) return { rows: [item] };
      if (sql.includes('FROM equipment_reservations r')) return { rows: reservations };
      if (sql.startsWith('UPDATE equipment SET')) {
        const [, name, total, damaged, maintenance, specs] = params;
        return { rows: [{ ...item, name, total_quantity: total, damaged_quantity: damaged, maintenance_quantity: maintenance, specs: JSON.parse(specs) }] };
      }
      if (sql.includes('FROM users WHERE id')) return { rows: [{ name: 'Tan Wei Ling' }] };
      return { rows: [] };
    };
    return { query, calls };
  }
  const data = (overrides = {}) => validateEquipmentUpdate({ name: 'Mic', quantity: 4, damagedQuantity: 2, maintenanceQuantity: 0, ...overrides });

  await t.test('without confirmation nothing is written and the affected events are listed', async () => {
    const { query, calls } = fakeQuery([reservation('Launch', 3, w('10:00', '12:00'))]);
    await assert.rejects(updateEquipment(query, 'mic', data()), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'reservations_affected');
      assert.deepEqual(error.impact.reservations.map(r => r.title), ['Launch']);
      assert.equal(error.impact.inService, 2);
      return true;
    });
    assert.equal(calls.some(c => c.sql.startsWith('UPDATE')), false);
  });

  await t.test('with confirmation the record is saved and the reservation flagged', async () => {
    const { query, calls } = fakeQuery([reservation('Launch', 3, w('10:00', '12:00'))]);
    const result = await updateEquipment(query, 'mic', data({ confirmReconsideration: true }));
    assert.equal(result.equipment.available_quantity, 2);
    assert.deepEqual(result.flaggedReservations.map(r => r.title), ['Launch']);
    assert.match(result.message, /Changes to "Mic" were saved\. 2 of 4 units available for events \(2 damaged\)\. 1 reservation was flagged for reconsideration: "Launch"\./);
    assert.ok(calls.some(c => c.sql.includes('SET requires_reconsideration = true') && c.params[0].includes('Launch')));
    const notice = calls.find(c => c.sql.includes('INSERT INTO notifications'));
    assert.ok(notice.sql.includes("role = 'technical_support_staff'"));
    assert.equal(notice.params[0], 'Equipment "Mic" was updated by a technical support staff member: Damaged units changed from 0 to 2. ' +
      '2 of 4 units now available for events. 1 reservation was flagged for reconsideration.');
  });

  await t.test('the notification names the staff member who made the edit', async () => {
    const { query, calls } = fakeQuery([]);
    await updateEquipment(query, 'mic', data({ name: 'Handheld mic', damagedQuantity: 4 }), 'staff-1');
    assert.equal(calls.find(c => c.sql.includes('INSERT INTO notifications')).params[0],
      'Equipment "Handheld mic" was updated by Tan Wei Ling: Renamed from "Mic" to "Handheld mic"; damaged units changed from 0 to 4. 0 of 4 units now available for events.');
  });

  await t.test('a save that changes nothing sends no notification', async () => {
    const { query, calls } = fakeQuery([]);
    await updateEquipment(query, 'mic', data({ damagedQuantity: 0 }), 'staff-1');
    assert.equal(calls.some(c => c.sql.includes('INSERT INTO notifications')), false);
  });

  await t.test('edits that do not reduce in-service stock never look up reservations', async () => {
    const { query, calls } = fakeQuery([reservation('Launch', 4, w('10:00', '12:00'))]);
    const result = await updateEquipment(query, 'mic', data({ name: 'Renamed mic', damagedQuantity: 0 }));
    assert.equal(result.message, 'Changes to "Renamed mic" were saved. 4 of 4 units available for events.');
    assert.equal(calls.some(c => c.sql.includes('FROM equipment_reservations r')), false);
  });

  await t.test('a stale version is rejected', async () => {
    const { query } = fakeQuery([]);
    await assert.rejects(updateEquipment(query, 'mic', data({ expectedUpdatedAt: '2025-12-31T00:00:00.000Z' })),
      error => error.status === 409 && error.code === 'stale');
    await updateEquipment(query, 'mic', data({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }));
  });
});
