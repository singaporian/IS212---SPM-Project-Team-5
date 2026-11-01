const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const read = name => parse(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).descriptor;
const descriptor = read('views/PendingBookingRequestsView.vue');
const review = read('components/BookingReview.vue');
const script = source => source.replace(/import .*\r?\n/g, '').replace('export default', 'return');
const reviewOptions = new Function('authHeaders', script(review.script.content))(() => ({}));
const booking = (id = 'request', status = 'pending') => ({ id, status, event_id: 'event', event_title: 'Workshop ' + id, venue_name: 'Demo Hall', coordinator_name: 'Coordinator One', start_time: '2099-03-01T02:03:00Z', end_time: '2099-03-01T03:07:00Z' });
const summary = values => ({ expected_attendance: 23, reserved_conflicts: 0, hold_conflicts: 0, unavailable_conflicts: 0, ...values });

function instance(fetch = async () => Response.json([]), route = '/bookings/pending') {
  const options = new Function('BookingReview', 'fetch', 'authHeaders', 'clearSession', script(descriptor.script.content))(reviewOptions, fetch, () => ({ Authorization: 'Bearer test' }), () => {});
  const state = { ...options.data(), $route: { path: route, query: {} }, $router: { push() {}, replace() {} } };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  return state;
}
async function render(state) {
  const { $route, $router, ...data } = state;
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => data });
  app.config.globalProperties.$route = $route;
  app.config.globalProperties.$router = $router;
  app.component('RouterLink', { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : \'/bookings/pending/\' + to.params.id + \'?from=\' + to.query.from"><slot /></a>' });
  return renderToString(app);
}
function loaded(summaryValues) {
  return Object.assign(instance(), { loading: false, requests: [booking()], summaries: { request: summary(summaryValues) } });
}

test('US-033 inbox shows distinct workflow labels separately from availability notices', async () => {
  const statuses = [['pending', 'Pending Review', 'status-pending'], ['approved', 'Approved — venue reserved', 'status-approved'], ['confirmed', 'Reserved', 'status-approved'], ['rejected', 'Rejected', 'status-rejected'], ['alternative_suggested', 'Alternative Suggested', 'status-alternative']];
  const state = Object.assign(instance(), { loading: false, requests: statuses.map(([status]) => booking(status, status)), summaries: Object.fromEntries(statuses.map(([status]) => [status, summary()])) });
  const cards = (await render(state)).match(/<article[\s\S]*?<\/article>/g);
  assert.equal(cards.length, statuses.length);
  for (const [index, [, label, style]] of statuses.entries()) {
    assert.ok(cards[index].includes('workflow-status ' + style));
    assert.ok(cards[index].includes(label));
    assert.ok(cards[index].includes('No conflicts identified'));
    assert.ok(cards[index].indexOf('workflow-status') < cards[index].indexOf('Availability checks'));
  }
});

test('US-033 inbox distinguishes each backend-reported conflict with an icon, label and count', async () => {
  for (const [field, style, label, detail] of [
    ['reserved_conflicts', 'notice-reserved', 'Warning: Reserved booking conflict', '2 approved / confirmed bookings overlap'],
    ['hold_conflicts', 'notice-hold', 'Warning: Active tentative hold conflict', '2 active holds affect'],
    ['unavailable_conflicts', 'notice-unavailable', 'Warning: Recorded venue unavailability', '2 maintenance / unavailable periods affect']
  ]) {
    const state = loaded({ [field]: 2 });
    const before = JSON.stringify(state.summaries);
    const html = await render(state);
    assert.ok(html.includes('availability-notice ' + style));
    assert.ok(html.includes('notice-icon'));
    assert.ok(html.includes(label));
    assert.ok(html.includes(detail));
    assert.ok(!html.includes('No conflicts identified'));
    assert.equal((html.match(/class="availability-notice /g) || []).length, 1);
    assert.equal(JSON.stringify(state.summaries), before, 'rendering must not change the API result');
  }
});

test('US-033 inbox displays all simultaneous conflicts without affecting another clear request', async () => {
  const state = loaded({ reserved_conflicts: 1, hold_conflicts: 1, unavailable_conflicts: 1 });
  state.requests.push(booking('clear'));
  state.summaries.clear = summary();
  const cards = (await render(state)).match(/<article[\s\S]*?<\/article>/g);
  for (const style of ['notice-reserved', 'notice-hold', 'notice-unavailable']) assert.ok(cards[0].includes(style));
  assert.ok(!cards[0].includes('notice-clear'));
  assert.ok(cards[1].includes('notice-clear'));
  assert.ok(!cards[1].includes('notice-reserved'));
});

test('US-033 inbox retains details, separate review links and Pending/Reviewed navigation', async () => {
  for (const route of ['/bookings/pending', '/bookings/reviewed']) {
    const state = loaded();
    state.$route.path = route;
    const html = await render(state);
    for (const text of ['Workshop request', 'Demo Hall', '10:03 AM', '11:07 AM', 'Coordinator One', 'Attendance: 23', 'Review Request', '/bookings/pending/request?from=' + (route.endsWith('reviewed') ? 'reviewed' : 'pending')]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`href="${route}" aria-current="page"`));
    assert.ok(!html.includes('Approve Request'));
    assert.ok(!html.includes('Suggest Alternative'));
  }
});

test('US-033 inbox loading and summary failure never imply a conflict-free result', async () => {
  const state = loaded();
  state.summaries = {};
  let html = await render(state);
  assert.ok(html.includes('Loading attendance and availability...'));
  assert.ok(!html.includes('No conflicts identified'));
  state.summaryErrors.request = 'Attendance and availability unavailable. Open the review to retry.';
  html = await render(state);
  assert.ok(html.includes('summary-unavailable'));
  assert.ok(html.includes('Open the review to retry.'));
  assert.ok(!html.includes('No conflicts identified'));
  assert.ok(html.includes('Review Request'));
});

test('US-033 inbox refresh keeps the existing GET contract and replaces outdated summary warnings', async () => {
  const calls = [];
  let conflicts = 1;
  const state = instance(async (url, options) => {
    calls.push({ url, options });
    return Response.json(url === '/api/bookings/reviewed' ? [booking()] : summary({ hold_conflicts: conflicts }));
  }, '/bookings/reviewed');
  await state.load();
  assert.ok((await render(state)).includes('Warning: Active tentative hold conflict'));
  conflicts = 0;
  await state.load();
  assert.ok((await render(state)).includes('No conflicts identified'));
  assert.deepEqual(calls.map(call => call.url), ['/api/bookings/reviewed', '/api/bookings/request/review?summary=1', '/api/bookings/reviewed', '/api/bookings/request/review?summary=1']);
  assert.ok(calls.every(call => !call.options.method && !call.options.body && call.options.headers.Authorization === 'Bearer test'));
});

test('US-033 inbox preserves event filtering and the existing single-request redirect', async () => {
  const state = instance(async () => Response.json([booking(), { ...booking('other'), event_id: 'other-event' }]));
  state.$route.query.eventId = 'event';
  let target;
  state.$router.replace = value => { target = value; };
  await state.load();
  assert.deepEqual(target, { name: 'venue-booking-review', params: { id: 'request' } });
});
