// US-009 frontend unit tests: the Organiser's status, next step, rejection reason and change requests (SubmittedRequestsView.vue).
// The page is rendered on its own; the API call is replaced by a stub returning one request.
// [UT-xx] ids link to docs/testing/US-009-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { createSSRApp, compile } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/SubmittedRequestsView.vue'), 'utf8')).descriptor;
const script = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');

// Renders one request, on its own page (default) or as a row of the list, and returns the HTML.
async function renderRequest(request, { list = false } = {}) {
  const row = { id: 'event', title: 'Orientation', submitted_at: '2099-01-01T00:00:00Z', draft_data: {}, ...request };
  const payload = list ? [row] : row;
  const fetchStub = async () => ({ ok: true, json: async () => payload });
  const options = new Function('fetch', 'authHeaders', 'RequestNavigation', 'canRequestChanges', script)(
    fetchStub, () => ({}), {}, status => ['approved', 'planning', 'confirmed'].includes(status));
  const state = { ...options.data(), $route: { params: list ? {} : { id: 'event' }, query: {} } };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  await state.load();
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => state });
  app.config.globalProperties.$route = state.$route;
  app.component('RequestNavigation', { template: '<nav />' });
  app.component('router-link', { template: '<a><slot /></a>' });
  return renderToString(app);
}

// The text inside the event's status badge.
const badge = label => new RegExp(`class="badge[^"]*">${label}</span>`);

const LABELS = {
  submitted: 'Submitted', clarification_requested: 'Returned for clarification', approved: 'Approved',
  planning: 'In planning', confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled'
};

test('[UT-01] each status shows its plain-words label, on the list and on the request page', async () => {
  for (const list of [false, true]) {
    for (const [status, label] of Object.entries(LABELS)) {
      assert.match(await renderRequest({ status }, { list }), badge(label), `${status} list=${list}`);
    }
  }
});

test('[UT-02] the request page states the next step for each status', async () => {
  const nextStep = {
    submitted: 'Edit request', clarification_requested: 'Resubmit for review',
    approved: 'Request changes', planning: 'Request changes', confirmed: 'Request changes',
    rejected: 'No further action', cancelled: 'No further action'
  };
  for (const [status, text] of Object.entries(nextStep)) {
    assert.ok((await renderRequest({ status })).includes(text), status);
  }
});

test("[UT-03] a rejected request shows Rejected and the Coordinator's reason", async () => {
  const html = await renderRequest({ status: 'rejected', rejection_reason: 'Other: Venue closed for renovation' });
  assert.match(html, badge('Rejected'));
  assert.ok(html.includes('Other: Venue closed for renovation'));
});

test("[UT-04] an approved event lists its change requests with their own status, separate from the event's", async () => {
  const html = await renderRequest({
    status: 'planning',
    change_requests: [
      { id: 'cr2', status: 'pending', proposed_changes: { venueLayoutPreference: 'Classroom' }, created_at: '2099-01-03T00:00:00Z' },
      { id: 'cr1', status: 'rejected', proposed_changes: { expectedAttendance: 150 }, created_at: '2099-01-02T00:00:00Z' }
    ]
  });
  assert.match(html, badge('In planning'));
  assert.ok(html.includes('Change requests'));
  assert.match(html, badge('Pending Review'));
  assert.match(html, badge('Rejected'));
});
