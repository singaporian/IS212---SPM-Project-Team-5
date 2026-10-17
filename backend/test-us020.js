// Test script for US-020 (Mark Venue Unavailable)
// Requires: backend server running locally on the port set in .env (default 3000)
// Requires: the US-020 additions pasted into index.js (reason-code validation +
//           PATCH /api/venues/unavailability/:id/end) and the schema migration run.
// Run with: node test-us020.js   (from inside the backend folder)

require('dotenv').config();
const db = require('./src/db');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = 'Password123!';
const MARKER = 'TEST_US020_';

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
  await db.query(`DELETE FROM venue_unavailabilities WHERE reason LIKE $1`, [`${MARKER}%`]);
  await db.query(`DELETE FROM notifications WHERE message LIKE $1`, [`%${MARKER}%`]);
  await db.query(`DELETE FROM events WHERE title LIKE $1`, [`${MARKER}%`]);
}

async function seedTestBooking(title, venueId, coordinatorId, status, dayOffset) {
  const event = await db.query(
    `INSERT INTO events (title, status, expected_attendance, assigned_coordinator_id)
     VALUES ($1, 'approved', 40, $2)
     RETURNING id`,
    [title, coordinatorId]
  );
  const booking = await db.query(
    `INSERT INTO bookings (
       event_id, venue_id, requested_by, start_time, end_time, status, setup_minutes, turnaround_minutes
     )
     VALUES ($1, $2, $3, now() + ($4 * interval '1 day'), now() + ($4 * interval '1 day') + interval '2 hours', $5, 15, 15)
     RETURNING id`,
    [event.rows[0].id, venueId, coordinatorId, dayOffset, status]
  );
  return { eventId: event.rows[0].id, bookingId: booking.rows[0].id };
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();

  const venues = await db.query('SELECT id, name FROM venues ORDER BY name LIMIT 1');
  if (!venues.rows.length) throw new Error('At least one seeded venue is required for US-020 tests');
  const venue = venues.rows[0];

  console.log('\n--- Logging in ---');
  const venueToken = await login('venue@connectsphere.local');
  const coordinatorToken = await login('coordinator@connectsphere.local');
  const attendeeToken = await login('attendee@connectsphere.local');
  const coordinatorId = await getUserId('coordinator@connectsphere.local');
  const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  const futureStart = (days) => new Date(Date.now() + days * 86400000);

  console.log('\n--- US-020: Authorization ---');
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, { method: 'POST', headers: authed(coordinatorToken), body: '{}' });
    check('Wrong role (coordinator) -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-020: Validation ---');
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
      method: 'POST', headers: authed(venueToken),
      body: JSON.stringify({ startTime: futureStart(10), endTime: futureStart(9), reasonCode: 'maintenance' })
    });
    check('End before start -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
      method: 'POST', headers: authed(venueToken),
      body: JSON.stringify({ startTime: futureStart(9), endTime: futureStart(10), reasonCode: 'not_a_real_reason' })
    });
    check('Invalid reason code -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
      method: 'POST', headers: authed(venueToken),
      body: JSON.stringify({ startTime: futureStart(9), endTime: futureStart(10), reasonCode: 'other' })
    });
    check('"Other" without free-text detail -> 400', res.status === 400, `(got ${res.status})`);
  }

  console.log('\n--- US-020: Create unavailability period ---');
  const createRes = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
    method: 'POST', headers: authed(venueToken),
    body: JSON.stringify({ startTime: futureStart(20), endTime: futureStart(21), reasonCode: 'other', reasonDetail: `${MARKER}Roof repair` })
  });
  const created = await createRes.json();
  check('Create succeeds (201)', createRes.status === 201, `(got ${createRes.status}, ${JSON.stringify(created)})`);
  check('Reason text stores the free-text detail', created.reason === `${MARKER}Roof repair`, `(got ${created.reason})`);
  check('created_by is set', created.created_by != null);
  check('created_at is set', created.created_at != null);
  check('modified_by is null before any edit', created.modified_by == null);

  console.log('\n--- US-020: Venue excluded from availability search while unavailable ---');
  const exclusionDay = 9;
  const exclusionDate = futureStart(exclusionDay).toISOString().slice(0, 10);
  const periodStart = new Date(`${exclusionDate}T07:00:00+08:00`);
  const periodEnd = new Date(`${exclusionDate}T13:00:00+08:00`);
  const exclusionCreate = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
    method: 'POST', headers: authed(venueToken),
    body: JSON.stringify({ startTime: periodStart, endTime: periodEnd, reasonCode: 'maintenance' })
  });
  const exclusionBody = await exclusionCreate.json();
  check('Exclusion-window fixture created (201)', exclusionCreate.status === 201, `(got ${exclusionCreate.status}, ${JSON.stringify(exclusionBody)})`);

  const searchRes = await fetch(
    `${BASE_URL}/api/venues?date=${exclusionDate}&startTime=09:00&endTime=11:00`,
    { headers: authed(coordinatorToken) }
  );
  const searchResults = await searchRes.json();
  check('Search request succeeds (200)', searchRes.status === 200, `(got ${searchRes.status})`);
  check('Venue is excluded from search results for the unavailable window', !searchResults.some((row) => row.id === venue.id));

  console.log('\n--- US-020: Overlap with existing bookings is flagged, not blocked ---');
  const clashing = await seedTestBooking(`${MARKER}ClashingEvent`, venue.id, coordinatorId, 'confirmed', 30);
  const overlapRes = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
    method: 'POST', headers: authed(venueToken),
    body: JSON.stringify({ startTime: futureStart(30), endTime: futureStart(30.2), reasonCode: 'safety_concerns' })
  });
  const overlapBody = await overlapRes.json();
  check('Overlapping period is still accepted, not blocked (201)', overlapRes.status === 201, `(got ${overlapRes.status})`);
  check('Clashing booking is listed in affected_bookings', overlapBody.affected_bookings?.some((b) => b.id === clashing.bookingId), `(got ${JSON.stringify(overlapBody.affected_bookings)})`);
  const stillConfirmed = await db.query('SELECT status FROM bookings WHERE id = $1', [clashing.bookingId]);
  check('Clashing booking is NOT auto-cancelled', stillConfirmed.rows[0].status === 'confirmed', `(got ${stillConfirmed.rows[0].status})`);
  const notif = await db.query('SELECT id FROM notifications WHERE user_id = $1 AND event_id = $2', [coordinatorId, clashing.eventId]);
  check('Responsible coordinator is notified of the clash', notif.rows.length > 0);

  console.log('\n--- US-020: List current/upcoming unavailable periods ---');
  const listRes = await fetch(`${BASE_URL}/api/venues/unavailability`, { headers: authed(venueToken) });
  const listBody = await listRes.json();
  check('List request succeeds (200)', listRes.status === 200, `(got ${listRes.status})`);
  check('Created period appears in the list', listBody.some((row) => row.id === created.id));

  console.log('\n--- US-020: End an active period early ---');
  const activeNow = await fetch(`${BASE_URL}/api/venues/${venue.id}/unavailability`, {
    method: 'POST', headers: authed(venueToken),
    body: JSON.stringify({ startTime: new Date(Date.now() - 3600000), endTime: futureStart(5), reasonCode: 'renovation' })
  });
  const activeNowBody = await activeNow.json();
  const endRes = await fetch(`${BASE_URL}/api/venues/unavailability/${activeNowBody.id}/end`, { method: 'PATCH', headers: authed(venueToken) });
  const endBody = await endRes.json();
  check('End-early request succeeds (200)', endRes.status === 200, `(got ${endRes.status})`);
  check('ended_early flag is set', endBody.ended_early === true);
  check('end_time moves to (approximately) now', Math.abs(new Date(endBody.end_time).getTime() - Date.now()) < 60000, `(got ${endBody.end_time})`);
  check('modified_by is recorded', endBody.modified_by != null);
  check('modified_at is recorded', endBody.modified_at != null);

  const availableAgainRes = await fetch(
    `${BASE_URL}/api/venues?date=${new Date().toISOString().slice(0, 10)}&startTime=23:00&endTime=23:30`,
    { headers: authed(coordinatorToken) }
  );
  check('Availability search still works after ending early (200)', availableAgainRes.status === 200, `(got ${availableAgainRes.status})`);

  {
    const res = await fetch(`${BASE_URL}/api/venues/unavailability/${activeNowBody.id}/end`, { method: 'PATCH', headers: authed(venueToken) });
    check('Ending an already-ended period -> 404', res.status === 404, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/venues/unavailability/00000000-0000-4000-8000-000000000000/end`, { method: 'PATCH', headers: authed(venueToken) });
    check('Ending a non-existent period -> 404', res.status === 404, `(got ${res.status})`);
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