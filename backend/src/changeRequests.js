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
      return res.status(409).json({ error: 'Change requests can only be made after your event is approved. Until then, edit the request directly.' });
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

    if (event.assignedCoordinatorId) {    // AC-008-003
      await db.query(
        `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
        [event.assignedCoordinatorId, event.id, `A change request was submitted for "${event.title}" and needs your review.`]
      );
    }

    // US-027: if the proposed change touches date/time/equipment, notify Tech Support Staff with equipment reserved for this event.
    const touchesRelevantFields = Object.keys(changes).some((key) =>
      ['preferredStart', 'preferredEnd', 'equipmentRequirements'].includes(key)
    );
    if (touchesRelevantFields) {
      const reservedStaff = await db.query(
        `SELECT DISTINCT reserved_by FROM equipment_reservations WHERE event_id = $1 AND reserved_by IS NOT NULL`,
        [event.id]
      );
      for (const row of reservedStaff.rows) {
        await db.query(
          `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
          [row.reserved_by, event.id, `An important change was requested for "${event.title}" (date, time, or equipment). Please review your reservation.`]
        );
      }
    }

    res.status(201).json(changeRequest.toJSON());     // AC-008-005: frontend turns this into the confirmation
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
    // US-027: capture who had equipment reserved before the reservations are removed, so they can be notified.
    const reservedStaff = await client.query(
      `SELECT DISTINCT reserved_by FROM equipment_reservations WHERE event_id = $1 AND reserved_by IS NOT NULL`,
      [event.id]
    );
    // US-023: a cancelled event's equipment goes straight back to available stock.
    await client.query('DELETE FROM equipment_reservations WHERE event_id = $1', [event.id]);
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
    // US-027: notify any Technical Support Staff who had equipment reserved for this event.
    for (const staffRow of reservedStaff.rows) {
      await client.query(
        `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
        [staffRow.reserved_by, event.id, `"${event.title}" has been cancelled. Please clear or reassign your equipment reservations for this event.`]
      );
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

// ---------- US-032: the assigned Event Coordinator reviews and processes change requests ----------

const coordinatorOnly = [auth.authenticate, auth.requireRoles('event_coordinator')];
const DECISIONS = ['approved', 'rejected'];

// AC-032-002: a decision is either an approval or a rejection.
function parseChangeRequestDecision(body) {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body.decision : undefined;
  const decision = typeof raw === 'string' ? raw.trim() : '';
  if (!DECISIONS.includes(decision)) {
    throw Object.assign(new Error('Choose to approve or reject the change request.'), { status: 400 });
  }
  return { decision };
}

function currentValues(row) {
  return {
    preferredStart: row.preferred_start ? new Date(row.preferred_start).toISOString() : null,
    preferredEnd: row.preferred_end ? new Date(row.preferred_end).toISOString() : null,
    expectedAttendance: row.expected_attendance,
    venueLayoutPreference: row.venue_layout_preference,
    equipmentRequirements: row.equipment_requirements
  };
}

// Builds "UPDATE events SET ..." for the approved columns plus the organiser's draft copy. $1 is the event id.
function buildEventUpdate(columns, draft) {
  const names = Object.keys(columns);
  const assignments = names.map((name, i) => `${name} = $${i + 2}${name === 'equipment_requirements' ? '::jsonb' : ''}`);
  const values = names.map((name) => (name === 'equipment_requirements' ? JSON.stringify(columns[name]) : columns[name]));
  return {
    sql: `UPDATE events SET ${[...assignments, `draft_data = $${names.length + 2}::jsonb`, 'updated_at = now()'].join(', ')} WHERE id = $1`,
    values: [...values, JSON.stringify(draft)]
  };
}

// AC-032-001: pending requests for events assigned to the signed-in coordinator, with current values.
router.get('/change-requests/pending', ...coordinatorOnly, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cr.id, cr.event_id, cr.proposed_changes, cr.status, cr.created_at, e.title AS event_title,
              e.preferred_start, e.preferred_end, e.expected_attendance, e.venue_layout_preference, e.equipment_requirements
       FROM event_change_requests cr JOIN events e ON e.id = cr.event_id
       WHERE e.assigned_coordinator_id = $1 AND cr.status = 'pending'
       ORDER BY cr.created_at ASC`,
      [req.auth.sub]
    );
    res.json(result.rows.map((row) => ({
      ...ChangeRequest.fromRow(row).toJSON(),
      event_title: row.event_title,
      current: currentValues(row)
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load change requests. Please retry.' });
  }
});

// AC-032-002 to AC-032-007: approve or reject, all in one transaction.
router.patch('/change-requests/:id/decision', ...coordinatorOnly, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Change request not found.' });
  let decision;
  try { ({ decision } = parseChangeRequestDecision(req.body)); }
  catch (error) { return res.status(error.status).json({ error: error.message }); }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    // Lock the request and its event so two decisions cannot both succeed (AC-032-006).
    const found = await client.query(
      `SELECT cr.id, cr.event_id, cr.organiser_id, cr.proposed_changes, cr.status, cr.created_at,
              e.preferred_start, e.preferred_end, e.title, e.draft_data
       FROM event_change_requests cr JOIN events e ON e.id = cr.event_id
       WHERE cr.id = $1 AND e.assigned_coordinator_id = $2
       FOR UPDATE OF cr, e`,
      [req.params.id, req.auth.sub]
    );
    if (!found.rows[0]) throw Object.assign(new Error('Change request not found.'), { status: 404 });
    const changeRequest = ChangeRequest.fromRow(found.rows[0]);
    const event = EventRequest.fromRow({ ...found.rows[0], id: found.rows[0].event_id });
    if (!changeRequest.canBeDecided()) {
      throw Object.assign(new Error('This change request has already been processed.'), { status: 409 });
    }

    const reconsider = { bookings: [], equipment: [] };
    const moved = decision === 'approved' && changeRequest.movesEvent(event); // compare against the times before the update

    if (decision === 'approved') {
      // AC-032-004: write the approved values onto the event, and keep the organiser's
      // form copy (draft_data) in step using US-010's helper.
      const draft = applyChangesToDraft(found.rows[0].draft_data, changeRequest.proposedChanges);
      const update = buildEventUpdate(changeRequest.toEventColumns(), draft);
      await client.query(update.sql, [event.id, ...update.values]);
    }

    await client.query(
      `UPDATE event_change_requests SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3`,
      [decision, req.auth.sub, changeRequest.id]
    );

    if (moved) {
      // AC-032-005: identify, don't cancel. Status, times and quantities are left exactly as they were.
      const bookings = await client.query(
        `UPDATE bookings SET requires_reconsideration = true
         WHERE event_id = $1 AND status IN ('pending', 'approved', 'confirmed')
         RETURNING id, status, start_time, end_time, (SELECT name FROM venues WHERE venues.id = bookings.venue_id) AS venue_name`,
        [event.id]
      );
      const equipment = await client.query(
        `UPDATE equipment_reservations SET requires_reconsideration = true
         WHERE event_id = $1
         RETURNING id, quantity, (SELECT name FROM equipment WHERE equipment.id = equipment_reservations.equipment_id) AS equipment_name`,
        [event.id]
      );
      reconsider.bookings = bookings.rows;
      reconsider.equipment = equipment.rows;
    }

    await client.query(
      `INSERT INTO event_changes (event_id, changed_by, change_summary) VALUES ($1, $2, $3)`,
      [event.id, req.auth.sub, `Change request ${changeRequest.id} ${decision} by the event coordinator.`]
    );
    await client.query('COMMIT');
    res.json({ id: changeRequest.id, event_id: event.id, status: decision, reconsider });
  } catch (error) {
    // AC-032-007: nothing is kept from a failed decision, so the coordinator can simply retry.
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unable to save your decision. Nothing was changed. Please retry.'
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = { router, parseChangeRequestInput, applyChangesToDraft, parseChangeRequestDecision };