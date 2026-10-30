// US-027 - Receive Relevant Event Notifications
// These tests call the real change-request and notification endpoints
// against an isolated PostgreSQL schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-027 Technical Support Staff with equipment reserved are notified of relevant changes', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us027_test_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const organiser = randomUUID(), coordinator = randomUUID(), tech = randomUUID(), otherTech = randomUUID();
  const venue = randomUUID(), event = randomUUID(), equipment = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'venues', 'events', 'bookings', 'equipment', 'equipment_reservations', 'event_change_requests', 'event_changes', 'notifications']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    pool = new (require('pg').Pool)({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);

    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [organiser, 'event_organiser', 'organiser@us027.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [coordinator, 'event_coordinator', 'coordinator@us027.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [tech, 'technical_support_staff', 'tech@us027.test']);
    await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [otherTech, 'technical_support_staff', 'othertech@us027.test']);
    await pool.query("INSERT INTO venues(id,name,capacity) VALUES($1,'Notify Hall',100)", [venue]);
    await pool.query(
      "INSERT INTO events(id,title,status,organiser_id,assigned_coordinator_id,preferred_start,preferred_end,expected_attendance) VALUES($1,'Notify Event','planning',$2,$3,now() + interval '10 days', now() + interval '10 days 2 hours', 30)",
      [event, organiser, coordinator]
    );
    await pool.query(
      "INSERT INTO bookings(event_id,venue_id,start_time,end_time,status,setup_minutes,turnaround_minutes) VALUES($1,$2,now() + interval '10 days', now() + interval '10 days 2 hours','confirmed',15,15)",
      [event, venue]
    );
    await pool.query("INSERT INTO equipment(id,name,equipment_type,total_quantity,status) VALUES($1,'Projector','Visual',5,'available')", [equipment]);
    // tech reserved equipment for this event; otherTech did not, and should never be notified about it.
    await pool.query("INSERT INTO equipment_reservations(equipment_id,event_id,quantity,reserved_by) VALUES($1,$2,2,$3)", [equipment, event, tech]);
    // A pre-existing notification belonging to otherTech, used to test cross-user ownership below.
    const privateNotif = await pool.query(
      "INSERT INTO notifications(user_id,event_id,message) VALUES($1,NULL,'PRIVATE_SENTINEL') RETURNING id",
      [otherTech]
    );

    server = require('../../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
    const token = (role, user) => jwt.sign({ role, sub: user }, secret);

    async function call(path, method = 'GET', body, role = 'event_organiser', user = organiser) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: { Authorization: 'Bearer ' + token(role, user), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }

    await t.test('an unrelated (venue layout only) change notifies nobody reserving equipment', async () => {
      const result = await call(`/events/${event}/change-requests`, 'POST', { venueLayoutPreference: 'Theatre style, updated' });
      assert.equal(result.status, 201);
      const techNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', tech);
      assert.equal(techNotifs.body.filter(n => n.event_id === event).length, 0);
    });

    let dateChangeNotificationId;

    await t.test('AC-027: a date/time change notifies the equipment reserver but not an uninvolved staff member', async () => {
      const newStart = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString();
      const newEnd = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
      const result = await call(`/events/${event}/change-requests`, 'POST', { preferredStart: newStart, preferredEnd: newEnd });
      assert.equal(result.status, 201);

      const techNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', tech);
      const relevant = techNotifs.body.find(n => n.event_id === event && n.message.includes('important change was requested'));
      assert.ok(relevant);
      dateChangeNotificationId = relevant.id;

      const otherNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', otherTech);
      assert.ok(!otherNotifs.body.some(n => n.event_id === event));
    });

    await t.test('AC-027: a cancellation notifies the equipment reserver but not an uninvolved staff member', async () => {
      const newStart = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();
      const newEnd = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
      const result = await call(`/events/${event}/cancel-and-resubmit`, 'POST', { preferredStart: newStart, preferredEnd: newEnd, expectedAttendance: 999 });
      assert.equal(result.status, 201);

      const techNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', tech);
      const cancelNotif = techNotifs.body.find(n => n.event_id === event && n.message.includes('has been cancelled'));
      assert.ok(cancelNotif);

      const otherNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', otherTech);
      assert.ok(!otherNotifs.body.some(n => n.event_id === event));
    });

    await t.test('notification ownership: a user only sees their own notifications', async () => {
      const techNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', tech);
      assert.ok(!techNotifs.body.some(n => n.id === privateNotif.rows[0].id));
      const otherNotifs = await call('/notifications', 'GET', undefined, 'technical_support_staff', otherTech);
      assert.ok(otherNotifs.body.some(n => n.id === privateNotif.rows[0].id));
    });

    await t.test('the owner can mark their own notification read, and it is reflected in the list', async () => {
      const markRead = await call(`/notifications/${dateChangeNotificationId}/read`, 'PATCH', undefined, 'technical_support_staff', tech);
      assert.equal(markRead.status, 200);
      assert.equal(markRead.body.read, true);
      const afterRead = await call('/notifications', 'GET', undefined, 'technical_support_staff', tech);
      assert.equal(afterRead.body.find(n => n.id === dateChangeNotificationId)?.read, true);
    });

    await t.test('a user cannot mark another user\'s notification as read', async () => {
      const markOtherRead = await call(`/notifications/${privateNotif.rows[0].id}/read`, 'PATCH', undefined, 'technical_support_staff', tech);
      assert.equal(markOtherRead.status, 404);
      const state = await pool.query('SELECT read FROM notifications WHERE id = $1', [privateNotif.rows[0].id]);
      assert.equal(state.rows[0].read, false);
    });

    await t.test('an unauthenticated request to list notifications is rejected', async () => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`);
      assert.equal(r.status, 401);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    db.pool = originalPool;
    db.query = originalQuery;
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  }
});
