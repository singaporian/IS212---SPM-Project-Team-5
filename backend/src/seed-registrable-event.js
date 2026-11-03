// Seeds one demo event that appears on the attendee "Browse Events" page (GET /api/events/registrable):
// confirmed + registration_required, a confirmed venue booking, and an approved operational safety check.
// Idempotent: re-running updates the same event (matched by title). Requires `npm run seed-demo` first.
const db = require('./db');

const TITLE = 'Demo: Open Registration Showcase';

async function run() {
  const users = await db.query(
    'SELECT email, id FROM users WHERE email = ANY($1::text[])',
    [['organiser@connectsphere.local', 'coordinator@connectsphere.local']]
  );
  const userIds = new Map(users.rows.map((row) => [row.email, row.id]));
  const venue = await db.query('SELECT id FROM venues WHERE name = $1', ['Hotel Ballroom 1']);
  const organiserId = userIds.get('organiser@connectsphere.local');
  const coordinatorId = userIds.get('coordinator@connectsphere.local');
  if (!organiserId || !coordinatorId || !venue.rows[0]) {
    throw new Error('Demo users/venues not found. Run `npm run seed-demo` first.');
  }
  const venueId = venue.rows[0].id;

  // 10 days ahead, 14:00-17:00 Singapore time; registration is open now and closes before the event.
  const startExpr = "((now() AT TIME ZONE 'Asia/Singapore')::date + 10 + TIME '14:00') AT TIME ZONE 'Asia/Singapore'";
  const endExpr = "((now() AT TIME ZONE 'Asia/Singapore')::date + 10 + TIME '17:00') AT TIME ZONE 'Asia/Singapore'";

  const existing = await db.query('SELECT id FROM events WHERE title = $1 ORDER BY created_at LIMIT 1', [TITLE]);
  const params = [organiserId, TITLE, coordinatorId];
  let eventId = existing.rows[0] && existing.rows[0].id;
  if (eventId) {
    await db.query(
      `UPDATE events SET organiser_id = $1, title = $2, assigned_coordinator_id = $3, status = 'confirmed',
         registration_required = true, registration_capacity = 50,
         registration_opens_at = now() - interval '1 day',
         registration_closes_at = ${startExpr} - interval '1 day',
         preferred_start = ${startExpr}, preferred_end = ${endExpr}, updated_at = now()
       WHERE id = $4`,
      [...params, eventId]
    );
  } else {
    const inserted = await db.query(
      `INSERT INTO events (organiser_id, title, event_type, expected_attendance, purpose, description, status,
         assigned_coordinator_id, registration_required, registration_capacity,
         registration_opens_at, registration_closes_at, preferred_start, preferred_end)
       VALUES ($1, $2, 'Conference', 50, 'Demo event open for attendee registration',
         'Seeded demo event that has cleared safety review.', 'confirmed',
         $3, true, 50, now() - interval '1 day', ${startExpr} - interval '1 day', ${startExpr}, ${endExpr})
       RETURNING id`,
      params
    );
    eventId = inserted.rows[0].id;
  }

  await db.query('DELETE FROM bookings WHERE event_id = $1', [eventId]);
  await db.query(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status,
       setup_minutes, turnaround_minutes, decided_by, decided_at)
     VALUES ($1, $2, $3, ${startExpr}, ${endExpr}, 'confirmed', 30, 30, $3, now())`,
    [eventId, venueId, coordinatorId]
  );

  await db.query(
    `INSERT INTO operational_safety_checks (event_id, status, comments, decided_by, decided_at)
     VALUES ($1, 'approved', 'Seeded demo approval', $2, now())
     ON CONFLICT (event_id) DO UPDATE SET status = 'approved', comments = EXCLUDED.comments,
       decided_by = EXCLUDED.decided_by, decided_at = now(), updated_at = now()`,
    [eventId, coordinatorId]
  );

  console.log(`Registrable demo event seeded: "${TITLE}" (${eventId})`);
  await db.pool.end();
}

run().catch(async (error) => {
  console.error('Failed to seed registrable demo event:', error);
  await db.pool.end();
  process.exit(1);
});
