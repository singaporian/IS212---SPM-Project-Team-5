const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { EventRequest, ChangeRequest } = require('./domain');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANGEABLE_FIELDS = ['preferredStart', 'preferredEnd', 'expectedAttendance', 'venueLayoutPreference', 'equipmentRequirements'];

// AC-008-002: Date, Time, Expected Attendance, Venue Requirements, Equipment Requirements.
// Every field is optional (a change request may touch just one of them), but at
// least one must be present, and each provided field must be individually valid.
function parseChangeRequestInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Invalid change request.'), { status: 400 });
  }
  const unknown = Object.keys(body).filter((key) => !CHANGEABLE_FIELDS.includes(key));
  if (unknown.length) throw Object.assign(new Error(`Unknown field: ${unknown[0]}`), { status: 400 });

  const changes = {};

  if (body.preferredStart !== undefined || body.preferredEnd !== undefined) {
    const start = new Date(body.preferredStart);
    const end = new Date(body.preferredEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw Object.assign(new Error('Enter a valid start and end date/time.'), { status: 400 });
    }
    if (end <= start) throw Object.assign(new Error('End time must be later than start time.'), { status: 400 });
    changes.preferredStart = start.toISOString();
    changes.preferredEnd = end.toISOString();
  }

  if (body.expectedAttendance !== undefined) {
    const attendance = Number(body.expectedAttendance);
    if (!Number.isInteger(attendance) || attendance <= 0) {
      throw Object.assign(new Error('Expected attendance must be a positive whole number.'), { status: 400 });
    }
    changes.expectedAttendance = attendance;
  }

  if (body.venueLayoutPreference !== undefined) {
    const value = String(body.venueLayoutPreference).trim();
    if (!value || value.length > 2000) {
      throw Object.assign(new Error('Venue requirements must be 1-2000 characters.'), { status: 400 });
    }
    changes.venueLayoutPreference = value;
  }

  if (body.equipmentRequirements !== undefined) {
    if (!Array.isArray(body.equipmentRequirements)) {
      throw Object.assign(new Error('Equipment requirements must be a list.'), { status: 400 });
    }
    const items = body.equipmentRequirements.map((item) => String(item).trim()).filter(Boolean);
    if (items.length > 50) throw Object.assign(new Error('Too many equipment items (maximum 50).'), { status: 400 });
    changes.equipmentRequirements = items;
  }

  if (Object.keys(changes).length === 0) {
    throw Object.assign(new Error('Propose at least one change.'), { status: 400 });
  }
  return changes;
}

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('event_organiser'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// AC-008-001 through AC-008-005.
router.post('/:id/change-requests', async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
  let changes;
  try { changes = parseChangeRequestInput(req.body); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  try {
    const eventResult = await db.query(
      `SELECT id, title, status, organiser_id, assigned_coordinator_id FROM events WHERE id = $1 AND organiser_id = $2`,
      [req.params.id, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found.' });
    const event = EventRequest.fromRow(eventResult.rows[0]);

    if (!event.canRequestChanges()) {
      return res.status(409).json({ error: 'This event has not been submitted yet.' });
    }

    const crResult = await db.query(
      `INSERT INTO event_change_requests (event_id, organiser_id, proposed_changes)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, event_id, organiser_id, proposed_changes, status, created_at`,
      [event.id, req.auth.sub, JSON.stringify(changes)]
    );
    const changeRequest = ChangeRequest.fromRow(crResult.rows[0]);

    if (event.assignedCoordinatorId) {                          // AC-008-003
      await db.query(
        `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
        [event.assignedCoordinatorId, event.id, `A change request was submitted for "${event.title}" and needs your review.`]
      );
    }

    res.status(201).json(changeRequest.toJSON());                // AC-008-005: frontend turns this into the confirmation
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to submit change request. Please retry.' });
  }
});

// Feeds the Organiser's own-requests list on the Events page.
router.get('/mine', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, status, created_at
       FROM events WHERE organiser_id = $1 AND status != 'draft' ORDER BY created_at DESC`,
      [req.auth.sub]
    );
    res.json(result.rows.map((row) => EventRequest.fromRow(row).toJSON()));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load your event requests. Please retry.' });
  }
});

module.exports = { router, parseChangeRequestInput };