const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/VenueSearchView.vue'), 'utf8')).descriptor;
const script = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');

test('venue catalogue displays operating hours and setup/turnaround information', async () => {
  const options = new Function('authHeaders', 'clearSession', script)(() => ({}), () => {});
  const state = { ...options.data(), venues: [{
    id: 'venue-1',
    name: 'Demo Meeting Room',
    location: 'Campus',
    capacity: 30,
    facilities: ['Wi-Fi'],
    accessibility: [],
    supported_layouts: [],
    operating_hours: [{ day_of_week: 1, opens_at: '08:00:00', closes_at: '22:00:00' }],
    default_setup_minutes: 30,
    default_turnaround_minutes: 45,
    images: []
  }] };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  for (const [name, definition] of Object.entries(options.computed)) {
    const computed = typeof definition === 'function' ? { get: definition } : definition;
    Object.defineProperty(state, name, {
      get: () => computed.get.call(state),
      set: computed.set ? value => computed.set.call(state, value) : undefined
    });
  }
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => state });
  app.component('router-link', { template: '<a><slot /></a>' });

  const html = await renderToString(app);
  assert.ok(html.includes('Operating hours'));
  assert.ok(html.includes('Monday: 8:00 AM - 10:00 PM'));
  assert.ok(html.includes('Setup / turnaround'));
  assert.ok(html.includes('30 min setup / 45 min turnaround'));
});
