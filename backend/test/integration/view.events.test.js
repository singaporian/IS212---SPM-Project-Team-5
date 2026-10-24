// US-028 - View Appropriate Event Information
// These integration tests call the attendee API with real PostgreSQL data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');
const { router } = require('../../src/registrations');

const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const schema = `us028_test_${randomUUID().replaceAll('-', '')}`;
const ids = { attendee: randomUUID(), coordinator: randomUUID(), organiser: randomUUID() };
let pool;
let server;
let base;
const originalPool = db.pool;
const originalQuery = db.query;

const token = (id, role) => jwt.sign({ sub: id, role }, secret);

async function request(path, bearer) {
  // Use a real HTTP request so authentication and the attendee-only route
  // middleware are exercised, not just the SQL query in isolation.
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${bearer}` } });
  return { status: response.status, body: await response.json() };
}

async function createEvent(title, registrationCapacity = null) {
  // Create only public event data plus one approved venue arrangement. Internal
  // coordinator/booking details remain in the database but are not returned by
  // the attendee response.
  const eventId = randomUUID();
  const venueId = randomUUID();
  await pool.query(
    `INSERT INTO events (id, title, description, organiser_id, assigned_coordinator_id, status,
                         preferred_start, preferred_end, registration_required, registration_capacity)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', '2099-03-01T09:00:00Z', '2099-03-01T12:00:00Z', true, $6)`,
    [eventId, title, `${title} public description`, ids.organiser, ids.coordinator, registrationCapacity]
  );
  await pool.query('INSERT INTO venues (id, name, location, capacity) VALUES ($1, $2, $3, 200)', [venueId, `${title} Hall`, 'Level 2']);
  await pool.query(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
     VALUES ($1, $2, $3, '2099-03-01T09:00:00Z', '2099-03-01T12:00:00Z', 'approved')`,
    [eventId, venueId, ids.coordinator]
  );
  return eventId;
}

test.before(async () => {
  const originalPool = db.pool;
  // Use a private PostgreSQL schema so this test can verify real persistence
  // without modifying the normal development database.
  await originalPool.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ['users', 'events', 'venues', 'bookings', 'registrations', 'operational_safety_checks']) {
    await originalPool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
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
  // Create separate Attendee, Coordinator, and Organiser identities for the
  // public-response and role-authorization checks.
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES
     ($1, 'Attendee', 'attendee@us028.test', 'unused', 'attendee'),
     ($2, 'Coordinator', 'coordinator@us028.test', 'unused', 'event_coordinator'),
     ($3, 'Organiser', 'organiser@us028.test', 'unused', 'event_organiser')`,
    [ids.attendee, ids.coordinator, ids.organiser]
  );
  const openEvent = await createEvent('Public Conference');
  const closedEvent = await createEvent('Full Workshop', 1);
  await pool.query("INSERT INTO operational_safety_checks (event_id, status, decided_at) VALUES ($1, 'approved', now()), ($2, 'approved', now())", [openEvent, closedEvent]);
  // Fill the closed event's only registration slot so its public status is closed.
  await pool.query(
    `INSERT INTO registrations (event_id, attendee_id, name, email, phone, status)
     VALUES ($1, $2, 'Existing Attendee', 'existing@us028.test', '12345678', 'registered')`,
    [closedEvent, ids.attendee]
  );

  const app = express();
  // Mount the real registrations router on a temporary HTTP server.
  app.use('/api/events', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
  assert.ok(openEvent && closedEvent);
});

test.after(async () => {
  // Stop the server, close the isolated pool, restore the shared db module, and
  // remove the temporary schema after the assertions finish.
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  db.pool = originalPool;
  db.query = originalQuery;
  await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
});

test('AC-028-001/002/003/004/005: attendee receives public event details and registration status only', async () => {
  // AC-028-001: an authenticated Attendee can request registrable events.
  const result = await request('/registrable', token(ids.attendee, 'attendee'));
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 2); // AC-028-001: both confirmed registration events are available.

  const openEvent = result.body.find(event => event.title === 'Public Conference');
  const closedEvent = result.body.find(event => event.title === 'Full Workshop');
  assert.equal(openEvent.description, 'Public Conference public description'); // AC-028-002: description is shown.
  assert.equal(openEvent.venue_name, 'Public Conference Hall'); // AC-028-002: venue is shown.
  assert.equal(openEvent.venue_location, 'Level 2'); // AC-028-002: venue location is shown.
  assert.equal(openEvent.registration_status, 'open'); // AC-028-003: open registration status is shown.
  assert.equal(closedEvent.registration_status, 'closed'); // AC-028-003: closed registration status is shown.
  assert.ok(!('assigned_coordinator_id' in openEvent)); // AC-028-004: Coordinator assignment is not exposed.
  assert.ok(!('booking_status' in openEvent)); // AC-028-004: internal booking status is not exposed.
  assert.ok(!('technical_support_requirements' in openEvent)); // AC-028-004: technical planning data is not exposed.
});

test('AC-028-001: only authenticated Attendees can view registrable events', async () => {
  // AC-028-001: authentication and role authorization prevent internal roles
  // and anonymous users from reading the public attendee event response.
  assert.equal((await request('/registrable', token(ids.coordinator, 'event_coordinator'))).status, 403);
  assert.equal((await request('/registrable', '')).status, 401);
});
