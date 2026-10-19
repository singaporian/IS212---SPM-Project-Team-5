// Promote an event only after both venue and technical arrangements are confirmed.
async function promoteEventIfReady(query, eventId) {
  const result = await query(
    `UPDATE events e
     SET status = 'confirmed', updated_at = now()
     WHERE e.id = $1 AND e.status IN ('approved', 'planning')
       AND EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.event_id = e.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.event_id = e.id AND b.status NOT IN ('approved', 'confirmed')
       )
       AND EXISTS (
         SELECT 1 FROM technical_support_requirements tsr
         WHERE tsr.event_id = e.id AND tsr.status = 'confirmed'
       )
     RETURNING e.id, e.title`,
    [eventId]
  );
  const event = result.rows[0] || null;
  if (event) {
    await query(
      `UPDATE operational_safety_checks
       SET status = 'pending', comments = NULL, decided_by = NULL, decided_at = NULL, updated_at = now()
       WHERE event_id = $1 AND status = 'changes_requested'`,
      [event.id]
    );
  }
  return event;
}

module.exports = { promoteEventIfReady };