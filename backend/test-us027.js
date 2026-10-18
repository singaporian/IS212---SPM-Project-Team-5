// Test script for US-027 (Receive Relevant Event Notifications)
// Requires: backend server running locally on the port set in .env (default 3000)
// Run with: node test-us027.js   (from inside the backend folder)

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

async function ensureSecondTechAccount() {
  const email = 'tech2@connectsphere.local';
  const hash = await bcrypt.hash(PASSWORD, 12);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Test Technical Support Two', $1, $2, 'technical_support_staff')
     ON CONFLICT (email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [email, hash]
  );
}

async function resetTestData() {
  await db.query(
    `DELETE FROM notifications
     WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'TEST_US027_%')
        OR message = 'TEST_US027_PRIVATE_SENTINEL'`
  );
  await db.query(`DELETE FROM equipment_reservations WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'TEST_US027_%')`);
  await db.query(`DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'TEST_US027_%')`);
  await db.query(`DELETE FROM event_change_requests WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'TEST_US027_%')`);
  await db.query(`DELETE FROM events WHERE title LIKE 'TEST_US027_%'`);
  await db.query(`DELETE FROM equipment WHERE name = 'TEST_US027_Equipment'`);
}

async function getUserId(email) {
  const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error(`Required test account not found: ${email}`);
  return result.rows[0].id;
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function run() {
  console.log('\n--- Setting up test data ---');
  await resetTestData();
  await ensureSecondTechAccount();

  const techId = await getUserId('tech@connectsphere.local');
  const otherTechId = await getUserId('tech2@connectsphere.local');
  const organiserId = await getUserId('organiser@connectsphere.local');
  const coordinatorId = await getUserId('coordinator@connectsphere.local');

  const venueResult = await db.query('SELECT id FROM venues LIMIT 1');
  if (!venueResult.rows[0]) throw new Error('At least one seeded venue is required for US-027 tests');
  const venueId = venueResult.rows[0].id;

  // An event in 'planning' status (the domain model's name for "approved by Coordinator"),
  // assigned to the coordinator, with a confirmed future booking — this is the minimum state
  // needed before equipment can be reserved against it and before change requests are allowed.
  const eventResult = await db.query(
    `INSERT INTO events (organiser_id, assigned_coordinator_id, title, status, preferred_start, preferred_end, expected_attendance)
     VALUES ($1, $2, 'TEST_US027_Event', 'planning', now() + interval '10 days', now() + interval '10 days 2 hours', 30)
     RETURNING id`,
    [organiserId, coordinatorId]
  );
  const eventId = eventResult.rows[0].id;

  await db.query(
    `INSERT INTO bookings (event_id, venue_id, start_time, end_time, status, setup_minutes, turnaround_minutes)
     VALUES ($1, $2, now() + interval '10 days', now() + interval '10 days 2 hours', 'confirmed', 15, 15)`,
    [eventId, venueId]
  );

  const equipmentResult = await db.query(
    `INSERT INTO equipment (name, equipment_type, total_quantity, status)
     VALUES ('TEST_US027_Equipment', 'Audio', 5, 'available')
     RETURNING id`
  );
  const equipmentId = equipmentResult.rows[0].id;

  const privateNotification = await db.query(
    `INSERT INTO notifications (user_id, event_id, message)
     VALUES ($1, NULL, 'TEST_US027_PRIVATE_SENTINEL')
     RETURNING id`,
    [otherTechId]
  );

  console.log('\n--- Logging in ---');
  const techToken = await login('tech@connectsphere.local');
  const otherTechToken = await login('tech2@connectsphere.local');
  const organiserToken = await login('organiser@connectsphere.local');

  console.log('\n--- US-027: Equipment reservation (via existing US-023 endpoint) ---');
  const reservation = await request('/api/equipment/reservations', techToken, 'POST', { eventId, equipmentId, quantity: 2 });
  check('Technical Support Staff reserves equipment (201)', reservation.response.status === 201, `(got ${reservation.response.status}: ${JSON.stringify(reservation.data)})`);
  check('Reservation records its owner', reservation.data?.reservation?.id !== undefined, `(got ${JSON.stringify(reservation.data)})`);

  console.log('\n--- US-027: Unrelated change does not notify Tech Support ---');
  const unrelatedChange = await request(`/api/events/${eventId}/change-requests`, organiserToken, 'POST', { venueLayoutPreference: 'Theatre style, updated' });
  check('Venue-layout-only change request succeeds (201)', unrelatedChange.response.status === 201, `(got ${unrelatedChange.response.status}: ${JSON.stringify(unrelatedChange.data)})`);
  const afterUnrelated = await request('/api/notifications', techToken);
  const techNotificationsSoFar = afterUnrelated.data.filter((n) => n.event_id === eventId).length;
  check('Venue-layout-only change creates no notification for the equipment reserver', techNotificationsSoFar === 0, `(found ${techNotificationsSoFar})`);

  console.log('\n--- US-027: Relevant change (date/time) notifies the reserver ---');
  const newStart = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
  newStart.setUTCMinutes(0, 0, 0);
  const newEnd = new Date(newStart.getTime() + 2 * 60 * 60 * 1000);
  const dateChange = await request(`/api/events/${eventId}/change-requests`, organiserToken, 'POST', {
    preferredStart: newStart.toISOString(),
    preferredEnd: newEnd.toISOString()
  });
  check('Date/time change request succeeds (201)', dateChange.response.status === 201, `(got ${dateChange.response.status}: ${JSON.stringify(dateChange.data)})`);
  const afterDateChange = await request('/api/notifications', techToken);
  const dateChangeNotification = afterDateChange.data.find((n) => n.event_id === eventId && n.message.includes('important change was requested'));
  check('Date/time change notifies the equipment reserver', Boolean(dateChangeNotification), `(notifications: ${JSON.stringify(afterDateChange.data.filter((n) => n.event_id === eventId))})`);
  const otherAfterDateChange = await request('/api/notifications', otherTechToken);
  check('Non-reserving staff member is not notified about the date/time change', !otherAfterDateChange.data.some((n) => n.event_id === eventId));

  console.log('\n--- US-027: Cancellation notifies the reserver ---');
  const cancellation = await request(`/api/events/${eventId}/cancel-and-resubmit`, organiserToken, 'POST', {
    preferredStart: newStart.toISOString(),
    preferredEnd: newEnd.toISOString(),
    expectedAttendance: 999
  });
  check('Cancel-and-resubmit succeeds (201)', cancellation.response.status === 201, `(got ${cancellation.response.status}: ${JSON.stringify(cancellation.data)})`);
  const afterCancellation = await request('/api/notifications', techToken);
  const cancellationNotification = afterCancellation.data.find((n) => n.event_id === eventId && n.message.includes('has been cancelled'));
  check('Cancellation notifies the equipment reserver', Boolean(cancellationNotification), `(notifications: ${JSON.stringify(afterCancellation.data.filter((n) => n.event_id === eventId))})`);
  const otherAfterCancellation = await request('/api/notifications', otherTechToken);
  check('Non-reserving staff member is not notified about the cancellation', !otherAfterCancellation.data.some((n) => n.event_id === eventId));

  console.log('\n--- US-027: Notification ownership and read state ---');
  const ownNotifications = await request('/api/notifications', techToken);
  const otherNotifications = await request('/api/notifications', otherTechToken);
  check("Notification list excludes another user's notification", !ownNotifications.data.some((n) => n.id === privateNotification.rows[0].id));
  check('Other user can see their own notification', otherNotifications.data.some((n) => n.id === privateNotification.rows[0].id));

  if (dateChangeNotification) {
    const markOwnRead = await request(`/api/notifications/${dateChangeNotification.id}/read`, techToken, 'PATCH');
    check('Owner can mark own notification as read', markOwnRead.response.status === 200, `(got ${markOwnRead.response.status})`);
    const afterRead = await request('/api/notifications', techToken);
    check('Read state is reflected by the notification list', afterRead.data.find((n) => n.id === dateChangeNotification.id)?.read === true);
  }

  const markOtherRead = await request(`/api/notifications/${privateNotification.rows[0].id}/read`, techToken, 'PATCH');
  check("User cannot mark another user's notification as read", markOtherRead.response.status === 404, `(got ${markOtherRead.response.status})`);
  const sentinelState = await db.query('SELECT read FROM notifications WHERE id = $1', [privateNotification.rows[0].id]);
  check('Rejected cross-user read attempt leaves notification unread', sentinelState.rows[0]?.read === false);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (error) => {
  console.error('Test script crashed:', error);
  await db.pool.end();
  process.exit(1);
});