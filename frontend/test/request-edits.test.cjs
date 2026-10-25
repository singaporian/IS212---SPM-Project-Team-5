// US-031 frontend unit tests: the Organiser's request page (SubmittedRequestsView.vue).
// The page is rendered on its own; the API call is replaced by a stub returning one request.
// [UT-xx] ids link to docs/testing/US-031-test-plan.md.
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

test('[UT-03] the Edit request link shows only for submitted and returned requests, on the list and the request page', async () => {
  for (const list of [false, true]) {
    for (const status of ['submitted', 'clarification_requested']) {
      assert.ok((await renderRequest({ status }, { list })).includes('Edit request'), `${status} list=${list}`);
    }
    for (const status of ['approved', 'planning', 'confirmed', 'rejected']) {
      assert.ok(!(await renderRequest({ status }, { list })).includes('Edit request'), `${status} list=${list}`);
    }
  }
});

test('[UT-04] a returned request shows "Returned for clarification" and the Coordinator\'s note', async () => {
  const html = await renderRequest({ status: 'clarification_requested', clarification_note: 'Please confirm the date.' });
  assert.ok(html.includes('Returned for clarification'));
  assert.ok(html.includes('Please confirm the date.'));
});
