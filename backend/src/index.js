const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { activeHoldSql, holdConflicts, processHoldExpiries } = require('./holdAvailability');
const { Venue, Booking } = require('./domain');
const { occupiedInterval, overlaps, OCCUPYING_STATUSES } = require('./venueOccupancy');
const { promoteEventIfReady } = require('./eventReadiness');
const { findUnavailability, unavailableMessage } = require('./venueAvailability');
const { loadOtherReservations, inServiceQuantity, windowsOverlap, peakCommitted } = require('./equipmentReservations');

dotenv.config();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/api/drafts', require('./drafts').router);
app.use('/api/equipment', require('./equipment').router);
app.use('/api/equipment', require('./equipmentReservations').router);
app.use('/api', require('./submissions').router);
app.use('/api/bookings', require('./bookingReview').router);
app.use('/api/bookings', require('./bookingNotes').router);
app.use('/api/venue-holds', require('./venueHolds').router);
app.use('/api/safety', require('./safetyChecks').router);
app.use('/api/preparation', require('./preparation').router); // US-021
app.use('/api/events', require('./registrations').router); // US-029/US-030

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

// US-020: reason dropdown + validator
const UNAVAILABILITY_REASONS = Object.freeze([
  'maintenance',
  'equipment_failure',
  'renovation',
  'safety_concerns',
  'other'
]);

// Older clients and tests send a free-text `reason` instead of reasonCode/reasonDetail.
const LEGACY_REASON_CODES = Object.freeze({
  maintenance: 'maintenance',
  'equipment failure': 'equipment_failure',
  renovation: 'renovation',
  'safety concern': 'safety_concerns',
  'safety concerns': 'safety_concerns'
});

function validateUnavailabilityReason(body) {
  let reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode.trim() : '';
  let reasonDetail = typeof body.reasonDetail === 'string' ? body.reasonDetail.trim() : '';
  const legacyReason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reasonCode && legacyReason) {
    reasonCode = LEGACY_REASON_CODES[legacyReason.toLowerCase()] || 'other';
    if (reasonCode === 'other' && !reasonDetail) reasonDetail = legacyReason;
  }
  if (!UNAVAILABILITY_REASONS.includes(reasonCode)) {
    throw Object.assign(new Error('Choose a valid reason for the unavailable period'), { status: 400 });
  }
  if (reasonCode === 'other' && !reasonDetail) {
    throw Object.assign(new Error('Describe the reason when selecting Other'), { status: 400 });
  }
  const reasonLabels = {
    maintenance: 'Maintenance',
    equipment_failure: 'Equipment Failure',
    renovation: 'Renovation',
    safety_concerns: 'Safety Concerns',
    other: reasonDetail
  };
  return { reasonCode, reasonDetail, reasonText: reasonLabels[reasonCode] };
}

app.post('/api/venues/:id/unavailability', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  const startTime = new Date(req.body.startTime);
  const endTime = new Date(req.body.endTime);
  if (!uuidPattern.test(req.params.id) || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || endTime <= startTime) {
    return res.status(400).json({ error: 'Enter a valid unavailability period with an end after the start' });
  }
  let reason;
  try { reason = validateUnavailabilityReason(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  try {
    const venue = await db.query('SELECT id, name FROM venues WHERE id = $1', [req.params.id]);
    if (!venue.rows[0]) return res.status(404).json({ error: 'Venue not found' });
    const result = await db.query(
      `INSERT INTO venue_unavailabilities (venue_id, start_time, end_time, reason, reason_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, venue_id, start_time, end_time, reason, reason_code, created_by, created_at, modified_by, modified_at, ended_early`,
      [req.params.id, startTime.toISOString(), endTime.toISOString(), reason.reasonText, reason.reasonCode, req.auth.sub]
    );
    const affected = await db.query(
      `SELECT b.id, b.event_id, b.start_time, b.end_time, b.status, b.setup_minutes, b.turnaround_minutes,
              e.title AS event_title, COALESCE(e.assigned_coordinator_id, b.requested_by) AS coordinator_id
       FROM bookings b JOIN events e ON e.id = b.event_id
       WHERE b.venue_id = $1 AND b.status IN ('pending', 'approved', 'confirmed')
         AND b.start_time - (b.setup_minutes * interval '1 minute') < $3::timestamptz
         AND b.end_time + (b.turnaround_minutes * interval '1 minute') > $2::timestamptz`,
      [req.params.id, startTime.toISOString(), endTime.toISOString()]
    );
    const relevant = affected.rows.filter((booking) => overlaps(occupiedInterval(booking), { start: startTime.toISOString(), end: endTime.toISOString() }));
    for (const booking of relevant.filter((item) => item.coordinator_id)) {
      await db.query(
        `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
        [booking.coordinator_id, booking.event_id, `Venue ${venue.rows[0].name} is unavailable for ${reason.reasonText}; replacement arrangements are required for ${booking.event_title}`]
      );
    }
    res.status(201).json({ ...result.rows[0], venue_name: venue.rows[0].name, affected_bookings: relevant });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to record venue unavailability' });
  }
});

app.get('/api/venues/unavailability', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  const result = await db.query(
    `SELECT vu.*, v.name AS venue_name FROM venue_unavailabilities vu JOIN venues v ON v.id = vu.venue_id
     WHERE vu.end_time >= now() ORDER BY vu.start_time ASC`
  );
  res.json(result.rows);
});

// US-020: end an active unavailability period early
app.patch('/api/venues/unavailability/:id/end', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'Invalid unavailability period id' });
  try {
    const result = await db.query(
      `UPDATE venue_unavailabilities
       SET end_time = now(), ended_early = true, modified_by = $1, modified_at = now()
       WHERE id = $2 AND start_time <= now() AND end_time > now() AND ended_early = false
       RETURNING id, venue_id, start_time, end_time, reason, reason_code, created_by, created_at, modified_by, modified_at, ended_early`,
      [req.auth.sub, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Active unavailability period not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to end the unavailability period early' });
  }
});

app.get('/api/bookings/affected', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
            `SELECT b.id, b.event_id, b.venue_id, b.start_time, b.end_time, b.status, b.setup_minutes, b.turnaround_minutes,
              b.required_capacity, b.venue_requirements, e.title AS event_title, v.name AS venue_name,
              vu.start_time AS unavailable_start, vu.end_time AS unavailable_end, vu.reason AS unavailable_reason,
              rb.id AS replacement_booking_id, rb.status AS replacement_status, rv.name AS replacement_venue_name,
              rb.start_time AS replacement_start_time, rb.end_time AS replacement_end_time
       FROM bookings b JOIN events e ON e.id = b.event_id JOIN venues v ON v.id = b.venue_id
       JOIN venue_unavailabilities vu ON vu.venue_id = b.venue_id
             LEFT JOIN bookings rb ON rb.replacement_for_booking_id = b.id
             LEFT JOIN venues rv ON rv.id = rb.venue_id
       WHERE COALESCE(e.assigned_coordinator_id, b.requested_by) = $1
         AND b.replacement_for_booking_id IS NULL
         AND b.status IN ('pending', 'approved', 'confirmed')
         AND b.start_time - (b.setup_minutes * interval '1 minute') < vu.end_time
         AND b.end_time + (b.turnaround_minutes * interval '1 minute') > vu.start_time
       ORDER BY vu.start_time ASC, b.start_time ASC`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load affected bookings' });
  }
});

app.get('/api/notifications', auth.authenticate, async (req, res) => {
  try {
    if (req.auth.role === 'event_coordinator') await processHoldExpiries(db, { coordinatorId: req.auth.sub });
    const result = await db.query(
      `SELECT id, event_id, message, read, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load notifications' });
  }
});

app.patch('/api/notifications/:id/read', auth.authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE notifications SET read = true
       WHERE id = $1 AND user_id = $2
       RETURNING id, read`,
      [req.params.id, req.auth.sub]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update notification' });
  }
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

// US-035: Venue Staff configure a venue's setup/turnaround defaults, used whenever the
// venue's availability is determined (searching, and reviewing booking requests).
// AC-035-001/002: both values must be whole, non-negative minutes.
function validateSetupTurnaroundInput(body) {
  const setupMinutes = Number(body.setupMinutes);
  const turnaroundMinutes = Number(body.turnaroundMinutes);
  if (!Number.isInteger(setupMinutes) || setupMinutes < 0 || !Number.isInteger(turnaroundMinutes) || turnaroundMinutes < 0) {
    throw Object.assign(new Error('Setup and turnaround times must be non-negative whole minutes'), { status: 400 });
  }
  return { setupMinutes, turnaroundMinutes };
}

app.put('/api/venues/:id/setup-turnaround', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'Invalid venue id' });
  let setupMinutes, turnaroundMinutes;
  try {
    ({ setupMinutes, turnaroundMinutes } = validateSetupTurnaroundInput(req.body));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  try {
    const result = await db.query(
      `UPDATE venues SET default_setup_minutes = $1, default_turnaround_minutes = $2
       WHERE id = $3
       RETURNING id, name, default_setup_minutes, default_turnaround_minutes`,
      [setupMinutes, turnaroundMinutes, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Venue not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update the venue setup and turnaround times' });
  }
});

app.get('/api/venues', auth.authenticate, auth.requireRoles('event_coordinator', 'venue_staff'), async (req, res) => {
  try {
    await processHoldExpiries(db);
    const {
      search,
      date,
      startTime,
      endTime,
      attendance,
      layout,
      facility,
      accessibility,
      setupMinutes,
      turnaroundMinutes
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
      params.push(startExpression, endExpression);
      const startParam = params.length - 1;
      const endParam = params.length;
      // US-035: when the caller doesn't explicitly ask for a particular setup/turnaround window,
      // fall back to each venue's own configured defaults rather than a fixed 30 minutes.
      let setupExpr;
      let turnaroundExpr;
      if (setupMinutes !== undefined) {
        params.push(Number(setupMinutes));
        setupExpr = `$${params.length}`;
      } else {
        setupExpr = 'v.default_setup_minutes';
      }
      if (turnaroundMinutes !== undefined) {
        params.push(Number(turnaroundMinutes));
        turnaroundExpr = `$${params.length}`;
      } else {
        turnaroundExpr = 'v.default_turnaround_minutes';
      }
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
          AND b.start_time - (b.setup_minutes * interval '1 minute') < ($${endParam}::timestamptz + (${turnaroundExpr} * interval '1 minute'))
          AND b.end_time + (b.turnaround_minutes * interval '1 minute') > ($${startParam}::timestamptz - (${setupExpr} * interval '1 minute'))
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM venue_holds h WHERE h.venue_id = v.id AND ${activeHoldSql('h')}
        AND h.start_time - h.setup_minutes * interval '1 minute' < ($${endParam}::timestamptz + ${turnaroundExpr} * interval '1 minute')
        AND h.end_time + h.turnaround_minutes * interval '1 minute' > ($${startParam}::timestamptz - ${setupExpr} * interval '1 minute')
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1 FROM venue_unavailabilities vu
        WHERE vu.venue_id = v.id
          AND vu.start_time < ($${endParam}::timestamptz + (${turnaroundExpr} * interval '1 minute'))
          AND vu.end_time > ($${startParam}::timestamptz - (${setupExpr} * interval '1 minute'))
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
        default_setup_minutes, default_turnaround_minutes,
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

// Register the organiser's /mine route before the coordinator's /:id route.
app.use('/api/events', require('./changeRequests').router);

// US-034: only the Event Coordinator Lead assigns and reassigns coordinators (this replaces US-011 self-assignment).
app.use('/api/coordinator-lead', require('./coordinatorAssignments').router);

// US-012: requests currently assigned to the logged-in coordinator
app.get('/api/events/assigned', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
            `SELECT id, title, event_type, preferred_start, preferred_end, expected_attendance, purpose, description,
              venue_layout_preference, accessibility_requirements, equipment_requirements, status, created_at
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

// Coordinator calendar: only events currently assigned to the signed-in Coordinator.
app.get('/api/events/coordinator-calendar', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
            `SELECT e.id, e.title, e.status, e.preferred_start, e.preferred_end,
              e.expected_attendance, e.purpose, e.registration_required,
              tsr.status AS technical_status, osc.status AS safety_status,
              COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                'id', b.id, 'venue_name', v.name, 'venue_location', v.location,
                'start_time', b.start_time, 'end_time', b.end_time, 'status', b.status,
                'venue_requirements', b.venue_requirements
              )) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb) AS bookings
       FROM events e
       LEFT JOIN bookings b ON b.event_id = e.id
       LEFT JOIN venues v ON v.id = b.venue_id
       LEFT JOIN technical_support_requirements tsr ON tsr.event_id = e.id
       LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
       WHERE e.assigned_coordinator_id = $1
       GROUP BY e.id, tsr.status, osc.status
       ORDER BY e.preferred_start NULLS LAST, e.title`,
      [req.auth.sub]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load your event calendar' });
  }
});

// US-012: full read-only detail, only visible if assigned to this coordinator
app.get('/api/events/:id', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, osc.status AS safety_status, osc.comments AS safety_comments,
          osc.change_scope AS safety_change_scope, osc.decided_at AS safety_decided_at
       FROM events e LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
       WHERE e.id = $1 AND e.assigned_coordinator_id = $2`,
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

function parseBookingInput(body, venueDefaults = {}) {
  const startTime = new Date(body.startTime);
  const endTime = new Date(body.endTime);
  // US-035: use the venue's own configured setup/turnaround defaults when the caller doesn't specify one.
  const setupMinutes = Number(body.setupMinutes ?? venueDefaults.default_setup_minutes ?? 30);
  const turnaroundMinutes = Number(body.turnaroundMinutes ?? venueDefaults.default_turnaround_minutes ?? 30);
  const requiredCapacity = body.requiredCapacity === undefined || body.requiredCapacity === null || body.requiredCapacity === '' ? null : Number(body.requiredCapacity);
  if (!uuidPattern.test(body.eventId || '') || !uuidPattern.test(body.venueId || '')) throw Object.assign(new Error('A valid event and venue are required'), { status: 400 });
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || endTime <= startTime) throw Object.assign(new Error('End time must be later than start time'), { status: 400 });
  if (!Number.isInteger(setupMinutes) || setupMinutes < 0 || !Number.isInteger(turnaroundMinutes) || turnaroundMinutes < 0) throw Object.assign(new Error('Setup and turnaround times must be non-negative whole minutes'), { status: 400 });
  if (requiredCapacity !== null && (!Number.isInteger(requiredCapacity) || requiredCapacity <= 0)) throw Object.assign(new Error('Required capacity must be a positive whole number'), { status: 400 });
  const venueRequirements = body.venueRequirements && typeof body.venueRequirements === 'object' && !Array.isArray(body.venueRequirements) ? body.venueRequirements : {};
  return { startTime, endTime, setupMinutes, turnaroundMinutes, requiredCapacity, venueRequirements, acknowledgeConflict: body.acknowledgeConflict === true };
}

// US-015: create a pending venue booking request for an event assigned to this coordinator.
app.post('/api/bookings/requests/batch', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  const bookings = Array.isArray(req.body.bookings) ? req.body.bookings : [];
  if (!bookings.length) return res.status(400).json({ error: 'Add at least one venue booking' });
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const eventResult = await client.query(
      `SELECT id, title, expected_attendance FROM events WHERE id = $1 AND assigned_coordinator_id = $2 AND status IN ('submitted', 'approved', 'planning')`,
      [req.body.eventId, req.auth.sub]
    );
    if (!eventResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found or not assigned to you' });
    }
    const replacementForBookingId = req.body.replacementForBookingId || null;
    if (replacementForBookingId && !uuidPattern.test(replacementForBookingId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid affected booking id' });
    }
    if (replacementForBookingId) {
      const original = await client.query(
        `SELECT b.id FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN venue_unavailabilities vu ON vu.venue_id = b.venue_id
         WHERE b.id = $1 AND b.event_id = $2 AND e.assigned_coordinator_id = $3
           AND b.status IN ('pending', 'approved', 'confirmed')
           AND b.start_time - (b.setup_minutes * interval '1 minute') < vu.end_time
           AND b.end_time + (b.turnaround_minutes * interval '1 minute') > vu.start_time`,
        [replacementForBookingId, req.body.eventId, req.auth.sub]
      );
      if (!original.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Affected booking not found for this event' });
      }
    }

    const prepared = [];
    const conflicts = [];
    for (let index = 0; index < bookings.length; index += 1) {
      const venueResult = await client.query('SELECT id, name, capacity, default_setup_minutes, default_turnaround_minutes FROM venues WHERE id = $1', [bookings[index].venueId]);
      if (!venueResult.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Venue ${index + 1} was not found` }); }
      let input;
      try { input = parseBookingInput({ ...bookings[index], eventId: req.body.eventId }, venueResult.rows[0]); }
      catch (error) { await client.query('ROLLBACK'); return res.status(error.status || 400).json({ error: `Venue ${index + 1}: ${error.message}` }); }
      const unavailable = await findUnavailability(client.query.bind(client), { venueId: bookings[index].venueId, startTime: input.startTime.toISOString(), endTime: input.endTime.toISOString(), setupMinutes: input.setupMinutes, turnaroundMinutes: input.turnaroundMinutes });
      if (unavailable) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Venue ${index + 1} is unavailable. ${unavailableMessage(unavailable)}`, unavailable }); }
      input.requiredCapacity = input.requiredCapacity ?? eventResult.rows[0].expected_attendance;
      if (input.requiredCapacity && venueResult.rows[0].capacity < input.requiredCapacity) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Venue ${index + 1} capacity is insufficient for the required capacity` }); }
      const conflictResult = await client.query(
        `SELECT b.id, b.start_time, b.end_time, b.status, v.name AS venue_name, e.title AS event_title
         FROM bookings b JOIN venues v ON v.id = b.venue_id LEFT JOIN events e ON e.id = b.event_id
         WHERE b.venue_id = $1 AND b.status IN ('pending', 'approved', 'confirmed')
           AND b.start_time - (b.setup_minutes * interval '1 minute') < $3::timestamptz + ($5 * interval '1 minute')
           AND b.end_time + (b.turnaround_minutes * interval '1 minute') > $2::timestamptz - ($4 * interval '1 minute')
         ORDER BY b.start_time ASC`,
        [bookings[index].venueId, input.startTime.toISOString(), input.endTime.toISOString(), input.setupMinutes, input.turnaroundMinutes]
      );
      const rowConflicts = conflictResult.rows.map((conflict) => ({
        booking_id: conflict.id,
        event_title: conflict.event_title || 'Existing booking',
        venue_name: conflict.venue_name,
        start_time: conflict.start_time,
        end_time: conflict.end_time,
        status: conflict.status
      }));
      if (rowConflicts.length) conflicts.push({ index, venue_name: venueResult.rows[0].name, conflicts: rowConflicts });
      prepared.push({ index, input, venueId: bookings[index].venueId, venueName: venueResult.rows[0].name });
    }
    if (conflicts.length && req.body.acknowledgeConflicts !== true) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'One or more venue bookings have conflicts. Review and acknowledge them to continue.', conflicts });
    }
    const created = [];
    for (const booking of prepared) {
      const result = await client.query(
        `INSERT INTO bookings (event_id, venue_id, requested_by, replacement_for_booking_id, required_capacity, start_time, end_time, status,
                              setup_minutes, turnaround_minutes, venue_requirements,
                              conflict_warning, conflict_details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10::jsonb, $11, $12::jsonb)
         RETURNING id, event_id, venue_id, start_time, end_time, status, setup_minutes,
                   turnaround_minutes, venue_requirements, conflict_warning, conflict_details, created_at`,
        [req.body.eventId, booking.venueId, req.auth.sub, replacementForBookingId, booking.input.requiredCapacity, booking.input.startTime.toISOString(), booking.input.endTime.toISOString(), booking.input.setupMinutes, booking.input.turnaroundMinutes, JSON.stringify(booking.input.venueRequirements), conflicts.some((entry) => entry.index === booking.index), JSON.stringify((conflicts.find((entry) => entry.index === booking.index) || {}).conflicts || [])]
      );
      created.push(result.rows[0]);
    }
    await client.query('COMMIT');
    for (const booking of created) await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'venue_staff'`,
      [req.body.eventId, `Venue booking request submitted for ${eventResult.rows[0].title} (Booking ID: ${booking.id})`]
    );
    res.status(201).json({ event_id: req.body.eventId, bookings: created });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Unable to submit venue bookings. Your fields are still available; please retry.' });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/bookings/requests', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
    const eventResult = await db.query(
      `SELECT id, title, expected_attendance FROM events WHERE id = $1 AND assigned_coordinator_id = $2 AND status IN ('submitted', 'approved', 'planning')`,
      [req.body.eventId, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found or not assigned to you' });
    const venueResult = await db.query('SELECT id, name, capacity, default_setup_minutes, default_turnaround_minutes FROM venues WHERE id = $1', [req.body.venueId]);
    if (!venueResult.rows[0]) return res.status(404).json({ error: 'Venue not found' });
    let input;
    try { input = parseBookingInput(req.body, venueResult.rows[0]); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
    const unavailable = await findUnavailability(db.query, { venueId: req.body.venueId, startTime: input.startTime.toISOString(), endTime: input.endTime.toISOString(), setupMinutes: input.setupMinutes, turnaroundMinutes: input.turnaroundMinutes });
    if (unavailable) return res.status(409).json({ error: `Venue is unavailable. ${unavailableMessage(unavailable)}`, unavailable });
    input.requiredCapacity = input.requiredCapacity ?? eventResult.rows[0].expected_attendance;
    if (input.requiredCapacity && venueResult.rows[0].capacity < input.requiredCapacity) return res.status(400).json({ error: 'Venue capacity is insufficient for the required capacity' });

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
      `INSERT INTO bookings (event_id, venue_id, requested_by, required_capacity, start_time, end_time, status,
                            setup_minutes, turnaround_minutes, venue_requirements,
                            conflict_warning, conflict_details)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9::jsonb, $10, $11::jsonb)
       RETURNING id, event_id, venue_id, start_time, end_time, status, setup_minutes,
                 turnaround_minutes, venue_requirements, conflict_warning, conflict_details, created_at`,
      [req.body.eventId, req.body.venueId, req.auth.sub, input.requiredCapacity, input.startTime.toISOString(), input.endTime.toISOString(), input.setupMinutes, input.turnaroundMinutes, JSON.stringify(input.venueRequirements), conflictDetails.length > 0, JSON.stringify(conflictDetails)]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'venue_staff'`,
      [req.body.eventId, `Venue booking request submitted for ${eventResult.rows[0].title} at ${venueResult.rows[0].name} (Booking ID: ${bookingResult.rows[0].id})`]
    );
    res.status(201).json(bookingResult.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to submit booking request. Your fields are still available; please retry.' });
  }
});

// Coordinators may edit a pending replacement request without creating a duplicate.
app.patch('/api/bookings/:id/replacement', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  let input;
  try { input = parseBookingInput(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  try {
    const booking = (await db.query(
      `SELECT b.id, b.event_id, e.title FROM bookings b JOIN events e ON e.id = b.event_id
       LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
       WHERE b.id = $1 AND e.assigned_coordinator_id = $2
         AND (
           (b.replacement_for_booking_id IS NOT NULL AND b.status = 'pending')
           OR (b.replacement_for_booking_id IS NULL AND b.status IN ('approved', 'confirmed')
               AND osc.status = 'changes_requested' AND 'venue' = ANY(osc.change_scope))
         )`,
      [req.params.id, req.auth.sub]
    )).rows[0];
    if (!booking) return res.status(404).json({ error: 'Pending replacement booking not found' });
    const venue = (await db.query('SELECT id, capacity FROM venues WHERE id = $1', [req.body.venueId])).rows[0];
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const unavailable = await findUnavailability(db.query, { venueId: req.body.venueId, startTime: input.startTime.toISOString(), endTime: input.endTime.toISOString(), setupMinutes: input.setupMinutes, turnaroundMinutes: input.turnaroundMinutes });
    if (unavailable) return res.status(409).json({ error: `Venue is unavailable. ${unavailableMessage(unavailable)}`, unavailable });
    const requiredCapacity = input.requiredCapacity;
    if (requiredCapacity && venue.capacity < requiredCapacity) return res.status(400).json({ error: 'Venue capacity is insufficient for the required capacity' });
    const result = await db.query(
      `UPDATE bookings SET venue_id = $1, required_capacity = $2, start_time = $3, end_time = $4,
             setup_minutes = $5, turnaround_minutes = $6, venue_requirements = $7::jsonb,
             conflict_warning = false, conflict_details = '[]'::jsonb, status = 'pending',
             decision_reason = NULL, decision_comment = NULL, decided_by = NULL, decided_at = NULL
       WHERE id = $8
       RETURNING id, event_id, venue_id, start_time, end_time, status, venue_requirements`,
      [req.body.venueId, requiredCapacity, input.startTime.toISOString(), input.endTime.toISOString(), input.setupMinutes, input.turnaroundMinutes, JSON.stringify(input.venueRequirements), req.params.id]
    );
    await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'venue_staff'`,
      [booking.event_id, `Venue booking request updated for ${booking.title} (Booking ID: ${booking.id}) and requires review.`]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to edit replacement booking. Your fields are still available; please retry.' });
  }
});

// Coordinator view of their submitted venue booking requests.
app.get('/api/bookings/mine', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  const result = await db.query(
    `SELECT b.*, v.name AS venue_name, e.title AS event_title,
      osc.status AS safety_status, osc.comments AS safety_comments, osc.change_scope AS safety_change_scope,
            EXISTS (
              SELECT 1 FROM venue_unavailabilities vu
              WHERE vu.venue_id = b.venue_id
                AND b.start_time - (b.setup_minutes * interval '1 minute') < vu.end_time
                AND b.end_time + (b.turnaround_minutes * interval '1 minute') > vu.start_time
            ) AS affected_by_unavailability
    FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN events e ON e.id = b.event_id
    LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
     WHERE e.assigned_coordinator_id = $1 ORDER BY b.created_at DESC`,
    [req.auth.sub]
  );
  res.json(result.rows);
});

app.get('/api/bookings', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  try {
    const { venueId, from, to } = req.query;
    const filters = ["b.status IN ('approved', 'confirmed')"];
    const params = [];

    if (venueId) {
      params.push(venueId);
      filters.push(`b.venue_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      filters.push(`b.start_time::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      filters.push(`b.start_time::date <= $${params.length}::date`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const result = await db.query(
      `SELECT b.id, b.venue_id, b.event_id, b.start_time, b.end_time, b.status,
              b.setup_minutes, b.turnaround_minutes,
              v.name AS venue_name,
              v.default_setup_minutes,
              v.default_turnaround_minutes,
              e.title AS event_title,
              e.status AS event_status,
              e.expected_attendance
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN events e ON e.id = b.event_id
       ${where}
       ORDER BY b.venue_id ASC, b.start_time ASC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
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

// US-033: decisions use the existing booking row and recheck committed availability.
app.patch('/api/bookings/:id/decision', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Booking request not found' });
  let input;
  try { input = require('./bookingDecisions').parseBookingDecision(req.body); }
  catch (error) { return res.status(error.status).json({ error: error.message }); }
  const { decision, reason, comment, alternativeStart, alternativeEnd } = input;
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    // Serialise reservation writes and blocked-period edits during check + decision.
    // Existing submission writers also take the conflicting PostgreSQL row-exclusive table lock.
    await client.query('LOCK TABLE bookings, venue_unavailabilities, venue_holds IN SHARE ROW EXCLUSIVE MODE');
    const found = await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    const booking = found.rows[0];
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking request not found' }); }
    if (booking.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This request is no longer pending.' }); }
    if (decision === 'approved') {
      const bookings = await client.query('SELECT * FROM bookings WHERE venue_id = $1 AND id <> $2', [booking.venue_id, booking.id]);
      const unavailable = await findUnavailability(client.query.bind(client), booking);
      const conflicts = [...require('./bookingReview').reviewConflicts(booking, bookings.rows, unavailable ? [{ ...unavailable, venue_id: booking.venue_id }] : []), ...await holdConflicts(client, booking)];
      if (conflicts.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The venue is unavailable for this occupied interval. Refresh the review before deciding.', conflicts });
      }
    }
    const result = await client.query(
      `UPDATE bookings SET status = $1, decision_reason = $2, decision_comment = $3,
       alternative_start_time = $4, alternative_end_time = $5, decided_by = $6, decided_at = now()
       WHERE id = $7 AND status = 'pending' RETURNING *`,
      [decision, reason.trim() || null, comment.trim() || null, alternativeStart, alternativeEnd, req.auth.sub, booking.id]);
    // Preserve main's event-readiness workflow and its safety notification atomically.
    if (decision === 'approved') {
      const readyEvent = await promoteEventIfReady(client.query.bind(client), booking.event_id);
      if (readyEvent) await client.query(
        `INSERT INTO notifications (user_id, event_id, message)
         SELECT id, $1, $2 FROM users WHERE role = 'safety_officer'`,
        [readyEvent.id, `Event "${readyEvent.title}" is ready for an Operational Safety Check.`]
      );
    }
    // Preserve US-034's notification recipient after coordinator reassignment.
    await client.query(`INSERT INTO notifications (user_id, event_id, message)
      SELECT COALESCE(e.assigned_coordinator_id, b.requested_by), b.event_id, $1
      FROM bookings b LEFT JOIN events e ON e.id = b.event_id WHERE b.id = $2`,
      [`Venue booking request ${decision.replaceAll('_', ' ')}${reason.trim() ? ': ' + reason.trim() : ''}`, booking.id]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Booking decision failed:', error.code || error.message);
    res.status(500).json({ error: 'Unable to save booking decision. Please retry.' });
  } finally { if (client) client.release(); }
});

app.get('/api/bookings/reviewed', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  try {
    const result = await db.query(`SELECT b.*, v.name AS venue_name, e.title AS event_title,
      u.name AS coordinator_name FROM bookings b JOIN venues v ON v.id = b.venue_id
      JOIN events e ON e.id = b.event_id LEFT JOIN users u ON u.id = b.requested_by
      WHERE b.status IN ('approved', 'confirmed', 'rejected', 'alternative_suggested') ORDER BY b.decided_at DESC NULLS LAST`);
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Unable to load reviewed requests. Please retry.' }); }
});

// US-013: approve or reject a submitted request assigned to this coordinator
// US-013: an Event Coordinator approves or rejects an event request assigned
// to them, with an audit trail (event_changes) and a notification to the
// Organiser. A rejection must give one of a fixed set of reasons, and "Other"
// needs a free-text detail.
const EVENT_DECISION_REASON_LABELS = Object.freeze({
  insufficient_information: 'Insufficient Information',
  infeasible_requirements: 'Infeasible Requirements',
  duplicate_request: 'Duplicate Request',
  other: 'Other'
});

function parseEventDecisionInput(body) {
  const { decision, reason, reasonDetail } = body || {};
  const safeDecision = typeof decision === 'string' ? decision.trim() : '';
  if (!['approved', 'rejected'].includes(safeDecision)) {
    throw Object.assign(new Error('Decision must be either approved or rejected'), { status: 400 });
  }

  if (safeDecision !== 'rejected') {
    return { decision: safeDecision, reason: null, reasonDetail: null };
  }

  const safeReason = typeof reason === 'string' ? reason.trim() : '';
  if (!Object.keys(EVENT_DECISION_REASON_LABELS).includes(safeReason)) {
    throw Object.assign(new Error('A valid rejection reason is required'), { status: 400 });
  }
  const comment = reasonDetail != null ? String(reasonDetail).trim() : '';
  if (safeReason === 'other' && !comment) {
    throw Object.assign(new Error('A free-text detail is required when the reason is Other'), { status: 400 });
  }
  // US-009 (AC-009-002): keep the Coordinator's comment for any reason, not only Other.
  return { decision: safeDecision, reason: safeReason, reasonDetail: comment };
}

// Builds the audit-trail summary and the Organiser-facing notification text
// for a decision already validated by parseEventDecisionInput.
function describeEventDecision({ decision, reason, reasonDetail }, { title, coordinatorId }) {
  if (decision === 'approved') {
    return {
      summary: `Decision: approved by coordinator ${coordinatorId}`,
      notificationMessage: `Your event request "${title}" was approved and can proceed to venue search and booking.`
    };
  }
  const reasonText = EVENT_DECISION_REASON_LABELS[reason];
  const detailText = reasonDetail ? ` Details: ${reasonDetail}` : '';
  return {
    summary: `Decision: rejected by coordinator ${coordinatorId} for reason: ${reasonText}${detailText}`,
    notificationMessage: `Your event request "${title}" was rejected. Reason: ${reasonText}${detailText}`
  };
}

app.patch('/api/events/:id/decision', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  let decisionInput;
  try {
    decisionInput = parseEventDecisionInput(req.body);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const { decision: safeDecision } = decisionInput;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE events
       SET status = $1
       WHERE id = $2 AND assigned_coordinator_id = $3 AND status = 'submitted'
       RETURNING id, title, status, organiser_id`,
      [safeDecision === 'approved' ? 'approved' : 'rejected', req.params.id, req.auth.sub]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found, not assigned to this coordinator, or already decided' });
    }

    const row = result.rows[0];
    const { summary, notificationMessage } = describeEventDecision(decisionInput, { title: row.title, coordinatorId: req.auth.sub });

    await client.query(
      `INSERT INTO event_changes (event_id, changed_by, change_summary)
       VALUES ($1, $2, $3)`,
      [row.id, req.auth.sub, summary]
    );

    await client.query(
      `INSERT INTO notifications (user_id, event_id, message)
       VALUES ($1, $2, $3)`,
      [row.organiser_id, row.id, notificationMessage]
    );

    await client.query('COMMIT');
    res.json({ ...row, message: notificationMessage });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Failed to save the event decision' });
  } finally {
    client.release();
  }
});

const SUPPORT_STATUS_LABELS = Object.freeze({
  pending: 'Pending Review',
  confirmed: 'Sufficient Resources Available',
  changes_requested: 'Insufficient Resources'
});

function validateSupportRequirements(body) {
  const equipment = Array.isArray(body.equipment) ? body.equipment : [];
  const noSupportRequired = body.noSupportRequired === true;
  const seen = new Set();
  const normalizedEquipment = equipment.map((item) => {
    const equipmentId = typeof item.equipmentId === 'string'
      ? item.equipmentId.trim()
      : (typeof item.equipment_id === 'string' ? item.equipment_id.trim() : '');
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const quantity = Number(item.quantity);
    const details = typeof item.details === 'string' ? item.details.trim() : '';
    if (!Number.isInteger(quantity) || quantity <= 0) throw Object.assign(new Error('Equipment quantities must be positive whole numbers'), { status: 400 });
    if (equipmentId) {
      if (!uuidPattern.test(equipmentId)) throw Object.assign(new Error('Choose a valid equipment item.'), { status: 400 });
      const key = 'id:' + equipmentId;
      if (seen.has(key)) throw Object.assign(new Error('Each equipment item may only be listed once'), { status: 400 });
      seen.add(key);
      return { equipmentId, quantity };
    }

    // Backward-compatible payload support for older clients.
    if (!type) throw Object.assign(new Error('Choose equipment to request.'), { status: 400 });
    if (details.length > 500) throw Object.assign(new Error('Equipment details must be at most 500 characters'), { status: 400 });
    const legacyKey = 'legacy:' + type.toLowerCase();
    if (seen.has(legacyKey)) throw Object.assign(new Error('Each equipment type may only be listed once'), { status: 400 });
    seen.add(legacyKey);
    return { legacyType: type, legacyDetails: details, quantity };
  });
  const staffRequired = Number(body.staffRequired);
  if (!Number.isInteger(staffRequired) || staffRequired < 0) throw Object.assign(new Error('Number of staff must be a non-negative whole number'), { status: 400 });
  if (!noSupportRequired && staffRequired === 0 && normalizedEquipment.length === 0) {
    throw Object.assign(new Error('Select at least one equipment item or require at least one technical support staff member'), { status: 400 });
  }
  if (noSupportRequired && (staffRequired !== 0 || normalizedEquipment.length !== 0)) {
    throw Object.assign(new Error('No technical support can only be selected when no equipment or staff is required'), { status: 400 });
  }
  return { equipment: normalizedEquipment, staffRequired, supportRequired: !noSupportRequired };
}

function supportDecisionLabel(status) {
  return SUPPORT_STATUS_LABELS[status] || status;
}

function parseSupportDecision(body = {}) {
  const rawDecision = typeof body.decision === 'string' ? body.decision.trim() : '';
  const decision = rawDecision.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  const comments = body.comments ?? '';
  const statusByDecision = {
    confirmed: 'confirmed',
    sufficient_resources_available: 'confirmed',
    changes_requested: 'changes_requested',
    insufficient_resources: 'changes_requested'
  };
  const status = statusByDecision[decision];
  if (!status) throw Object.assign(new Error('Decision must be "Sufficient Resources Available" or "Insufficient Resources"'), { status: 400 });
  if (typeof comments !== 'string' || comments.trim().length > 2000) throw Object.assign(new Error('Comments must be 2,000 characters or fewer'), { status: 400 });
  return { status, comments: comments.trim(), label: supportDecisionLabel(status) };
}

function validWindow(start, end) {
  return Number.isFinite(new Date(start).getTime()) &&
    Number.isFinite(new Date(end).getTime()) &&
    new Date(end).getTime() > new Date(start).getTime();
}

function eventWindowsForAvailability(event, bookings) {
  const windows = (bookings || [])
    .filter((booking) => OCCUPYING_STATUSES.includes(booking.status) && validWindow(booking.start_time, booking.end_time))
    .map((booking) => ({ start: booking.start_time, end: booking.end_time }));
  if (windows.length) return { windows, basis: 'bookings' };
  if (validWindow(event.preferred_start, event.preferred_end)) {
    return { windows: [{ start: event.preferred_start, end: event.preferred_end }], basis: 'event_preferred_time' };
  }
  return { windows: [], basis: 'unscheduled' };
}

function normalizeSupportEquipmentRequirements(rawRequirements = []) {
  return rawRequirements
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      const equipmentId = typeof item.equipment_id === 'string' && uuidPattern.test(item.equipment_id.trim())
        ? item.equipment_id.trim()
        : null;
      const equipmentName = typeof item.equipment_name === 'string' && item.equipment_name.trim()
        ? item.equipment_name.trim()
        : (typeof item.type === 'string' ? item.type.trim() : '');
      const equipmentType = typeof item.equipment_type === 'string' && item.equipment_type.trim()
        ? item.equipment_type.trim()
        : (typeof item.type === 'string' ? item.type.trim() : '');
      const details = typeof item.details === 'string' && item.details.trim() ? item.details.trim() : '';
      return {
        equipment_id: equipmentId,
        equipment_name: equipmentName || equipmentType || 'Unknown equipment',
        equipment_type: equipmentType || null,
        quantity,
        ...(details ? { details } : {})
      };
    })
    .filter(Boolean);
}

function presentSupportEquipment(item) {
  return {
    ...item,
    type: item.equipment_name
  };
}

function requiresTechnicalSafetyReapproval(item) {
  return Array.isArray(item?.safety_change_scope) &&
    item.safety_change_scope.includes('technical') &&
    item.safety_status !== 'approved';
}

function presentEquipmentCatalogRow(row) {
  const availableQuantity = row.status === 'available' ? inServiceQuantity(row) : 0;
  return {
    id: row.id,
    name: row.name,
    equipment_type: row.equipment_type,
    status: row.status,
    total_quantity: row.total_quantity,
    damaged_quantity: row.damaged_quantity || 0,
    maintenance_quantity: row.maintenance_quantity || 0,
    available_quantity: availableQuantity
  };
}

async function equipmentAvailabilityByRequirement(query, { eventId, equipmentRequirements, preferredStart, preferredEnd, bookings }) {
  const requested = normalizeSupportEquipmentRequirements(equipmentRequirements);
  if (!requested.length) return { rows: [], windowsBasis: 'unscheduled' };

  const requestedIds = [...new Set(requested.map((item) => item.equipment_id).filter(Boolean))];
  const legacyTypes = [...new Set(requested.filter((item) => !item.equipment_id && item.equipment_type).map((item) => item.equipment_type))];
  const { windows, basis } = eventWindowsForAvailability(
    { preferred_start: preferredStart, preferred_end: preferredEnd },
    bookings
  );
  const [equipmentRows, otherReservations] = await Promise.all([
    (requestedIds.length || legacyTypes.length)
      ? query(
        `SELECT id, name, equipment_type, status, total_quantity, damaged_quantity, maintenance_quantity
         FROM equipment
         WHERE ($1::uuid[] <> '{}'::uuid[] AND id = ANY($1::uuid[]))
            OR ($2::text[] <> '{}'::text[] AND equipment_type = ANY($2::text[]))`,
        [requestedIds, legacyTypes]
      )
      : Promise.resolve({ rows: [] }),
    windows.length ? loadOtherReservations(query, eventId) : Promise.resolve([])
  ]);
  const equipmentById = new Map(equipmentRows.rows.map((row) => [row.id, row]));
  const equipmentByType = equipmentRows.rows.reduce((map, row) => {
    const existing = map.get(row.equipment_type) || [];
    existing.push(row);
    map.set(row.equipment_type, existing);
    return map;
  }, new Map());

  return {
    windowsBasis: basis,
    rows: requested.map((item, index) => {
      const equipment = item.equipment_id ? equipmentById.get(item.equipment_id) : null;
      if (equipment) {
        const inService = equipment.status === 'available' ? inServiceQuantity(equipment) : 0;
        const overlapping = windows.length
          ? otherReservations.filter((reservation) => reservation.equipment_id === equipment.id && windowsOverlap(windows, reservation.windows))
          : [];
        const committedElsewhere = windows.length ? peakCommitted(windows, overlapping) : 0;
        const available = Math.max(0, inService - committedElsewhere);
        return {
          key: equipment.id,
          equipment_id: equipment.id,
          equipment_name: equipment.name,
          equipment_type: equipment.equipment_type,
          requested_quantity: item.quantity,
          available_quantity: available,
          in_service_quantity: inService,
          committed_elsewhere: committedElsewhere,
          sufficient: available >= item.quantity
        };
      }

      const byType = item.equipment_type ? (equipmentByType.get(item.equipment_type) || []) : [];
      let inService = 0;
      let committedElsewhere = 0;
      let available = 0;
      for (const row of byType) {
        const rowInService = row.status === 'available' ? inServiceQuantity(row) : 0;
        const overlapping = windows.length
          ? otherReservations.filter((reservation) => reservation.equipment_id === row.id && windowsOverlap(windows, reservation.windows))
          : [];
        const rowCommittedElsewhere = windows.length ? peakCommitted(windows, overlapping) : 0;
        inService += rowInService;
        committedElsewhere += rowCommittedElsewhere;
        available += Math.max(0, rowInService - rowCommittedElsewhere);
      }
      return {
        key: `legacy-${index}-${item.equipment_name}`,
        equipment_id: null,
        equipment_name: item.equipment_name,
        equipment_type: item.equipment_type,
        requested_quantity: item.quantity,
        available_quantity: available,
        in_service_quantity: inService,
        committed_elsewhere: committedElsewhere,
        sufficient: available >= item.quantity
      };
    })
  };
}

async function buildSupportEquipmentRequirements(query, normalizedEquipment) {
  const inventoryItems = normalizedEquipment.filter((item) => item.equipmentId);
  if (!inventoryItems.length) {
    return normalizedEquipment.map((item) => ({
      type: item.legacyType,
      quantity: item.quantity,
      ...(item.legacyDetails ? { details: item.legacyDetails } : {})
    }));
  }

  const uniqueIds = [...new Set(inventoryItems.map((item) => item.equipmentId))];
  const inventory = await query(
    `SELECT id, name, equipment_type
     FROM equipment
     WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );
  if (inventory.rows.length !== uniqueIds.length) {
    throw Object.assign(new Error('One or more selected equipment items are no longer in the inventory. Refresh and try again.'), { status: 400 });
  }
  const byId = new Map(inventory.rows.map((row) => [row.id, row]));
  return normalizedEquipment.map((item) => {
    if (!item.equipmentId) {
      return {
        type: item.legacyType,
        quantity: item.quantity,
        ...(item.legacyDetails ? { details: item.legacyDetails } : {})
      };
    }
    const equipment = byId.get(item.equipmentId);
    return {
      equipment_id: equipment.id,
      equipment_name: equipment.name,
      equipment_type: equipment.equipment_type,
      quantity: item.quantity
    };
  });
}

async function supportEquipmentCatalog(query) {
  const result = await query(
    `SELECT id, name, equipment_type, status, total_quantity, damaged_quantity, maintenance_quantity
     FROM equipment
     ORDER BY lower(name), id`
  );
  return result.rows.map(presentEquipmentCatalogRow);
}

app.get('/api/technical-support/equipment-catalog', auth.authenticate, auth.requireRoles('event_coordinator', 'technical_support_staff'), async (req, res) => {
  try {
    res.json(await supportEquipmentCatalog(db.query));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load the equipment inventory for technical support.' });
  }
});

// US-016: save or replace the latest technical support requirements for an assigned event.
app.put('/api/events/:id/technical-support', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  let requirements;
  try { requirements = validateSupportRequirements(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  try {
    const eventResult = await db.query(
      `SELECT id, title, preferred_start, preferred_end FROM events
       WHERE id = $1 AND assigned_coordinator_id = $2 AND status NOT IN ('completed', 'cancelled', 'rejected')`,
      [req.params.id, req.auth.sub]
    );
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found or not assigned to you' });
    const event = eventResult.rows[0];
    if (event.preferred_end && new Date() > new Date(event.preferred_end)) {
      return res.status(400).json({ error: 'Technical support requirements cannot be submitted after the event has ended' });
    }
    const equipmentRequirements = await buildSupportEquipmentRequirements(db.query, requirements.equipment);
    const lateRequest = event.preferred_start ? new Date() >= new Date(event.preferred_start) : false;
    const existingRequirement = await db.query('SELECT id FROM technical_support_requirements WHERE event_id = $1', [req.params.id]);
    const result = await db.query(
      `INSERT INTO technical_support_requirements (event_id, equipment_requirements, staff_required, support_required, status, decision_comments, decided_by, decided_at, late_request, updated_by)
       VALUES ($1, $2::jsonb, $3, $4, 'pending', NULL, NULL, NULL, $5, $6)
       ON CONFLICT (event_id) DO UPDATE SET equipment_requirements = EXCLUDED.equipment_requirements,
         staff_required = EXCLUDED.staff_required, late_request = EXCLUDED.late_request,
         support_required = EXCLUDED.support_required, status = EXCLUDED.status,
         decision_comments = NULL, decided_by = NULL, decided_at = NULL,
         updated_by = EXCLUDED.updated_by, updated_at = now(), update_count = technical_support_requirements.update_count + 1
       RETURNING id, event_id, equipment_requirements, staff_required, support_required, status, late_request, update_count, updated_at`,
      [req.params.id, JSON.stringify(equipmentRequirements), requirements.staffRequired, requirements.supportRequired, lateRequest, req.auth.sub]
    );
    if (requirements.supportRequired) await db.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT id, $1, $2 FROM users WHERE role = 'technical_support_staff'`,
      [req.params.id, `Technical support requirements updated for ${event.title}${lateRequest ? ' (late request)' : ''}`]
    );
    if (!requirements.supportRequired) {
      const confirmedEvent = await promoteEventIfReady(db.query, req.params.id);
      if (confirmedEvent) await db.query(
        `INSERT INTO notifications (user_id, event_id, message)
         SELECT id, $1, $2 FROM users WHERE role = 'safety_officer'`,
        [confirmedEvent.id, `Event "${confirmedEvent.title}" is ready for an Operational Safety Check.`]
      );
    }
    res.json({ ...result.rows[0], updated: existingRequirement.rows.length > 0 });
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unable to save technical support requirements. Your input is still available; please retry.'
    });
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
      `SELECT tsr.*, e.title AS event_title, osc.status AS safety_status,
          osc.comments AS safety_comments, osc.change_scope AS safety_change_scope
       FROM technical_support_requirements tsr
       JOIN events e ON e.id = tsr.event_id
       LEFT JOIN operational_safety_checks osc ON osc.event_id = tsr.event_id
       WHERE tsr.event_id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.json({
        event_id: req.params.id,
        event_title: event.title,
        equipment_requirements: [],
        staff_required: 0,
        support_required: true,
        status: 'pending',
        resource_decision: supportDecisionLabel('pending'),
        late_request: false,
        updated: false
      });
    }
    const equipmentRequirements = normalizeSupportEquipmentRequirements(result.rows[0].equipment_requirements).map(presentSupportEquipment);
    res.json({
      ...result.rows[0],
      equipment_requirements: equipmentRequirements,
      resource_decision: supportDecisionLabel(result.rows[0].status)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load technical support requirements' });
  }
});

app.get('/api/technical-support/requirements', auth.authenticate, auth.requireRoles('technical_support_staff'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tsr.*, (tsr.update_count > 0) AS updated, e.title AS event_title, e.preferred_start, e.preferred_end,
              osc.status AS safety_status, osc.comments AS safety_comments, osc.change_scope AS safety_change_scope
       FROM technical_support_requirements tsr
       JOIN events e ON e.id = tsr.event_id
       LEFT JOIN operational_safety_checks osc ON osc.event_id = tsr.event_id
       ORDER BY e.preferred_start NULLS LAST, tsr.updated_at DESC`
    );
    const eventIds = result.rows.map((row) => row.event_id);
    const bookings = eventIds.length
      ? (await db.query(
        `SELECT b.event_id, b.status, b.start_time, b.end_time, v.name AS venue_name
         FROM bookings b
         LEFT JOIN venues v ON v.id = b.venue_id
         WHERE b.event_id = ANY($1::uuid[])
           AND b.status IN ('pending', 'approved', 'confirmed')
         ORDER BY b.start_time ASC`,
        [eventIds]
      )).rows
      : [];
    const bookingsByEvent = bookings.reduce((acc, booking) => {
      const list = acc.get(booking.event_id) || [];
      list.push(booking);
      acc.set(booking.event_id, list);
      return acc;
    }, new Map());
    const hydrated = await Promise.all(result.rows.map(async (row) => {
      const eventBookings = bookingsByEvent.get(row.event_id) || [];
      const venues = [...new Set(eventBookings.map((booking) => booking.venue_name).filter(Boolean))];
      const equipmentRequirements = normalizeSupportEquipmentRequirements(row.equipment_requirements).map(presentSupportEquipment);
      const availability = await equipmentAvailabilityByRequirement(db.query, {
        eventId: row.event_id,
        equipmentRequirements,
        preferredStart: row.preferred_start,
        preferredEnd: row.preferred_end,
        bookings: eventBookings
      });
      return {
        ...row,
        venues,
        venue_bookings: eventBookings,
        equipment_requirements: equipmentRequirements,
        resource_decision: supportDecisionLabel(row.status),
        re_review_safety_check: requiresTechnicalSafetyReapproval(row),
        equipment_availability: availability.rows,
        equipment_availability_window_basis: availability.windowsBasis
      };
    }));
    res.json(hydrated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load technical support requirements' });
  }
});

// Technical Support Staff confirm arrangements or send them back for changes.
app.patch('/api/events/:id/technical-support/decision', auth.authenticate, auth.requireRoles('technical_support_staff'), async (req, res) => {
  let decision;
  try { decision = parseSupportDecision(req.body); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE technical_support_requirements
       SET status = $1, decision_comments = $2, decided_by = $3, decided_at = now(), updated_at = now()
       WHERE event_id = $4
       RETURNING event_id, status, decision_comments, decided_by, decided_at`,
      [decision.status, decision.comments || null, req.auth.sub, req.params.id]
    );
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Technical support requirements not found' }); }
    const event = (await client.query('SELECT id, title, assigned_coordinator_id FROM events WHERE id = $1', [req.params.id])).rows[0];
    if (event?.assigned_coordinator_id) await client.query(
      `INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)`,
      [event.assigned_coordinator_id, event.id, `Technical support review for ${event.title}: ${decision.label}${decision.comments ? ` — ${decision.comments}` : ''}`]
    );
    if (decision.status === 'confirmed') {
      const confirmedEvent = await promoteEventIfReady(client.query.bind(client), req.params.id);
      if (confirmedEvent) await client.query(
        `INSERT INTO notifications (user_id, event_id, message)
         SELECT id, $1, $2 FROM users WHERE role = 'safety_officer'`,
        [confirmedEvent.id, `Event "${confirmedEvent.title}" is ready for an Operational Safety Check.`]
      );
    }
    await client.query('COMMIT');
    res.json({ ...result.rows[0], resource_decision: supportDecisionLabel(result.rows[0].status) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Unable to save the technical support decision. Nothing was changed; please retry.' });
  } finally { client.release(); }
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
    res.json(result.rows.map((row) => ({
      ...row,
      equipment_requirements: normalizeSupportEquipmentRequirements(row.equipment_requirements).map(presentSupportEquipment),
      resource_decision: supportDecisionLabel(row.status)
    })));
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
if (require.main === module) app.listen(port, () => console.log(`Backend listening on port ${port}`));
app.__test__ = {
  parseEventDecisionInput,
  describeEventDecision,
  validateSetupTurnaroundInput,
  validateSupportRequirements,
  parseSupportDecision,
  normalizeSupportEquipmentRequirements,
  presentSupportEquipment,
  eventWindowsForAvailability,
  equipmentAvailabilityByRequirement,
  buildSupportEquipmentRequirements,
  requiresTechnicalSafetyReapproval
};
module.exports = app;
