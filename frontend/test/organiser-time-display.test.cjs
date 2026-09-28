const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { createSSRApp, compile } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/SubmittedRequestsView.vue'), 'utf8')).descriptor;
const script = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');

// Lark: CHG-001-001, CHG-001-002 (receipt minute precision and AM/PM display).
test('organiser receipt renders AM/PM event times without modifying API data', async () => {
  for (const [raw, displayed] of [['15:23', '03:23 PM'], ['00:05', '12:05 AM'], ['12:05', '12:05 PM'], ['23:59', '11:59 PM'], ['15:25', '03:25 PM'], ['00:00', '12:00 AM'], ['10:03', '10:03 AM'], ['10:04', '10:04 AM']]) {
    const payload = { id: 'event', title: 'Test event', status: 'submitted', submitted_at: '2026-10-01T00:00:00Z',
      draft_data: { startTime: raw, endTime: raw, startDate: '2026-10-01', registrationNeeds: 'no' } };
    const before = JSON.stringify(payload);
    const calls = [];
    const options = new Function('fetch', 'authHeaders', 'RequestNavigation', script)(async (url, options) => {
      calls.push({ url, options }); return { ok: true, json: async () => payload };
    }, () => ({}), {});
    const state = { ...options.data(), $route: { params: { id: 'event' }, query: {} } };
    for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
    await state.load();
    assert.equal(state.value('startTime'), displayed);
    assert.equal(state.value('endTime'), displayed);
    const app = createSSRApp({ render: compile(descriptor.template.content), data: () => state });
    app.config.globalProperties.$route = state.$route;
    app.component('RequestNavigation', { template: '<nav />' });
    app.component('router-link', { template: '<a><slot /></a>' });
    const html = await renderToString(app);
    assert.ok(html.includes(displayed));
    assert.equal(JSON.stringify(payload), before);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/requests/event');
    assert.equal(calls[0].options.method, undefined);
    assert.equal(state.request.draft_data.startTime, raw);
  }
});
