// US-034: venue bookings follow the event's current coordinator after the Lead reassigns it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../src/db');

test('after reassignment the new coordinator sees the event\'s bookings and receives Venue Staff decisions', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query, originalPool = db.pool;
  let server;
  try {
    await client.query('BEGIN');
    for (const table of ['users', 'events', 'venues', 'bookings', 'notifications', 'event_changes']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    db.query = (sql, params) => client.query(sql, params);
    // The reassignment route opens its own transaction; run it as a savepoint inside the test's transaction.
    db.pool = { connect: async () => ({
      query: (sql, params) => {
        const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (command === 'BEGIN') return client.query('SAVEPOINT us034_bookings');
        if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT us034_bookings');
        if (command === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT us034_bookings');
        return client.query(sql, params);
      },
      release() {}
    }) };

    server = require('../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    const token = (sub, role) => jwt.sign({ sub, role }, process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(method, path, bearer, body) {
      const res = await fetch(base + path, {
        method,
        headers: { Authorization: 'Bearer ' + bearer, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, body: await res.json() };
    }

    const [lead, alice, bob, venueStaff] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [id, name, role] of [[lead, 'Lead', 'event_coordinator_lead'], [alice, 'Alice', 'event_coordinator'],
      [bob, 'Bob', 'event_coordinator'], [venueStaff, 'Venue', 'venue_staff']]) {
      await client.query('INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4)', [id, name, `${id}@test.local`, role]);
    }
    const venueId = randomUUID(), eventId = randomUUID(), bookingId = randomUUID();
    await client.query("INSERT INTO venues (id, name, capacity) VALUES ($1, 'Test Hall', 100)", [venueId]);
    await client.query("INSERT INTO events (id, title, status, assigned_coordinator_id) VALUES ($1, 'Robotics Showcase', 'submitted', $2)", [eventId, alice]);
    // Alice requested the booking while the event was hers.
    await client.query(
      `INSERT INTO bookings (id, event_id, venue_id, requested_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, '2099-03-01T02:00:00Z', '2099-03-01T04:00:00Z', 'pending')`,
      [bookingId, eventId, venueId, alice]);
    const myBookings = async coordinator => (await call('GET', '/bookings/mine', token(coordinator, 'event_coordinator'))).body.map(b => b.id);

    await t.test('before reassignment only the assigned coordinator sees the booking', async () => {
      assert.deepEqual(await myBookings(alice), [bookingId]);
      assert.deepEqual(await myBookings(bob), []);
    });

    await t.test('after reassignment the booking moves to the new coordinator', async () => {
      const result = await call('PATCH', `/coordinator-lead/events/${eventId}/coordinator`, token(lead, 'event_coordinator_lead'),
        { coordinatorId: bob, currentCoordinatorId: alice });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(await myBookings(bob), [bookingId]);
      assert.deepEqual(await myBookings(alice), []);
    });

    await t.test('a Venue Staff decision notifies the current coordinator, not the one who requested it', async () => {
      const decision = await call('PATCH', `/bookings/${bookingId}/decision`, token(venueStaff, 'venue_staff'), { decision: 'approved' });
      assert.equal(decision.status, 200, JSON.stringify(decision.body));
      const notes = await client.query("SELECT user_id FROM notifications WHERE event_id = $1 AND message LIKE 'Venue booking request%'", [eventId]);
      assert.deepEqual(notes.rows.map(n => n.user_id), [bob]);
    });
  } finally {
    db.query = originalQuery;
    db.pool = originalPool;
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await originalPool.end();
  }
});
