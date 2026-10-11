// Team policy: venue approval reserves the arrangement, not the overall event.
const OCCUPYING_STATUSES = Object.freeze(['approved', 'confirmed']);
const occupiesVenue = status => OCCUPYING_STATUSES.includes(status);
module.exports = { occupiesVenue, OCCUPYING_STATUSES };

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


module.exports.occupiedInterval = occupiedInterval;
module.exports.overlaps = overlaps;
