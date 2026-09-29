const express = require('express');
const db = require('./db');
const auth = require('./auth');

// Only confirmed bookings have source-backed reservation semantics for US-019.
// Approved and other states remain contextual records pending lifecycle clarification.
const RESERVED_STATUSES = new Set(['confirmed']);

function occupiedInterval(booking) {
  // Missing values add no buffer; do not use the domain model's 30-minute defaults.
  return {
    start: new Date(new Date(booking.start_time).getTime() - Number(booking.setup_minutes ?? 0) * 60000).toISOString(),
    end: new Date(new Date(booking.end_time).getTime() + Number(booking.turnaround_minutes ?? 0) * 60000).toISOString()
  };
}

function overlaps(first, second) {
  // Implementation convention: strict overlap excludes exact touching.
  // This boundary is not a customer/team-confirmed rule or manual acceptance criterion.
  return new Date(first.start) < new Date(second.end) && new Date(first.end) > new Date(second.start);
}

function reviewConflicts(request, bookings, unavailability) {
  const occupied = occupiedInterval(request);
  return [
    ...bookings.filter(booking => booking.id !== request.id && booking.venue_id === request.venue_id &&
      RESERVED_STATUSES.has(booking.status) && overlaps(occupied, occupiedInterval(booking)))
      .map(booking => ({ type: 'booking', id: booking.id, status: booking.status,
        title: booking.event_title || 'Reserved booking', ...occupiedInterval(booking) })),
    ...unavailability.filter(period => period.venue_id === request.venue_id &&
      overlaps(occupied, { start: period.start_time, end: period.end_time }))
      .map(period => ({ type: 'unavailability', id: period.id, title: period.reason || 'Recorded unavailability',
        start: period.start_time, end: period.end_time }))
  ];
}

const router = express.Router();
router.get('/:id/review', auth.authenticate, auth.requireRoles('venue_staff'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(404).json({ error: 'Booking request not found.' });
  }
  try {
    const result = await db.query(`SELECT b.*, e.title AS event_title,
      e.expected_attendance, e.preferred_start, e.preferred_end, e.venue_layout_preference,
      e.accessibility_requirements, e.equipment_requirements, e.draft_data
      FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.id = $1`, [req.params.id]);
    const request = result.rows[0];
    if (!request) return res.status(404).json({ error: 'Booking request not found.' });
    const occupied = occupiedInterval(request);
    const venue = await db.query(`SELECT id, name, location, capacity, facilities, accessibility,
      supported_layouts, available_from::text, available_until::text, notes FROM venues WHERE id = $1`, [request.venue_id]);
    if (!venue.rows[0]) return res.status(404).json({ error: 'Venue information not found.' });
    // Show nearby records on the Singapore calendar days touched by the occupied interval.
    // Include their buffers so a neighbouring event extending into the window is not missed.
    const bounds = [request.venue_id, occupied.start, occupied.end];
    const bookings = await db.query(`SELECT b.id, b.venue_id, b.start_time, b.end_time, b.status,
      b.setup_minutes, b.turnaround_minutes, e.title AS event_title
      FROM bookings b LEFT JOIN events e ON e.id = b.event_id
      WHERE b.venue_id = $1 AND b.id <> $4
      AND b.end_time + COALESCE(b.turnaround_minutes, 0) * interval '1 minute' >=
        (date_trunc('day', $2::timestamptz AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')
      AND b.start_time - COALESCE(b.setup_minutes, 0) * interval '1 minute' <
        ((date_trunc('day', $3::timestamptz AT TIME ZONE 'Asia/Singapore') + interval '1 day') AT TIME ZONE 'Asia/Singapore')
      ORDER BY b.start_time, b.id`, [...bounds, request.id]);
    const unavailability = await db.query(`SELECT id, venue_id, start_time, end_time, reason FROM venue_unavailabilities
      WHERE venue_id = $1 AND end_time >=
        (date_trunc('day', $2::timestamptz AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')
      AND start_time <
        ((date_trunc('day', $3::timestamptz AT TIME ZONE 'Asia/Singapore') + interval '1 day') AT TIME ZONE 'Asia/Singapore')
      ORDER BY start_time, id`, bounds);
    const hours = await db.query(`SELECT day_of_week, opens_at::text, closes_at::text
      FROM venue_operating_hours WHERE venue_id = $1 ORDER BY day_of_week`, [request.venue_id]);
    res.json({ request, venue: venue.rows[0], occupied,
      bookings: bookings.rows.map(booking => ({ ...booking, occupied: occupiedInterval(booking) })),
      unavailability: unavailability.rows, operating_hours: hours.rows,
      conflicts: reviewConflicts(request, bookings.rows, unavailability.rows) });
  } catch (error) {
    console.error('Booking review failed:', error.code || error.message);
    res.status(500).json({ error: 'Unable to load booking review. Please retry.' });
  }
});

module.exports = { router, occupiedInterval, overlaps, reviewConflicts };
