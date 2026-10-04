const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { EventRequest, ChangeRequest, MAJOR_CHANGE_LABELS } = require('./domain');

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
    if ([start, end].some((d) => d.getUTCMinutes() % 5 !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0)) {
      throw Object.assign(new Error('Choose a time in five-minute intervals.'), { status: 400 });
    }
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

// US-010 (AC-010-003): explanation shown when a request contains a major change.
function majorChangeResponse(major) {
  const names = major.map((key) => MAJOR_CHANGE_LABELS[key]).join(' and ');
  return {
    error: `${names} changes can't be made through a change request. The event must be cancelled and resubmitted.`,
    code: 'MAJOR_CHANGE',
    majorChanges: major
  };
}

// US-010 (AC-010-004): copy the proposed changes into the new draft's form fields.
function toSingaporeParts(iso) {
  const local = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function applyChangesToDraft(draftData, changes) {
  const next = { ...(draftData || {}) };
  if (changes.preferredStart !== undefined) {
    const start = toSingaporeParts(changes.preferredStart);
    const end = toSingaporeParts(changes.preferredEnd);
    Object.assign(next, { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time });
  }
  if (changes.expectedAttendance !== undefined) next.expectedAttendance = String(changes.expectedAttendance);
  if (changes.venueLayoutPreference !== undefined) next.venueRequirements = changes.venueLayoutPreference;
  if (changes.equipmentRequirements !== undefined) next.equipmentRequirements = changes.equipmentRequirements.join(', ');
  return next;
}

const router = express.Router();
const organiserOnly = [auth.authenticate, auth.requireRoles('event_organiser')];
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });


router.post('/:id/change-requests', ...organiserOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
  let changes;
  try { changes = parseChangeRequestInput(req.body); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  try {
    const eventResult = await db.query(
      `SELECT id, title, status, organiser_id, assigned_coordinator_id, expected_attendance, preferred_start, preferred_end
       FROM events WHERE id = $1 AND organiser_id = $2`,
      [req.params.id, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found.' });
    const event = EventRequest.fromRow(eventResult.rows[0]);

    if (!event.canRequestChanges()) {
      return res.status(409).json({ error: 'Change requests can only be made after your event is approved. Until then, edit the request directly." ' });
    }

   // US-010 (AC-010-002): one major aspect makes the whole request major; nothing is saved.
    const major = event.majorChangesIn(changes);
    if (major.length) return res.status(422).json(majorChangeResponse(major));

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

// US-010 (AC-010-004): the Organiser chose to proceed with a major change.
// In one transaction: cancel the approved event, open a new draft pre-filled with the
// old details plus the proposed changes, record why, and tell the Coordinator.
router.post('/:id/cancel-and-resubmit', ...organiserOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
  let changes;
  try { changes = parseChangeRequestInput(req.body); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM events WHERE id = $1 AND organiser_id = $2 FOR UPDATE`, [req.params.id, req.auth.sub]);
    const row = found.rows[0];
    if (!row) throw Object.assign(new Error('Event not found.'), { status: 404 });
    const event = EventRequest.fromRow(row);
    if (!event.canRequestChanges()) {
      throw Object.assign(new Error('Only approved events can be cancelled and resubmitted.'), { status: 409 });
    }
    const major = event.majorChangesIn(changes);
    if (!major.length) {
      throw Object.assign(new Error('These changes are not major. Submit them as a change request instead.'), { status: 400 });
    }

    await client.query(`UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1`, [event.id]);
    const draft = await client.query(
      `INSERT INTO events (organiser_id, title, draft_data, status) VALUES ($1, $2, $3::jsonb, 'draft') RETURNING id`,
      [req.auth.sub, event.title, JSON.stringify(applyChangesToDraft(row.draft_data, changes))]);
    const draftId = draft.rows[0].id;
    const labels = major.map((key) => MAJOR_CHANGE_LABELS[key]).join(' and ');
    await client.query(
      `INSERT INTO event_changes (event_id, changed_by, change_summary) VALUES ($1, $2, $3)`,
      [event.id, req.auth.sub, `Cancelled by the organiser for a major change (${labels}). Resubmitting as draft ${draftId}.`]);
    if (event.assignedCoordinatorId) {
      await client.query(
        `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
        [event.assignedCoordinatorId, event.id, `"${event.title}" was cancelled by the organiser because of a major change (${labels}). A new request will be resubmitted.`]);
    }
    await client.query('COMMIT');
    res.status(201).json({ cancelledEventId: event.id, draftId, majorChanges: major });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to cancel and resubmit. Nothing was changed. Please retry.' });
  } finally {
    if (client) client.release();
  }
});

// Feeds the Organiser's own-requests list on the Events page.
router.get('/mine', ...organiserOnly, async (req, res) => {
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

module.exports = { router, parseChangeRequestInput, applyChangesToDraft };