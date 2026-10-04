const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const db = require('../src/db');

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

test('event decision endpoint approves, records audit, and blocks invalid re-decisions', async (t) => {
  const organiserId = randomUUID();
  const coordinatorId = randomUUID();
  const eventId = randomUUID();

  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    [organiserId, 'Test Organiser', `organiser-${randomUUID()}@example.com`, 'hashed', 'event_organiser']
  );
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    [coordinatorId, 'Test Coordinator', `coordinator-${randomUUID()}@example.com`, 'hashed', 'event_coordinator']
  );
  await db.query(
    `INSERT INTO events (id, organiser_id, title, status, assigned_coordinator_id, preferred_start, preferred_end, expected_attendance)
     VALUES ($1, $2, 'Approval test event', 'submitted', $3, NOW(), NOW() + interval '2 hours', 80)`,
    [eventId, organiserId, coordinatorId]
  );

  const server = spawn('node', ['src/index.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: '3101', JWT_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForServer('http://127.0.0.1:3101/api/health');

    const token = jwt.sign({ sub: coordinatorId, role: 'event_coordinator' }, 'test-secret', { expiresIn: '8h' });

    const approveRes = await fetch(`http://127.0.0.1:3101/api/events/${eventId}/decision`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(approveRes.status, 200, 'approval request should succeed');

    const updatedEvent = await db.query('SELECT status FROM events WHERE id = $1', [eventId]);
    assert.equal(updatedEvent.rows[0].status, 'approved');
    const changeRow = await db.query('SELECT change_summary FROM event_changes WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [eventId]);
    assert.match(changeRow.rows[0].change_summary, /approved/i);
    const notification = await db.query('SELECT message FROM notifications WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [eventId]);
    assert.match(notification.rows[0].message, /approved/i);

    const rejectRes = await fetch(`http://127.0.0.1:3101/api/events/${eventId}/decision`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected', reason: 'insufficient_information' })
    });
    assert.equal(rejectRes.status, 404, 'a settled request cannot be re-decided');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await db.query('DELETE FROM notifications WHERE event_id = $1', [eventId]);
    await db.query('DELETE FROM event_changes WHERE event_id = $1', [eventId]);
    await db.query('DELETE FROM events WHERE id = $1', [eventId]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2)', [organiserId, coordinatorId]);
  }
});
