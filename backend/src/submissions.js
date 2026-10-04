const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { validateDraft } = require('./drafts');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholders = ['none', 'not required', 'not decided'];

function validateSubmission(input) {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = {};
  const name = typeof values.eventName === 'string' ? values.eventName.trim() : '';
  if (!name) errors.eventName = 'Event Name: enter an event name.';
  for (const [field, label] of [['startDate', 'Start Date'], ['endDate', 'End Date']]) {
    const date = values[field];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date) errors[field] = `${label}: enter a valid date.`;
  }
  for (const [field, label] of [['startTime', 'Start Time'], ['endTime', 'End Time']]) {
    if (typeof values[field] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(values[field])) {
      errors[field] = `${label}: enter a valid clock time.`;
    } else if (Number(values[field].slice(3)) % 5 !== 0) {
      errors[field] = 'Choose a time in five-minute intervals.';
    }
  }
  const attendance = typeof values.expectedAttendance === 'string' ? values.expectedAttendance.trim() : '';
  if (!attendance || attendance.toLowerCase() === 'not decided') {
    errors.expectedAttendance = 'Enter a positive whole number before submitting.';
  } else if (!/^-?\d+$/.test(attendance)) {
    errors.expectedAttendance = 'Enter a positive whole number.';
  } else if (Number(attendance) < 1) {
    errors.expectedAttendance = 'Enter a positive whole number.';
  } else if (Number(attendance) > 2147483647) {
    errors.expectedAttendance = 'This attendance estimate is too large. Enter a smaller number.';
  }
  if (!errors.startDate && !errors.endDate) {
    if (values.endDate < values.startDate) {
      errors.endDate = 'End date must not be earlier than the start date.';
    } else if (values.endDate === values.startDate && !errors.startTime && !errors.endTime && values.endTime <= values.startTime) {
      errors.endTime = 'End time must be later than the start time.';
    }
  }
  let data;
  try { data = validateDraft(input); }
  catch (error) {
    // Preserve field-specific mandatory errors; still reject malformed optional fields.
    for (const [field, message] of Object.entries(error.fields || { form: error.message })) {
      if (!errors[field]) errors[field] = message;
    }
  }
  if (Object.keys(errors).length) {
    const error = new Error('Please correct the listed fields before submitting.');
    error.status = 422;
    error.fields = errors;
    throw error;
  }
  return data;
}

function optionalText(value) {
  return !value.trim() || placeholders.includes(value.trim().toLowerCase()) ? '' : value;
}

const router = express.Router();
router.use(['/drafts/:id/submit', '/requests'], auth.authenticate, auth.requireRoles('event_organiser'),
  (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.param('id', (req, res, next, id) => {
  if (!uuid.test(id)) return res.status(404).json({ error: 'Request not found.' });
  next();
});

// Submit current values atomically. Existing drafts retain optimistic version checks;
// the stable event ID and matching submitted content make retries idempotent.
router.post('/drafts/:id/submit', async (req, res) => {
  const body = req.body;
  const hasCurrent = body && Object.prototype.hasOwnProperty.call(body, 'draft');
  if (!body || (body.version !== null && (typeof body.version !== 'string' || !/^[a-f0-9]{32}$/.test(body.version))) ||
    (body.version === null && !hasCurrent) || Object.keys(body).some(key => !['version', 'draft'].includes(key))) {
    return res.status(400).json({ error: 'Provide the current form and its draft version.' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    let created = false;
    if (body.version === null) {
      const initial = validateSubmission(body.draft);
      const inserted = await client.query(`INSERT INTO events (id, organiser_id, title, draft_data, status)
        VALUES ($1, $2, $3, $4::jsonb, 'draft') ON CONFLICT (id) DO NOTHING RETURNING id`,
        [req.params.id, req.auth.sub, initial.eventName, JSON.stringify(initial)]);
      created = inserted.rowCount === 1;
    }
    const result = await client.query(
      'SELECT *, md5(draft_data::text) AS version FROM events WHERE id = $1 AND organiser_id = $2 FOR UPDATE',
      [req.params.id, req.auth.sub]);
    const event = result.rows[0];
    if (!event) {
      const error = new Error('Request not found.'); error.status = 404; throw error;
    }
    const data = validateSubmission(hasCurrent ? body.draft : event.draft_data);
    if (event.status === 'submitted') {
      const matching = hasCurrent
        ? (await client.query('SELECT $1::jsonb = $2::jsonb AS same',
          [JSON.stringify(data), JSON.stringify(event.draft_data)])).rows[0].same
        : event.version === body.version;
      if (!matching) {
        const error = new Error('This request has already been submitted with different values.'); error.status = 409; throw error;
      }
      await client.query('COMMIT');
      return res.json({ id: event.id, status: event.status, submitted_at: event.submitted_at });
    }
    if (event.status !== 'draft') {
      const error = new Error('This request is no longer a draft.'); error.status = 409; throw error;
    }
    if (!created && event.version !== body.version) {
      const error = new Error('This draft was changed elsewhere. Reopen it and review the latest saved values before submitting.');
      error.status = 409; throw error;
    }
    const accessibility = optionalText(data.accessibilityNeeds);
    const equipment = optionalText(data.equipmentRequirements);
    const updated = await client.query(`UPDATE events SET
      title = $1, purpose = $2, description = $3, preferred_start = $4::timestamptz,
      preferred_end = $5::timestamptz, expected_attendance = $6, venue_layout_preference = $7,
      accessibility_requirements = $8::jsonb, equipment_requirements = $9::jsonb,
      registration_required = $10, draft_data = $13::jsonb, status = 'submitted', submitted_at = now(), updated_at = now()
      WHERE id = $11 AND organiser_id = $12 AND status = 'draft'
      RETURNING id, status, submitted_at`, [data.eventName, data.purpose, data.description,
      `${data.startDate}T${data.startTime}:00+08:00`, `${data.endDate}T${data.endTime}:00+08:00`,
      Number(data.expectedAttendance.trim()), data.venueRequirements,
      JSON.stringify(accessibility ? { notes: accessibility } : {}), JSON.stringify(equipment ? [equipment] : []),
      data.registrationNeeds === 'not_decided' ? null : data.registrationNeeds === 'yes', event.id, req.auth.sub, JSON.stringify(data)]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (!error.status) console.error('Submission failed:', error.code || error.message);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unable to submit the request. Please retry.',
      ...(error.fields ? { fields: error.fields } : {})
    });
  } finally {
    if (client) client.release();
  }
});

router.get('/requests', async (req, res) => {
  try {
    const result = await db.query(`SELECT id, title, status, submitted_at FROM events
      WHERE organiser_id = $1 AND status <> 'draft' ORDER BY submitted_at DESC NULLS LAST`, [req.auth.sub]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: 'Unable to load submitted requests. Please retry.' }); }
});

router.get('/requests/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT id, title, draft_data, status, submitted_at FROM events
      WHERE id = $1 AND organiser_id = $2 AND status <> 'draft'`, [req.params.id, req.auth.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Request not found.' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Unable to load submitted request. Please retry.' }); }
});

module.exports = { router, validateSubmission };
