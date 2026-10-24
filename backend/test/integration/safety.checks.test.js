// US-039 - Operational Safety Check
// These integration tests call the real Safety Officer API and PostgreSQL schema.
// Each test run uses a private schema so production/developer data is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');
const { router } = require('../../src/safetyChecks');

const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const token = (id, role) => jwt.sign({ sub: id, role }, secret);
const schema = `us039_test_${randomUUID().replaceAll('-', '')}`;
let pool;
let server;
let base;
const originalPool = db.pool;
const originalQuery = db.query;
const ids = { safety: randomUUID(), coordinator: randomUUID(), organiser: randomUUID() };
const events = {};

async function request(path, bearer, options = {}) {
  // Use a real HTTP request so authentication, role checks, JSON parsing, and
  // the Safety Officer route all run exactly as they do in the application.
  const response = await fetch(base + path, {
    ...options,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, body: await response.json() };
}

async function createEvent(title, { bookingStatus = 'approved', technicalStatus = 'confirmed', safetyStatus = null } = {}) {
  // Build an event with controllable venue, technical, and previous safety states
  // so each eligibility rule can be tested independently.
  const eventId = randomUUID();
  const venueId = randomUUID();
  await pool.query(
    `INSERT INTO events (id, title, organiser_id, assigned_coordinator_id, status, expected_attendance, preferred_start, preferred_end)
     VALUES ($1, $2, $3, $4, 'confirmed', 100, '2099-03-01T09:00:00Z', '2099-03-01T12:00:00Z')`,
    [eventId, title, ids.organiser, ids.coordinator]
  );
  await pool.query('INSERT INTO venues (id, name, capacity, facilities, accessibility, supported_layouts) VALUES ($1, $2, 200, $3, $4, $5)', [venueId, `${title} Venue`, '[]', '{}', '[]']);
  await pool.query(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
     VALUES ($1, $2, $3, '2099-03-01T09:00:00Z', '2099-03-01T12:00:00Z', $4)`,
    [eventId, venueId, ids.coordinator, bookingStatus]
  );
  if (technicalStatus) await pool.query(
    `INSERT INTO technical_support_requirements (event_id, support_required, status)
     VALUES ($1, false, $2)`, [eventId, technicalStatus]
  );
  if (safetyStatus) await pool.query(
    `INSERT INTO operational_safety_checks (event_id, status, decided_at)
     VALUES ($1, $2, now())`, [eventId, safetyStatus]
  );
  return eventId;
}

test.before(async () => {
  // Copy only the tables used by this workflow into a private schema. The API
  // then uses this schema through search_path instead of the normal database.
  await db.pool.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ['users', 'events', 'venues', 'bookings', 'technical_support_requirements', 'operational_safety_checks', 'notifications', 'event_changes', 'venue_operating_hours', 'venue_unavailabilities']) {
    await db.pool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'connectsphere',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    options: `-c search_path=${schema},public`
  });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);
  // Create one Safety Officer, Coordinator, and Organiser for authorization and
  // notification assertions.
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES
     ($1, 'Safety Officer', 'safety@us039.test', 'unused', 'safety_officer'),
     ($2, 'Coordinator', 'coordinator@us039.test', 'unused', 'event_coordinator'),
     ($3, 'Organiser', 'organiser@us039.test', 'unused', 'event_organiser')`,
    [ids.safety, ids.coordinator, ids.organiser]
  );
  events.eligible = await createEvent('Eligible Event');
  events.pendingVenue = await createEvent('Pending Venue Event', { bookingStatus: 'pending' });
  events.noTechnical = await createEvent('No Technical Confirmation Event', { technicalStatus: null });
  events.changes = await createEvent('Changes Event');

  // Mount the real router on a temporary HTTP server for API-level testing.
  const app = express();
  app.use(express.json());
  app.use('/api/safety', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/safety`;
});

test.after(async () => {
  // Close the server and test pool, restore the shared db module, and remove the
  // isolated schema so this test cannot affect other tests or developer data.
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  db.pool = originalPool;
  db.query = originalQuery;
  await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
});

test('AC-039-001/002: only eligible confirmed events are visible to Safety Officers', async () => {
  // AC-039-001: a confirmed event with approved venue and confirmed technical
  // arrangements is returned by the review queue.
  const result = await request('/checks', token(ids.safety, 'safety_officer'));
  assert.equal(result.status, 200);
  const titles = result.body.map(event => event.title);
  assert.ok(titles.includes('Eligible Event')); // AC-039-001: eligible event is visible.
  assert.ok(!titles.includes('Pending Venue Event')); // AC-039-001: pending venue blocks eligibility.
  assert.ok(!titles.includes('No Technical Confirmation Event')); // AC-039-001: missing technical confirmation blocks eligibility.
  assert.equal(result.body.find(event => event.title === 'Eligible Event').technical_status, 'confirmed'); // AC-039-002: technical status is shown to the reviewer.
});

test('AC-039-002: non-Safety Officers cannot access the review queue', async () => {
  // AC-039-002: role middleware blocks an Event Coordinator from using the
  // Safety Officer queue even when the request is otherwise valid.
  const result = await request('/checks', token(ids.coordinator, 'event_coordinator'));
  assert.equal(result.status, 403);
});

test('AC-039-003/005/006: approval records the decision, audit row, and Coordinator notification', async () => {
  // AC-039-003: submit an approval through the real decision endpoint.
  const result = await request(`/checks/${events.eligible}`, token(ids.safety, 'safety_officer'), {
    method: 'PATCH', body: JSON.stringify({ decision: 'approved', comments: 'All arrangements are safe.' })
  });
  assert.equal(result.status, 200); // AC-039-003: the decision succeeds for an eligible event.
  const safety = (await pool.query('SELECT status, comments FROM operational_safety_checks WHERE event_id = $1', [events.eligible])).rows[0];
  assert.deepEqual(safety, { status: 'approved', comments: 'All arrangements are safe.' }); // AC-039-003: decision and comments persist.
  const notification = (await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1', [events.eligible])).rows[0];
  assert.equal(notification.user_id, ids.coordinator); // AC-039-005: assigned Coordinator is notified.
  assert.match(notification.message, /approved/); // AC-039-005: notification identifies the outcome.
  const audit = (await pool.query('SELECT change_summary FROM event_changes WHERE event_id = $1', [events.eligible])).rows[0];
  assert.match(audit.change_summary, /Operational Safety Check: approved/); // AC-039-006: decision is recorded for audit.
});

test('AC-039-004/007: Request Changes requires scope, returns the event to planning, and notifies the Coordinator', async () => {
  // AC-039-004: the API rejects Request Changes until the Safety Officer says
  // whether venue arrangements, technical arrangements, or both need changes.
  const missingScope = await request(`/checks/${events.changes}`, token(ids.safety, 'safety_officer'), {
    method: 'PATCH', body: JSON.stringify({ decision: 'changes_requested', comments: 'Fix the venue route.' })
  });
  assert.equal(missingScope.status, 400); // AC-039-004: missing change scope is rejected.

  const result = await request(`/checks/${events.changes}`, token(ids.safety, 'safety_officer'), {
    method: 'PATCH', body: JSON.stringify({ decision: 'changes_requested', changeScope: ['venue'], comments: 'Fix the venue route.' })
  });
  assert.equal(result.status, 200); // AC-039-004: a scoped change request is accepted.
  const event = (await pool.query('SELECT status FROM events WHERE id = $1', [events.changes])).rows[0];
  assert.equal(event.status, 'planning'); // AC-039-007: event returns to planning.
  const safety = (await pool.query('SELECT status, change_scope, comments FROM operational_safety_checks WHERE event_id = $1', [events.changes])).rows[0];
  assert.deepEqual(safety, { status: 'changes_requested', change_scope: ['venue'], comments: 'Fix the venue route.' }); // AC-039-004: scope/comments persist for the Coordinator.
  const notification = (await pool.query('SELECT user_id, message FROM notifications WHERE event_id = $1', [events.changes])).rows[0];
  assert.equal(notification.user_id, ids.coordinator); // AC-039-007: Coordinator is prompted to act.
  assert.match(notification.message, /venue changes/); // AC-039-007: notification identifies the affected arrangement.
});
