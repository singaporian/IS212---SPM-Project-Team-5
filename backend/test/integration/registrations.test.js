// US-029/US-030 - Register for Event / Withdraw Registration
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
const schema = `us029030_test_${randomUUID().replaceAll('-', '')}`;
const ids = { organiser: randomUUID(), coordinator: randomUUID(), attendee: randomUUID(), otherAttendee: randomUUID() };
const events = {};
let pool;
let server;
let base;
const originalPool = db.pool;
const originalQuery = db.query;
const token = (id, role) => jwt.sign({ sub: id, role }, secret);

async function request(path, { method = 'GET', body, bearer } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

test.before(async () => {
  await originalPool.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ['users', 'venues', 'events', 'bookings', 'operational_safety_checks', 'registrations', 'notifications']) {
    await originalPool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  pool = new Pool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'connectsphere', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres', options: `-c search_path=${schema},public` });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES
     ($1, 'Organiser', 'organiser@us029.test', 'unused', 'event_organiser'),
     ($2, 'Coordinator', 'coordinator@us029.test', 'unused', 'event_coordinator'),
     ($3, 'Attendee', 'attendee@us029.test', 'unused', 'attendee'),
     ($4, 'Other Attendee', 'other-attendee@us029.test', 'unused', 'attendee')`,
    [ids.organiser, ids.coordinator, ids.attendee, ids.otherAttendee]
  );

  events.open = randomUUID();        // confirmed, registration_required, no window/capacity restriction
  events.capped = randomUUID();      // confirmed, registration_required, capacity already full
  events.notYetOpen = randomUUID();  // registration_opens_at in the future
  events.started = randomUUID();     // confirmed event already in the past, used to test withdrawal lockout
  await pool.query(
    `INSERT INTO events (id, title, organiser_id, assigned_coordinator_id, status, registration_required, registration_capacity, preferred_start, preferred_end)
     VALUES
       ($1, 'Open Workshop', $5, $6, 'confirmed', true, NULL, now() + interval '7 days', now() + interval '7 days' + interval '1 hour'),
       ($2, 'Capped Workshop', $5, $6, 'confirmed', true, 1, now() + interval '7 days', now() + interval '7 days' + interval '1 hour'),
       ($3, 'Future-Opening Workshop', $5, $6, 'confirmed', true, NULL, now() + interval '7 days', now() + interval '7 days' + interval '1 hour'),
       ($4, 'Started Workshop', $5, $6, 'confirmed', true, NULL, now() - interval '1 hour', now() + interval '1 hour')`,
    [events.open, events.capped, events.notYetOpen, events.started, ids.organiser, ids.coordinator]
  );
  await pool.query(`UPDATE events SET registration_opens_at = now() + interval '1 day' WHERE id = $1`, [events.notYetOpen]);
  // Capacity 1, already filled by someone else so Attendee gets blocked.
  await pool.query(
    `INSERT INTO registrations (event_id, attendee_id, name, phone, email, status) VALUES ($1, $2, 'Filled Seat', '90000000', 'filled@us029.test', 'registered')`,
    [events.capped, ids.otherAttendee]
  );
  // Attendee already has an active registration on the "started" event, to be withdrawn in tests.
  await pool.query(
    `INSERT INTO registrations (event_id, attendee_id, name, phone, email, status) VALUES ($1, $2, 'Locked In', '90000001', 'lockedin@us029.test', 'registered')`,
    [events.started, ids.attendee]
  );
  for (const id of [events.open, events.capped, events.notYetOpen, events.started]) {
    await pool.query(`INSERT INTO operational_safety_checks (event_id, status) VALUES ($1, 'approved')`, [id]);
  }

  const app = express();
  app.use(express.json());
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

test('unauthenticated requests are rejected', async () => {
  const noToken = await request(`/registrable`, { bearer: '' });
  assert.equal(noToken.status, 401);
});

test('AC-029-001: /registrable lists open events with computed registration status', async () => {
  const result = await request(`/registrable`, { bearer: token(ids.attendee, 'attendee') });
  assert.equal(result.status, 200);
  const open = result.body.find(e => e.id === events.open);
  assert.ok(open);
  assert.equal(open.registration_open, true);
  assert.equal(open.my_registration_id, null);
  const capped = result.body.find(e => e.id === events.capped);
  assert.equal(capped.registration_open, false);
  assert.match(capped.registration_closed_reason, /capacity/);
});

test('AC-029-002/003: invalid registration input is rejected with field errors', async () => {
  const result = await request(`/${events.open}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: '', email: 'bad', phone: '1' }
  });
  assert.equal(result.status, 400);
  assert.ok(result.body.fields.name);
  assert.ok(result.body.fields.email);
  assert.ok(result.body.fields.phone);
});

test('registering for an unknown event returns 404', async () => {
  const result = await request(`/${randomUUID()}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 404);
});

test('AC-029-004/006: a valid registration succeeds and is notified', async () => {
  const result = await request(`/${events.open}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'registered');

  const notif = await pool.query(`SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2`, [ids.attendee, events.open]);
  assert.equal(notif.rows.length, 1);
  assert.match(notif.rows[0].message, /registered/i);

  const status = await request(`/${events.open}/registration`, { bearer: token(ids.attendee, 'attendee') });
  assert.equal(status.status, 200);
  assert.equal(status.body.status, 'registered');
});

test('AC-029-005: a duplicate registration is rejected', async () => {
  const result = await request(`/${events.open}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 409);
});

test('AC-029-008: registration is blocked once capacity is reached', async () => {
  const result = await request(`/${events.capped}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 409);
});

test('AC-029-007: registration is blocked before the window opens', async () => {
  const result = await request(`/${events.notYetOpen}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /opens/);
});

test('an attendee with no registration sees null status', async () => {
  const result = await request(`/${events.notYetOpen}/registration`, { bearer: token(ids.attendee, 'attendee') });
  assert.equal(result.status, 200);
  assert.equal(result.body, null);
});

test('AC-030-001/003: withdrawing an active registration succeeds and is notified', async () => {
  const myReg = await request(`/${events.started}/registration`, { bearer: token(ids.attendee, 'attendee') });
  assert.equal(myReg.status, 200);

  const withdraw = await request(`/registrations/${myReg.body.id}/withdraw`, { method: 'PATCH', bearer: token(ids.attendee, 'attendee') });
  // The "started" event's preferred_start is in the past, so AC-030-002 should block this instead.
  assert.equal(withdraw.status, 409);
  assert.match(withdraw.body.error, /started/);
});

test('AC-030-001/003: withdrawing a not-yet-started registration succeeds and is notified', async () => {
  const myReg = await request(`/${events.open}/registration`, { bearer: token(ids.attendee, 'attendee') });
  assert.equal(myReg.status, 200);

  const withdraw = await request(`/registrations/${myReg.body.id}/withdraw`, { method: 'PATCH', bearer: token(ids.attendee, 'attendee') });
  assert.equal(withdraw.status, 200);
  assert.equal(withdraw.body.status, 'withdrawn');

  const notif = await pool.query(`SELECT message FROM notifications WHERE user_id = $1 AND event_id = $2 ORDER BY id DESC LIMIT 1`, [ids.attendee, events.open]);
  assert.match(notif.rows[0].message, /withdrawn/i);
});

test('AC-030-004: withdrawing an already-withdrawn registration is rejected', async () => {
  const myReg = await pool.query(`SELECT id FROM registrations WHERE event_id = $1 AND attendee_id = $2`, [events.open, ids.attendee]);
  const withdraw = await request(`/registrations/${myReg.rows[0].id}/withdraw`, { method: 'PATCH', bearer: token(ids.attendee, 'attendee') });
  assert.equal(withdraw.status, 409);
});

test('AC-029-005: re-registering after a withdrawal is allowed', async () => {
  const result = await request(`/${events.open}/register`, {
    method: 'POST', bearer: token(ids.attendee, 'attendee'),
    body: { name: 'Attendee', email: 'attendee@us029.test', phone: '91234567' }
  });
  assert.equal(result.status, 201);
});

test('an attendee cannot withdraw another attendee\'s registration', async () => {
  const otherReg = await pool.query(`SELECT id FROM registrations WHERE event_id = $1 AND attendee_id = $2`, [events.capped, ids.otherAttendee]);
  const withdraw = await request(`/registrations/${otherReg.rows[0].id}/withdraw`, { method: 'PATCH', bearer: token(ids.attendee, 'attendee') });
  assert.equal(withdraw.status, 404);
});
