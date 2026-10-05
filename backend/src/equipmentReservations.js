// US-023: reserve equipment for an event without over-committing it to overlapping events.
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { OCCUPYING_STATUSES } = require('./venueOccupancy');

// 'approved' is the status the Coordinator decision endpoint writes; 'planning'/'confirmed' are the domain names for it.
const RESERVABLE_EVENT_STATUSES = Object.freeze(['approved', 'planning', 'confirmed']);
// Reservations on events in these states never hold stock, even if a row was somehow left behind.
const RELEASED_EVENT_STATUSES = Object.freeze(['cancelled', 'rejected', 'completed']);
const MAX_QUANTITY = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateReservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid reservation details.');
  if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new Error('Choose an event.');
  if (typeof input.equipmentId !== 'string' || !UUID.test(input.equipmentId)) throw new Error('Choose the equipment to reserve.');
  const quantity = input.quantity;
  if (quantity === undefined || quantity === null || quantity === '') throw new Error('Quantity is required.');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number.');
  if (quantity > MAX_QUANTITY) throw new Error('Quantity is too large.');
  return { eventId: input.eventId, equipmentId: input.equipmentId, quantity };
}

// Sorted, non-overlapping [start, end) intervals in milliseconds. Windows that only touch are kept apart.
function mergeWindows(windows) {
  const sorted = (windows || [])
    .map(w => ({ start: new Date(w.start).getTime(), end: new Date(w.end).getTime() }))
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start < last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

// Two events overlap when any of their scheduled windows intersect (touching end-to-start does not count).
function windowsOverlap(first, second) {
  return mergeWindows(first).some(a => mergeWindows(second).some(b => a.start < b.end && b.start < a.end));
}

// Highest number of units held by other events at any single moment inside the target's windows.
// A plain sum would wrongly reject when two other events overlap the target but not each other.
function peakCommitted(targetWindows, others) {
  const target = mergeWindows(targetWindows);
  const changes = [];
  for (const other of others) {
    for (const w of mergeWindows(other.windows)) {
      for (const t of target) {
        const start = Math.max(w.start, t.start), end = Math.min(w.end, t.end);
        if (start < end) changes.push([start, other.quantity], [end, -other.quantity]);
      }
    }
  }
  // At equal times, releases happen before new holds so touching windows do not stack.
  changes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 0;
  for (const [, delta] of changes) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

// Scheduled windows come from venue bookings that occupy the venue (approved/confirmed).
async function loadEvent(query, eventId) {
  const result = await query(
    `SELECT e.id, e.title, e.status,
            COALESCE(json_agg(json_build_object('start', b.start_time, 'end', b.end_time) ORDER BY b.start_time)
                     FILTER (WHERE b.id IS NOT NULL), '[]'::json) AS windows
     FROM events e
     LEFT JOIN bookings b ON b.event_id = e.id AND b.status = ANY($2::text[])
     WHERE e.id = $1
     GROUP BY e.id`,
    [eventId, OCCUPYING_STATUSES]
  );
  return result.rows[0] || null;
}

function assertReservable(event) {
  if (!event) throw httpError(404, 'Event not found.');
  if (!RESERVABLE_EVENT_STATUSES.includes(event.status)) {
    throw httpError(409, `"${event.title}" is not an approved event, so equipment cannot be reserved for it.`);
  }
  if (!event.windows.length) throw httpError(409, `"${event.title}" has no approved venue booking yet, so it has no scheduled time to reserve against.`);
  if (Math.max(...event.windows.map(w => new Date(w.end).getTime())) <= Date.now()) {
    throw httpError(409, `"${event.title}" has already ended.`);
  }
}

// Reservations held by other live events, with each event's scheduled windows.
async function loadOtherReservations(query, eventId, equipmentId = null) {
  const result = await query(
    `SELECT r.equipment_id, r.quantity, e.id AS event_id, e.title,
            COALESCE(json_agg(json_build_object('start', b.start_time, 'end', b.end_time))
                     FILTER (WHERE b.id IS NOT NULL), '[]'::json) AS windows
     FROM equipment_reservations r
     JOIN events e ON e.id = r.event_id
     LEFT JOIN bookings b ON b.event_id = e.id AND b.status = ANY($3::text[])
     WHERE r.event_id <> $1 AND ($2::uuid IS NULL OR r.equipment_id = $2)
       AND e.status <> ALL($4::text[])
     GROUP BY r.id, e.id`,
    [eventId, equipmentId, OCCUPYING_STATUSES, RELEASED_EVENT_STATUSES]
  );
  return result.rows;
}

function describeAvailability(item, event, others, reservation) {
  const overlapping = others.filter(o => o.equipment_id === item.id && windowsOverlap(event.windows, o.windows));
  const committedElsewhere = peakCommitted(event.windows, overlapping);
  const reservedForEvent = reservation ? reservation.quantity : 0;
  return {
    id: item.id,
    name: item.name,
    equipment_type: item.equipment_type,
    status: item.status,
    total_quantity: item.total_quantity,
    committed_elsewhere: committedElsewhere,
    reserved_for_event: reservedForEvent,
    available: Math.max(0, item.total_quantity - committedElsewhere - reservedForEvent),
    reservation: reservation ? { id: reservation.id, quantity: reservation.quantity, status: reservation.status, updated_at: reservation.updated_at } : null,
    overlapping_events: overlapping.map(o => ({ id: o.event_id, title: o.title, quantity: o.quantity }))
  };
}

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('technical_support_staff'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Approved events that still have a future scheduled window.
router.get('/reservable-events', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.id, e.title, e.status,
              json_agg(json_build_object('start', b.start_time, 'end', b.end_time, 'venue', v.name) ORDER BY b.start_time) AS windows,
              (SELECT COALESCE(sum(r.quantity), 0)::int FROM equipment_reservations r WHERE r.event_id = e.id) AS reserved_units
       FROM events e
       JOIN bookings b ON b.event_id = e.id AND b.status = ANY($1::text[])
       LEFT JOIN venues v ON v.id = b.venue_id
       WHERE e.status = ANY($2::text[])
       GROUP BY e.id
       HAVING max(b.end_time) > now()
       ORDER BY min(b.start_time), e.title`,
      [OCCUPYING_STATUSES, RESERVABLE_EVENT_STATUSES]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load events. Please retry.' });
  }
});

// Every inventory item with how many units are free during the chosen event's schedule.
router.get('/availability', async (req, res) => {
  const eventId = String(req.query.eventId || '');
  if (!UUID.test(eventId)) return res.status(400).json({ error: 'Choose an event.' });
  try {
    const event = await loadEvent(db.query, eventId);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const [equipment, reservations, others] = await Promise.all([
      db.query('SELECT id, name, equipment_type, status, total_quantity FROM equipment ORDER BY name'),
      db.query('SELECT id, equipment_id, quantity, status, updated_at FROM equipment_reservations WHERE event_id = $1', [eventId]),
      loadOtherReservations(db.query, eventId)
    ]);
    const byEquipment = new Map(reservations.rows.map(r => [r.equipment_id, r]));
    res.json({
      event,
      equipment: equipment.rows.map(item => describeAvailability(item, event, others, byEquipment.get(item.id)))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load equipment availability. Please retry.' });
  }
});

// Reserve additional units for an event. Repeating a reservation adds to the event's existing row.
router.post('/reservations', async (req, res) => {
  let data;
  try { data = validateReservation(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  let client;
  try {
    client = await db.pool.connect();
    const query = (sql, params) => client.query(sql, params);
    await client.query('BEGIN');
    // Locking the equipment row serialises reservations for the same item, so two staff cannot both take the last units.
    const equipmentResult = await query(
      'SELECT id, name, equipment_type, status, total_quantity FROM equipment WHERE id = $1 FOR UPDATE', [data.equipmentId]);
    const item = equipmentResult.rows[0];
    if (!item) throw httpError(404, 'Equipment not found.');
    if (item.status !== 'available') throw httpError(409, `"${item.name}" is not in service, so it cannot be reserved.`);

    const event = await loadEvent(query, data.eventId);
    assertReservable(event);

    const existing = (await query(
      'SELECT id, quantity FROM equipment_reservations WHERE equipment_id = $1 AND event_id = $2',
      [item.id, event.id])).rows[0];
    const overlapping = (await loadOtherReservations(query, event.id, item.id))
      .filter(o => windowsOverlap(event.windows, o.windows));
    const committedElsewhere = peakCommitted(event.windows, overlapping);
    const alreadyReserved = existing ? existing.quantity : 0;
    const available = Math.max(0, item.total_quantity - committedElsewhere - alreadyReserved);

    if (data.quantity > available) {
      const names = overlapping.map(o => `"${o.title}" (${o.quantity})`).join(', ');
      const reason = committedElsewhere
        ? `${committedElsewhere} of ${item.total_quantity} are already committed to overlapping events: ${names}.`
        : `Only ${item.total_quantity} unit${item.total_quantity === 1 ? ' is' : 's are'} in inventory.`;
      const already = alreadyReserved ? ` ${alreadyReserved} ${alreadyReserved === 1 ? 'is' : 'are'} already reserved for this event.` : '';
      throw Object.assign(httpError(409,
        `Reservation conflict: only ${available} "${item.name}" unit${available === 1 ? ' is' : 's are'} available during "${event.title}". ${reason}${already}`),
      { conflict: { available, requested: data.quantity, overlappingEvents: overlapping.map(o => ({ id: o.event_id, title: o.title, quantity: o.quantity })) } });
    }

    const saved = await query(
      `INSERT INTO equipment_reservations (equipment_id, event_id, quantity, status, reserved_by)
       VALUES ($1, $2, $3, 'reserved', $4)
       ON CONFLICT (equipment_id, event_id) DO UPDATE SET
         quantity = equipment_reservations.quantity + EXCLUDED.quantity,
         status = 'reserved', reserved_by = EXCLUDED.reserved_by, updated_at = now()
       RETURNING id, equipment_id, event_id, quantity, status, updated_at`,
      [item.id, event.id, data.quantity, req.auth.sub]);
    await client.query('COMMIT');

    const reservation = saved.rows[0];
    res.status(existing ? 200 : 201).json({
      reservation,
      remaining: available - data.quantity,
      message: `Reserved ${data.quantity} "${item.name}" unit${data.quantity === 1 ? '' : 's'} for "${event.title}". ` +
        `${reservation.quantity} now reserved for this event.`
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unable to save the reservation. Nothing was changed. Please retry.',
      ...(error.conflict ? { conflict: error.conflict } : {})
    });
  } finally {
    if (client) client.release();
  }
});

// Manually removing a reservation returns its units to available stock immediately.
router.delete('/reservations/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Reservation not found.' });
  try {
    const result = await db.query(
      `DELETE FROM equipment_reservations r
       USING equipment q, events e
       WHERE r.id = $1 AND q.id = r.equipment_id AND e.id = r.event_id
       RETURNING r.id, r.quantity, q.name AS equipment_name, e.title AS event_title`,
      [req.params.id]);
    const removed = result.rows[0];
    if (!removed) return res.status(404).json({ error: 'Reservation not found. It may already have been removed.' });
    res.json({
      removed,
      message: `Removed the reservation of ${removed.quantity} "${removed.equipment_name}" unit${removed.quantity === 1 ? '' : 's'} for "${removed.event_title}". They are back in available stock.`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to remove the reservation. Nothing was changed. Please retry.' });
  }
});

module.exports = { router, validateReservation, mergeWindows, windowsOverlap, peakCommitted, RESERVABLE_EVENT_STATUSES };
