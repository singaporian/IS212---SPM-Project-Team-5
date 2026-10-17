// Unit test for the change request review page (ChangeRequestReviewView.vue, US-032).
// The page's API call is replaced by a STUB: a stand-in that just returns sample data,
// so the page can be tested without a backend. [FE-01] links to docs/testing/US-032-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/ChangeRequestReviewView.vue'), 'utf8')).descriptor;

// Builds the page with its imports removed, so the test can pass its own API functions in.
function instance(api) {
  const script = descriptor.script.content.replace(/import .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('fetchPendingChangeRequests', 'decideChangeRequest', script)(api.list, api.decide);
  const state = { ...options.data() };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  return state;
}
const render = (state) => renderToString(createSSRApp({ render: compile(descriptor.template.content), data: () => state }));

const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

test('[FE-01] review page shows each proposed value beside the current one, and hides unchanged fields', async () => {
  const sampleRequest = {
    id: 'cr-1', event_id: 'ev-1', event_title: 'Orientation', status: 'pending', created_at: at('2099-02-01', '10:00'),
    proposed_changes: { preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00'), venueLayoutPreference: 'Classroom' },
    current: { preferredStart: at('2099-03-01', '09:00'), preferredEnd: at('2099-03-01', '12:00'), expectedAttendance: 100,
      venueLayoutPreference: 'Theatre', equipmentRequirements: ['projector'] }
  };
  // Stub: the list call returns the sample request; no decision is made in this test.
  const page = instance({ list: async () => [sampleRequest], decide: async () => ({}) });

  await page.load();
  const html = await render(page);

  for (const text of ['Orientation', 'Date &amp; time', '1 Mar 2099, 9:00 AM – 12:00 PM', '5 Mar 2099, 2:00 PM – 5:00 PM',
    'Venue requirements', 'Theatre', 'Classroom', 'Approve', 'Reject']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes('Expected attendance'), 'attendance is not being changed, so it is not listed');
  assert.ok(!html.includes('Equipment requirements'), 'equipment is not being changed, so it is not listed');
});
