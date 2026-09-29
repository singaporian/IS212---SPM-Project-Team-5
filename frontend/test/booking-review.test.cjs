const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');
const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/components/BookingReview.vue'), 'utf8')).descriptor;
function instance(fetch) {
  const script = descriptor.script.content.replace(/import .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('fetch', 'authHeaders', script)(fetch, () => ({}));
  const state = { ...options.data(), bookingId: 'request' };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  return state;
}
const payload = () => ({
  request: { start_time: '2026-10-15T02:03:00Z', end_time: '2026-10-15T03:07:00Z', setup_minutes: 0, turnaround_minutes: null,
    preferred_start: '2026-10-15T01:00:00Z', preferred_end: '2026-10-15T02:00:00Z', expected_attendance: 25,
    venue_requirements: { description: 'Requested classroom' }, draft_data: { venueRequirements: 'Original theatre', accessibilityNeeds: 'Wheelchair', equipmentRequirements: 'Projector' } },
  venue: { name: 'Review room', capacity: 100, facilities: ['Projector'], accessibility: { wheelchair: true }, supported_layouts: ['Classroom'], available_from: '2026-01-01', available_until: '2027-01-01' },
  occupied: { start: '2026-10-15T02:03:00Z', end: '2026-10-15T03:07:00Z' },
  operating_hours: [{ day_of_week: 4, opens_at: '15:03:00', closes_at: '23:59:00' }],
  bookings: [], unavailability: [], conflicts: []
});
const render = state => renderToString(createSSRApp({ render: compile(descriptor.template.content), data: () => state }));

test('US-019 renders separate booking/event requirements, operating hours and precise AM/PM times', async () => {
  const data = payload(), before = JSON.stringify(data);
  const state = instance(async () => Response.json(data));
  await state.load();
  const html = await render(state);
  for (const text of ['Submitted booking arrangement', 'Requested classroom', 'Original theatre', '25', 'Wheelchair', 'Projector', '10:03 AM', '11:07 AM', '03:03 PM', '11:59 PM', 'No overlapping confirmed bookings']) assert.ok(html.includes(text), text);
  assert.equal(JSON.stringify(data), before);
  assert.equal(state.formatClock('00:00:00'), '12:00 AM');
  assert.equal(state.formatClock('12:05:00'), '12:05 PM');
  assert.equal(state.buffer(null), 'Not recorded');
  assert.equal(state.buffer(0), '0 minutes');
});

test('US-019 refresh uses GET and renders current conflicts while pending/approved records stay informational', async () => {
  const calls = [];
  const state = instance(async (url, options) => {
    calls.push({ url, options });
    const data = payload();
    data.bookings = [{ id: 'pending', status: 'pending', event_title: 'Other request', start_time: data.occupied.start, end_time: data.occupied.end, occupied: data.occupied }];
    data.bookings.push({ ...data.bookings[0], id: 'approved', status: 'approved', event_title: 'Approved contextual record' });
    if (calls.length > 1) data.conflicts = [{ id: 'block', type: 'unavailability', title: 'Maintenance', ...data.occupied }, { id: 'reserved', type: 'booking', title: 'Reserved event', ...data.occupied }];
    return Response.json(data);
  });
  await state.load();
  assert.ok((await render(state)).includes('Pending Review'));
  assert.ok((await render(state)).includes('Approved contextual record'));
  assert.ok(!(await render(state)).includes('Approved and confirmed bookings reserve'));
  assert.ok((await render(state)).includes('No overlapping confirmed bookings'));
  await state.load();
  const html = await render(state);
  assert.ok(html.includes('Maintenance'));
  assert.ok(html.includes('Reserved event'));
  assert.ok(!html.includes('No overlapping confirmed bookings'));
  assert.ok(calls.every(call => call.url === '/api/bookings/request/review' && !call.options.method && !call.options.body));
});

test('US-019 loading and failed refresh never display stale availability; retry succeeds', async () => {
  let calls = 0;
  const state = instance(async () => {
    if (++calls === 2) throw new Error('offline');
    return Response.json(payload());
  });
  assert.ok((await render(state)).includes('Loading review information'));
  await state.load();
  await state.load();
  const html = await render(state);
  assert.ok(html.includes('Unable to load booking review'));
  assert.ok(html.includes('Retry'));
  assert.ok(!html.includes('No overlapping confirmed bookings'));
  assert.equal(state.review, null);
  await state.load();
  assert.equal(state.error, '');
  assert.ok(state.review);
});
