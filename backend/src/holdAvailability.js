const { occupiedInterval } = require('./venueOccupancy');
// Use database wall-clock time, including after a transaction waited for locks.
const activeHoldSql = alias => `${alias}.status = 'active' AND ${alias}.expiry_at > clock_timestamp()`;
const effectiveHoldStatus = (hold, now = new Date()) => hold.status === 'active' && new Date(hold.expiry_at) <= now ? 'expired' : hold.status;
// Atomic claim + notification: concurrent readers cannot notify the same expiry twice.
// Unassigned events remain unprocessed, so a later assigned Coordinator can be informed.
async function processHoldExpiries(queryable, { coordinatorId = null, venueId = null } = {}) {
 return queryable.query(`WITH due AS (
   UPDATE venue_holds h SET expiry_notified_at = clock_timestamp()
   FROM events e WHERE e.id = h.event_id AND e.assigned_coordinator_id IS NOT NULL
     AND h.status = 'active' AND h.expiry_at <= clock_timestamp() AND h.expiry_notified_at IS NULL
     AND ($1::uuid IS NULL OR e.assigned_coordinator_id = $1)
     AND ($2::uuid IS NULL OR h.venue_id = $2)
   RETURNING h.id, h.event_id, h.expiry_at, e.assigned_coordinator_id, e.title
 ), sent AS (
   INSERT INTO notifications (user_id, event_id, message)
   SELECT assigned_coordinator_id, event_id,
     'Tentative venue hold expired for "' || title || '". The hold no longer reserves the venue. Hold: ' || id::text
   FROM due RETURNING id
 ) SELECT count(*)::integer AS notified FROM sent`, [coordinatorId, venueId]);
}
async function holdConflicts(queryable, request) {
 await processHoldExpiries(queryable, { venueId: request.venue_id });
 const occupied = occupiedInterval(request);
 const result = await queryable.query(`SELECT h.*, e.title AS event_title FROM venue_holds h LEFT JOIN events e ON e.id = h.event_id
 WHERE h.venue_id = $1 AND ${activeHoldSql('h')}
 AND h.start_time - h.setup_minutes * interval '1 minute' < $3::timestamptz
 AND h.end_time + h.turnaround_minutes * interval '1 minute' > $2::timestamptz
 ORDER BY h.start_time, h.id`, [request.venue_id,occupied.start,occupied.end]);
 return result.rows.map(hold=>({type:'hold',id:hold.id,title:hold.event_title || 'Tentative hold',expiry_at:hold.expiry_at,...occupiedInterval(hold)}));
}
module.exports = { activeHoldSql, effectiveHoldStatus, holdConflicts, processHoldExpiries };
