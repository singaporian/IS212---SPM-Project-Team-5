// Test script for US-013 (Approve or Reject Event Request)
// Requires: backend server running locally on the port set in .env (default 3000)
// Run with: node test-us013.js   (from inside the backend folder)

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
  await db.query(`DELETE FROM events WHERE title LIKE 'TEST_US013_%'`);
}

async function getUserId(email) {
  const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error(`Required demo account not found: ${email}`);
  return result.rows[0].id;
}

async function seedEvent(title, status, coordinatorId, organiserId) {
  const result = await db.query(
    `INSERT INTO events (title, status, assigned_coordinator_id, organiser_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [title, status, coordinatorId, organiserId]
  );
  return result.rows[0].id;
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();
  await ensureSecondCoordinator();

  const coordinatorId = await getUserId('coordinator@connectsphere.local');
  const coordinator2Id = await getUserId('coordinator2@connectsphere.local');
  const organiserId = await getUserId('organiser@connectsphere.local');

  const eventIds = {
    unassigned: await seedEvent('TEST_US013_Unassigned', 'submitted', null, organiserId),
    assignedToMe: await seedEvent('TEST_US013_AssignedToMe', 'submitted', coordinatorId, organiserId),
    assignedToOther: await seedEvent('TEST_US013_AssignedToOther', 'submitted', coordinator2Id, organiserId),
    forRejection: await seedEvent('TEST_US013_ForRejection', 'submitted', coordinatorId, organiserId),
    alreadyApproved: await seedEvent('TEST_US013_AlreadyApproved', 'approved', coordinatorId, organiserId)
  };

  console.log('\n--- Logging in ---');
  const coordToken = await login('coordinator@connectsphere.local');
  const coord2Token = await login('coordinator2@connectsphere.local');
  const attendeeToken = await login('attendee@connectsphere.local');
  void coord2Token;

  const authed = (token) => ({ Authorization: `Bearer ${token}` });
  const decisionUrl = (id) => `${BASE_URL}/api/events/${id}/decision`;
  const submitDecision = (id, token, body) => fetch(decisionUrl(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? authed(token) : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  console.log('\n--- US-013: Authorization ---');
  {
    const res = await submitDecision(eventIds.assignedToMe);
    check('No token -> 401', res.status === 401, `(got ${res.status})`);
  }
  {
    const res = await submitDecision(eventIds.assignedToMe, attendeeToken, { decision: 'approved' });
    check('Attendee role -> 403', res.status === 403, `(got ${res.status})`);
  }

  console.log('\n--- US-013: Approve (happy path) ---');
  {
    const res = await submitDecision(eventIds.assignedToMe, coordToken, { decision: 'approved' });
    const body = await res.json();
    check('Coordinator approves assigned event (200)', res.status === 200, `(got ${res.status})`);
    check('Response status is approved', body.status === 'approved', `(got ${JSON.stringify(body)})`);
  }
  {
    const result = await db.query('SELECT status FROM events WHERE id = $1', [eventIds.assignedToMe]);
    check('Approved status persisted in database', result.rows[0]?.status === 'approved');
  }

  console.log('\n--- US-013: Approve (ownership rules) ---');
  for (const [label, eventId] of [
    ['Unassigned event', eventIds.unassigned],
    ['Event assigned to another coordinator', eventIds.assignedToOther],
    ['Already-approved event', eventIds.alreadyApproved]
  ]) {
    const res = await submitDecision(eventId, coordToken, { decision: 'approved' });
    check(`${label} cannot be approved (404)`, res.status === 404, `(got ${res.status})`);
  }

  console.log('\n--- US-013: Reject (validation) ---');
  {
    const res = await submitDecision(eventIds.forRejection, coordToken, { decision: 'rejected' });
    check('Missing rejection reason -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await submitDecision(eventIds.forRejection, coordToken, { decision: 'rejected', reason: 'other' });
    check('Other reason without reasonDetail -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await submitDecision(eventIds.forRejection, coordToken, { decision: 'rejected', reason: 'made_up_reason' });
    check('Invalid rejection reason -> 400', res.status === 400, `(got ${res.status})`);
  }
  {
    const res = await submitDecision(eventIds.forRejection, coordToken, { decision: 'maybe' });
    check('Invalid decision -> 400', res.status === 400, `(got ${res.status})`);
  }

  console.log('\n--- US-013: Reject (happy path) ---');
  {
    const res = await submitDecision(eventIds.forRejection, coordToken, {
      decision: 'rejected',
      reason: 'insufficient_information'
    });
    const body = await res.json();
    check('Coordinator rejects assigned event (200)', res.status === 200, `(got ${res.status})`);
    check('Response status is rejected', body.status === 'rejected', `(got ${JSON.stringify(body)})`);
  }
  {
    const result = await db.query('SELECT status FROM events WHERE id = $1', [eventIds.forRejection]);
    check('Rejected status persisted in database', result.rows[0]?.status === 'rejected');
  }
  {
    const result = await db.query(
      'SELECT id FROM event_changes WHERE event_id = $1 AND changed_by = $2',
      [eventIds.forRejection, coordinatorId]
    );
    check('Rejection audit row records the coordinator', result.rows.length > 0);
  }
  {
    const result = await db.query(
      `SELECT id FROM notifications
       WHERE event_id = $1 AND user_id = $2 AND message ILIKE '%rejected%'`,
      [eventIds.forRejection, organiserId]
    );
    check('Organiser receives a rejection notification', result.rows.length > 0);
  }

  console.log('\n--- US-013: Audit trail ---');
  {
    const result = await db.query(
      `SELECT id FROM event_changes
       WHERE event_id = $1 AND changed_by = $2 AND change_summary ILIKE '%approved%'`,
      [eventIds.assignedToMe, coordinatorId]
    );
    check('Approval audit row records the coordinator', result.rows.length > 0);
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