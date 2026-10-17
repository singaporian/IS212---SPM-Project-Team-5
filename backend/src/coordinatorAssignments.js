// US-034: the Event Coordinator Lead assigns and reassigns Event Coordinators to event requests.
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { EventRequest, ACTIVE_STATUSES } = require('./domain');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// currentCoordinatorId is the coordinator the Lead saw when choosing (null for the unassigned queue).
// It lets the server refuse a change made against an out-of-date view.
function validateAssignment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid assignment details.');
  if (typeof input.coordinatorId !== 'string' || !UUID.test(input.coordinatorId)) throw new Error('Choose an Event Coordinator.');
  if (!Object.prototype.hasOwnProperty.call(input, 'currentCoordinatorId') ||
    (input.currentCoordinatorId !== null && (typeof input.currentCoordinatorId !== 'string' || !UUID.test(input.currentCoordinatorId)))) {
    throw new Error('Refresh the page and try again.');
  }
  return { coordinatorId: input.coordinatorId, currentCoordinatorId: input.currentCoordinatorId };
}

// Basic information the Lead reviews before assigning.
const EVENT_FIELDS = `e.id, e.title, e.event_type, e.status, e.preferred_start, e.preferred_end, e.expected_attendance,
  e.purpose, e.description, e.submitted_at, e.created_at, e.assigned_coordinator_id,
  o.name AS organiser_name, o.email AS organiser_email, c.name AS coordinator_name, c.email AS coordinator_email`;

// The unassigned queue, every coordinator's active workload, and every active assignment.
async function loadAssignmentOverview(query) {
  const [unassigned, assignments, coordinators] = await Promise.all([
    query(
      `SELECT ${EVENT_FIELDS}
       FROM events e
       LEFT JOIN users o ON o.id = e.organiser_id
       LEFT JOIN users c ON c.id = e.assigned_coordinator_id
       WHERE e.status = ANY($1::text[]) AND e.assigned_coordinator_id IS NULL
       ORDER BY COALESCE(e.submitted_at, e.created_at) ASC`,
      [ACTIVE_STATUSES]),
    query(
      `SELECT ${EVENT_FIELDS}
       FROM events e
       LEFT JOIN users o ON o.id = e.organiser_id
       JOIN users c ON c.id = e.assigned_coordinator_id
       WHERE e.status = ANY($1::text[])
       ORDER BY c.name, e.preferred_start NULLS LAST, e.title`,
      [ACTIVE_STATUSES]),
    query(
      `SELECT u.id, u.name, u.email, count(e.id)::int AS active_count
       FROM users u
       LEFT JOIN events e ON e.assigned_coordinator_id = u.id AND e.status = ANY($1::text[])
       WHERE u.role = 'event_coordinator'
       GROUP BY u.id
       ORDER BY u.name`,
      [ACTIVE_STATUSES])
  ]);
  return { unassigned: unassigned.rows, assignments: assignments.rows, coordinators: coordinators.rows };
}

// Assign an unassigned request, or reassign it to a different coordinator, as the Lead `leadId`. Both coordinators are notified.
// Runs inside the caller's transaction; throws a 400/404/409 httpError when the change is not allowed.
async function assignEventCoordinator(query, eventId, { coordinatorId, currentCoordinatorId }, leadId) {
  // Locking the event serialises concurrent assignments of the same request.
  const eventResult = await query(
    'SELECT id, title, status, organiser_id, assigned_coordinator_id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  if (!eventResult.rows[0]) throw httpError(404, 'Event request not found.');
  const request = EventRequest.fromRow(eventResult.rows[0]);
  if (request.assignedCoordinatorId !== currentCoordinatorId) {
    throw httpError(409, `"${request.title}" was assigned by someone else while you were viewing it. The list has been refreshed; review it and try again.`);
  }

  const people = await query(
    'SELECT id, name, role FROM users WHERE id = ANY($1::uuid[])',
    [[coordinatorId, leadId, request.assignedCoordinatorId].filter(Boolean)]);
  const byId = new Map(people.rows.map(user => [user.id, user]));
  const coordinator = byId.get(coordinatorId);
  if (!coordinator || coordinator.role !== 'event_coordinator') throw httpError(400, 'Choose an Event Coordinator.');

  let previousCoordinatorId;
  try { previousCoordinatorId = request.assignCoordinator(coordinator.id); }
  catch (error) { throw httpError(409, error.message + '.'); }
  const previous = previousCoordinatorId ? byId.get(previousCoordinatorId) : null;
  const previousName = previous ? previous.name : 'the previous coordinator';
  const leadName = byId.get(leadId)?.name || 'the Event Coordinator Lead';

  await query('UPDATE events SET assigned_coordinator_id = $1, updated_at = now() WHERE id = $2', [coordinator.id, request.id]);
  await query(
    'INSERT INTO event_changes (event_id, changed_by, change_summary) VALUES ($1, $2, $3)',
    [request.id, leadId, previousCoordinatorId
      ? `Coordinator reassigned from ${previousName} to ${coordinator.name}`
      : `Coordinator assigned: ${coordinator.name}`]);
  await query(
    'INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)',
    [coordinator.id, request.id, previousCoordinatorId
      ? `Event request "${request.title}" has been reassigned to you from ${previousName} by ${leadName}.`
      : `Event request "${request.title}" has been assigned to you by ${leadName}.`]);
  if (previousCoordinatorId) {
    await query(
      'INSERT INTO notifications (user_id, event_id, message) VALUES ($1, $2, $3)',
      [previousCoordinatorId, request.id,
        `Event request "${request.title}" has been reassigned from you to ${coordinator.name} by ${leadName}. It is no longer in your assigned requests.`]);
  }

  return {
    event: { id: request.id, title: request.title, status: request.status, assigned_coordinator_id: coordinator.id, coordinator_name: coordinator.name },
    previous_coordinator_id: previousCoordinatorId,
    message: previousCoordinatorId
      ? `Reassigned "${request.title}" from ${previousName} to ${coordinator.name}. Both coordinators have been notified.`
      : `Assigned "${request.title}" to ${coordinator.name}. They have been notified.`
  };
}

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('event_coordinator_lead'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/overview', async (req, res) => {
  try {
    res.json(await loadAssignmentOverview(db.query));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load coordinator assignments. Please retry.' });
  }
});

router.patch('/events/:id/coordinator', async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Event request not found.' });
  let data;
  try { data = validateAssignment(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const result = await assignEventCoordinator((sql, params) => client.query(sql, params), req.params.id, data, req.auth.sub);
    await client.query('COMMIT');
    res.json(result);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to save the assignment. Nothing was changed. Please retry.' });
  } finally {
    if (client) client.release();
  }
});

module.exports = { router, validateAssignment, loadAssignmentOverview, assignEventCoordinator };
