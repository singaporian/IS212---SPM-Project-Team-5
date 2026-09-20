const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, validateDraft } = require('../src/drafts');

test('draft validation accepts incomplete values and rejects invalid populated fields', () => {
  for (const input of [{}, { startTime: '12:05' }, { startDate: '2099-01-01' },
    { expectedAttendance: ' Not Decided ' }, { registrationNeeds: 'no' }]) {
    const result = validateDraft(input);
    for (const [key, value] of Object.entries(input)) assert.equal(result[key], value);
  }
  for (const input of [{ expectedAttendance: '-2' }, { expectedAttendance: '1.5' },
    { startDate: '2099-02-30' }, { startTime: '24:00' }, { startTime: '12:03' },
    { registrationNeeds: 'maybe' }, { eventName: {} }, { status: 'submitted' },
    { startDate: '2099-01-02', endDate: '2099-01-01' }]) {
    assert.throws(() => validateDraft(input));
  }
});

test('draft API persists atomically and enforces ownership in PostgreSQL', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query;
  let server;
  try {
    await client.query('BEGIN');
    // Temporary tables keep fixtures and deliberate failure constraints away from real data.
    await client.query('CREATE TEMP TABLE events (LIKE public.events INCLUDING ALL) ON COMMIT DROP');
    db.query = (sql, params) => client.query(sql, params);
    const app = express();
    app.use(express.json());
    app.use('/api/drafts', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/drafts';
    const owner = randomUUID(), other = randomUUID(), id = randomUUID();
    const token = (sub, role = 'event_organiser') => jwt.sign({ sub, role },
      process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function request(path, method = 'GET', body, bearer = token(owner)) {
      const res = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    let saved;
    await t.test('partial input saves and round-trips exactly, including blanks and placeholders', async () => {
      const input = validateDraft({ startTime: '10:05', expectedAttendance: ' Not Decided ',
        description: 'Line one\nLine two', venueRequirements: '  theatre  ', registrationNeeds: 'no' });
      const result = await request('/' + id, 'PUT', input);
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'draft');
      assert.deepEqual(result.body.draft_data, input);
      saved = input;
      assert.deepEqual((await request('/' + id)).body.draft_data, input);
    });
    await t.test('repeated saves update the same draft, including clearing fields', async () => {
      saved = { ...saved, eventName: 'Updated event', description: '', purpose: 'Planning' };
      for (let i = 0; i < 2; i++) assert.equal((await request('/' + id, 'PUT', saved)).status, 200);
      const list = await request('');
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].id, id);
      assert.deepEqual((await request('/' + id)).body.draft_data, saved);
    });
    await t.test('other organisers cannot read, list or overwrite the draft', async () => {
      const outsider = token(other);
      assert.equal((await request('/' + id, 'GET', undefined, outsider)).status, 404);
      const write = await request('/' + id, 'PUT', { eventName: 'stolen' }, outsider);
      assert.deepEqual(write, { status: 404, body: { error: 'Draft not found.' } });
      assert.deepEqual((await request('', 'GET', undefined, outsider)).body, []);
      assert.deepEqual((await request('/' + id)).body.draft_data, saved);
    });
    await t.test('missing authentication and every other role are rejected', async () => {
      assert.equal((await request('/' + id, 'GET', undefined, '')).status, 401);
      for (const role of ['attendee', 'event_coordinator', 'venue_staff', 'technical_support_staff']) {
        for (const method of ['GET', 'PUT']) {
          assert.equal((await request('/' + id, method, method === 'PUT' ? {} : undefined, token(owner, role))).status, 403);
        }
      }
    });
    await t.test('invalid values do not partially update a saved draft', async () => {
      assert.equal((await request('/' + id, 'PUT', { eventName: 'Should not save', expectedAttendance: 'bad' })).status, 400);
      assert.deepEqual((await request('/' + id)).body.draft_data, saved);
    });
    await t.test('a database write failure preserves the entire previous save and permits retry', async () => {
      await client.query("ALTER TABLE events ADD CONSTRAINT test_write_failure CHECK (title <> 'force failure')");
      await client.query('SAVEPOINT failure');
      const result = await request('/' + id, 'PUT', { ...saved, eventName: 'force failure', purpose: 'changed' });
      assert.equal(result.status, 500);
      assert.match(result.body.error, /retry/);
      await client.query('ROLLBACK TO SAVEPOINT failure');
      assert.deepEqual((await request('/' + id)).body.draft_data, saved);
      assert.equal((await request('/' + id, 'PUT', saved)).status, 200);
    });

    await t.test('blank drafts and all registration choices round-trip without requiring a title', async () => {
      const blankId = randomUUID();
      for (const registrationNeeds of ['not_decided', 'yes', 'no']) {
        const input = validateDraft({ registrationNeeds });
        const result = await request('/' + blankId, 'PUT', input);
        assert.equal(result.status, 200);
        assert.equal(result.body.status, 'draft');
        assert.deepEqual((await request('/' + blankId)).body.draft_data, input);
      }
    });
    await t.test('date-only and time-only drafts preserve incomplete date/time pairs', async () => {
      for (const input of [{ startDate: '2099-01-01' }, { endTime: '23:55' }]) {
        const partialId = randomUUID();
        assert.equal((await request('/' + partialId, 'PUT', input)).status, 200);
        assert.deepEqual((await request('/' + partialId)).body.draft_data, validateDraft(input));
      }
    });
    await t.test('expired tokens and missing tokens cannot read, list or save', async () => {
      const expired = jwt.sign({ sub: owner, role: 'event_organiser' },
        process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: -1 });
      for (const bearer of ['', expired]) {
        for (const [route, method, body] of [['', 'GET'], ['/' + id, 'GET'], ['/' + id, 'PUT', saved]]) {
          assert.equal((await request(route, method, body, bearer)).status, 401);
        }
      }
      assert.deepEqual((await request('/' + id)).body.draft_data, saved);
    });
    await t.test('malformed and inaccessible draft IDs return generic errors without contents', async () => {
      for (const draftId of ['not-a-uuid', randomUUID()]) {
        assert.deepEqual(await request('/' + draftId), { status: 404, body: { error: 'Draft not found.' } });
      }
      assert.equal((await request('/invalid', 'PUT', saved)).status, 404);
    });
    await t.test('clients cannot inject an owner or submitted status into a save', async () => {
      for (const extra of [{ organiser_id: other }, { status: 'submitted' }]) {
        assert.equal((await request('/' + id, 'PUT', { ...saved, ...extra })).status, 400);
      }
      const draft = await request('/' + id);
      assert.equal(draft.body.status, 'draft');
      assert.deepEqual(draft.body.draft_data, saved);
    });

    await t.test('all nine Week 4 field groups round-trip, including valid historical dates', async () => {
      const fullId = randomUUID();
      const input = {
        eventName: 'Historical workshop', purpose: 'Planning record', description: 'First line\nSecond line',
        startDate: '2000-01-01', startTime: '10:00', endDate: '2000-01-01', endTime: '11:00',
        expectedAttendance: '150', venueRequirements: 'Theatre seating', accessibilityNeeds: 'Ramp',
        equipmentRequirements: 'Projector', registrationNeeds: 'yes'
      };
      assert.equal((await request('/' + fullId, 'PUT', input)).status, 200);
      assert.deepEqual((await request('/' + fullId)).body.draft_data, input);
      assert.equal((await request('/' + fullId, 'PUT', { startDate: '2000-01-01' })).status, 200);
      assert.deepEqual((await request('/' + fullId)).body.draft_data, validateDraft({ startDate: '2000-01-01' }));
    });
    await t.test('saving cannot revert a submitted request to draft', async () => {
      await client.query("UPDATE events SET status = 'submitted' WHERE id = $1", [id]);
      assert.equal((await request('/' + id, 'PUT', saved)).status, 404);
      assert.equal((await request('/' + id)).status, 404);
      assert.equal((await client.query('SELECT status FROM events WHERE id = $1', [id])).rows[0].status, 'submitted');
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await db.pool.end();
  }
});
