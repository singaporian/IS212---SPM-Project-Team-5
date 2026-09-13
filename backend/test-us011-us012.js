// Test script for US-011 (Assign an Event Request to Self) and US-012 (View Submitted Event Request Details)
// Requires: backend server running locally on the port set in .env (default 3000)
// Run with: node test-us011-us012.js   (from inside the backend folder)

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

async function ensureSecondCoordinator() {
  const email = 'coordinator2@connectsphere.local';
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) return;
  const hash = await bcrypt.hash(PASSWORD, 12);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'event_coordinator')`,
    ['Test Coordinator Two', email, hash]
  );
  console.log('Created second coordinator test account (coordinator2@connectsphere.local)');
}

async function resetTestData() {
  await db.query(`DELETE FROM events WHERE title LIKE 'TEST_US011_%'`);
}

async function seedTestEvents() {
  const oldest = await db.query(
    `INSERT INTO events (title, event_type, preferred_start, preferred_end, expected_attendance, purpose, status, created_at)
     VALUES ('TEST_US011_Oldest', 'Conference', '2026-10-01 09:00+08', '2026-10-01 17:00+08', 50, 'Oldest test event', 'submitted', now() - interval '2 days')
     RETURNING id`
  );
  const middle = await db.query(
    `INSERT INTO events (title, event_type, preferred_start, preferred_end, expected_attendance, purpose, status, created_at)
     VALUES ('TEST_US011_Middle', 'Workshop', '2026-10-05 09:00+08', '2026-10-05 12:00+08', 20, 'Middle test event', 'submitted', now() - interval '1 day')
     RETURNING id`
  );
  const minimal = await db.query(
    `INSERT INTO events (title, status, created_at)
     VALUES ('TEST_US011_Minimal', 'submitted', now())
     RETURNING id`
  );
  return {
    oldestId: oldest.rows[0].id,
    middleId: middle.rows[0].id,
    minimalId: minimal.rows[0].id
  };
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();
  await ensureSecondCoordinator();
  const { oldestId, middleId, minimalId } = await seedTestEvents();

  console.log('\n--- Logging in ---');
  const coordToken = await login('coordinator@connectsphere.local');
  const coord2Token = await login('coordinator2@connectsphere.local');
  const attendeeToken = await login('attendee@connectsphere.local');

  const authed = (token) => ({ Authorization: `Bearer ${token}` });

  console.log('\n--- US-011: Unauthenticated / unauthorized access ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/unassigned`);
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/unassigned`, { headers: authed(attendeeToken) });
    check('Attendee role -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-011: Unassigned queue, sorted oldest first ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/unassigned`, { headers: authed(coordToken) });
    const body = await res.json();
    const ids = body.map(e => e.id);
    const oldestIdx = ids.indexOf(oldestId);
    const middleIdx = ids.indexOf(middleId);
    check('Unassigned queue reachable (200)', res.status === 200, `(got ${res.status})`);
    check('Both test events present in queue', oldestIdx !== -1 && middleIdx !== -1);
    check('Oldest event appears before middle event', oldestIdx !== -1 && middleIdx !== -1 && oldestIdx < middleIdx);
  }

  console.log('\n--- US-011: Assign to self (happy path) ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}/assign`, { method: 'PATCH', headers: authed(coordToken) });
    const body = await res.json();
    check('Assign succeeds (200)', res.status === 200, `(got ${res.status})`);
    check('Response reflects assignment', body.assigned_coordinator_id, `(got ${JSON.stringify(body)})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/unassigned`, { headers: authed(coordToken) });
    const body = await res.json();
    check('Assigned event no longer in unassigned queue', !body.some(e => e.id === oldestId));
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/assigned`, { headers: authed(coordToken) });
    const body = await res.json();
    check('Assigned event appears in my assigned list', body.some(e => e.id === oldestId));
  }

  console.log('\n--- US-011: Double-assignment conflict ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}/assign`, { method: 'PATCH', headers: authed(coord2Token) });
    check('Second coordinator assigning same event -> 409', res.status === 409, `(got ${res.status})`);
  }

  console.log('\n--- US-012: View request details ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}`, { headers: authed(coordToken) });
    const body = await res.json();
    check('Owner can view assigned request details (200)', res.status === 200, `(got ${res.status})`);
    check('Details include expected fields', body.title === 'TEST_US011_Oldest' && body.purpose === 'Oldest test event');
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}`, { headers: authed(coord2Token) });
    check('Non-owner coordinator viewing details -> 403', res.status === 403, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${minimalId}`, { headers: authed(coordToken) });
    check('Viewing an unassigned request -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-011: Unassign ---');
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}/unassign`, { method: 'PATCH', headers: authed(coord2Token) });
    check('Non-owner unassigning -> 404', res.status === 404, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/${oldestId}/unassign`, { method: 'PATCH', headers: authed(coordToken) });
    check('Owner unassigning succeeds (200)', res.status === 200, `(got ${res.status})`);
  }
  {
    const res = await fetch(`${BASE_URL}/api/events/unassigned`, { headers: authed(coordToken) });
    const body = await res.json();
    check('Event returns to unassigned queue', body.some(e => e.id === oldestId));
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
