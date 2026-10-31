// US-007 frontend unit tests: the "Venue Details" section on the Organiser's request page (SubmittedRequestsView.vue).
// The page is rendered on its own; the API call is replaced by a stub returning one request.
// [FE-xx] ids link to docs/testing/US-007-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { createSSRApp, compile } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/SubmittedRequestsView.vue'), 'utf8')).descriptor;
const script = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');

// Renders the request page for a confirmed event with the given venues and returns the "Venue Details" section's HTML.
async function renderVenueDetails(venues) {
  const request = { id: 'event', title: 'Orientation', status: 'confirmed', submitted_at: '2099-01-01T00:00:00Z', draft_data: {}, venues };
  const fetchStub = async () => ({ ok: true, json: async () => request });
  const options = new Function('fetch', 'authHeaders', 'RequestNavigation', 'canRequestChanges', script)(
    fetchStub, () => ({}), {}, () => true);
  const state = { ...options.data(), $route: { params: { id: 'event' }, query: {} } };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  await state.load();
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => state });
  app.config.globalProperties.$route = state.$route;
  app.component('RequestNavigation', { template: '<nav />' });
  app.component('router-link', { template: '<a><slot /></a>' });
  const html = await renderToString(app);
  const section = /<section[^>]*data-test="venue-details"[^>]*>[\s\S]*?<\/section>/.exec(html);
  assert.ok(section, 'the page has a Venue Details section');
  return section[0];
}

const venue = (name, location, beingRearranged = false) => ({
  venue_name: name, location, start_time: '2099-03-01T01:00:00.000Z', end_time: '2099-03-01T04:00:00.000Z', being_rearranged: beingRearranged
});

test('[FE-01] with no confirmed venue, the read-only Venue Details section says the venue is still being arranged', async () => {
  const html = await renderVenueDetails([]);
  assert.ok(html.includes('Venue Details'));
  assert.ok(html.includes('Venue is still being arranged'));
  assert.doesNotMatch(html, /<(input|select|textarea|button)\b/);
});

test('[FE-02] each confirmed venue shows its name, location and time; an unavailable one is labelled "Venue being re-arranged"', async () => {
  const html = await renderVenueDetails([venue('Main Hall', 'Level 1'), venue('Room B', 'Level 2', true)]);
  for (const text of ['Main Hall', 'Level 1', 'Room B', 'Level 2', '2099'])assert.ok(html.includes(text), text);
  assert.equal(html.split('Venue being re-arranged').length - 1, 1);
  assert.ok(!html.includes('Venue is still being arranged'));
});
