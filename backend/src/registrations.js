const express = require('express');
const db = require('./db');
const auth = require('./auth');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts digits with optional leading +, spaces, dashes or parentheses; 7-15 digits overall.
const PHONE_PATTERN = /^\+?[\d\s()-]{7,20}$/;

function fieldError(field, message) {
  return Object.assign(new Error(message), { status: 400, fields: { [field]: message } });
}

// US-029 (AC-029-002/003): name, phone, email are required to register, and must be valid.
function validateRegistrationInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!name) throw fieldError('name', 'Enter your name.');
  if (!email || !EMAIL_PATTERN.test(email)) throw fieldError('email', 'Enter a valid email address.');
  if (!phone || !PHONE_PATTERN.test(phone) || phone.replace(/\D/g, '').length < 7) {
    throw fieldError('phone', 'Enter a valid phone number.');
  }
  return { name, phone, email };
}

// US-029 (AC-029-001/007/008): an event is open for registration only when it's confirmed,
// marked as requiring registration, and (if a window/capacity is set) within that window and
// under capacity. Returns { open: boolean, reason } so callers can show why it's blocked.
async function registrationWindowStatus(query, event, registeredCount) {
  if (event.status !== 'confirmed') return { open: false, reason: 'This event is not yet confirmed.' };
  if (!event.registration_required) return { open: false, reason: 'This event does not take attendee registration.' };
  const now = new Date();
  if (event.registration_opens_at && now < new Date(event.registration_opens_at)) {
    return { open: false, reason: `Registration opens ${new Date(event.registration_opens_at).toLocaleString()}.` };
  }
  if (event.registration_closes_at && now > new Date(event.registration_closes_at)) {
    return { open: false, reason: `Registration closed ${new Date(event.registration_closes_at).toLocaleString()}.` };
  }
  if (event.registration_capacity != null && registeredCount >= event.registration_capacity) {
    return { open: false, reason: 'This event has reached its registration capacity.' };
  }
  return { open: true, reason: null };
}

const router = express.Router();
const attendeeOnly = [auth.authenticate, auth.requireRoles('attendee')];
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// US-028/US-029: confirmed events open (or previously open) for attendee registration, with
// each event's current registration status and the signed-in Attendee's own registration, if any.
router.get('/registrable', ...attendeeOnly, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.id, e.title, e.purpose, e.event_type, e.preferred_start, e.preferred_end,
              e.registration_required, e.registration_capacity, e.registration_opens_at, e.registration_closes_at,
              e.status,
              v.name AS venue_name, v.location AS venue_location,
              (SELECT COUNT(*)::int FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') AS registered_count,
              (SELECT r.id FROM registrations r WHERE r.event_id = e.id AND r.attendee_id = $1 AND r.status = 'registered') AS my_registration_id
       FROM events e
       LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'confirmed'
       LEFT JOIN venues v ON v.id = b.venue_id
       WHERE e.status = 'confirmed' AND e.registration_required = true
       ORDER BY e.preferred_start ASC NULLS LAST`,
      [req.auth.sub]
    );
    const events = await Promise.all(result.rows.map(async (row) => {
      const windowStatus = await registrationWindowStatus(db.query, row, row.registered_count);
      return {
        id: row.id,
        title: row.title,
        purpose: row.purpose,
        event_type: row.event_type,
        preferred_start: row.preferred_start,
        preferred_end: row.preferred_end,
        venue_name: row.venue_name,
        venue_location: row.venue_location,
        registration_capacity: row.registration_capacity,
        registration_opens_at: row.registration_opens_at,
        registration_closes_at: row.registration_closes_at,
        registered_count: row.registered_count,
        registration_open: windowStatus.open,
        registration_closed_reason: windowStatus.open ? null : windowStatus.reason,
        my_registration_id: row.my_registration_id || null
      };
    }));
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load events open for registration' });
  }
});

// US-029: register the signed-in Attendee for a confirmed event.
router.post('/:id/register', ...attendeeOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
  let input;
  try { input = validateRegistrationInput(req.body); }
  catch (error) {
    return res.status(error.status || 400).json({ error: error.message, fields: error.fields || {} });
  }
  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found.' });
    const event = eventResult.rows[0];

    const existing = await db.query(
      `SELECT id FROM registrations WHERE event_id = $1 AND attendee_id = $2 AND status = 'registered'`,
      [req.params.id, req.auth.sub]
    );
    if (existing.rows[0]) return res.status(409).json({ error: 'You are already registered for this event.' });

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM registrations WHERE event_id = $1 AND status = 'registered'`,
      [req.params.id]
    );
    const windowStatus = await registrationWindowStatus(db.query, event, countResult.rows[0].count);
    if (!windowStatus.open) return res.status(409).json({ error: windowStatus.reason });

    const result = await db.query(
      `INSERT INTO registrations (event_id, attendee_id, name, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, 'registered')
       RETURNING id, event_id, name, phone, email, status, created_at, updated_at`,
      [req.params.id, req.auth.sub, input.name, input.phone, input.email]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
      [req.auth.sub, req.params.id, `You're registered for "${event.title}".`]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'You are already registered for this event.' });
    console.error(error);
    res.status(500).json({ error: 'Unable to register for this event. Please retry.' });
  }
});

// US-029 (AC-029-005): the Attendee's own registration status for an event.
router.get('/:id/registration', ...attendeeOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
  try {
    const result = await db.query(
      `SELECT id, event_id, name, phone, email, status, created_at, updated_at
       FROM registrations WHERE event_id = $1 AND attendee_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, req.auth.sub]
    );
    res.json(result.rows[0] || null);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load your registration status' });
  }
});

// US-030: withdraw an active registration. A confirmation prompt is a frontend concern;
// this endpoint performs the withdrawal once the Attendee has confirmed.
router.patch('/registrations/:id/withdraw', ...attendeeOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Registration not found.' });
  try {
    const registrationResult = await db.query(
      `SELECT r.*, e.title AS event_title, e.preferred_start
       FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE r.id = $1 AND r.attendee_id = $2`,
      [req.params.id, req.auth.sub]
    );
    const registration = registrationResult.rows[0];
    if (!registration) return res.status(404).json({ error: 'Registration not found.' });
    if (registration.status !== 'registered') {
      return res.status(409).json({ error: 'This registration has already been withdrawn.' });
    }
    if (registration.preferred_start && new Date(registration.preferred_start) <= new Date()) {
      return res.status(409).json({ error: 'Withdrawal is not permitted once the event has started.' });
    }
    const result = await db.query(
      `UPDATE registrations SET status = 'withdrawn', updated_at = now()
       WHERE id = $1
       RETURNING id, event_id, name, phone, email, status, created_at, updated_at`,
      [req.params.id]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
      [req.auth.sub, registration.event_id, `You've withdrawn your registration for "${registration.event_title}".`]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to withdraw your registration. Please retry.' });
  }
});

module.exports = { router, validateRegistrationInput, registrationWindowStatus };
