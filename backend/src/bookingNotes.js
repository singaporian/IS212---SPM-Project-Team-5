const express = require('express');
const db = require('./db');
const auth = require('./auth');

const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

function validateNoteText(value) {
  if (typeof value !== 'string' || !value.trim()) throw fail(400, 'Enter a note.');
  if (value.length > 10000) throw fail(400, 'Keep the note within 10,000 characters.');
  return value.trim();
}

function ownsNote(note, userId) {
  return Boolean(note && typeof userId === 'string' && userId && note.created_by === userId);
}

// Existing venue APIs give Venue Staff role-wide access. There is no per-venue assignment model.
// Join venues to ensure a booking with a removed/unavailable venue cannot expose notes.
async function eligibleBooking(query, id, lock = false) {
  const result = await query(`SELECT b.id, b.status FROM bookings b JOIN venues v ON v.id=b.venue_id
    WHERE b.id=$1${lock ? ' FOR SHARE OF b, v' : ''}`, [id]);
  const booking = result.rows[0];
  if (!booking) throw fail(404, 'Booking not found.');
  if (booking.status !== 'confirmed') throw fail(409, 'Internal notes are available only for confirmed bookings.');
}

const router = express.Router();
router.use('/:bookingId/notes', auth.authenticate, auth.requireRoles('venue_staff'), (req, res, next) => {
  if (!uuid(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking id.' });
  next();
});

router.get('/:bookingId/notes', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await eligibleBooking(db.query, req.params.bookingId);
    const result = await db.query(`SELECT n.id, n.booking_id, n.note_text, n.created_by, n.created_at, n.updated_at,
      u.name AS author_name FROM booking_notes n JOIN users u ON u.id=n.created_by
      WHERE n.booking_id=$1 ORDER BY n.created_at ASC, n.id ASC`, [req.params.bookingId]);
    res.json(result.rows);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to load internal notes. Please retry.' });
  }
});

async function mutate(req, res, action) {
  let client;
  try {
    if (action !== 'add' && !uuid(req.params.noteId)) throw fail(400, 'Invalid note id.');
    const text = action === 'delete' ? null : validateNoteText(req.body?.noteText);
    client = await db.pool.connect();
    await client.query('BEGIN');
    await eligibleBooking(client.query.bind(client), req.params.bookingId, true);
    if (action !== 'add') {
      const note = (await client.query('SELECT * FROM booking_notes WHERE id=$1 AND booking_id=$2 FOR UPDATE', [req.params.noteId, req.params.bookingId])).rows[0];
      if (!note) throw fail(404, 'Note not found.');
      if (!ownsNote(note, req.auth.sub)) throw fail(403, 'Only the author can edit or delete this note.');
    }
    let result;
    if (action === 'add') result = await client.query(`INSERT INTO booking_notes (booking_id,note_text,created_by)
      VALUES ($1,$2,$3) RETURNING *`, [req.params.bookingId, text, req.auth.sub]);
    else if (action === 'edit') result = await client.query(`UPDATE booking_notes SET note_text=$1, updated_at=clock_timestamp()
      WHERE id=$2 AND booking_id=$3 AND created_by=$4 RETURNING *`, [text, req.params.noteId, req.params.bookingId, req.auth.sub]);
    else await client.query('DELETE FROM booking_notes WHERE id=$1 AND booking_id=$2 AND created_by=$3', [req.params.noteId, req.params.bookingId, req.auth.sub]);
    await client.query('COMMIT');
    if (action === 'delete') return res.status(204).end();
    res.status(action === 'add' ? 201 : 200).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to save internal notes. Your text has been kept; please retry.' });
  } finally { if (client) client.release(); }
}

router.post('/:bookingId/notes', (req, res) => mutate(req, res, 'add'));
router.patch('/:bookingId/notes/:noteId', (req, res) => mutate(req, res, 'edit'));
router.delete('/:bookingId/notes/:noteId', (req, res) => mutate(req, res, 'delete'));

module.exports = { router, validateNoteText, ownsNote };
