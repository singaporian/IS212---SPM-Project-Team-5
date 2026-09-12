const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

function formInstance(request, id) {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/EventRequestForm.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('draftRequest', script)(request);
  const instance = { $route: { params: id ? { id } : {} }, $options: options };
  instance.$router = { async replace(route) { instance.$route.params = route.params } };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

test('save failures retain all input and retry uses the same draft ID', async () => {
  const calls = [];
  const instance = formInstance(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('Connection lost');
    return {};
  });
  Object.assign(instance.form, { purpose: 'Plan later', startTime: '11:05', expectedAttendance: 'none' });
  const before = structuredClone(instance.form);
  await instance.saveDraft();
  assert.deepEqual(instance.form, before);
  assert.match(instance.saveError, /Connection lost/);
  assert.equal(instance.saving, false);
  await instance.saveDraft();
  assert.equal(calls[0].url, calls[1].url);
  assert.deepEqual(JSON.parse(calls[1].options.body), before);
  assert.match(instance.saveMessage, /saved successfully/);
  assert.equal(instance.$route.params.id, instance.draftId);
});

test('reopening a draft restores every corresponding field', async () => {
  const stored = { eventName: 'Sample', startDate: '2099-01-01', startTime: '', endDate: '',
    endTime: '12:00', expectedAttendance: ' not decided ', purpose: 'Purpose', description: 'Description',
    venueRequirements: 'Theatre', accessibilityNeeds: 'Ramp', equipmentRequirements: 'none', registrationNeeds: 'no' };
  const instance = formInstance(async () => ({ draft_data: stored }), 'saved-id');
  await instance.loadDraft();
  assert.deepEqual(instance.form, stored);
  assert.equal(instance.loadError, '');
});

test('invalid attendance blocks save and retains input', async () => {
  let called = false;
  const instance = formInstance(async () => { called = true });
  instance.form.expectedAttendance = '1.5';
  await instance.saveDraft();
  assert.equal(called, false);
  assert.equal(instance.form.expectedAttendance, '1.5');
  assert.match(instance.saveError, /whole number/);
});

test('concurrent clicks cannot send duplicate saves', async () => {
  let finish, calls = 0;
  const instance = formInstance(() => { calls++; return new Promise(resolve => { finish = resolve }) });
  const pending = instance.saveDraft();
  await instance.saveDraft();
  assert.equal(calls, 1);
  finish({});
  await pending;
});

test('denied draft load does not expose an editable empty form', async () => {
  const instance = formInstance(async () => { throw new Error('Draft not found.') }, 'other-id');
  await instance.loadDraft();
  assert.equal(instance.loadError, 'Draft not found.');
  assert.equal(instance.loading, false);
});

test('a late response from another draft cannot replace the current form', async () => {
  let finish;
  const instance = formInstance(() => new Promise(resolve => { finish = resolve }), 'first-id');
  const pending = instance.loadDraft();
  instance.draftId = 'second-id';
  instance.form.eventName = 'Current draft';
  finish({ draft_data: { eventName: 'Previous draft' } });
  await pending;
  assert.equal(instance.form.eventName, 'Current draft');
});

test('loading can be retried after a temporary failure', async () => {
  let calls = 0;
  const instance = formInstance(async () => {
    if (++calls === 1) throw new Error('Temporary outage');
    return { draft_data: { eventName: 'Recovered draft' } };
  }, 'saved-id');
  await instance.loadDraft();
  assert.equal(instance.loadError, 'Temporary outage');
  await instance.loadDraft();
  assert.equal(instance.loadError, '');
  assert.equal(instance.form.eventName, 'Recovered draft');
});

test('expired-session save error keeps unsaved input available', async () => {
  const instance = formInstance(async () => { throw new Error('Your session has expired.') });
  instance.form.purpose = 'Unsaved work';
  await instance.saveDraft();
  assert.match(instance.saveError, /session has expired/);
  assert.equal(instance.form.purpose, 'Unsaved work');
  assert.equal(instance.saving, false);
});

test('valid complete future date/time pairs save while reversed times are rejected', async () => {
  let calls = 0;
  const instance = formInstance(async () => { calls++; return {} });
  Object.assign(instance.form, { startDate: '2099-01-01', startTime: '10:00', endDate: '2099-01-01', endTime: '11:00' });
  await instance.saveDraft();
  assert.equal(calls, 1);
  instance.form.endTime = '09:00';
  await instance.saveDraft();
  assert.equal(calls, 1);
  assert.match(instance.saveError, /later than the start/);
});

test('valid historical dates can be saved with or without a time', async () => {
  let calls = 0;
  const instance = formInstance(async () => { calls++; return {} });
  instance.form.startDate = '2000-01-01';
  await instance.saveDraft();
  assert.equal(calls, 1);
  Object.assign(instance.form, { startTime: '10:00', endDate: '2000-01-01', endTime: '11:00' });
  await instance.saveDraft();
  assert.equal(calls, 2);
  assert.equal(instance.saveError, '');
});
