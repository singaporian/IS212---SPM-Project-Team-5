const express = require('express');
const db = require('./db');
const auth = require('./auth');
const fields = ['eventName', 'startDate', 'startTime', 'endDate', 'endTime',
  'expectedAttendance', 'purpose', 'description', 'venueRequirements',
  'accessibilityNeeds', 'equipmentRequirements', 'registrationNeeds'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldError(field, message) {
  return Object.assign(new Error(message), { fields: { [field]: message } });
}

function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid draft fields.');
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unknown draft field.');
  const data = {};
  for (const field of fields) {
    const value = input[field] ?? (field === 'registrationNeeds' ? 'not_decided' : '');
    if (typeof value !== 'string' || value.length > 10000) throw fieldError(field, field + ' must be text of at most 10,000 characters.');
    data[field] = value;
  }
  for (const field of ['startDate', 'endDate']) {
    const value = data[field];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)) throw fieldError(field, 'Enter a valid date.');
  }
  for (const field of ['startTime', 'endTime']) {
    if (data[field] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data[field])) throw fieldError(field, 'Enter a valid clock time.');
  }
  const attendance = data.expectedAttendance.trim().toLowerCase();
  if (attendance && !/^\d+$/.test(attendance) && !['not decided', 'none', 'not required'].includes(attendance)) {
    throw fieldError('expectedAttendance', "Enter a positive whole number.");
  }
  if (!['not_decided', 'yes', 'no'].includes(data.registrationNeeds)) throw fieldError('registrationNeeds', 'Invalid registration needs.');
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    throw fieldError('endDate', 'End date must not be earlier than the start date.');
  }
  if (data.startDate && data.startDate === data.endDate && data.startTime && data.endTime && data.endTime <= data.startTime) {
    throw fieldError('endTime', 'End time must be later than the start time.');
  }
  return data;
}

const router = express.Router();
router.use(auth.authenticate, auth.requireRoles('event_organiser'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.param('id', (req, res, next, id) => {
  if (!uuid.test(id)) return res.status(404).json({ error: 'Draft not found.' });
  next();
});
router.get('/', async (req, res) => {
  try {
    const result = await db.query("SELECT id, title, status, updated_at FROM events WHERE organiser_id = $1 AND status = 'draft' ORDER BY updated_at DESC", [req.auth.sub]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load drafts. Please retry.' });
  }
});
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query("SELECT id, draft_data, status, updated_at, md5(draft_data::text) AS version FROM events WHERE id = $1 AND organiser_id = $2 AND status = 'draft'", [req.params.id, req.auth.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Draft not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load draft. Please retry.' });
  }
});
// Stable client UUIDs make retries safe even after a lost response.
// A single statement atomically writes all fields and checks ownership/status.
router.put('/:id', async (req, res) => {
  let data;
  try { data = validateDraft(req.body); }
  catch (error) { return res.status(400).json({ error: error.message, fields: error.fields || {} }); }
  try {
    const result = await db.query(`INSERT INTO events (id, organiser_id, title, draft_data, status)
      VALUES ($1, $2, $3, $4::jsonb, 'draft')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, draft_data = EXCLUDED.draft_data, updated_at = now()
      WHERE events.organiser_id = $2 AND events.status = 'draft'
      RETURNING id, draft_data, status, updated_at, md5(draft_data::text) AS version`, [req.params.id, req.auth.sub, data.eventName, JSON.stringify(data)]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Draft not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save draft. Your input is still available; please retry.' });
  }
});
module.exports = { router, validateDraft };
