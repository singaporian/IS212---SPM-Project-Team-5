// US-021 integration tests: call the real API endpoints, with real login checks and a real database.
// All test data lives in temporary tables that are thrown away at the end, so real data is never touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');            // makes random ids for test rows
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
const { router } = require('../../src/preparation');       // the code under test

const FUTURE = { start: '2099-03-01T01:00:00Z', end: '2099-03-01T04:00:00Z' }; // upcoming
const PAST = { start: '2020-03-01T01:00:00Z', end: '2020-03-01T04:00:00Z' };   // already happened

const staff = randomUUID(), coordA = randomUUID(), coordB = randomUUID();
// A login token for any user id + role, signed with the same secret the backend checks.
const token = (sub, role) => jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
const STAFF = token(staff, 'venue_staff');

const originalQuery = db.query;  // kept so teardown can put it back
let client, server, base;
let failOn = null;               // when set, matching SQL fails on purpose (database error test)

// SETUP: runs once before all tests.
before(async () => {
  client = await db.pool.connect();
  await client.query('BEGIN');   // everything after this is undone by ROLLBACK in teardown
  for (const table of ['events', 'venues', 'bookings']) {
    // Empty copy of the real table (same columns and rules), only visible to this test.
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
  }
  // Make the app use our test connection, or fail the query when failOn matches it.
  db.query = (sql, params) => (failOn && failOn.test(sql)
    ? Promise.reject(new Error('forced database failure'))
    : client.query(sql, params));

  const app = express();
  app.use(express.json());
  app.use('/api/preparation', router);
  server = app.listen(0, '127.0.0.1');  // port 0 = pick any free port
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/preparation`;
});

// TEARDOWN: runs once after all tests, even if a test failed.
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.query = originalQuery;
  if (client) {
    await client.query('ROLLBACK').catch(() => {});  // throws away all test data
    client.release();
  }
  await db.pool.end();  // closes the database connection so the test process can exit
});

// Sends a request to the test server and returns the status code and JSON body.
async function call(method, path, body, bearer) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },  // "logged in" as bearer
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}
// Save a status; by default as Venue Staff.
const save = (id, status, bearer = STAFF) => call('PATCH', `/bookings/${id}`, { status }, bearer);

let venueCount = 0;  // gives each venue a unique name (Hall 1, Hall 2, ...)
async function makeEvent(status = 'confirmed', coordinator = coordA) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO events (id, title, status, assigned_coordinator_id) VALUES ($1, $2, $3, $4)',  // $1.. = values below
    [id, `Event ${id.slice(0, 4)}`, status, coordinator]);
  return id;
}
// One booking = one venue, so an event with two bookings has two venues.
async function makeBooking(eventId, when = FUTURE) {
  const venueId = randomUUID();
  await client.query('INSERT INTO venues (id, name) VALUES ($1, $2)', [venueId, `Hall ${++venueCount}`]);
  const result = await client.query(
    `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status)
     VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id`, [eventId, venueId, when.start, when.end]);  // RETURNING gives back the new id
  return result.rows[0].id;
}
// Reads the saved status straight from the database (not through the API).
async function statusOf(id) {
  const result = await client.query('SELECT preparation_status FROM bookings WHERE id = $1', [id]);
  return result.rows[0].preparation_status;
}

test('[IT-01] staff only see bookings of confirmed upcoming events (AC1)', async () => {
  const confirmedEvent = await makeEvent('confirmed');
  const roomA = await makeBooking(confirmedEvent);
  const roomB = await makeBooking(confirmedEvent);
  await makeBooking(await makeEvent('planning'));        // safety check not passed: should be hidden
  await makeBooking(await makeEvent('confirmed'), PAST); // already happened: should be hidden

  const result = await call('GET', '/bookings', undefined, STAFF);
  assert.equal(result.status, 200);
  // Exactly the two rooms, in any order (sort() so order doesn't matter).
  assert.deepEqual(result.body.map((row) => row.id).sort(), [roomA, roomB].sort());
});

test('[IT-02] venue staff can save a status and it is stored (AC2)', async () => {
  const id = await makeBooking(await makeEvent());
  const result = await save(id, 'in_progress');
  assert.equal(result.status, 200);
  assert.equal(await statusOf(id), 'in_progress');  // really saved in the database
});

test('[IT-03] a coordinator cannot save a status (AC2)', async () => {
  const id = await makeBooking(await makeEvent());
  const result = await save(id, 'ready', token(coordA, 'event_coordinator'));
  assert.equal(result.status, 403);                  // 403 = not allowed for this role
  assert.equal(await statusOf(id), 'not_started');   // unchanged (the default)
});

test('[IT-04] saving is refused before the safety check is approved (AC5)', async () => {
  const id = await makeBooking(await makeEvent('planning'));  // 'planning' = safety check not approved yet
  const result = await save(id, 'ready');
  assert.equal(result.status, 409);                  // 409 = refused by a business rule
  assert.equal(await statusOf(id), 'not_started');
});

test('[IT-05] a coordinator sees each venue of their own event, not other events (AC3, AC4)', async () => {
  const myEvent = await makeEvent('confirmed', coordA);
  const roomA = await makeBooking(myEvent);
  const roomB = await makeBooking(myEvent);
  const otherRoom = await makeBooking(await makeEvent('confirmed', coordB));  // belongs to another coordinator
  await save(roomA, 'ready');

  const result = await call('GET', '/mine', undefined, token(coordA, 'event_coordinator'));
  assert.equal(result.status, 200);
  // Turn the list into { bookingId: status } so each room is easy to check.
  const statusById = Object.fromEntries(result.body.map((row) => [row.id, row.preparation_status]));
  assert.equal(statusById[roomA], 'ready');
  assert.equal(statusById[roomB], 'not_started'); // saving room A did not change room B
  assert.equal(statusById[otherRoom], undefined);  // other coordinator's event is not in the list
});

test('[IT-06] if the database fails, the save returns 500 and the status is unchanged (AC6)', async () => {
  const id = await makeBooking(await makeEvent());
  failOn = /UPDATE bookings/;  // make the save's UPDATE query fail
  const result = await save(id, 'ready');
  failOn = null;               // back to normal so the check below works
  assert.equal(result.status, 500);                  // 500 = server error shown to the user
  assert.equal(await statusOf(id), 'not_started');   // old status kept
});