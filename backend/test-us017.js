// Test script for US-017 (View Upcoming Bookings Calendar)
// Requires: backend server running locally on the port set in .env (default 3000)
// Run with: node test-us017.js   (from inside the backend folder)

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = 'Password123!';

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

async function ensureAttendee() {
  const email = 'attendee@connectsphere.local';
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) return;
  const hash = await bcrypt.hash(PASSWORD, 12);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Attendee', $1, $2, 'attendee')`,
    [email, hash]
  );
  console.log('Created attendee test account (attendee@connectsphere.local)');
}

async function resetTestData() {
  await db.query(`DELETE FROM events WHERE title LIKE 'TEST_US017_%'`);
}

async function getUserId(email) {
  const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error(`Required demo account not found: ${email}`);
  return result.rows[0].id;
}

async function seedTestBooking(title, venueId, status, index) {
  const event = await db.query(
    `INSERT INTO events (title, status, expected_attendance)
     VALUES ($1, 'approved', $2)
     RETURNING id`,
    [title, 40 + index]
  );
  const booking = await db.query(
    `INSERT INTO bookings (
       event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes
     )
     VALUES ($1, $2, now() + ($3 * interval '1 day'), now() + ($3 * interval '1 day') + interval '2 hours', $4, $5, $6)
     RETURNING id`,
    [event.rows[0].id, venueId, index + 7, status, 20 + index, 35 + index]
  );
  return { eventId: event.rows[0].id, bookingId: booking.rows[0].id };
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();
  await ensureAttendee();

  const venues = await db.query('SELECT id, name FROM venues ORDER BY name LIMIT 2');
  if (venues.rows.length < 2) throw new Error('At least two seeded venues are required for US-017 tests');
  const venueOne = venues.rows[0];
  const venueTwo = venues.rows[1];

  const confirmedOne = await seedTestBooking('TEST_US017_ConfirmedOne', venueOne.id, 'confirmed', 1);
  const pendingOne = await seedTestBooking('TEST_US017_PendingOne', venueOne.id, 'pending', 2);
  const confirmedTwo = await seedTestBooking('TEST_US017_ConfirmedTwo', venueTwo.id, 'confirmed', 3);

  console.log('\n--- Logging in ---');
  const venueToken = await login('venue@connectsphere.local');
  const attendeeToken = await login('attendee@connectsphere.local');
  const authed = (token) => ({ Authorization: `Bearer ${token}` });

  console.log('\n--- US-017: Authorization ---');
  {
    const res = await fetch(`${BASE_URL}/api/bookings`);
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/bookings`, { headers: authed(attendeeToken) });
    check('Wrong role -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-017: Confirmed booking response ---');
  const allRes = await fetch(`${BASE_URL}/api/bookings`, { headers: authed(venueToken) });
  const allBookings = await allRes.json();
  check('Venue staff can fetch bookings (200)', allRes.status === 200, `(got ${allRes.status})`);
  check('Confirmed fixture bookings are returned', allBookings.some((booking) => booking.id === confirmedOne.bookingId) && allBookings.some((booking) => booking.id === confirmedTwo.bookingId));
  check('Pending fixture booking is excluded', !allBookings.some((booking) => booking.id === pendingOne.bookingId));
  const confirmedFixture = allBookings.find((booking) => booking.id === confirmedOne.bookingId);
  check(
    'Response includes setup_minutes and turnaround_minutes',
    confirmedFixture?.setup_minutes === 21 && confirmedFixture?.turnaround_minutes === 36,
    `(got ${JSON.stringify(confirmedFixture)})`
  );

  console.log('\n--- US-017: Venue filter ---');
  const filteredRes = await fetch(`${BASE_URL}/api/bookings?venueId=${venueOne.id}`, { headers: authed(venueToken) });
  const filteredBookings = await filteredRes.json();
  check('Venue filter request succeeds (200)', filteredRes.status === 200, `(got ${filteredRes.status})`);
  check('Venue filter includes only the selected venue', filteredBookings.every((booking) => booking.venue_id === venueOne.id));
  check('Venue filter includes its confirmed fixture', filteredBookings.some((booking) => booking.id === confirmedOne.bookingId));
  check('Venue filter excludes its pending fixture', !filteredBookings.some((booking) => booking.id === pendingOne.bookingId));

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test script crashed:', err);
  await db.pool.end();
  process.exit(1);
});
