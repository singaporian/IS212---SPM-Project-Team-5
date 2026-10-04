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
  const state = { ...options.data(), bookingId: 'request', fullPage: true };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  for (const [name, getter] of Object.entries(options.computed || {})) Object.defineProperty(state, name, { enumerable: true, get: () => getter.call(state) });
  return state;
}
const payload = () => ({
  request: { start_time: '2026-10-15T02:03:00Z', end_time: '2026-10-15T03:07:00Z', setup_minutes: 0, turnaround_minutes: null,
    preferred_start: '2026-10-15T01:00:00Z', preferred_end: '2026-10-15T02:00:00Z', expected_attendance: 25,
    venue_requirements: { description: 'Requested classroom' }, draft_data: { venueRequirements: 'Original theatre', accessibilityNeeds: 'Wheelchair', equipmentRequirements: 'Projector' } },
  venue: { name: 'Review room', location: 'Level 2', capacity: 100, facilities: ['Projector'], accessibility: { wheelchair: true }, supported_layouts: ['Classroom'], available_from: '2026-01-01', available_until: '2027-01-01' },
  occupied: { start: '2026-10-15T02:03:00Z', end: '2026-10-15T03:07:00Z' },
  operating_hours: [{ day_of_week: 4, opens_at: '15:03:00', closes_at: '23:59:00' }],
  bookings: [], unavailability: [], conflicts: []
});
const render = state => renderToString(createSSRApp({ render: compile(descriptor.template.content), data: () => state }));

test('TC-US019-FE-02/03/05 AC1/AC2/AC4: US-019 renders separate booking/event requirements, operating hours and precise AM/PM times', async () => {
  const data = payload(), before = JSON.stringify(data);
  const state = instance(async () => Response.json(data));
  await state.load();
  const html = await render(state);
  for (const text of ['Level 2', 'Classroom', 'Recorded setup / turnaround', 'Occupied interval', '0 minutes', 'Booking Request', 'Requested classroom', 'Original theatre', '25', 'Wheelchair', 'Projector', '10:03 AM', '11:07 AM', '03:03 PM', '11:59 PM', 'No overlapping reserved bookings']) assert.ok(html.includes(text), text);
  assert.equal(JSON.stringify(data), before);
  assert.equal(state.formatClock('00:00:00'), '12:00 AM');
  assert.equal(state.formatClock('12:05:00'), '12:05 PM');
  assert.equal(state.buffer(null), 'Not recorded');
  assert.equal(state.buffer(0), '0 minutes');
});

test('TC-US019-FE-04 AC3: US-019 refresh uses GET and renders current conflicts while pending records stay informational', async () => {
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
  assert.ok((await render(state)).includes('Approved — venue reserved'));
  assert.ok((await render(state)).includes('No overlapping reserved bookings'));
  await state.load();
  const html = await render(state);
  assert.ok(html.includes('Maintenance'));
  assert.ok(html.includes('Reserved event'));
  assert.ok(!html.includes('No overlapping reserved bookings'));
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
  assert.ok(!html.includes('No overlapping reserved bookings'));
  assert.equal(state.review, null);
  await state.load();
  assert.equal(state.error, '');
  assert.ok(state.review);
});

test('TC-US019-FE-01/06: US-019 inbox links each request to its own read-only page and keeps conflict summaries visible', async () => {
  const inbox = parse(fs.readFileSync(path.join(__dirname, '../src/views/PendingBookingRequestsView.vue'), 'utf8')).descriptor;
  const options = new Function('BookingReview', inbox.script.content.replace(/import .*\r?\n/g, '').replace('export default', 'return'))({ methods: instance(async () => Response.json(payload())) });
  const state = { ...options.data(), requests: [{ id: 'one', event_title: 'First event', venue_name: 'Hall' }, { id: 'two', event_title: 'Second event', venue_name: 'Room' }], summaries: { one: { expected_attendance: 23, reserved_conflicts: 1, unavailable_conflicts: 0 }, two: { expected_attendance: 10, reserved_conflicts: 0, unavailable_conflicts: 1 } } };
  const app = createSSRApp({ render: compile(inbox.template.content), data: () => state, methods: options.methods });
  app.component('router-link', { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : \'/bookings/pending/\' + to.params.id"><slot /></a>' });
  const html = await renderToString(app);
  for (const text of ['/bookings/pending/one', '/bookings/pending/two', 'Attendance: 23', 'Warning: Reserved booking conflict', 'Warning: Recorded venue unavailability', 'Review Request']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Event Requirements'));
  for (const text of ['Approve', 'Reject', 'Suggest Alternative', 'Decision', 'Reviewed']) assert.ok(!html.includes(text), text);
});

test('TC-US019-FE-06: US-019 dedicated page renders review details and back navigation without decision actions', async () => {
  const page = parse(fs.readFileSync(path.join(__dirname, '../src/views/VenueBookingReviewView.vue'), 'utf8')).descriptor;
  const reviewState = instance(async () => Response.json(payload()));
  await reviewState.load();
  const app = createSSRApp({ render: compile(page.template.content), data: () => ({ review: null }), methods: { onLoading() {}, onLoaded() {} } });
  app.config.globalProperties.$route = { params: { id: 'request' } };
  app.component('router-link', { props: ['to'], template: '<a :href="to"><slot /></a>' });
  app.component('BookingReview', { props: { bookingId: String, fullPage: Boolean }, render: compile(descriptor.template.content), data: () => { const { bookingId, fullPage, ...data } = reviewState; return data } });
  const html = await renderToString(app);
  for (const text of ['Back to requests', 'Booking Request', 'Event Requirements', 'Venue information', 'Availability &amp; Conflicts']) assert.ok(html.includes(text), text);
  for (const text of ['Approve', 'Reject', 'Suggest Alternative', 'Confirm decision', 'Reviewed', 'aria-label="Decision"']) assert.ok(!html.includes(text), text);
});

 test('TC-US019-FE-07 and TC-US019-10: capacity and missing optional fields render safely', async () => {
  for (const [attendance, capacity, expected] of [[101,100,'Capacity exceeded'],[100,100,'within venue capacity'],[null,100,'Capacity assessment unavailable'],[25,null,'Capacity assessment unavailable']]) {
    const data = payload();
    data.request.expected_attendance = attendance; data.venue.capacity = capacity;
    data.request.draft_data = null; data.request.venue_requirements = null;
    data.venue.location = null; data.venue.facilities = null; data.venue.supported_layouts = null; data.venue.accessibility = null;
    data.operating_hours = [];
    const state = instance(async () => Response.json(data)); await state.load();
    const html = await render(state);
    assert.ok(html.includes(expected));
    assert.ok(html.includes('Not recorded'));
    assert.ok(html.includes('No operating hours recorded.'));
  }
 });
