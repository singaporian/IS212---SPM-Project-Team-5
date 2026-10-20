const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { OCCUPYING_STATUSES } = require('./venueOccupancy');
const { inServiceQuantity, windowsOverlap, peakCommitted, RELEASED_EVENT_STATUSES } = require('./equipmentReservations');

const EQUIPMENT_TYPES = Object.freeze(['Audio', 'Video & Display', 'Lighting', 'Staging', 'Networking', 'Power & Cabling', 'Furniture', 'Other']);
const MAX_QUANTITY = 2147483647; // largest value the integer column can hold
const MAX_SPECS = 50;

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('Equipment name is required.');
  if (name.length > 200) throw new Error('Equipment name must be at most 200 characters.');
  return name;
}

function validateQuantity(quantity) {
  if (quantity === undefined || quantity === null || quantity === '') throw new Error('Quantity is required.');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number.');
  if (quantity > MAX_QUANTITY) throw new Error('Quantity is too large.');
  return quantity;
}

// US-024: how many units are damaged or under maintenance; zero is allowed.
function validateOutOfService(value, label) {
  if (value === undefined || value === null || value === '') throw new Error(label + ' quantity is required.');
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(label + ' quantity must be a whole number of 0 or more.');
  if (value > MAX_QUANTITY) throw new Error(label + ' quantity is too large.');
  return value;
}

function validateSpecifications(rawSpecs = {}) {
  if (rawSpecs === null || typeof rawSpecs !== 'object' || Array.isArray(rawSpecs)) throw new Error('Specifications must be a list of label and value pairs.');
  const entries = Object.entries(rawSpecs);
  if (entries.length > MAX_SPECS) throw new Error('Too many specifications (maximum ' + MAX_SPECS + ').');
  const specifications = {};
  const seen = new Set();
  for (const [rawLabel, rawValue] of entries) {
    const label = rawLabel.trim();
    if (!label) throw new Error('Each specification needs a label.');
    if (typeof rawValue !== 'string' || !rawValue.trim()) throw new Error('Specification "' + label + '" needs a value.');
    if (label.length > 100 || rawValue.trim().length > 500) throw new Error('Specification "' + label.slice(0, 40) + '" is too long.');
    if (seen.has(label.toLowerCase())) throw new Error('Specification "' + label + '" is listed more than once.');
    seen.add(label.toLowerCase());
    specifications[label] = rawValue.trim();
  }
  return specifications;
}

// New equipment always starts as available; the client cannot choose a status.
function validateEquipment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid equipment details.');
  const name = validateName(input.name);
  if (typeof input.type !== 'string' || !input.type) throw new Error('Equipment type is required.');
  if (!EQUIPMENT_TYPES.includes(input.type)) throw new Error('Choose a valid equipment type.');
  const quantity = validateQuantity(input.quantity);
  const specifications = validateSpecifications(input.specifications ?? {});
  return { name, type: input.type, quantity, specifications };
}

// US-024: the type is fixed once recorded, so it is not part of an update.
function validateEquipmentUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid equipment details.');
  const name = validateName(input.name);
  const quantity = validateQuantity(input.quantity);
  const damagedQuantity = validateOutOfService(input.damagedQuantity, 'Damaged');
  const maintenanceQuantity = validateOutOfService(input.maintenanceQuantity, 'Under maintenance');
  const outOfService = damagedQuantity + maintenanceQuantity;
  if (outOfService > quantity) {
    throw new Error(`Damaged and under-maintenance units (${outOfService}) cannot exceed the total quantity (${quantity}).`);
  }
  const specifications = validateSpecifications(input.specifications ?? {});
  let expectedUpdatedAt = null;
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== null) {
    if (typeof input.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(input.expectedUpdatedAt))) throw new Error('Invalid record version.');
    expectedUpdatedAt = input.expectedUpdatedAt;
  }
  return { name, quantity, damagedQuantity, maintenanceQuantity, specifications, expectedUpdatedAt, confirmReconsideration: input.confirmReconsideration === true };
}

// Upcoming reservations that would no longer fit if only `inService` units remained in service.
// A reservation needs its own units plus the most units other overlapping reservations hold at any one moment.
function findAffectedReservations(reservations, inService) {
  return reservations.filter(reservation => {
    const others = reservations.filter(other => other !== reservation && windowsOverlap(reservation.windows, other.windows));
    return reservation.quantity + peakCommitted(reservation.windows, others) > inService;
  });
}

// Records whose legacy status is not 'available' are out of service as a whole.
function presentEquipment(row) {
  return { ...row, available_quantity: row.status === 'available' ? inServiceQuantity(row) : 0 };
}

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

function plural(count, word) {
  return count + ' ' + word + (count === 1 ? '' : 's');
}

const COLUMNS = 'id, name, equipment_type, total_quantity, damaged_quantity, maintenance_quantity, status, specs, created_at, updated_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('technical_support_staff'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/', async (req, res) => {
  let data;
  try { data = validateEquipment(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const result = await db.query(
      `INSERT INTO equipment (name, equipment_type, total_quantity, status, specs)
       VALUES ($1, $2, $3, 'available', $4::jsonb)
       RETURNING ${COLUMNS}`,
      [data.name, data.type, data.quantity, JSON.stringify(data.specifications)]
    );
    res.status(201).json(presentEquipment(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save the equipment record. Your input is still available; please retry.' });
  }
});

// US-024: every inventory record with how many units are in service.
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`SELECT ${COLUMNS} FROM equipment ORDER BY lower(name), id`);
    res.json(result.rows.map(presentEquipment));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load the equipment inventory. Please retry.' });
  }
});

// Non-UUID paths (e.g. /availability) fall through to the reservations router.
router.get('/:id', async (req, res, next) => {
  if (!UUID.test(req.params.id)) return next();
  try {
    const item = (await db.query(`SELECT ${COLUMNS} FROM equipment WHERE id = $1`, [req.params.id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Equipment not found. It may have been removed.' });
    res.json(presentEquipment(item));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load the equipment record. Please retry.' });
  }
});

// Reservations of this item for live events that have not finished yet, with their scheduled windows.
async function loadUpcomingReservations(query, equipmentId) {
  const result = await query(
    `SELECT r.id, r.quantity, e.id AS event_id, e.title, min(b.start_time) AS starts_at,
            json_agg(json_build_object('start', b.start_time, 'end', b.end_time) ORDER BY b.start_time) AS windows
     FROM equipment_reservations r
     JOIN events e ON e.id = r.event_id
     JOIN bookings b ON b.event_id = e.id AND b.status = ANY($2::text[])
     WHERE r.equipment_id = $1 AND e.status <> ALL($3::text[])
     GROUP BY r.id, e.id
     HAVING max(b.end_time) > now()
     ORDER BY min(b.start_time), e.title`,
    [equipmentId, OCCUPYING_STATUSES, RELEASED_EVENT_STATUSES]
  );
  return result.rows;
}

// Plain-language list of what an update changed, for the notification sent to technical support staff.
function describeChanges(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(`renamed from "${before.name}" to "${after.name}"`);
  if (before.total_quantity !== after.total_quantity) changes.push(`total quantity changed from ${before.total_quantity} to ${after.total_quantity}`);
  if ((before.damaged_quantity || 0) !== after.damaged_quantity) changes.push(`damaged units changed from ${before.damaged_quantity || 0} to ${after.damaged_quantity}`);
  if ((before.maintenance_quantity || 0) !== after.maintenance_quantity) changes.push(`units under maintenance changed from ${before.maintenance_quantity || 0} to ${after.maintenance_quantity}`);
  if (JSON.stringify(before.specs || {}) !== JSON.stringify(after.specs || {})) changes.push('specifications updated');
  return changes;
}

// Saves name, quantity, out-of-service counts and specifications in one transaction.
// If fewer units would remain in service than upcoming events have reserved, nothing is saved until the
// client resends with confirmReconsideration; those reservations are then flagged for reconsideration.
async function updateEquipment(query, id, data, actorId = null) {
  // Locking the row serialises this with reservations of the same item.
  const item = (await query(`SELECT ${COLUMNS} FROM equipment WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!item) throw httpError(404, 'Equipment not found. It may have been removed.');
  if (data.expectedUpdatedAt && new Date(item.updated_at).getTime() !== new Date(data.expectedUpdatedAt).getTime()) {
    throw httpError(409, 'This record was changed by someone else after you opened it. Reload to see the latest details, then reapply your changes.', { code: 'stale' });
  }

  const inService = data.quantity - data.damagedQuantity - data.maintenanceQuantity;
  const affected = inService < inServiceQuantity(item)
    ? findAffectedReservations(await loadUpcomingReservations(query, id), inService)
    : [];
  const impact = affected.map(r => ({ id: r.id, eventId: r.event_id, title: r.title, quantity: r.quantity, startsAt: r.starts_at }));
  if (affected.length && !data.confirmReconsideration) {
    throw httpError(409,
      `Only ${plural(inService, 'unit')} would remain in service, which is fewer than ${affected.length === 1 ? 'an upcoming event has' : affected.length + ' upcoming events have'} reserved. ` +
      'Confirm to save anyway and flag those reservations for reconsideration.',
      { code: 'reservations_affected', impact: { inService, reservations: impact } });
  }

  const updated = (await query(
    `UPDATE equipment SET name = $2, total_quantity = $3, damaged_quantity = $4, maintenance_quantity = $5,
            specs = $6::jsonb, updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, data.name, data.quantity, data.damagedQuantity, data.maintenanceQuantity, JSON.stringify(data.specifications)]
  )).rows[0];
  if (affected.length) {
    await query(
      'UPDATE equipment_reservations SET requires_reconsideration = true, updated_at = now() WHERE id = ANY($1::uuid[])',
      [affected.map(r => r.id)]);
  }

  const equipment = presentEquipment(updated);

  // Every saved change is announced to all technical support staff, in the same transaction as the update.
  const changes = describeChanges(item, equipment);
  if (changes.length) {
    const actor = actorId ? (await query('SELECT name FROM users WHERE id = $1', [actorId])).rows[0] : null;
    const summary = changes.join('; ');
    await query(
      `INSERT INTO notifications (user_id, message)
       SELECT id, $1 FROM users WHERE role = 'technical_support_staff'`,
      [`Equipment "${equipment.name}" was updated by ${actor ? actor.name : 'a technical support staff member'}: ` +
        summary.charAt(0).toUpperCase() + summary.slice(1) + '. ' +
        `${equipment.available_quantity} of ${plural(equipment.total_quantity, 'unit')} now available for events.` +
        (affected.length ? ` ${affected.length === 1 ? '1 reservation was' : affected.length + ' reservations were'} flagged for reconsideration.` : '')]
    );
  }

  const outOfService = [];
  if (equipment.damaged_quantity) outOfService.push(equipment.damaged_quantity + ' damaged');
  if (equipment.maintenance_quantity) outOfService.push(equipment.maintenance_quantity + ' under maintenance');
  const flagged = affected.length
    ? ` ${affected.length === 1 ? '1 reservation was' : affected.length + ' reservations were'} flagged for reconsideration: ${affected.map(r => `"${r.title}"`).join(', ')}.`
    : '';
  return {
    equipment,
    flaggedReservations: impact,
    message: `Changes to "${equipment.name}" were saved. ${equipment.available_quantity} of ${plural(equipment.total_quantity, 'unit')} available for events` +
      (outOfService.length ? ` (${outOfService.join(', ')})` : '') + '.' + flagged
  };
}

router.put('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Equipment not found. It may have been removed.' });
  let data;
  try { data = validateEquipmentUpdate(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const result = await updateEquipment((sql, params) => client.query(sql, params), req.params.id, data, req.auth.sub);
    await client.query('COMMIT');
    res.json(result);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unable to save your changes. The record was not changed. Please retry.',
      ...(error.status && error.code ? { code: error.code } : {}),
      ...(error.impact ? { impact: error.impact } : {})
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = { router, validateEquipment, validateEquipmentUpdate, findAffectedReservations, presentEquipment, describeChanges, updateEquipment, EQUIPMENT_TYPES };
