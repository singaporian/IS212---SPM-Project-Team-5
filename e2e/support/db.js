// Test data helpers for end-to-end tests. Reuses the backend's database settings and packages,
// so e2e/ only needs @playwright/test of its own.
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const backend = path.join(__dirname, '..', '..', 'backend');
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env') });
const { Pool } = require(path.join(backend, 'node_modules', 'pg'));
const bcrypt = require(path.join(backend, 'node_modules', 'bcryptjs'));

const pool = new Pool({
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'connectsphere',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

const PASSWORD = 'Password123!';
const sgt = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// Every fixture is tagged with a run id so it can be removed afterwards without touching other data.
function createFixtures() {
  const run = randomUUID().slice(0, 8);
  const users = [];
  const events = [];
  const venues = [];
  const equipment = [];
  let passwordHash;

  async function user(role, label) {
    passwordHash = passwordHash || await bcrypt.hash(PASSWORD, 4);
    const email = `e2e-${label}-${run}@connectsphere.test`;
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`E2E ${label} ${run}`, email, passwordHash, role]);
    users.push(rows[0].id);
    return { id: rows[0].id, email, password: PASSWORD };
  }

  async function event({ title, organiser, coordinator, status = 'planning' }) {
    const { rows } = await pool.query(
      `INSERT INTO events (title, status, organiser_id, assigned_coordinator_id, expected_attendance,
                           preferred_start, preferred_end, venue_layout_preference, equipment_requirements)
       VALUES ($1, $6, $2, $3, 100, $4, $5, 'Theatre', '["projector"]'::jsonb) RETURNING id`,
      [`${title} ${run}`, organiser.id, coordinator.id, sgt('2099-03-01', '09:00'), sgt('2099-03-01', '12:00'), status]);
    events.push(rows[0].id);
    if (status === 'confirmed') {
      await pool.query(
        `INSERT INTO technical_support_requirements (event_id, support_required, status)
         VALUES ($1, false, 'confirmed')`, [rows[0].id]
      );
      await pool.query(
        `INSERT INTO operational_safety_checks (event_id, status, decided_at)
         VALUES ($1, 'approved', now())`, [rows[0].id]
      );
    }
    return { id: rows[0].id, title: `${title} ${run}` };
  }

  async function arrangements(eventRef, coordinator) {
    const venue = await pool.query(`INSERT INTO venues (name, capacity) VALUES ($1, 200) RETURNING id, name`, [`E2E Hall ${run}`]);
    venues.push(venue.rows[0].id);
    const item = await pool.query(`INSERT INTO equipment (name, total_quantity) VALUES ($1, 5) RETURNING id, name`, [`E2E Projector ${run}`]);
    equipment.push(item.rows[0].id);
    const booking = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING id`,
      [eventRef.id, venue.rows[0].id, coordinator.id, sgt('2099-03-01', '09:00'), sgt('2099-03-01', '12:00')]);
    const reservation = await pool.query(
      `INSERT INTO equipment_reservations (equipment_id, event_id, quantity) VALUES ($1, $2, 2) RETURNING id`,
      [item.rows[0].id, eventRef.id]);
    return { venueName: venue.rows[0].name, equipmentName: item.rows[0].name, bookingId: booking.rows[0].id, reservationId: reservation.rows[0].id };
  }

  // US-021: one confirmed venue booking in its own venue, so an event can have several.
  async function venueBooking(eventRef, coordinator, label) {
    const venue = await pool.query(`INSERT INTO venues (name, capacity) VALUES ($1, 200) RETURNING id, name`, [`E2E ${label} ${run}`]);
    venues.push(venue.rows[0].id);
    const booking = await pool.query(
      `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING id`,
      [eventRef.id, venue.rows[0].id, coordinator.id, sgt('2099-03-01', '09:00'), sgt('2099-03-01', '12:00')]);
    return { venueName: venue.rows[0].name, bookingId: booking.rows[0].id };
  }

  async function changeRequest(eventRef, organiser, proposed) {
    const { rows } = await pool.query(
      `INSERT INTO event_change_requests (event_id, organiser_id, proposed_changes) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [eventRef.id, organiser.id, JSON.stringify(proposed)]);
    return rows[0].id;
  }

  const row = async (sql, params) => (await pool.query(sql, params)).rows[0];

  async function cleanup() {
    if (events.length) await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [events]); // cascades to requests, bookings, reservations
    if (venues.length) await pool.query('DELETE FROM venues WHERE id = ANY($1::uuid[])', [venues]);
    if (equipment.length) await pool.query('DELETE FROM equipment WHERE id = ANY($1::uuid[])', [equipment]);
    if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  }

  return { run, user, event, arrangements, venueBooking, changeRequest, row, cleanup, sgt };
}

module.exports = { pool, createFixtures };
