// US-021: Venue Staff update the preparation status of each venue booking of a confirmed event;
// the assigned Event Coordinator sees the status of each venue.
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { EVENT_STATUS, PREPARATION_STATUSES } = require('./domain');
const { OCCUPYING_STATUSES } = require('./venueOccupancy');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// AC2: only Not Started / In Progress / Ready.
function parsePreparationStatus(body) {
  const status = body && typeof body === 'object' ? body.status : undefined;
  if (!PREPARATION_STATUSES.includes(status)) {
    throw Object.assign(new Error('Status must be Not Started, In Progress or Ready.'), { status: 400 });
  }
  return status;
}

const router = express.Router();
const staffOnly = [auth.authenticate, auth.requireRoles('venue_staff')];

function listPreparationRows(coordinatorId = null) {
  return db.query(
    `SELECT b.id, b.event_id, e.title AS event_title, v.name AS venue_name,
            b.start_time, b.end_time, b.preparation_status
     FROM bookings b JOIN events e ON e.id = b.event_id JOIN venues v ON v.id = b.venue_id
       JOIN operational_safety_checks osc ON osc.event_id = e.id AND osc.status = 'approved'
     WHERE e.status = $1 AND b.status = ANY($2::text[]) AND b.start_time > now()
       AND ($3::uuid IS NULL OR e.assigned_coordinator_id = $3)
     ORDER BY b.start_time, v.name`,
    [EVENT_STATUS.CONFIRMED, OCCUPYING_STATUSES, coordinatorId]
  );
}
//US21-AC1: one row per venue booking of a confirmed (safety-approved) upcoming event.
router.get('/bookings', ...staffOnly, async (req, res) => {
  try {
    const result = await listPreparationRows();
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load preparation status. Please retry.' });
  }
});

//US21- AC2, AC4, AC5, AC6: save the status of one venue booking only.
router.patch('/bookings/:id', ...staffOnly, async (req, res) => {
  let status;
  try { status = parsePreparationStatus(req.body); }
  catch (error) { return res.status(error.status).json({ error: error.message }); }
  if (!uuidPattern.test(req.params.id)) return res.status(404).json({ error: 'Venue booking not found.' });
  try {
    const found = await db.query(
      `SELECT b.id, e.status AS event_status, osc.status AS safety_status
       FROM bookings b JOIN events e ON e.id = b.event_id
       LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!found.rows[0]) return res.status(404).json({ error: 'Venue booking not found.' });
    if (found.rows[0].event_status !== EVENT_STATUS.CONFIRMED || found.rows[0].safety_status !== 'approved') {
      return res.status(409).json({ error: 'Preparation status can only be set after the Operational Safety Check is approved.' });
    }
    const updated = await db.query(
      'UPDATE bookings SET preparation_status = $1 WHERE id = $2 RETURNING id, preparation_status',
      [status, req.params.id]
    );
    res.json(updated.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save preparation status. Please retry.' });
  }
});

// AC3: the assigned Coordinator sees each venue's status for their own events only.
router.get('/mine', auth.authenticate, auth.requireRoles('event_coordinator'), async (req, res) => {
  try {
       const result = await listPreparationRows(req.auth.sub);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load preparation status. Please retry.' });
  }
});

module.exports = { router, parsePreparationStatus };
