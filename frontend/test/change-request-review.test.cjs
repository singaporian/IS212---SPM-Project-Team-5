// US-032: Event Coordinator reviews and processes change requests.
// Test case IDs match docs/testing/US-032-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/ChangeRequestReviewView.vue'), 'utf8')).descriptor;

// Build the component's state with the API service replaced by test doubles.
function instance(api) {
  const script = descriptor.script.content.replace(/import .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('fetchPendingChangeRequests', 'decideChangeRequest', script)(api.list, api.decide);
  const state = { ...options.data() };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  for (const [name, getter] of Object.entries(options.computed || {})) Object.defineProperty(state, name, { enumerable: true, get: () => getter.call(state) });
  return state;
}
const render = (state) => renderToString(createSSRApp({ render: compile(descriptor.template.content), data: () => state }));

const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const pendingRequest = () => ({
  id: 'cr-1', event_id: 'ev-1', event_title: 'Orientation', status: 'pending', created_at: at('2099-02-01', '10:00'),
  proposed_changes: { preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00'), venueLayoutPreference: 'Classroom' },
  current: { preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '12:00'), expectedAttendance: 100,
    venueLayoutPreference: 'Theatre', equipmentRequirements: ['projector'] }
});

test('TC-US032-FE-01 AC1: each proposed value is shown alongside the current value', async () => {
  const state = instance({ list: async () => [pendingRequest()], decide: async () => assert.fail('no decision expected') });
  await state.load();
  const html = await render(state);
  for (const text of ['Orientation', 'Date &amp; time', '1 Mar 2099, 9:00 AM – 12:00 PM', '5 Mar 2099, 2:00 PM – 5:00 PM',
    'Venue requirements', 'Theatre', 'Classroom', 'Approve', 'Reject']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes('Expected attendance'), 'fields that are not being changed are not listed');
  assert.ok(!html.includes('Equipment requirements'));
});

test('TC-US032-FE-02 AC2 AC5: approving sends the decision, removes the request and lists arrangements to reconsider', async () => {
  const calls = [];
  const state = instance({
    list: async () => [pendingRequest()],
    decide: async (id, decision) => {
      calls.push([id, decision]);
      return { id, status: 'approved', reconsider: {
        bookings: [{ id: 'b1', venue_name: 'Main Hall', status: 'confirmed', start_time: at('2099-03-01', '09:00'), end_time: at('2099-03-01', '12:00') }],
        equipment: [{ id: 'r1', equipment_name: 'Projector', quantity: 2 }]
      } };
    }
  });
  await state.load();
  await state.decide(state.requests[0], 'approved');
  assert.deepEqual(calls, [['cr-1', 'approved']]);
  assert.equal(state.requests.length, 0);
  assert.equal(state.decisionError, '');
  assert.match(state.successMessage, /^Change request for Orientation approved\./);
  assert.match(state.successMessage, /Reconsider/);
  assert.match(state.successMessage, /Main Hall booking/);
  assert.match(state.successMessage, /2 × Projector/);

  const rejected = instance({ list: async () => [pendingRequest()], decide: async (id) => ({ id, status: 'rejected' }) });
  await rejected.load();
  await rejected.decide(rejected.requests[0], 'rejected');
  assert.equal(rejected.successMessage, 'Change request for Orientation rejected. The event is unchanged.');
});

test('TC-US032-FE-03 AC7: a failed save keeps the request and decision so the coordinator can retry', async () => {
  let attempt = 0;
  const calls = [];
  const state = instance({
    list: async () => [pendingRequest()],
    decide: async (id, decision) => {
      calls.push([id, decision]);
      attempt += 1;
      if (attempt === 1) throw new Error('Unable to save your decision. Nothing was changed. Please retry.');
      return { id, status: 'approved', reconsider: { bookings: [], equipment: [] } };
    }
  });
  await state.load();
  await state.decide(state.requests[0], 'approved');
  assert.equal(state.decisionError, 'Unable to save your decision. Nothing was changed. Please retry.');
  assert.equal(state.successMessage, '');
  assert.equal(state.requests.length, 1, 'the request is still listed');
  assert.deepEqual(state.pendingDecision, { id: 'cr-1', decision: 'approved' });
  assert.equal(state.busyId, '');
  const html = await render(state);
  assert.ok(html.includes('Retry approve'), 'a retry action for the same decision is offered');

  await state.retry();
  assert.deepEqual(calls, [['cr-1', 'approved'], ['cr-1', 'approved']]);
  assert.equal(state.requests.length, 0);
  assert.equal(state.decisionError, '');
  assert.equal(state.pendingDecision, null);
  assert.match(state.successMessage, /approved/);
});
