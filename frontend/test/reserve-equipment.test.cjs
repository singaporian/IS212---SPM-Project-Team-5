// US-023: Reserve Equipment view behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

const EVENT = { id: 'event-1', title: 'Product Launch', windows: [{ start: '2099-03-01T02:00:00Z', end: '2099-03-01T04:00:00Z', venue: 'Hotel Ballroom 2' }] };
const item = (overrides = {}) => ({ id: 'mic', name: 'Wireless microphone', equipment_type: 'Audio', status: 'available', total_quantity: 4,
  committed_elsewhere: 0, reserved_for_event: 0, available: 4, reservation: null, overlapping_events: [], ...overrides });

function viewInstance(api = {}) {
  const services = {
    listReservableEvents: async () => [EVENT],
    getEquipmentAvailability: async () => ({ event: EVENT, equipment: [item()] }),
    reserveEquipment: async () => ({ message: 'Reserved' }),
    removeReservation: async () => ({ message: 'Removed' }),
    ...api
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/views/ReserveEquipmentView.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function(...Object.keys(services), script)(...Object.values(services));
  const instance = { $refs: {}, $nextTick: fn => fn() };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

async function ready(instance) {
  await instance.loadEvents();
  instance.selectedEventId = EVENT.id;
  await instance.selectEvent();
}

test('approved events load and choosing one shows equipment availability for it', async () => {
  const requested = [];
  const instance = viewInstance({ getEquipmentAvailability: async id => { requested.push(id); return { equipment: [item()] } } });
  await ready(instance);
  assert.equal(instance.events.length, 1);
  assert.equal(instance.selectedEvent.title, 'Product Launch');
  assert.deepEqual(requested, ['event-1']);
  assert.equal(instance.equipment[0].available, 4);
  assert.match(instance.formatWindow(EVENT.windows[0]), /1 Mar 2099, 10:00 AM – 12:00 PM/);
});

test('equipment and a positive whole quantity are required before anything is sent', async () => {
  const calls = [];
  const instance = viewInstance({ reserveEquipment: async payload => { calls.push(payload); return {} } });
  await ready(instance);
  await instance.reserve();
  assert.equal(calls.length, 0);
  assert.equal(instance.errors.equipmentId, 'Choose the equipment to reserve.');
  assert.equal(instance.errors.quantity, 'Quantity is required.');
  instance.form.equipmentId = 'mic';
  for (const bad of ['0', '-1', '1.5', 'abc', '99999999999']) {
    instance.form.quantity = bad;
    await instance.reserve();
    assert.match(instance.errors.quantity, /Quantity/, bad);
  }
  assert.equal(calls.length, 0);
});

test('a successful reservation is confirmed, the form clears and availability reloads', async () => {
  const calls = [];
  let loads = 0;
  const instance = viewInstance({
    reserveEquipment: async payload => { calls.push(payload); return { message: 'Reserved 2 "Wireless microphone" units for "Product Launch".' } },
    getEquipmentAvailability: async () => { loads++; return { equipment: [item(loads > 1 ? { reserved_for_event: 2, available: 2, reservation: { id: 'r1', quantity: 2, status: 'reserved' } } : {})] } }
  });
  await ready(instance);
  Object.assign(instance.form, { equipmentId: 'mic', quantity: ' 2 ' });
  await instance.reserve();
  assert.deepEqual(calls, [{ eventId: 'event-1', equipmentId: 'mic', quantity: 2 }]);
  assert.match(instance.successMessage, /Reserved 2/);
  assert.deepEqual(instance.form, { equipmentId: '', quantity: '' });
  assert.equal(instance.equipment[0].reservation.status, 'reserved');
  assert.equal(instance.saving, false);
});

test('a conflict is shown, the input is kept and nothing is marked reserved', async () => {
  const instance = viewInstance({
    reserveEquipment: async () => { throw Object.assign(new Error('Reservation conflict: only 0 units are available.'), { status: 409 }) },
    getEquipmentAvailability: async () => ({ equipment: [item({ committed_elsewhere: 4, available: 0 })] })
  });
  await ready(instance);
  Object.assign(instance.form, { equipmentId: 'mic', quantity: '1' });
  await instance.reserve();
  assert.match(instance.conflictMessage, /conflict/);
  assert.equal(instance.successMessage, '');
  assert.deepEqual(instance.form, { equipmentId: 'mic', quantity: '1' });
  assert.equal(instance.equipment[0].reservation, null);
});

test('a save failure shows an error, keeps the input and the prior state, and a retry succeeds', async () => {
  let attempts = 0;
  const instance = viewInstance({
    reserveEquipment: async () => { if (++attempts === 1) throw new Error('Connection lost'); return { message: 'Reserved 1' } }
  });
  await ready(instance);
  const before = JSON.parse(JSON.stringify(instance.equipment));
  Object.assign(instance.form, { equipmentId: 'mic', quantity: '1' });
  await instance.reserve();
  assert.match(instance.saveError, /Connection lost.*kept/);
  assert.deepEqual(instance.form, { equipmentId: 'mic', quantity: '1' });
  assert.deepEqual(JSON.parse(JSON.stringify(instance.equipment)), before);
  assert.equal(instance.saving, false);
  await instance.reserve();
  assert.equal(instance.saveError, '');
  assert.equal(instance.successMessage, 'Reserved 1');
});

test('removing a reservation asks for confirmation in a dialog before anything is sent', async () => {
  const removed = [];
  const reservedItem = item({ reserved_for_event: 2, available: 2, reservation: { id: 'r1', quantity: 2, status: 'reserved' } });
  const instance = viewInstance({
    getEquipmentAvailability: async () => ({ equipment: [removed.length ? item() : reservedItem] }),
    removeReservation: async id => { removed.push(id); return { message: 'They are back in available stock.' } }
  });
  await ready(instance);
  instance.askRemoval(instance.equipment[0]);
  assert.equal(instance.pendingRemoval, reservedItem, 'the dialog opens');
  assert.deepEqual(removed, [], 'opening the dialog removes nothing');

  instance.cancelRemoval();
  assert.equal(instance.pendingRemoval, null, 'keeping the reservation closes the dialog');
  assert.deepEqual(removed, []);

  instance.askRemoval(instance.equipment[0]);
  await instance.remove();
  assert.deepEqual(removed, ['r1']);
  assert.equal(instance.pendingRemoval, null, 'the dialog closes after removal');
  assert.match(instance.successMessage, /available stock/);
  assert.equal(instance.equipment[0].reservation, null);
});

test('a failed removal keeps the dialog open with an error, leaves the reservation, and can be retried', async () => {
  let fail = true;
  const removed = [];
  const reservedItem = item({ reserved_for_event: 2, available: 2, reservation: { id: 'r1', quantity: 2, status: 'reserved' } });
  const instance = viewInstance({
    getEquipmentAvailability: async () => ({ equipment: [removed.length ? item() : reservedItem] }),
    removeReservation: async id => { if (fail) throw new Error('Server unavailable'); removed.push(id); return { message: 'Removed' } }
  });
  await ready(instance);
  instance.askRemoval(instance.equipment[0]);
  await instance.remove();
  assert.equal(instance.pendingRemoval, reservedItem, 'dialog stays open');
  assert.match(instance.removalError, /Server unavailable.*unchanged/);
  assert.equal(instance.equipment[0].reservation.id, 'r1');
  assert.equal(instance.removingId, '');

  fail = false;
  await instance.remove();
  assert.deepEqual(removed, ['r1']);
  assert.equal(instance.pendingRemoval, null);
  assert.equal(instance.removalError, '');
  assert.equal(instance.successMessage, 'Removed');
});
