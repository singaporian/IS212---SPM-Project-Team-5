// US-040 - View Event Registrations
// These tests call the real registrations API against an isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');
const { router } = require('../../src/registrations');

const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const schema = `us040_test_${randomUUID().replaceAll('-', '')}`;
const ids = { organiser: randomUUID(), coordinator: randomUUID(), otherOrganiser: randomUUID(), otherCoordinator: randomUUID(), attendee: randomUUID() };
const events = {};
let pool;
let server;
let base;
const originalPool = db.pool;
const originalQuery = db.query;
const token = (id, role) => jwt.sign({ sub: id, role }, secret);

async function request(path, bearer) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${bearer}` } });
  return { status: response.status, body: await response.json() };
}

test.before(async () => {
  await originalPool.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ['users', 'events', 'registrations']) {
    await originalPool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  pool = new Pool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'connectsphere', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres', options: `-c search_path=${schema},public` });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES
     ($1, 'Organiser', 'organiser@us040.test', 'unused', 'event_organiser'),
     ($2, 'Coordinator', 'coordinator@us040.test', 'unused', 'event_coordinator'),
     ($3, 'Other Organiser', 'other-organiser@us040.test', 'unused', 'event_organiser'),
     ($4, 'Other Coordinator', 'other-coordinator@us040.test', 'unused', 'event_coordinator'),
     ($5, 'Attendee', 'attendee@us040.test', 'unused', 'attendee')`,
    [ids.organiser, ids.coordinator, ids.otherOrganiser, ids.otherCoordinator, ids.attendee]
  );
  events.enabled = randomUUID();
  events.disabled = randomUUID();
  await pool.query(
    `INSERT INTO events (id, title, organiser_id, assigned_coordinator_id, status, registration_required)
     VALUES ($1, 'Registration Event', $3, $4, 'confirmed', true),
            ($2, 'No Registration Event', $3, $4, 'confirmed', false)`,
    [events.enabled, events.disabled, ids.organiser, ids.coordinator]
  );
  await pool.query(
    `INSERT INTO registrations (event_id, attendee_id, name, phone, email, status, created_at, updated_at)
     VALUES ($1, $2, 'Active Person', '91234567', 'active@us040.test', 'registered', '2027-01-01T10:00:00Z', '2027-01-01T10:00:00Z'),
            ($1, $3, 'Withdrawn Person', '81234567', 'withdrawn@us040.test', 'withdrawn', '2027-01-02T10:00:00Z', '2027-01-03T10:00:00Z')`,
    [events.enabled, ids.attendee, ids.otherAttendee || ids.otherOrganiser]
  );
  const app = express();
  app.use('/api/events', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  db.pool = originalPool;
  db.query = originalQuery;
  await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
});

test('AC-040-001/002/003: owner and assigned Coordinator view separated registration data', async () => {
  const organiserResult = await request(`/${events.enabled}/registrations`, token(ids.organiser, 'event_organiser'));
  assert.equal(organiserResult.status, 200);
  assert.equal(organiserResult.body.registered_count, 1);
  assert.equal(organiserResult.body.withdrawn_count, 1);
  assert.equal(organiserResult.body.registrations[0].name, 'Active Person');
  assert.equal(organiserResult.body.registrations[0].email, 'active@us040.test');
  assert.equal(organiserResult.body.registrations[0].phone, '91234567');
  assert.equal(organiserResult.body.withdrawn[0].status, 'withdrawn');
  assert.ok(organiserResult.body.registrations[0].created_at);

  const coordinatorResult = await request(`/${events.enabled}/registrations`, token(ids.coordinator, 'event_coordinator'));
  assert.equal(coordinatorResult.status, 200);
  assert.equal(coordinatorResult.body.registered_count, 1);
});

test('AC-040-004: registration-disabled events show a clear empty-state response', async () => {
  const result = await request(`/${events.disabled}/registrations`, token(ids.organiser, 'event_organiser'));
  assert.equal(result.status, 200);
  assert.equal(result.body.registration_enabled, false);
  assert.deepEqual(result.body.registrations, []);
});

test('AC-040-005: unrelated Organisers, Coordinators, and Attendees are denied', async () => {
  assert.equal((await request(`/${events.enabled}/registrations`, token(ids.otherOrganiser, 'event_organiser'))).status, 403);
  assert.equal((await request(`/${events.enabled}/registrations`, token(ids.otherCoordinator, 'event_coordinator'))).status, 403);
  assert.equal((await request(`/${events.enabled}/registrations`, token(ids.attendee, 'attendee'))).status, 403);
});