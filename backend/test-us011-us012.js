// Test script for US-012 (View Submitted Event Request Details) and US-034 (Lead assigns and reassigns coordinators).
// US-034 replaced US-011 self-assignment: only the Event Coordinator Lead assigns requests now.
// Requires seeded demo accounts (npm run seed-demo).
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
  const leadToken = await login('coordinatorlead@connectsphere.local');
  const attendeeToken = await login('attendee@connectsphere.local');
  const coordinatorIds = Object.fromEntries((await db.query(
    `SELECT email, id FROM users WHERE email IN ('coordinator@connectsphere.local', 'coordinator2@connectsphere.local')`)).rows.map(r => [r.email, r.id]));
  const coordId = coordinatorIds['coordinator@connectsphere.local'];
  const coord2Id = coordinatorIds['coordinator2@connectsphere.local'];

  const authed = (token) => ({ Authorization: `Bearer ${token}` });
  const overview = async () => (await fetch(`${BASE_URL}/api/coordinator-lead/overview`, { headers: authed(leadToken) })).json();
  const assign = (eventId, coordinatorId, currentCoordinatorId, token = leadToken) => fetch(`${BASE_URL}/api/coordinator-lead/events/${eventId}/coordinator`, {
    method: 'PATCH', headers: { ...authed(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinatorId, currentCoordinatorId })
  });

  console.log('\n--- US-034: Unauthenticated / unauthorized access ---');
  {
    const res = await fetch(`${BASE_URL}/api/coordinator-lead/overview`);
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  for (const [label, token] of [['Attendee', attendeeToken], ['Coordinator', coordToken]]) {
    const res = await fetch(`${BASE_URL}/api/coordinator-lead/overview`, { headers: authed(token) });
    check(`${label} role -> 403`, res.status === 403, `(got ${res.status})`);
  }
  {
    const res = await assign(oldestId, coordId, null, coordToken);
    check('Coordinator cannot assign a request to themselves -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-034: Unassigned queue, sorted oldest first ---');
  {
    const ids = (await overview()).unassigned.map(e => e.id);
    const oldestIdx = ids.indexOf(oldestId);
    const middleIdx = ids.indexOf(middleId);
    check('Both test events present in queue', oldestIdx !== -1 && middleIdx !== -1);
    check('Oldest event appears before middle event', oldestIdx !== -1 && middleIdx !== -1 && oldestIdx < middleIdx);
  }

  console.log('\n--- US-034: Lead assigns (happy path) ---');
  {
    const res = await assign(oldestId, coordId, null);
    const body = await res.json();
    check('Assign succeeds (200)', res.status === 200, `(got ${res.status})`);
    check('Response reflects assignment', body.event && body.event.assigned_coordinator_id === coordId, `(got ${JSON.stringify(body)})`);
  }
  {
    check('Assigned event no longer in unassigned queue', !(await overview()).unassigned.some(e => e.id === oldestId));
    const res = await fetch(`${BASE_URL}/api/events/assigned`, { headers: authed(coordToken) });
    const body = await res.json();
    check('Assigned event appears in the coordinator\'s assigned list', body.some(e => e.id === oldestId));
  }
  {
    const res = await assign(oldestId, coord2Id, null);
    check('Assigning from an out-of-date queue -> 409', res.status === 409, `(got ${res.status})`);
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

  console.log('\n--- US-034: Lead reassigns ---');
  {
    const res = await assign(oldestId, coord2Id, coordId);
    check('Reassign succeeds (200)', res.status === 200, `(got ${res.status})`);
    const before = await fetch(`${BASE_URL}/api/events/${oldestId}`, { headers: authed(coordToken) });
    check('Previous coordinator can no longer view the request -> 403', before.status === 403, `(got ${before.status})`);
    const after = await fetch(`${BASE_URL}/api/events/${oldestId}`, { headers: authed(coord2Token) });
    check('New coordinator can view the request (200)', after.status === 200, `(got ${after.status})`);
    const notes = await db.query('SELECT user_id FROM notifications WHERE event_id = $1', [oldestId]);
    check('New and previous coordinators were notified', [coordId, coord2Id].every(id => notes.rows.some(n => n.user_id === id)));
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
