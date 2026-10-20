const express = require('express');
const db = require('./db');
const auth = require('./auth');

const router = express.Router();
const SAFETY_DECISIONS = ['approved', 'rejected', 'changes_requested'];

function safetyError(message) { return Object.assign(new Error(message), { status: 400 }); }

function parseSafetyDecision(body = {}) {
  const decision = body.decision;
  const comments = body.comments ?? '';
  const scopes = Array.isArray(body.changeScope) ? [...new Set(body.changeScope)] : [];
  if (!SAFETY_DECISIONS.includes(decision)) throw safetyError('Choose approve, reject, or request changes');
  if (typeof comments !== 'string' || comments.trim().length > 2000) throw safetyError('Comments must be 2,000 characters or fewer');
  if (decision === 'changes_requested' && (!scopes.length || scopes.some(scope => !['venue', 'technical'].includes(scope)))) {
    throw safetyError('Select whether venue arrangements, technical arrangements, or both require changes');
  }
  return { decision, comments: comments.trim(), scopes };
}

router.use(auth.authenticate, auth.requireRoles('safety_officer'));

// US-039 AC1/AC2: Safety Officers see confirmed events with complete venue arrangements.
router.get('/checks', async (req, res) => {
  try {
    const history = req.query.view === 'history';
    const safetyFilter = history ? "c.status IN ('approved', 'rejected', 'changes_requested')" : "(c.status IS NULL OR c.status = 'pending')";
    const readinessFilter = history ? 'TRUE' : "e.status = 'confirmed' AND tsr.status = 'confirmed'";
    const result = await db.query(
      `SELECT e.id, e.title, e.status, e.expected_attendance, e.preferred_start, e.preferred_end,
              e.venue_layout_preference, e.accessibility_requirements, e.equipment_requirements,
              e.programme, e.special_arrangements,
              tsr.status AS technical_status, tsr.support_required AS technical_support_required,
              tsr.staff_required AS technical_staff_required, tsr.equipment_requirements AS technical_equipment_requirements,
              tsr.decision_comments AS technical_decision_comments,
              c.status AS safety_status, c.comments, c.change_scope AS safety_change_scope, c.decided_at,
              u.name AS safety_decided_by,
              COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                'id', b.id, 'venue_id', b.venue_id, 'venue_name', v.name,
                'capacity', v.capacity, 'start_time', b.start_time, 'end_time', b.end_time,
                'status', b.status, 'venue_requirements', b.venue_requirements,
                'facilities', v.facilities, 'accessibility', v.accessibility,
                'supported_layouts', v.supported_layouts, 'venue_notes', v.notes,
                'available_from', v.available_from, 'available_until', v.available_until,
                'setup_minutes', b.setup_minutes, 'turnaround_minutes', b.turnaround_minutes,
                'operating_hours', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'day_of_week', voh.day_of_week, 'opens_at', voh.opens_at, 'closes_at', voh.closes_at
                ) ORDER BY voh.day_of_week), '[]'::jsonb) FROM venue_operating_hours voh WHERE voh.venue_id = v.id),
                'unavailability', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'start_time', vu.start_time, 'end_time', vu.end_time, 'reason', vu.reason
                ) ORDER BY vu.start_time), '[]'::jsonb) FROM venue_unavailabilities vu
                WHERE vu.venue_id = v.id
                  AND b.start_time - (b.setup_minutes * interval '1 minute') < vu.end_time
                  AND b.end_time + (b.turnaround_minutes * interval '1 minute') > vu.start_time)
              )) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb) AS bookings
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       JOIN venues v ON v.id = b.venue_id
      JOIN technical_support_requirements tsr ON tsr.event_id = e.id
       LEFT JOIN operational_safety_checks c ON c.event_id = e.id
      LEFT JOIN users u ON u.id = c.decided_by
      WHERE ${readinessFilter} AND ${safetyFilter}
      GROUP BY e.id, c.status, c.comments, c.change_scope, c.decided_at, u.name, tsr.status, tsr.support_required,
          tsr.staff_required, tsr.equipment_requirements, tsr.decision_comments
       HAVING bool_and(b.status IN ('approved', 'confirmed'))
       ORDER BY e.preferred_start NULLS LAST, e.updated_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load operational safety checks' });
  }
});

// US-039 AC3/AC4/AC5/AC6/AC7/AC8: record one decision and notify the assigned Coordinator.
router.patch('/checks/:eventId', async (req, res) => {
  let decision, comments, scopes;
  try { ({ decision, comments, scopes } = parseSafetyDecision(req.body)); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const event = (await client.query(
      `SELECT e.id, e.title, e.assigned_coordinator_id, e.status, osc.status AS safety_status,
              count(b.id)::int AS booking_count,
              bool_and(b.status IN ('approved', 'confirmed')) AS arrangements_confirmed
      FROM events e
      JOIN technical_support_requirements tsr ON tsr.event_id = e.id AND tsr.status = 'confirmed'
      LEFT JOIN bookings b ON b.event_id = e.id
      LEFT JOIN operational_safety_checks osc ON osc.event_id = e.id
       WHERE e.id = $1 GROUP BY e.id, osc.status`, [req.params.eventId]
    )).rows[0];
    if (!event) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Event not found' }); }
    if (event.safety_status === 'approved' || event.safety_status === 'rejected') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This Operational Safety Check has already been decided.' });
    }
    if (event.status !== 'confirmed' || event.booking_count < 1 || !event.arrangements_confirmed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Safety checks are available only after all venue arrangements are confirmed' });
    }
    const result = await client.query(
      `INSERT INTO operational_safety_checks (event_id, status, change_scope, comments, decided_by, decided_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (event_id) DO UPDATE SET status = EXCLUDED.status, comments = EXCLUDED.comments,
         change_scope = EXCLUDED.change_scope, decided_by = EXCLUDED.decided_by,
         decided_at = EXCLUDED.decided_at, updated_at = now()
       RETURNING id, event_id, status, change_scope, comments, decided_by, decided_at`,
      [event.id, decision, scopes, comments.trim() || null, req.auth.sub]
    );
    const nextEventStatus = decision === 'changes_requested' ? 'planning' : 'confirmed';
    await client.query('UPDATE events SET status = $1, updated_at = now() WHERE id = $2', [nextEventStatus, event.id]);
    await client.query(
      `INSERT INTO notifications (user_id, event_id, message)
       SELECT assigned_coordinator_id, id, $1 FROM events WHERE id = $2 AND assigned_coordinator_id IS NOT NULL`,
      [`Operational Safety Check ${decision.replace('_', ' ')} for ${event.title}${scopes.length ? ` (${scopes.join(' and ')} changes)` : ''}${comments.trim() ? `: ${comments.trim()}` : ''}`, event.id]
    );
    await client.query(
      `INSERT INTO event_changes (event_id, changed_by, change_summary) VALUES ($1, $2, $3)`,
      [event.id, req.auth.sub, `Operational Safety Check: ${decision}${comments.trim() ? ` — ${comments.trim()}` : ''}`]
    );
    await client.query('COMMIT');
    res.json({ ...result.rows[0], event_status: nextEventStatus });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Unable to save the safety decision. Nothing was changed; please retry.' });
  } finally {
    client.release();
  }
});

module.exports = { router, SAFETY_DECISIONS, parseSafetyDecision };
