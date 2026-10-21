// US-024: view and update equipment records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../src/views', file), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  // US-025: both views register the delete dialog; a stub stands in for the stripped import.
  const all = { DeleteEquipmentDialog: {}, ...dependencies };
  return new Function(...Object.keys(all), script)(...Object.values(all));
}

function instantiate(options, extra = {}) {
  const instance = { $refs: {}, $nextTick: fn => fn(), ...extra };
  instance.$router = { pushed: [], push(to) { this.pushed.push(to) } };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

const RECORD = {
  id: 'mic-1', name: 'Wireless microphone', equipment_type: 'Audio', status: 'available',
  total_quantity: 10, damaged_quantity: 1, maintenance_quantity: 0, available_quantity: 9,
  specs: { Range: '100 m' }, updated_at: '2026-10-01T00:00:00.000Z'
};

async function editView({ getEquipment = async () => ({ ...RECORD }), updateEquipment = async () => { throw new Error('not expected') } } = {}) {
  const options = load('EditEquipmentView.vue', { getEquipment, updateEquipment });
  const instance = instantiate(options, { $route: { params: { id: 'mic-1' } } });
  await instance.load();
  return instance;
}

function savedResult(payload, extra = {}) {
  const available = payload.quantity - payload.damagedQuantity - payload.maintenanceQuantity;
  return {
    equipment: { ...RECORD, name: payload.name, total_quantity: payload.quantity, damaged_quantity: payload.damagedQuantity,
      maintenance_quantity: payload.maintenanceQuantity, available_quantity: available, specs: payload.specifications, updated_at: '2026-10-02T00:00:00.000Z' },
    message: `Changes to "${payload.name}" were saved.`,
    flaggedReservations: [],
    ...extra
  };
}

test('the edit form loads the current record with its status breakdown', async () => {
  const view = await editView();
  assert.equal(view.form.name, 'Wireless microphone');
  assert.equal(view.form.quantity, '10');
  assert.equal(view.form.damaged, '1');
  assert.equal(view.form.maintenance, '0');
  assert.deepEqual(view.form.specs.map(s => [s.label, s.value]), [['Range', '100 m']]);
  assert.equal(view.preview.available, 9);
  assert.equal(view.dirty, false);
});

test('a missing record shows a not-found message without a retry', async () => {
  const view = await editView({ getEquipment: async () => { throw Object.assign(new Error('Equipment not found.'), { status: 404 }) } });
  assert.equal(view.record, null);
  assert.equal(view.notFound, true);
  assert.match(view.loadError, /not found/);
});

test('marking units damaged or under maintenance updates the available preview immediately', async () => {
  const view = await editView();
  view.form.damaged = '3';
  view.form.maintenance = '2';
  assert.equal(view.preview.available, 5);
  assert.equal(view.preview.reduced, 4);
  assert.equal(view.dirty, true);
});

test('out-of-service units cannot exceed the total and invalid counts block saving', async () => {
  const calls = [];
  const view = await editView({ updateEquipment: async (...args) => { calls.push(args); return savedResult(args[1]) } });
  view.form.damaged = '6';
  view.form.maintenance = '5';
  assert.equal(view.errors.outOfService, 'Damaged and under-maintenance units (11) cannot exceed the total quantity (10).');
  assert.equal(view.preview.available, null);
  await view.save();
  for (const [field, bad] of [['damaged', '-1'], ['maintenance', '1.5'], ['quantity', '0'], ['damaged', '']]) {
    view.form.damaged = '0'; view.form.maintenance = '0'; view.form.quantity = '10';
    view.form[field] = bad;
    assert.equal(view.hasErrors, true, `${field}=${bad}`);
    await view.save();
  }
  view.form.quantity = '10'; view.form.damaged = '0'; view.form.maintenance = '0';
  view.form.name = '  ';
  await view.save();
  assert.equal(calls.length, 0);
});

test('saving sends name, quantity, status counts and specifications, then confirms success', async () => {
  const calls = [];
  const view = await editView({ updateEquipment: async (id, payload) => { calls.push([id, payload]); return savedResult(payload) } });
  view.form.name = '  Handheld mic ';
  view.form.quantity = ' 12 ';
  view.form.damaged = '2';
  view.form.maintenance = '1';
  view.form.specs[0].value = '120 m';
  view.addSpec();
  view.form.specs[1].label = 'Battery';
  view.form.specs[1].value = 'AA';
  view.addSpec(); // a blank row is ignored
  await view.save();
  assert.deepEqual(calls, [['mic-1', {
    name: 'Handheld mic', quantity: 12, damagedQuantity: 2, maintenanceQuantity: 1,
    specifications: { Range: '120 m', Battery: 'AA' }, expectedUpdatedAt: '2026-10-01T00:00:00.000Z'
  }]]);
  assert.equal(view.successMessage, 'Changes to "Handheld mic" were saved.');
  assert.equal(view.saveError, '');
  assert.equal(view.record.available_quantity, 9);
  assert.equal(view.record.updated_at, '2026-10-02T00:00:00.000Z');
  assert.equal(view.dirty, false);
  assert.equal(view.saving, false);
});

test('a failed save says the changes were not saved and keeps the edits', async () => {
  const view = await editView({ updateEquipment: async () => { throw new Error('Unable to reach the server.') } });
  view.form.name = 'Handheld mic';
  await view.save();
  assert.equal(view.successMessage, '');
  assert.match(view.saveError, /Unable to reach the server\. Your edits have been kept/);
  assert.equal(view.form.name, 'Handheld mic');
  assert.equal(view.record.name, 'Wireless microphone');
});

test('a stale copy offers a reload instead of overwriting newer changes', async () => {
  const view = await editView({ updateEquipment: async () => { throw Object.assign(new Error('This record was changed by someone else.'), { status: 409, code: 'stale' }) } });
  view.form.name = 'Old copy';
  await view.save();
  assert.equal(view.stale, true);
  assert.match(view.saveError, /changed by someone else/);
});

test('reducing stock below reservations warns first, then saves only once confirmed', async () => {
  const calls = [];
  const impact = { inService: 5, reservations: [{ id: 'r1', title: 'Product Launch', quantity: 6, startsAt: '2099-03-01T10:00:00Z' }] };
  const view = await editView({
    updateEquipment: async (id, payload) => {
      calls.push(payload);
      if (!payload.confirmReconsideration) throw Object.assign(new Error('Only 5 units would remain.'), { status: 409, code: 'reservations_affected', impact });
      return savedResult(payload, { message: 'Changes saved. 1 reservation was flagged for reconsideration: "Product Launch".' });
    }
  });
  view.form.damaged = '5';
  await view.save();
  assert.deepEqual(view.impact, impact);
  assert.equal(view.saveError, '');
  assert.equal(view.successMessage, '');
  assert.equal(calls.length, 1);
  assert.equal('confirmReconsideration' in calls[0], false);

  await view.save(true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].confirmReconsideration, true);
  assert.equal(view.impact, null);
  assert.match(view.successMessage, /flagged for reconsideration/);
});

test('editing after a reservation warning dismisses it so stale impact is never confirmed', async () => {
  const view = await editView();
  view.impact = { inService: 1, reservations: [] };
  view.onInput();
  assert.equal(view.impact, null);
});

test('cancelling without changes returns to the inventory straight away', async () => {
  const calls = [];
  const view = await editView({ updateEquipment: async (...args) => { calls.push(args) } });
  view.cancel();
  assert.deepEqual(view.$router.pushed, ['/equipment']);
  assert.equal(calls.length, 0);
});

test('cancelling with unsaved changes asks in the leave dialog, and discarding leaves the record unchanged', async () => {
  const calls = [];
  const view = await editView({ updateEquipment: async (...args) => { calls.push(args) } });
  view.form.name = 'Changed name';
  view.form.damaged = '4';
  view.cancel();
  assert.equal(view.pendingLeave, '/equipment', 'Cancel opens the same dialog as leaving the page');
  assert.deepEqual(view.$router.pushed, []);

  view.stayOnPage(); // "Keep editing"
  assert.equal(view.pendingLeave, null);
  assert.equal(view.form.name, 'Changed name');

  view.cancel();
  view.confirmLeave(); // "Discard and leave"
  assert.equal(calls.length, 0);
  assert.equal(view.form.name, 'Wireless microphone');
  assert.equal(view.form.damaged, '1');
  assert.equal(view.record.name, 'Wireless microphone');
  assert.deepEqual(view.$router.pushed, ['/equipment']);
});

test('the inventory lists each record with type, quantity and status breakdown', async () => {
  const items = [
    { ...RECORD },
    { ...RECORD, id: 'proj', name: 'Projector', equipment_type: 'Video & Display', total_quantity: 4, damaged_quantity: 0, maintenance_quantity: 4, available_quantity: 0, specs: {} },
    { ...RECORD, id: 'cable', name: 'HDMI cable', equipment_type: 'Power & Cabling', total_quantity: 20, damaged_quantity: 0, maintenance_quantity: 0, available_quantity: 20, specs: { A: '1', B: '2', C: '3' } }
  ];
  const options = load('EquipmentInventoryView.vue', { listEquipment: async () => items });
  const view = instantiate(options);
  await view.load();
  assert.equal(view.equipment.length, 3);
  assert.deepEqual(view.statusBadges(items[0]).map(b => b.label), ['9 Available', '1 Damaged']);
  assert.deepEqual(view.statusBadges(items[1]).map(b => b.label), ['4 Under Maintenance']);
  assert.deepEqual(view.statusBadges({ ...items[2], status: 'retired' }).map(b => b.label), ['Out of service']);
  assert.deepEqual(view.summary.map(t => t.value), [34, 29, 1, 4]);
  assert.equal(view.specSummary(items[2].specs), 'A: 1 · B: 2 · +1 more');
  assert.equal(view.specSummary({}), 'No specifications');

  view.statusFilter = 'maintenance';
  assert.deepEqual(view.filtered.map(i => i.name), ['Projector']);
  view.statusFilter = 'available';
  assert.deepEqual(view.filtered.map(i => i.name), ['HDMI cable']);
  view.statusFilter = '';
  view.search = 'audio';
  assert.deepEqual(view.filtered.map(i => i.name), ['Wireless microphone']);
});

test('the inventory shows a retryable error when loading fails', async () => {
  const options = load('EquipmentInventoryView.vue', { listEquipment: async () => { throw new Error('Unable to load the equipment inventory. Please retry.') } });
  const view = instantiate(options);
  await view.load();
  assert.match(view.loadError, /retry/);
  assert.equal(view.loading, false);
});

test('leaving with unsaved changes opens an in-app dialog instead of a browser pop-up', async () => {
  const options = load('EditEquipmentView.vue', { getEquipment: async () => ({ ...RECORD }), updateEquipment: async () => { throw new Error('not expected') } });
  const view = instantiate(options, { $route: { params: { id: 'mic-1' } } });
  await view.load();
  const leave = to => { let result; options.beforeRouteLeave.call(view, { fullPath: to }, {}, value => { result = value }); return result };

  // No changes: the page is left straight away, with no dialog.
  assert.equal(leave('/equipment'), undefined);
  assert.equal(view.pendingLeave, null);

  view.form.quantity = '6';
  assert.equal(leave('/equipment'), false, 'navigation is held while the dialog is open');
  assert.equal(view.pendingLeave, '/equipment');

  view.stayOnPage(); // "Keep editing"
  assert.equal(view.pendingLeave, null);
  assert.equal(view.form.quantity, '6');
  assert.deepEqual(view.$router.pushed, []);

  leave('/equipment/reserve'); // e.g. a notification link
  view.confirmLeave(); // "Discard and leave"
  assert.deepEqual(view.$router.pushed, ['/equipment/reserve']);
  assert.equal(view.form.quantity, '10', 'unsaved edits are thrown away');
  assert.equal(leave('/equipment/reserve'), undefined, 'the confirmed navigation is not asked about again');
});
