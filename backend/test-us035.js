// Test script for US-035 (Configure Venue Setup and Turnaround Time)
// Requires: backend server running locally on the port set in .env (default 3000)
// Requires: the US-035 schema migration run (default_setup_minutes / default_turnaround_minutes columns)
// Run with: node test-us035.js   (from inside the backend folder)

require('dotenv').config();
const db = require('./src/db');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = 'Password123!';
const MARKER = 'TEST_US035_';

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
  await db.query(`DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE title LIKE $1)`, [`${MARKER}%`]);
  await db.query(`DELETE FROM notifications WHERE message LIKE $1`, [`%${MARKER}%`]);
  await db.query(`DELETE FROM events WHERE title LIKE $1`, [`${MARKER}%`]);
  // Restore any venue this run touched back to the 30/30 default so other tests aren't affected.
  await db.query(`UPDATE venues SET default_setup_minutes = 30, default_turnaround_minutes = 30 WHERE name LIKE $1`, [`${MARKER}%`]);
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();

  const venues = await db.query('SELECT id, name FROM venues ORDER BY name LIMIT 1');
  if (!venues.rows.length) throw new Error('At least one seeded venue is required for US-035 tests');
  const venue = venues.rows[0];

  console.log('\n--- Logging in ---');
  const venueToken = await login('venue@connectsphere.local');
  const coordinatorToken = await login('coordinator@connectsphere.local');
  const coordinatorId = await getUserId('coordinator@connectsphere.local');
  const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  // Make sure we start from a known baseline (30/30) for this venue.
  await db.query('UPDATE venues SET default_setup_minutes = 30, default_turnaround_minutes = 30 WHERE id = $1', [venue.id]);

  console.log('\n--- US-035: Authorization ---');
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupMinutes: 20, turnaroundMinutes: 20 })
    });
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
      method: 'PUT', headers: authed(coordinatorToken),
      body: JSON.stringify({ setupMinutes: 20, turnaroundMinutes: 20 })
    });
    check('Wrong role (coordinator) -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-035: Validation ---');
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
      method: 'PUT', headers: authed(venueToken),
      body: JSON.stringify({ setupMinutes: -5, turnaroundMinutes: 20 })
    });
    check('Negative setup minutes -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
      method: 'PUT', headers: authed(venueToken),
      body: JSON.stringify({ setupMinutes: 20, turnaroundMinutes: -1 })
    });
    check('Negative turnaround minutes -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
      method: 'PUT', headers: authed(venueToken),
      body: JSON.stringify({ setupMinutes: 'abc', turnaroundMinutes: 20 })
    });
    check('Non-numeric setup minutes -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/00000000-0000-4000-8000-000000000000/setup-turnaround`, {
      method: 'PUT', headers: authed(venueToken),
      body: JSON.stringify({ setupMinutes: 20, turnaroundMinutes: 20 })
    });
    check('Non-existent venue -> 404', res.status === 404, `(got ${res.status})`);
  }

  console.log('\n--- US-035: Specify setup/turnaround (0 minutes is a valid non-negative duration) ---');
  const setZero = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
    method: 'PUT', headers: authed(venueToken),
    body: JSON.stringify({ setupMinutes: 0, turnaroundMinutes: 0 })
  });
  const setZeroBody = await setZero.json();
  check('Zero minutes accepted (200)', setZero.status === 200, `(got ${setZero.status})`);
  check('default_setup_minutes stored as 0', setZeroBody.default_setup_minutes === 0, `(got ${setZeroBody.default_setup_minutes})`);
  check('default_turnaround_minutes stored as 0', setZeroBody.default_turnaround_minutes === 0, `(got ${setZeroBody.default_turnaround_minutes})`);

  console.log('\n--- US-035: Update the configured values when required ---');
  const update1 = await fetch(`${BASE_URL}/api/venues/${venue.id}/setup-turnaround`, {
    method: 'PUT', headers: authed(venueToken),
    body: JSON.stringify({ setupMinutes: 45, turnaroundMinutes: 60 })
  });
  const update1Body = await update1.json();
  check('Update succeeds (200)', update1.status === 200, `(got ${update1.status})`);
  check('default_setup_minutes updated to 45', update1Body.default_setup_minutes === 45, `(got ${update1Body.default_setup_minutes})`);
  check('default_turnaround_minutes updated to 60', update1Body.default_turnaround_minutes === 60, `(got ${update1Body.default_turnaround_minutes})`);

  const persisted = await db.query('SELECT default_setup_minutes, default_turnaround_minutes FROM venues WHERE id = $1', [venue.id]);
  check('Change is associated with the venue (persisted in DB)', persisted.rows[0].default_setup_minutes === 45 && persisted.rows[0].default_turnaround_minutes === 60);

  console.log('\n--- US-035: Configured defaults are considered when searching for suitable venues ---');
  // Seed a confirmed booking ending at 10:00, with the venue's own (updated) 60-min turnaround.
  const searchDate = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const searchEvent = await db.query(
    `INSERT INTO events (title, status, expected_attendance, assigned_coordinator_id)
     VALUES ($1, 'approved', 40, $2) RETURNING id`,
    [`${MARKER}SearchEvent`, coordinatorId]
  );
  await db.query(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status, setup_minutes, turnaround_minutes)
     VALUES ($1, $2, $3, ($4::date + time '08:00')::timestamptz, ($4::date + time '10:00')::timestamptz, 'confirmed', 0, 60)`,
    [searchEvent.rows[0].id, venue.id, coordinatorId, searchDate]
  );
  // Without passing setupMinutes/turnaroundMinutes explicitly, the search should use the venue's
  // configured 45-min setup default, so a 10:30-11:00 slot (within the 60-min turnaround buffer
  // after the 10:00 booking) should still exclude this venue.
  const blockedSearch = await fetch(
    `${BASE_URL}/api/venues?date=${searchDate}&startTime=10:30&endTime=11:00`,
    { headers: authed(coordinatorToken) }
  );
  const blockedResults = await blockedSearch.json();
  check('Search request succeeds (200)', blockedSearch.status === 200, `(got ${blockedSearch.status})`);
  check('Venue is excluded using its configured turnaround default (no setupMinutes/turnaroundMinutes passed)', !blockedResults.some((row) => row.id === venue.id));

  // A slot well clear of the turnaround buffer should still find the venue available.
  const clearSearch = await fetch(
    `${BASE_URL}/api/venues?date=${searchDate}&startTime=14:00&endTime=15:00`,
    { headers: authed(coordinatorToken) }
  );
  const clearResults = await clearSearch.json();
  check('Venue is available again outside the configured buffer', clearResults.some((row) => row.id === venue.id));
  const foundVenue = clearResults.find((row) => row.id === venue.id);
  check('Search response exposes the venue\'s configured defaults', foundVenue && foundVenue.default_setup_minutes === 45 && foundVenue.default_turnaround_minutes === 60, `(got ${JSON.stringify(foundVenue && foundVenue.default_setup_minutes)}, ${JSON.stringify(foundVenue && foundVenue.default_turnaround_minutes)})`);

  console.log('\n--- US-035: Configured defaults are considered when reviewing venue booking requests ---');
  const bookingEvent = await db.query(
    `INSERT INTO events (title, status, expected_attendance, assigned_coordinator_id)
     VALUES ($1, 'approved', 40, $2) RETURNING id`,
    [`${MARKER}BookingEvent`, coordinatorId]
  );
  const requestDate = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
  const bookingRes = await fetch(`${BASE_URL}/api/bookings/requests`, {
    method: 'POST', headers: authed(coordinatorToken),
    body: JSON.stringify({
      eventId: bookingEvent.rows[0].id,
      venueId: venue.id,
      startTime: `${requestDate}T13:00:00+08:00`,
      endTime: `${requestDate}T15:00:00+08:00`
      // setupMinutes/turnaroundMinutes intentionally omitted -> should fall back to the venue's defaults (45 / 60).
    })
  });
  const bookingBody = await bookingRes.json();
  check('Booking request created without explicit setup/turnaround (201)', bookingRes.status === 201, `(got ${bookingRes.status}, ${JSON.stringify(bookingBody)})`);
  check('Booking request used the venue\'s configured default_setup_minutes (45)', bookingBody.setup_minutes === 45, `(got ${bookingBody.setup_minutes})`);
  check('Booking request used the venue\'s configured default_turnaround_minutes (60)', bookingBody.turnaround_minutes === 60, `(got ${bookingBody.turnaround_minutes})`);

  // An explicit override in the request body should still win over the venue's configured defaults.
  const bookingEvent2 = await db.query(
    `INSERT INTO events (title, status, expected_attendance, assigned_coordinator_id)
     VALUES ($1, 'approved', 40, $2) RETURNING id`,
    [`${MARKER}BookingEventOverride`, coordinatorId]
  );
  const overrideRes = await fetch(`${BASE_URL}/api/bookings/requests`, {
    method: 'POST', headers: authed(coordinatorToken),
    body: JSON.stringify({
      eventId: bookingEvent2.rows[0].id,
      venueId: venue.id,
      startTime: `${requestDate}T16:00:00+08:00`,
      endTime: `${requestDate}T17:00:00+08:00`,
      setupMinutes: 5,
      turnaroundMinutes: 5
    })
  });
  const overrideBody = await overrideRes.json();
  check('Explicit setupMinutes/turnaroundMinutes still override the venue default (201)', overrideRes.status === 201, `(got ${overrideRes.status})`);
  check('Explicit override is honoured (5 / 5, not 45 / 60)', overrideBody.setup_minutes === 5 && overrideBody.turnaround_minutes === 5, `(got ${overrideBody.setup_minutes}, ${overrideBody.turnaround_minutes})`);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test script crashed:', err);
  await db.pool.end();
  process.exit(1);
});
