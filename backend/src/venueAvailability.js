async function findUnavailability(query, booking) {
  const venueId = booking.venueId || booking.venue_id;
  const startTime = booking.startTime || booking.start_time;
  const endTime = booking.endTime || booking.end_time;
  const setupMinutes = booking.setupMinutes ?? booking.setup_minutes ?? 0;
  const turnaroundMinutes = booking.turnaroundMinutes ?? booking.turnaround_minutes ?? 0;
  const result = await query(
    `SELECT id, start_time, end_time, reason
     FROM venue_unavailabilities
     WHERE venue_id = $1
       AND $2::timestamptz - ($4 * interval '1 minute') < end_time
       AND $3::timestamptz + ($5 * interval '1 minute') > start_time
     ORDER BY start_time
     LIMIT 1`,
    [venueId, startTime, endTime, setupMinutes, turnaroundMinutes]
  );
  return result.rows[0] || null;
}

function unavailableMessage(unavailability) {
  return `The venue is unavailable from ${new Date(unavailability.start_time).toLocaleString()} to ${new Date(unavailability.end_time).toLocaleString()}${unavailability.reason ? ` (${unavailability.reason})` : ''}.`;
}

module.exports = { findUnavailability, unavailableMessage };
