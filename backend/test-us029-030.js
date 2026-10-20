// Test script for US-029 (Register for Event) and US-030 (Withdraw Registration)
// Requires: backend server running locally on the port set in .env (default 3000)
// Requires: the registrations schema migration run (attendee_id/updated_at on
//           registrations, registration_capacity/opens_at/closes_at on events).
// Run with: node test-us029-030.js   (from inside the backend folder)
// After running, a confirmed, registration-open event ("TEST_US029_OpenEvent") is left
// in the DB so you can also register for it from the UI as attendee@connectsphere.local.

require('dotenv').config();
const db = require('./src/db');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = 'Password123!';
const MARKER = 'TEST_US029_';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label} ${extra}`);
    failed++;
  }
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  return body.token;
}

async function getUserId(email) {
  const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error(`Required demo account not found: ${email}`);
  return result.rows[0].id;
}

async function resetTestData() {
  await db.query(`DELETE FROM registrations WHERE event_id IN (SELECT id FROM events WHERE title LIKE $1)`, [`${MARKER}%`]);
  await db.query(`DELETE FROM notifications WHERE event_id IN (SELECT id FROM events WHERE title LIKE $1)`, [`${MARKER}%`]);
  await db.query(`DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE title LIKE $1)`, [`${MARKER}%`]);
  await db.query(`DELETE FROM events WHERE title LIKE $1`, [`${MARKER}%`]);
}

async function createConfirmedEvent(db, { title, organiserId, venueId, dayOffset, capacity = null, opensAt = null, closesAt = null }) {
  const start = `now() + interval '${dayOffset} days'`;
  const event = await db.query(
    `INSERT INTO events (organiser_id, title, status, expected_attendance, preferred_start, preferred_end, registration_required, registration_capacity, registration_opens_at, registration_closes_at)
     VALUES ($1, $2, 'confirmed', 40, ${start}, ${start} + interval '2 hours', true, $3, $4, $5)
     RETURNING id, preferred_start`,
    [organiserId, title, capacity, opensAt, closesAt]
  );
  await db.query(
    `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
     VALUES ($1, $2, ${start}, ${start} + interval '2 hours', 'confirmed', 15, 15)`,
    [event.rows[0].id, venueId]
  );
  return event.rows[0];
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();

  const venues = await db.query('SELECT id FROM venues ORDER BY name LIMIT 1');
  if (!venues.rows.length) throw new Error('At least one seeded venue is required for these tests');
  const venueId = venues.rows[0].id;
  const organiserId = await getUserId('organiser@connectsphere.local');

  console.log('\n--- Logging in ---');
  const attendeeToken = await login('attendee@connectsphere.local');
  const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const validAttendee = () => ({ name: 'Test Attendee', email: `test_us029_${Date.now()}@example.com`, phone: '+65 8123 4567' });

  console.log('\n--- US-029: Authorization ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/registrable`, { headers: { 'Content-Type': 'application/json' } });
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }

  console.log('\n--- US-029: Register for a confirmed, open event ---');
  const openEvent = await createConfirmedEvent(db, { title: `${MARKER}OpenEvent`, organiserId, venueId, dayOffset: 10 });
  {
    const listRes = await fetch(`${BASE_URL}/api/events/registrable`, { headers: authed(attendeeToken) });
    const list = await listRes.json();
    check('registrable list succeeds (200)', listRes.status === 200, `(got ${listRes.status})`);
    const found = list.find((e) => e.id === openEvent.id);
    check('Open event appears in the registrable list', Boolean(found), `(got ${JSON.stringify(list.map((e) => e.title))})`);
    check('Open event is marked registration_open', found?.registration_open === true, `(got ${JSON.stringify(found)})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${openEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify({ name: '', email: 'bad', phone: '123' }) });
    check('Invalid registration details -> 400', res.status === 400, `(got ${res.status})`);
  }
  let registrationId;
  {
    const res = await fetch(`${BASE_URL}/api/events/${openEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    const body = await res.json();
    check('Valid registration succeeds (201)', res.status === 201, `(got ${res.status}, ${JSON.stringify(body)})`);
    check('Registration status is "registered"', body.status === 'registered', `(got ${body.status})`);
    registrationId = body.id;
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${openEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    check('Registering twice for the same event -> 409', res.status === 409, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${openEvent.id}/registration`, { headers: authed(attendeeToken) });
    const body = await res.json();
    check('Attendee can view their own registration status', body?.id === registrationId, `(got ${JSON.stringify(body)})`);
  }
  {
    const notif = await db.query(`SELECT id FROM notifications WHERE event_id = $1 AND message LIKE $2`, [openEvent.id, '%registered%']);
    check('A notification confirms successful registration', notif.rows.length > 0);
  }

  console.log('\n--- US-029: Capacity ---');
  const fullEvent = await createConfirmedEvent(db, { title: `${MARKER}FullEvent`, organiserId, venueId, dayOffset: 11, capacity: 1 });
  await db.query(`INSERT INTO registrations (event_id, name, phone, email, status) VALUES ($1, 'Existing Attendee', '+6591234567', 'existing@example.com', 'registered')`, [fullEvent.id]);
  {
    const res = await fetch(`${BASE_URL}/api/events/${fullEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    check('Registration blocked once capacity is reached -> 409', res.status === 409, `(got ${res.status})`);
  }

  console.log('\n--- US-029: Registration window ---');
  const notYetOpenEvent = await createConfirmedEvent(db, {
    title: `${MARKER}NotYetOpenEvent`, organiserId, venueId, dayOffset: 12,
    opensAt: 'now() + interval \'1 day\''
  });
  {
    const res = await fetch(`${BASE_URL}/api/events/${notYetOpenEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    check('Registration blocked before the window opens -> 409', res.status === 409, `(got ${res.status})`);
  }
  const closedEvent = await createConfirmedEvent(db, {
    title: `${MARKER}ClosedEvent`, organiserId, venueId, dayOffset: 13,
    closesAt: 'now() - interval \'1 day\''
  });
  {
    const res = await fetch(`${BASE_URL}/api/events/${closedEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    check('Registration blocked after the window closes -> 409', res.status === 409, `(got ${res.status})`);
  }

  console.log('\n--- US-030: Withdraw a registration ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/registrations/${registrationId}/withdraw`, { method: 'PATCH', headers: authed(attendeeToken) });
    const body = await res.json();
    check('Withdraw succeeds (200)', res.status === 200, `(got ${res.status}, ${JSON.stringify(body)})`);
    check('Status updates to "withdrawn"', body.status === 'withdrawn', `(got ${body.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/registrations/${registrationId}/withdraw`, { method: 'PATCH', headers: authed(attendeeToken) });
    check('Withdrawing an already-withdrawn registration -> 409', res.status === 409, `(got ${res.status})`);
  }
  {
    const notif = await db.query(`SELECT id FROM notifications WHERE event_id = $1 AND message LIKE $2`, [openEvent.id, '%withdrawn%']);
    check('A notification confirms successful withdrawal', notif.rows.length > 0);
  }
  {
    // The released place should become available to another attendee again.
    const res = await fetch(`${BASE_URL}/api/events/${openEvent.id}/register`, { method: 'POST', headers: authed(attendeeToken), body: JSON.stringify(validAttendee()) });
    check('Can re-register after withdrawing (released place becomes available)', res.status === 201, `(got ${res.status})`);
  }

  console.log('\n--- US-030: Withdrawal is blocked once the event has started ---');
  const startedEvent = await createConfirmedEvent(db, { title: `${MARKER}StartedEvent`, organiserId, venueId, dayOffset: -1 });
  const startedReg = await db.query(
    `INSERT INTO registrations (event_id, attendee_id, name, phone, email, status) VALUES ($1, $2, 'Test Attendee', '+6591234567', 'started@example.com', 'registered') RETURNING id`,
    [startedEvent.id, await getUserId('attendee@connectsphere.local')]
  );
  {
    const res = await fetch(`${BASE_URL}/api/events/registrations/${startedReg.rows[0].id}/withdraw`, { method: 'PATCH', headers: authed(attendeeToken) });
    check('Withdrawal blocked once the event has started -> 409', res.status === 409, `(got ${res.status})`);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test script crashed:', err);
  await db.pool.end();
  process.exit(1);
});
