// Home workspace Refresh: Event Coordinators browse venues through Find Venues, not a full venue list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

function homeInstance(role, fetched) {
  const services = {
    authHeaders: () => ({}),
    clearSession: () => {},
    getUser: () => ({ name: 'Tester', role })
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/views/HomePage.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function(...Object.keys(services), script)(...Object.values(services));
  const instance = { $router: { push() {} } };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  global.fetch = async url => {
    fetched.push(url);
    const body = url === '/api/venues/count' ? { count: 2 } : url === '/api/venues' ? [{ id: 'v1', name: 'Hall' }] : [];
    return { ok: true, status: 200, json: async () => body };
  };
  return instance;
}

test('Refresh reloads an Event Coordinator\'s dashboard without listing the venue directory', async () => {
  const fetched = [];
  const instance = homeInstance('event_coordinator', fetched);
  instance.venues = [{ id: 'stale', name: 'Stale' }];
  await instance.refreshWorkspace();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instance.venues, []);
  assert.ok(!fetched.includes('/api/venues'), 'the venue directory is not requested');
  for (const url of ['/api/venues/count', '/api/bookings/mine', '/api/technical-support/my-requirements']) {
    assert.ok(fetched.includes(url), url);
  }
});

test('Refresh still loads the venue list for Venue Staff', async () => {
  const fetched = [];
  const instance = homeInstance('venue_staff', fetched);
  await instance.refreshWorkspace();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(fetched.includes('/api/venues'));
  assert.deepEqual(instance.venues.map(v => v.name), ['Hall']);
});
