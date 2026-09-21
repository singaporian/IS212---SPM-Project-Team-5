const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

function viewInstance(createEquipment) {
  const source = fs.readFileSync(path.join(__dirname, '../src/views/AddEquipmentView.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('createEquipment', script)(createEquipment);
  const instance = { $refs: {}, $nextTick: fn => fn() };
  instance.$router = { pushed: [], push(to) { this.pushed.push(to) } };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

function fill(instance, values = {}) {
  Object.assign(instance.form, { name: 'Wireless microphone', type: 'Audio', quantity: '4' }, values);
}

test('mandatory fields must be populated before anything is sent', async () => {
  const calls = [];
  const instance = viewInstance(async payload => { calls.push(payload); return {} });
  await instance.save();
  assert.equal(calls.length, 0);
  assert.equal(instance.showErrors, true);
  assert.equal(instance.errors.name, 'Name is required.');
  assert.equal(instance.errors.type, 'Type is required.');
  assert.equal(instance.errors.quantity, 'Quantity is required.');
  for (const missing of ['name', 'type', 'quantity']) {
    const partial = viewInstance(async payload => { calls.push(payload); return {} });
    fill(partial, { [missing]: '' });
    await partial.save();
    assert.equal(calls.length, 0, missing);
  }
  const whitespaceName = viewInstance(async payload => { calls.push(payload); return {} });
  fill(whitespaceName, { name: '   ' });
  await whitespaceName.save();
  assert.equal(calls.length, 0);
});

test('quantity only accepts positive whole numbers', async () => {
  const instance = viewInstance(async () => ({}));
  fill(instance);
  for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '+2', '2 3', '99999999999']) {
    instance.form.quantity = bad;
    assert.match(instance.errors.quantity, /Quantity/, bad);
  }
  for (const good of ['1', '25', ' 7 ', '007']) {
    instance.form.quantity = good;
    assert.equal(instance.errors.quantity, '', good);
  }
});

test('a valid record is sent once, confirmed, and the form is cleared for the next entry', async () => {
  const calls = [];
  const instance = viewInstance(async payload => {
    calls.push(payload);
    return { name: payload.name, total_quantity: payload.quantity, status: 'available' };
  });
  fill(instance, { name: '  Wireless microphone ', quantity: ' 4 ' });
  instance.form.specs[0].label = ' Frequency range '
  instance.form.specs[0].value = '470-530 MHz'
  instance.addSpec(); // a blank row is ignored
  await instance.save();
  assert.deepEqual(calls, [{ name: 'Wireless microphone', type: 'Audio', quantity: 4, specifications: { 'Frequency range': '470-530 MHz' } }]);
  assert.match(instance.successMessage, /Wireless microphone.*added to the inventory.*Available/);
  assert.equal(instance.saveError, '');
  assert.equal(instance.form.name, '');
  assert.equal(instance.form.quantity, '');
  assert.equal(instance.saving, false);
});

test('half-filled and duplicate specification rows block saving', async () => {
  const calls = [];
  const instance = viewInstance(async payload => { calls.push(payload); return {} });
  fill(instance);
  instance.form.specs[0].label = 'Power';
  await instance.save();
  assert.equal(calls.length, 0);
  assert.match(instance.errors.specs[0], /value/);
  instance.form.specs[0].value = '12V';
  instance.addSpec();
  instance.form.specs[1].label = 'power';
  instance.form.specs[1].value = '24V';
  assert.match(instance.errors.specs[1], /already used/);
  instance.removeSpec(1);
  await instance.save();
  assert.equal(calls.length, 1);
});

test('a failed save shows an error, keeps every field and allows a retry', async () => {
  let attempts = 0;
  const instance = viewInstance(async () => {
    if (++attempts === 1) throw new Error('Connection lost');
    return { name: 'Wireless microphone', total_quantity: 1, status: 'available' };
  });
  fill(instance, { quantity: '1' });
  const before = JSON.parse(JSON.stringify(instance.form));
  await instance.save();
  assert.match(instance.saveError, /Connection lost/);
  assert.equal(instance.successMessage, '');
  assert.deepEqual(JSON.parse(JSON.stringify(instance.form)), before);
  assert.equal(instance.saving, false);
  await instance.save();
  assert.equal(instance.saveError, '');
  assert.match(instance.successMessage, /1 unit,/);
});

test('cancelling discards the entered data without calling the server', async () => {
  const calls = [];
  const instance = viewInstance(async payload => { calls.push(payload); return {} });
  fill(instance);
  instance.form.specs[0].label = 'Power';
  instance.cancel();
  assert.equal(calls.length, 0);
  assert.equal(instance.form.name, '');
  assert.equal(instance.form.type, '');
  assert.equal(instance.form.quantity, '');
  assert.equal(instance.form.specs.length, 1);
  assert.equal(instance.form.specs[0].label, '');
  assert.deepEqual(instance.$router.pushed, ['/']);
});
