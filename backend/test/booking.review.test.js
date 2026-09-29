const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { occupiedInterval, reviewConflicts } = require('../src/bookingReview');

const sample = { id: 'request', venue_id: 'venue', start_time: '2026-10-15T10:03:00+08:00', end_time: '2026-10-15T11:07:00+08:00' };

test('US-019 source-backed conflict classification includes confirmed only and excludes self/other venues', () => {
  const bookings = ['pending', 'approved', 'confirmed', 'rejected', 'alternative_suggested', 'hold', 'unknown']
    .map(status => ({ ...sample, id: status, status }));
  bookings.push({ ...sample, status: 'confirmed' }, { ...sample, id: 'elsewhere', venue_id: 'other', status: 'confirmed' });
  assert.deepEqual(reviewConflicts(sample, bookings, []).map(item => item.id), ['confirmed']);
});

// Technical convention coverage only; exact-touch acceptance awaits team confirmation.
test('US-019 strict-overlap implementation convention and recorded setup/turnaround calculations', () => {
  const next = { ...sample, id: 'next', status: 'confirmed', start_time: sample.end_time, end_time: '2026-10-15T12:00:00+08:00' };
  assert.equal(reviewConflicts(sample, [next], []).length, 0);
  assert.equal(reviewConflicts({ ...sample, turnaround_minutes: 1 }, [next], []).length, 1);
  assert.equal(reviewConflicts(sample, [{ ...next, setup_minutes: 1 }], []).length, 1);
  const earlier = { ...sample, id: 'earlier', status: 'confirmed', start_time: '2026-10-15T09:00:00+08:00', end_time: sample.start_time };
  assert.equal(reviewConflicts(sample, [earlier], []).length, 0);
  assert.equal(reviewConflicts({ ...sample, setup_minutes: 1 }, [earlier], []).length, 1);
  assert.equal(reviewConflicts(sample, [{ ...earlier, turnaround_minutes: 1 }], []).length, 1);
  const gap = { ...next, start_time: '2026-10-15T11:17:00+08:00' };
  assert.equal(reviewConflicts({ ...sample, turnaround_minutes: 5 }, [{ ...gap, setup_minutes: 5 }], []).length, 0);
  assert.equal(reviewConflicts({ ...sample, turnaround_minutes: 6 }, [{ ...gap, setup_minutes: 5 }], []).length, 1);
});

test('US-019 missing/zero buffers add nothing and overnight minute values are preserved', () => {
  const overnight = { ...sample, start_time: '2026-10-15T23:59:00+08:00', end_time: '2026-10-16T00:01:00+08:00' };
  const expected = { start: '2026-10-15T15:59:00.000Z', end: '2026-10-15T16:01:00.000Z' };
  assert.deepEqual(occupiedInterval(overnight), expected);
  assert.deepEqual(occupiedInterval({ ...overnight, setup_minutes: null, turnaround_minutes: 0 }), expected);
});

test('US-019 recorded unavailability uses occupied interval and strict-overlap implementation convention', () => {
  const period = { id: 'blocked', venue_id: sample.venue_id, start_time: sample.end_time, end_time: '2026-10-15T12:00:00+08:00', reason: 'Maintenance' };
  assert.equal(reviewConflicts(sample, [], [period]).length, 0);
  const conflicts = reviewConflicts({ ...sample, turnaround_minutes: 1 }, [], [period]);
  assert.equal(conflicts[0].type, 'unavailability');
  assert.equal(conflicts[0].title, 'Maintenance');
  assert.equal(reviewConflicts(sample, [], [{ ...period, start_time: sample.start_time }]).length, 1);
  assert.equal(reviewConflicts(sample, [], [{ ...period, venue_id: 'other' }]).length, 0);
});

test('US-019 review API returns current requirements/availability without changing arrangements', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['venues', 'events', 'bookings', 'venue_unavailabilities', 'venue_operating_hours', 'notifications']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    const venue = randomUUID(), event = randomUUID(), requestId = randomUUID();
    await client.query(`INSERT INTO venues (id, name, capacity, facilities, accessibility, notes)
      VALUES ($1, 'Review room', 100, '["Projector"]', '{"wheelchair":true}', 'Recorded operating note')`, [venue]);
    await client.query(`INSERT INTO events (id, title, expected_attendance, preferred_start, preferred_end, draft_data)
      VALUES ($1, 'Review workshop', 25, '2026-10-15T09:00:00+08:00', '2026-10-15T10:00:00+08:00',
      '{"venueRequirements":"Original theatre preference","accessibilityNeeds":"Wheelchair access","equipmentRequirements":"Projector"}')`, [event]);
    async function booking(status, start = sample.start_time, end = sample.end_time, id = randomUUID()) {
      await client.query(`INSERT INTO bookings (id, event_id, venue_id, status, start_time, end_time, setup_minutes, turnaround_minutes, venue_requirements)
        VALUES ($1,$2,$3,$4,$5,$6,0,0,'{"description":"Requested classroom layout"}')`, [id,event,venue,status,start,end]);
      return id;
    }
    await booking('pending', sample.start_time, sample.end_time, requestId);
    await booking('pending');
    // Deliberately outside these hours: operating data is displayed, never a conflict rule.
    await client.query(`INSERT INTO venue_operating_hours (venue_id, day_of_week, opens_at, closes_at) VALUES ($1,4,'15:03','23:59')`, [venue]);
    server = require('../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const token = role => jwt.sign({ sub: randomUUID(), role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function get(id = requestId, bearer = token('venue_staff')) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/${id}/review`, { headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });
      return { status: response.status, body: await response.json() };
    }
    await t.test('required details keep booking values primary and show operating information', async () => {
      const result = await get();
      assert.equal(result.status, 200);
      assert.equal(result.body.request.venue_requirements.description, 'Requested classroom layout');
      assert.equal(result.body.request.draft_data.venueRequirements, 'Original theatre preference');
      assert.equal(result.body.request.expected_attendance, 25);
      assert.equal(result.body.request.draft_data.accessibilityNeeds, 'Wheelchair access');
      assert.equal(result.body.request.draft_data.equipmentRequirements, 'Projector');
      assert.equal(result.body.request.start_time, '2026-10-15T02:03:00.000Z');
      assert.equal(result.body.request.preferred_start, '2026-10-15T01:00:00.000Z');
      assert.deepEqual(result.body.venue.facilities, ['Projector']);
      assert.equal(result.body.operating_hours[0].opens_at, '15:03:00');
      assert.equal(result.body.bookings.length, 1);
      assert.deepEqual(result.body.conflicts, []);
    });
    await t.test('refresh detects confirmed bookings/unavailability, keeps approved contextual and causes no writes', async () => {
      const approved = await booking('approved'), confirmed = await booking('confirmed');
      await booking('rejected');
      await booking('alternative_suggested');
      const period = randomUUID();
      await client.query(`INSERT INTO venue_unavailabilities (id, venue_id, start_time, end_time, reason) VALUES ($1,$2,$3,$4,'Maintenance')`, [period, venue, sample.start_time, sample.end_time]);
      async function snapshot() {
        const rows = [];
        for (const table of ['events', 'bookings', 'notifications']) rows.push((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows);
        return rows;
      }
      const before = await snapshot();
      const result = await get();
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.conflicts.map(item => item.id).sort(), [confirmed, period].sort());
      assert.ok(result.body.bookings.some(item => item.id === approved && item.status === 'approved'));
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('overnight review retrieves periods on the following Singapore date', async () => {
      const id = await booking('pending', '2026-10-15T23:59:00+08:00', '2026-10-16T00:01:00+08:00');
      const reserved = await booking('confirmed', '2026-10-16T00:00:00+08:00', '2026-10-16T00:30:00+08:00');
      assert.ok((await get(id)).body.conflicts.some(item => item.id === reserved));
    });
    await t.test('only venue staff can review and missing requests return 404', async () => {
      assert.equal((await get(requestId, '')).status, 401);
      for (const role of ['event_organiser', 'event_coordinator', 'attendee', 'technical_support_staff']) assert.equal((await get(requestId, token(role))).status, 403);
      assert.equal((await get('bad-id')).status, 404);
      assert.equal((await get(randomUUID())).status, 404);
    });
    await t.test('failed review is a retryable error, never an empty successful result', async () => {
      db.query = async () => { throw new Error('test read failure'); };
      const result = await get();
      assert.equal(result.status, 500);
      assert.match(result.body.error, /retry/i);
      assert.equal(result.body.conflicts, undefined);
      db.query = (sql, params) => client.query(sql, params);
      assert.equal((await get()).status, 200);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await db.pool.end();
  }
});
