const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { EventRequest, Venue, Booking } = require('./domain');

dotenv.config();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/api/drafts', require('./drafts').router);
app.use('/api/equipment', require('./equipment').router);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    res.status(201).json(await auth.register(req.body));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    res.json(await auth.login(req.body));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Login failed' });
  }
});

app.get('/api/auth/me', auth.authenticate, async (req, res) => {
  const result = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.auth.sub]);
  if (!result.rows[0]) return res.status(401).json({ error: 'User no longer exists' });
  res.json({ user: result.rows[0] });
});

// Aggregate venue count is safe to show on authenticated dashboards; venue details remain role-restricted below.
app.get('/api/venues/count', auth.authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*)::int AS count FROM venues');
    res.json({ count: result.rows[0].count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to count venues' });
  }
});

app.get('/api/venues', auth.authenticate, auth.requireRoles('event_coordinator', 'venue_staff'), async (req, res) => {
  try {
    const {
      search,
      date,
      startTime,
      endTime,
      attendance,
      layout,
      facility,
      accessibility,
      setupMinutes = '30',
      turnaroundMinutes = '30'
    } = req.query;
    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(v.name ILIKE $${params.length} OR v.location ILIKE $${params.length})`);
    }
    if (attendance) {
      params.push(Number(attendance));
      filters.push(`v.capacity >= $${params.length}`);
    }
    const layouts = (Array.isArray(layout) ? layout : layout ? [layout] : []).filter(Boolean);
    if (layouts.length) {
      params.push(layouts);
      filters.push(`v.supported_layouts ?| $${params.length}::text[]`);
    }
    const facilities = (Array.isArray(facility) ? facility : facility ? [facility] : []).filter(Boolean);
    if (facilities.length) {
      params.push(facilities);
      filters.push(`v.facilities ?| $${params.length}::text[]`);
    }
    const accessibilityNeeds = (Array.isArray(accessibility) ? accessibility : accessibility ? [accessibility] : []).filter(Boolean);
    if (accessibilityNeeds.length) {
      params.push(accessibilityNeeds);
      filters.push(`v.accessibility ?| $${params.length}::text[]`);
    }

    let dateParam;
    if (date) {
      params.push(date);
      dateParam = params.length;
      filters.push(`$${dateParam}::date BETWEEN v.available_from AND v.available_until`);
    }

    const hasDate = Boolean(date);
    const hasTime = Boolean(startTime || endTime);
    if (hasDate && hasTime && (!startTime || !endTime)) {
      return res.status(400).json({ error: 'Both startTime and endTime are required when filtering by time' });
    }
    if (hasTime && !hasDate) {
      return res.status(400).json({ error: 'Date is required when filtering by time' });
    }
    if (hasTime && endTime <= startTime) {
      return res.status(400).json({ error: 'End time must be later than start time' });
    }
    if (hasDate && hasTime) {
      const startExpression = hasTime ? `${date} ${startTime}+08:00` : `${date} 00:00+08:00`;
      const endExpression = hasTime ? `${date} ${endTime}+08:00` : `${date} 24:00+08:00`;
      params.push(startExpression, endExpression, Number(setupMinutes), Number(turnaroundMinutes));
      const startParam = params.length - 3;
      const endParam = params.length - 2;
      const setupParam = params.length - 1;
      const turnaroundParam = params.length;
      filters.push(`EXISTS (
        SELECT 1 FROM venue_operating_hours voh
        WHERE voh.venue_id = v.id
          AND voh.day_of_week = EXTRACT(DOW FROM ($${startParam}::timestamptz AT TIME ZONE 'Asia/Singapore'))
          AND voh.opens_at <= (($${startParam}::timestamptz AT TIME ZONE 'Asia/Singapore')::time)
          AND voh.closes_at >= (($${endParam}::timestamptz AT TIME ZONE 'Asia/Singapore')::time)
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.venue_id = v.id
          AND b.status = 'confirmed'
          AND b.start_time - (b.setup_minutes * interval '1 minute') < ($${endParam}::timestamptz + ($${turnaroundParam} * interval '1 minute'))
          AND b.end_time + (b.turnaround_minutes * interval '1 minute') > ($${startParam}::timestamptz - ($${setupParam} * interval '1 minute'))
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM venue_unavailabilities vu
        WHERE vu.venue_id = v.id
          AND vu.start_time < ($${endParam}::timestamptz + ($${turnaroundParam} * interval '1 minute'))
          AND vu.end_time > ($${startParam}::timestamptz - ($${setupParam} * interval '1 minute'))
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const unavailablePeriods = hasDate ? `(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'start_time', vu.start_time,
          'end_time', vu.end_time,
          'reason', vu.reason
        ) ORDER BY vu.start_time), '[]'::jsonb)
        FROM venue_unavailabilities vu
        WHERE vu.venue_id = v.id
          AND vu.start_time < (($${dateParam}::date::text || ' 00:00:00+08:00')::timestamptz + interval '1 day')
          AND vu.end_time > ($${dateParam}::date::text || ' 00:00:00+08:00')::timestamptz
      ) AS unavailable_periods,` : "'[]'::jsonb AS unavailable_periods,";
    const result = await db.query(
      `SELECT id, name, location, capacity, facilities, accessibility, supported_layouts,
        ${unavailablePeriods}
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', vi.id,
          'url', vi.image_url,
          'alt_text', vi.alt_text,
          'is_primary', vi.is_primary
        ) ORDER BY vi.is_primary DESC, vi.sort_order, vi.created_at), '[]'::jsonb)
         FROM venue_images vi WHERE vi.venue_id = v.id) AS images
       FROM venues v ${where} ORDER BY name LIMIT 100`,
      params
    );
    res.json(result.rows.map((row) => new Venue({
      ...row,
      supportedLayouts: row.supported_layouts,
      unavailablePeriods: row.unavailable_periods
    }).toJSON()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

// US-011: unassigned queue (submitted, no coordinator yet), oldest first
app.get('/api/events/unassigned', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, status, created_at
       FROM events
       WHERE status = 'submitted' AND assigned_coordinator_id IS NULL
       ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch unassigned requests' });
  }
});

// US-012: requests currently assigned to the logged-in coordinator
app.get('/api/events/assigned', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, status, created_at
       FROM events
       WHERE assigned_coordinator_id = $1
       ORDER BY created_at DESC`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assigned requests' });
  }
});

// US-011: assign an unassigned request to self (fails gracefully if already taken)
app.patch('/api/events/:id/assign', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE events SET assigned_coordinator_id = $1
       WHERE id = $2 AND status = 'submitted' AND assigned_coordinator_id IS NULL
       RETURNING id, title, assigned_coordinator_id`,
      [req.auth.sub, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(409).json({ error: 'This request has already been assigned' });
    }
    const request = EventRequest.fromRow(result.rows[0]);
    res.json({ id: request.id, title: request.title, assigned_coordinator_id: request.assignedCoordinatorId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign request' });
  }
});

// US-011: release a request back to the unassigned queue
app.patch('/api/events/:id/unassign', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE events SET assigned_coordinator_id = NULL
       WHERE id = $1 AND assigned_coordinator_id = $2
       RETURNING id, title`,
      [req.params.id, req.auth.sub]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Request not found or not assigned to you' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unassign request' });
  }
});

// US-012: full read-only detail, only visible if assigned to this coordinator
app.get('/api/events/:id', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM events WHERE id = $1 AND assigned_coordinator_id = $2`,
      [req.params.id, req.auth.sub]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'Not authorised to view this request' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch request details' });
  }
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBookingInput(body) {
  const startTime = new Date(body.startTime);
  const endTime = new Date(body.endTime);
  const setupMinutes = Number(body.setupMinutes ?? 30);
  const turnaroundMinutes = Number(body.turnaroundMinutes ?? 30);
  if (!uuidPattern.test(body.eventId || '') || !uuidPattern.test(body.venueId || '')) throw Object.assign(new Error('A valid event and venue are required'), { status: 400 });
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || endTime <= startTime) throw Object.assign(new Error('End time must be later than start time'), { status: 400 });
  if (!Number.isInteger(setupMinutes) || setupMinutes < 0 || !Number.isInteger(turnaroundMinutes) || turnaroundMinutes < 0) throw Object.assign(new Error('Setup and turnaround times must be non-negative whole minutes'), { status: 400 });
  const venueRequirements = body.venueRequirements && typeof body.venueRequirements === 'object' && !Array.isArray(body.venueRequirements) ? body.venueRequirements : {};
  return { startTime, endTime, setupMinutes, turnaroundMinutes, venueRequirements, acknowledgeConflict: body.acknowledgeConflict === true };
}

// US-015: create a pending venue booking request for an event assigned to this coordinator.
app.post('/api/bookings/requests', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  let input;
  try { input = parseBookingInput(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  try {
    const eventResult = await db.query(
      `SELECT id, title FROM events WHERE id = $1 AND assigned_coordinator_id = $2 AND status = 'submitted'`,
      [req.body.eventId, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found or not assigned to you' });
    const venueResult = await db.query('SELECT id, name FROM venues WHERE id = $1', [req.body.venueId]);
    if (!venueResult.rows[0]) return res.status(404).json({ error: 'Venue not found' });

    const conflicts = await db.query(
      `SELECT b.id, b.start_time, b.end_time, b.status, b.setup_minutes, b.turnaround_minutes,
              v.name AS venue_name, e.title AS event_title
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       LEFT JOIN events e ON e.id = b.event_id
       WHERE b.venue_id = $1
         AND b.status IN ('pending', 'approved', 'confirmed')
         AND b.start_time - (b.setup_minutes * interval '1 minute') < $3::timestamptz + ($5 * interval '1 minute')
         AND b.end_time + (b.turnaround_minutes * interval '1 minute') > $2::timestamptz - ($4 * interval '1 minute')
       ORDER BY b.start_time ASC`,
      [req.body.venueId, input.startTime.toISOString(), input.endTime.toISOString(), input.setupMinutes, input.turnaroundMinutes]
    );
    const conflictDetails = conflicts.rows.map((conflict) => ({
      booking_id: conflict.id,
      event_title: conflict.event_title || 'Existing booking',
      venue_name: conflict.venue_name,
      start_time: conflict.start_time,
      end_time: conflict.end_time,
      status: conflict.status
    }));
    if (conflictDetails.length && !input.acknowledgeConflict) {
      return res.status(409).json({ error: 'Booking conflict requires acknowledgement', conflicts: conflictDetails });
    }

    const bookingResult = await db.query(
      `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status,
                            setup_minutes, turnaround_minutes, venue_requirements,
                            conflict_warning, conflict_details)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8::jsonb, $9, $10::jsonb)
       RETURNING id, event_id, venue_id, start_time, end_time, status, setup_minutes,
                 turnaround_minutes, venue_requirements, conflict_warning, conflict_details, created_at`,
      [req.body.eventId, req.body.venueId, req.auth.sub, input.startTime.toISOString(), input.endTime.toISOString(), input.setupMinutes, input.turnaroundMinutes, JSON.stringify(input.venueRequirements), conflictDetails.length > 0, JSON.stringify(conflictDetails)]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'venue_staff'`,
      [req.body.eventId, `New venue booking request for ${eventResult.rows[0].title} at ${venueResult.rows[0].name}`]
    );
    res.status(201).json(bookingResult.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to submit booking request. Your fields are still available; please retry.' });
  }
});

// Coordinator view of their submitted venue booking requests.
app.get('/api/bookings/mine', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  const result = await db.query(
    `SELECT b.*, v.name AS venue_name, e.title AS event_title
     FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN events e ON e.id = b.event_id
     WHERE b.requested_by = $1 ORDER BY b.created_at DESC`,
    [req.auth.sub]
  );
  res.json(result.rows);
});

// Venue Staff review queue and decision endpoint.
app.get('/api/bookings/pending', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  const result = await db.query(
    `SELECT b.*, v.name AS venue_name, e.title AS event_title, u.name AS coordinator_name, u.email AS coordinator_email
     FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN events e ON e.id = b.event_id
     LEFT JOIN users u ON u.id = b.requested_by
     WHERE b.status = 'pending' ORDER BY b.created_at ASC`
  );
  res.json(result.rows);
});

app.patch('/api/bookings/:id/decision', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  const { decision, reason = '', comment = '', alternativeStartTime, alternativeEndTime } = req.body;
  if (!['approved', 'rejected', 'alternative_suggested'].includes(decision)) return res.status(400).json({ error: 'Invalid booking decision' });
  if (decision === 'rejected' && !reason.trim()) return res.status(400).json({ error: 'A rejection reason is required' });
  if (decision === 'alternative_suggested' && (!alternativeStartTime || !alternativeEndTime)) return res.status(400).json({ error: 'An alternative start and end time are required' });
  try {
    const result = await db.query(
      `UPDATE bookings SET status = $1, decision_reason = $2, decision_comment = $3,
             alternative_start_time = $4, alternative_end_time = $5, decided_by = $6, decided_at = now()
       WHERE id = $7 AND status = 'pending'
       RETURNING id, event_id, status, decision_reason, decision_comment, alternative_start_time, alternative_end_time, decided_at`,
      [decision, reason.trim() || null, comment.trim() || null, alternativeStartTime || null, alternativeEndTime || null, req.auth.sub, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pending booking request not found' });
    const resultRow = result.rows[0];
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT requested_by, event_id, $1 FROM bookings WHERE id = $2`,
      [`Venue booking request ${decision.replace('_', ' ')}${reason ? `: ${reason}` : ''}`, req.params.id]
    );
    res.json(resultRow);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save booking decision. Please retry.' });
  }
});

const SUPPORT_EQUIPMENT_TYPES = Object.freeze(['Audio', 'Video & Display', 'Lighting', 'Staging', 'Networking', 'Power & Cabling', 'Furniture', 'Other']);

function validateSupportRequirements(body) {
  const equipment = Array.isArray(body.equipment) ? body.equipment : [];
  const seen = new Set();
  const normalizedEquipment = equipment.map((item) => {
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const quantity = Number(item.quantity);
    const details = typeof item.details === 'string' ? item.details.trim() : '';
    if (!SUPPORT_EQUIPMENT_TYPES.includes(type)) throw Object.assign(new Error('Choose a valid equipment type'), { status: 400 });
    if (seen.has(type)) throw Object.assign(new Error('Each equipment type may only be listed once'), { status: 400 });
    if (!Number.isInteger(quantity) || quantity <= 0) throw Object.assign(new Error('Equipment quantities must be positive whole numbers'), { status: 400 });
    if (details.length > 500) throw Object.assign(new Error('Equipment details must be at most 500 characters'), { status: 400 });
    if (type === 'Other' && !details) throw Object.assign(new Error('Describe the equipment when using Other'), { status: 400 });
    seen.add(type);
    return { type, quantity, ...(details ? { details } : {}) };
  });
  const staffRequired = Number(body.staffRequired);
  if (!Number.isInteger(staffRequired) || staffRequired < 0) throw Object.assign(new Error('Number of staff must be a non-negative whole number'), { status: 400 });
  return { equipment: normalizedEquipment, staffRequired };
}

// US-016: save or replace the latest technical support requirements for an assigned event.
app.put('/api/events/:id/technical-support', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  let requirements;
  try { requirements = validateSupportRequirements(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  try {
    const eventResult = await db.query(
      `SELECT id, title, preferred_start FROM events
       WHERE id = $1 AND assigned_coordinator_id = $2 AND status NOT IN ('completed', 'cancelled', 'rejected')`,
      [req.params.id, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found or not assigned to you' });
    const event = eventResult.rows[0];
    const lateRequest = event.preferred_start ? new Date() >= new Date(event.preferred_start) : false;
    const existingRequirement = await db.query('SELECT id FROM technical_support_requirements WHERE event_id = $1', [req.params.id]);
    const result = await db.query(
      `INSERT INTO technical_support_requirements (event_id, equipment_requirements, staff_required, late_request, updated_by)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET equipment_requirements = EXCLUDED.equipment_requirements,
         staff_required = EXCLUDED.staff_required, late_request = EXCLUDED.late_request,
         updated_by = EXCLUDED.updated_by, updated_at = now(), update_count = technical_support_requirements.update_count + 1
       RETURNING id, event_id, equipment_requirements, staff_required, late_request, update_count, updated_at`,
      [req.params.id, JSON.stringify(requirements.equipment), requirements.staffRequired, lateRequest, req.auth.sub]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'technical_support_staff'`,
      [req.params.id, `Technical support requirements updated for ${event.title}${lateRequest ? ' (late request)' : ''}`]
    );
    res.json({ ...result.rows[0], updated: existingRequirement.rows.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save technical support requirements. Your input is still available; please retry.' });
  }
});

app.get('/api/events/:id/technical-support', auth.authenticate, async (req, res) => {
  try {
    const eventAccess = await db.query(
      `SELECT id, title, assigned_coordinator_id FROM events WHERE id = $1`,
      [req.params.id]
    );
    if (!eventAccess.rows[0]) return res.status(404).json({ error: 'Event not found' });
    const event = eventAccess.rows[0];
    const isCoordinator = req.auth.role === 'event_coordinator' && event.assigned_coordinator_id === req.auth.sub;
    const isTechSupport = req.auth.role === 'technical_support_staff';
    if (!isCoordinator && !isTechSupport) return res.status(403).json({ error: 'You do not have permission to view these requirements' });
    const result = await db.query(
      `SELECT tsr.*, e.title AS event_title FROM technical_support_requirements tsr
       JOIN events e ON e.id = tsr.event_id WHERE tsr.event_id = $1`,
      [req.params.id]
    );
    res.json(result.rows[0] || { event_id: req.params.id, event_title: event.title, equipment_requirements: [], staff_required: 0, late_request: false, updated: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load technical support requirements' });
  }
});

app.get('/api/technical-support/requirements', auth.authenticate, auth.requireRoles('technical_support_staff'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tsr.*, (tsr.update_count > 0) AS updated, e.title AS event_title, e.preferred_start, e.preferred_end
       FROM technical_support_requirements tsr JOIN events e ON e.id = tsr.event_id
       ORDER BY e.preferred_start NULLS LAST, tsr.updated_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load technical support requirements' });
  }
});

app.get('/api/technical-support/my-requirements', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tsr.*, (tsr.update_count > 0) AS updated, e.title AS event_title, e.preferred_start, e.preferred_end
       FROM technical_support_requirements tsr JOIN events e ON e.id = tsr.event_id
       WHERE e.assigned_coordinator_id = $1
       ORDER BY tsr.updated_at DESC`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load your technical support requirements' });
  }
});

// dev-only: run schema SQL via HTTP (idempotent if schema includes IF NOT EXISTS)
app.post('/api/init', async (req, res) => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await db.pool.query(sql);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'init failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend listening on port ${port}`));
