// Seeds two events for manually testing the Event Coordinator endpoints:
//   PATCH /api/events/:id/complete  -> "Demo: Ready to Complete" (confirmed, booking ended 2 days ago)
//   PATCH /api/events/:id/cancel    -> "Demo: Ready to Cancel"   (confirmed, booking in the future)
// Idempotent: matched by title; reruns reset status to 'confirmed' and recreate the booking,
// so an event you already completed/cancelled becomes usable again.
// Requires `npm run seed-demo` first.
const db = require('./db');

const COORDINATOR_EMAIL = 'coordinator@connectsphere.local';
const COORDINATOR_PASSWORD = 'Password123!';

// Day offsets are relative to today in Singapore time, which is how the app displays dates.
const specs = [
  { title: 'Demo: Ready to Complete', dayOffset: -2, start: '09:00', end: '12:00' },
  { title: 'Demo: Ready to Cancel', dayOffset: 7, start: '14:00', end: '17:00' }
];

const timeExpr = (dayParam, timeParam) =>
  `((now() AT TIME ZONE 'Asia/Singapore')::date + ${dayParam}::int + ${timeParam}::time) AT TIME ZONE 'Asia/Singapore'`;

async function seedEvent(spec, organiserId, coordinatorId, venueId) {
  const existing = await db.query('SELECT id FROM events WHERE title = $1 ORDER BY created_at LIMIT 1', [spec.title]);
  let eventId = existing.rows[0] && existing.rows[0].id;
  const startExpr = timeExpr('$4', '$5');
  const endExpr = timeExpr('$4', '$6');
  const params = [organiserId, coordinatorId, spec.title, spec.dayOffset, spec.start, spec.end];

  if (eventId) {
    await db.query(
      `UPDATE events SET organiser_id = $1, assigned_coordinator_id = $2, title = $3, status = 'confirmed',
         preferred_start = ${startExpr}, preferred_end = ${endExpr}, updated_at = now()
       WHERE id = $7`,
      [...params, eventId]
    );
  } else {
    const inserted = await db.query(
      `INSERT INTO events (organiser_id, assigned_coordinator_id, title, event_type, expected_attendance, purpose,
         status, preferred_start, preferred_end)
       VALUES ($1, $2, $3, 'Conference', 40, 'Demo event for coordinator complete/cancel actions',
         'confirmed', ${startExpr}, ${endExpr})
       RETURNING id`,
      params
    );
    eventId = inserted.rows[0].id;
  }

  await db.query('DELETE FROM bookings WHERE event_id = $1', [eventId]);
  await db.query(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status,
       setup_minutes, turnaround_minutes, decided_by, decided_at)
     VALUES ($1, $2, $3, ${timeExpr('$4', '$5')}, ${timeExpr('$4', '$6')}, 'confirmed', 30, 30, $3, now())`,
    [eventId, venueId, coordinatorId, spec.dayOffset, spec.start, spec.end]
  );
  return eventId;
}

async function run() {
  const users = await db.query(
    'SELECT email, id FROM users WHERE email = ANY($1::text[])',
    [['organiser@connectsphere.local', COORDINATOR_EMAIL]]
  );
  const userIds = new Map(users.rows.map((row) => [row.email, row.id]));
  const venue = await db.query('SELECT id FROM venues WHERE name = $1', ['Hotel Ballroom 1']);
  const organiserId = userIds.get('organiser@connectsphere.local');
  const coordinatorId = userIds.get(COORDINATOR_EMAIL);
  if (!organiserId || !coordinatorId || !venue.rows[0]) {
    throw new Error('Demo users/venues not found. Run `npm run seed-demo` first.');
  }

  const ids = [];
  for (const spec of specs) {
    ids.push({ title: spec.title, id: await seedEvent(spec, organiserId, coordinatorId, venue.rows[0].id) });
  }

  console.log('Coordinator action demo events seeded:');
  for (const { title, id } of ids) console.log(`  ${title}: ${id}`);
  console.log(`Coordinator login: ${COORDINATOR_EMAIL} / ${COORDINATOR_PASSWORD}`);
  await db.pool.end();
}

run().catch(async (error) => {
  console.error('Failed to seed coordinator action demo events:', error);
  await db.pool.end();
  process.exit(1);
});
