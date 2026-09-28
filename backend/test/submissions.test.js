const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { validateSubmission } = require('../src/submissions');
const complete = { eventName: 'Student workshop', startDate: '2026-10-01', startTime: '10:00',
  endDate: '2026-10-01', endTime: '11:00', expectedAttendance: '25' };

// Lark: US-006-003, US-006-004, US-006-005, US-006-006.
test('submission requires name, both date/time pairs and positive integer attendance', () => {
  for (const field of Object.keys(complete)) {
    assert.throws(() => validateSubmission({ ...complete, [field]: '' }), error => error.status === 422 && !!error.fields[field]);
  }
  for (const expectedAttendance of ['none', 'not decided', '0', '-1', '1.5', '2147483648']) {
    assert.throws(() => validateSubmission({ ...complete, expectedAttendance }), /correct/);
  }
  for (const extra of [{ startDate: '2026-02-30' }, { startDate: '0000-01-01' },
    { startTime: '24:00' }, { startTime: '12:70' }, { endTime: '10:00' },
    { endDate: '2026-09-30' }, { equipmentRequirements: {} }, { registrationNeeds: 'maybe' }]) {
    assert.throws(() => validateSubmission({ ...complete, ...extra }), /correct/);
  }
});

// Lark: CHG-001-001, CHG-001-002, CHG-001-003; defect: DEF-001 (all four branches).
test('CHG-001 submission interval errors identify only the cause and allow overnight times', () => {
  const draft = { ...complete, startTime: '10:03', endTime: '10:04' };
  for (const [changes, fields] of [
    [{ endDate: '2026-09-30' }, { endDate: 'End date must not be earlier than the start date.' }],
    [{ endTime: '10:03' }, { endTime: 'End time must be later than the start time.' }],
    [{ endTime: '10:02' }, { endTime: 'End time must be later than the start time.' }]
  ]) {
    assert.throws(() => validateSubmission({ ...draft, ...changes }), error => {
      assert.equal(error.status, 422);
      assert.deepEqual(error.fields, fields);
      return true;
    });
  }
  assert.equal(validateSubmission({ ...draft, endDate: '2026-10-02', endTime: '00:01' }).endTime, '00:01');
  assert.equal(validateSubmission(draft).endTime, '10:04');
});

test('optional fields and valid historical dates do not block submission', () => {
  for (const extra of [{}, { accessibilityNeeds: 'None', equipmentRequirements: 'Not Required', registrationNeeds: 'no' },
    { startDate: '2000-01-01', endDate: '2000-01-01' }, { expectedAttendance: '2147483647' }]) {
    assert.equal(validateSubmission({ ...complete, ...extra }).eventName, complete.eventName);
  }
});

test('submission integrates with real PostgreSQL and coordinator routes', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'us006_test_' + randomUUID().replaceAll('-', '');
  let pool, server;
  try {
    await originalPool.query(`CREATE SCHEMA "${schema}"`);
    await originalPool.query(`CREATE TABLE "${schema}".users (LIKE public.users INCLUDING ALL)`);
    await originalPool.query(`CREATE TABLE "${schema}".events (LIKE public.events INCLUDING ALL)`);
    pool = new Pool({ ...originalPool.options, password: originalPool.options.password,
      options: `-c search_path=${schema},public` });
    db.pool = pool;
    db.query = (sql, params) => pool.query(sql, params);
    await pool.query('ALTER TABLE events ADD FOREIGN KEY (organiser_id) REFERENCES users(id)');
    await pool.query('ALTER TABLE events ADD FOREIGN KEY (assigned_coordinator_id) REFERENCES users(id)');
    const owner = randomUUID(), other = randomUUID(), coordinator = randomUUID();
    for (const [id, role] of [[owner, 'event_organiser'], [other, 'event_organiser'], [coordinator, 'event_coordinator']]) {
      await pool.query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)',
        [id, role, id + '@test.local', 'unused-test-hash', role]);
    }
    const token = (id = owner, role = 'event_organiser') => jwt.sign({ sub: id, role },
      process.env.JWT_SECRET || 'local-development-secret-change-me');
    server = require('../src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    async function request(path, method = 'GET', body, bearer = token()) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    }
    async function save(input = complete, id = randomUUID()) {
      const result = await request('/drafts/' + id, 'PUT', input);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    }
    const submit = draft => request('/drafts/' + draft.id + '/submit', 'POST', { version: draft.version });
    const row = async id => (await pool.query('SELECT * FROM events WHERE id=$1', [id])).rows[0];
    const coordToken = token(coordinator, 'event_coordinator');
    // Lark: US-006-003 through US-006-006, CHG-001-003; AC-CHG001-03 invalid clocks.
    await t.test('US-006 rejected values give corrective errors and preserve the entire draft', async () => {
      const cases = [
        ['eventName', '   ', /enter an event name/],
        ['expectedAttendance', '', /^Enter a positive whole number before submitting\.$/],
        ['expectedAttendance', ' Not Decided ', /^Enter a positive whole number before submitting\.$/],
        ['expectedAttendance', 'abc', /^Enter a positive whole number\.$/],
        ['expectedAttendance', '1.5', /^Enter a positive whole number\.$/],
        ['expectedAttendance', '0', /^Enter a positive whole number\.$/],
        ['expectedAttendance', '-1', /^Enter a positive whole number\.$/],
        ['expectedAttendance', '2147483648', /too large/],
        ['startTime', '25:00', /valid clock time/],
        ['endTime', '12:70', /valid clock time/],
        ['endTime', '10:00', /later than/]
      ];
      for (const [field, value, message] of cases) {
        const draft = await save();
        // Seed malformed saved snapshots directly: draft validation already rejects some cases.
        await pool.query('UPDATE events SET draft_data=$1::jsonb WHERE id=$2',
          [JSON.stringify({ ...draft.draft_data, [field]: value }), draft.id]);
        const current = (await request('/drafts/' + draft.id)).body;
        const before = await row(draft.id);
        const result = await submit(current);
        assert.equal(result.status, 422);
        assert.match(result.body.fields[field], message);
        assert.equal((await row(draft.id)).status, 'draft');
        assert.deepEqual(await row(draft.id), before);
      }
    });
    // Lark: US-006-006, CHG-001-001, CHG-001-002 (minute precision and attendance 1).
    await t.test('US-006 nonblank former placeholders and attendance one submit; CHG-001 minute times persist', async () => {
      for (const [eventName, startTime, endTime] of [
        ['none', '10:03', '10:07'], ['not required', '10:07', '23:59'], ['not decided', '23:58', '23:59']
      ]) {
        const draft = await save({ ...complete, eventName, expectedAttendance: '1', startTime, endTime });
        assert.equal((await submit(draft)).status, 200);
        const stored = await row(draft.id);
        assert.equal(stored.title, eventName);
        assert.equal(stored.expected_attendance, 1);
        assert.equal(stored.status, 'submitted');
        assert.deepEqual(stored.draft_data, draft.draft_data);
      }
    });
    // Lark: US-006-004; both unresolved attendance states round-trip as Draft.
    await t.test('undecided attendance saves as draft but requires a number on submission', async () => {
      for (const expectedAttendance of ['', 'Not decided']) {
      const draft = await save({ ...complete, expectedAttendance });
      const before = await row(draft.id);
      assert.equal(before.status, 'draft');
      assert.equal(before.draft_data.expectedAttendance, expectedAttendance);
      assert.equal((await request('/drafts/' + draft.id)).body.draft_data.expectedAttendance, expectedAttendance);
      const result = await submit(draft);
      assert.equal(result.status, 422);
      assert.equal(result.body.fields.expectedAttendance, 'Enter a positive whole number before submitting.');
      assert.deepEqual(await row(draft.id), before);
      }
    });
    // Lark: US-006-001, US-006-002, US-006-006.
    await t.test('direct submit saves current values on the same ID and matching retries are idempotent', async () => {
      const draft = await save({ purpose: 'Old saved draft' });
      const current = { ...complete, eventName: 'Current title', purpose: 'Unsaved purpose', startTime: '10:03', endTime: '10:07', expectedAttendance: '1' };
      const body = { version: draft.version, draft: current };
      const path = '/drafts/' + draft.id + '/submit';
      const results = await Promise.all([request(path, 'POST', body), request(path, 'POST', body)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      assert.deepEqual(results[0].body, results[1].body);
      const stored = await row(draft.id);
      assert.equal(stored.status, 'submitted');
      for (const [key, value] of Object.entries(current)) assert.equal(stored.draft_data[key], value);
      assert.equal(stored.title, current.eventName);
      assert.equal(stored.expected_attendance, 1);
      assert.equal((await pool.query('SELECT count(*) FROM events WHERE id=$1', [draft.id])).rows[0].count, '1');
      assert.ok((await request('/events/unassigned', 'GET', undefined, coordToken)).body.some(item => item.id === draft.id));
      assert.equal((await request(path, 'POST', { ...body, draft: { ...current, eventName: 'Different retry' } })).status, 409);
    });
    // Lark: US-006-003, US-006-004, US-006-005, US-006-006.
    await t.test('invalid current submission preserves the saved draft and returns field errors', async () => {
      const draft = await save();
      const before = await row(draft.id);
      for (const [field, value] of [
        ...['eventName', 'startDate', 'startTime', 'endDate', 'endTime'].map(field => [field, '']),
        ...['', 'Not decided', 'abc', '1.5', '0'].map(value => ['expectedAttendance', value])
      ]) {
        const result = await request('/drafts/' + draft.id + '/submit', 'POST', {
          version: draft.version, draft: { ...complete, purpose: 'Unsaved', [field]: value }
        });
        assert.equal(result.status, 422);
        assert.deepEqual(Object.keys(result.body.fields), [field]);
        assert.deepEqual(await row(draft.id), before);
      }
    });
    // Lark: US-006-001.
    await t.test('new unsaved forms submit once; invalid forms create no partial event', async () => {
      const invalidId = randomUUID();
      assert.equal((await request('/drafts/' + invalidId + '/submit', 'POST', { version: null, draft: {} })).status, 422);
      assert.equal(await row(invalidId), undefined);
      const id = randomUUID(), body = { version: null, draft: complete };
      const results = await Promise.all([request('/drafts/' + id + '/submit', 'POST', body), request('/drafts/' + id + '/submit', 'POST', body)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      assert.deepEqual(results[0].body, results[1].body);
      assert.equal((await row(id)).status, 'submitted');
      assert.equal((await pool.query('SELECT count(*) FROM events WHERE id=$1', [id])).rows[0].count, '1');
      assert.ok((await request('/events/unassigned', 'GET', undefined, coordToken)).body.some(item => item.id === id));
    });
    // Lark: CHG-001-002; DEF-001 later date with earlier clock time.
    await t.test('CHG-001 midnight direct submission preserves Singapore dates and minute values', async () => {
      const id = randomUUID();
      const draft = { ...complete, startDate: '2026-10-15', startTime: '23:59', endDate: '2026-10-16', endTime: '00:00' };
      const result = await request('/drafts/' + id + '/submit', 'POST', { version: null, draft });
      assert.equal(result.status, 200);
      const stored = await row(id);
      assert.equal(stored.status, 'submitted');
      assert.equal(stored.preferred_start.toISOString(), '2026-10-15T15:59:00.000Z');
      assert.equal(stored.preferred_end.toISOString(), '2026-10-15T16:00:00.000Z');
      const receipt = (await request('/requests/' + id)).body;
      for (const [key, value] of Object.entries(draft)) assert.equal(receipt.draft_data[key], value);
    });
    await t.test('direct submission retains ownership and stale-version protection', async () => {
      const draft = await save();
      await save({ ...complete, purpose: 'Newer saved version' }, draft.id);
      const before = await row(draft.id);
      const path = '/drafts/' + draft.id + '/submit';
      assert.equal((await request(path, 'POST', { version: draft.version, draft: complete })).status, 409);
      assert.equal((await request(path, 'POST', { version: null, draft: complete })).status, 409);
      assert.equal((await request(path, 'POST', { version: null, draft: complete }, token(other))).status, 404);
      assert.deepEqual(await row(draft.id), before);
    });
    await t.test('incomplete draft stays unchanged with field-specific errors', async () => {
      const draft = await save({ purpose: 'Planning later' });
      const before = await row(draft.id);
      const result = await submit(draft);
      assert.equal(result.status, 422);
      for (const key of Object.keys(complete)) assert.ok(result.body.fields[key]);
      assert.deepEqual(await row(draft.id), before);
      assert.ok(!(await request('/events/unassigned', 'GET', undefined, coordToken)).body.some(item => item.id === draft.id));
    });
    // Lark: US-006-001, US-006-002. Assignment assertions also cover the separate coordinator workflow.
    await t.test('success preserves every field and feeds the existing coordinator workflow', async () => {
      const draft = await save({ ...complete, purpose: 'Learning', description: 'Line one\nLine two',
        venueRequirements: 'Theatre', accessibilityNeeds: 'Ramp', equipmentRequirements: 'Projector', registrationNeeds: 'yes' });
      const result = await submit(draft);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const stored = await row(draft.id);
      assert.equal(stored.status, 'submitted');
      assert.deepEqual(stored.draft_data, draft.draft_data);
      assert.equal(stored.title, complete.eventName);
      assert.equal(stored.description, draft.draft_data.description);
      assert.equal(stored.purpose, 'Learning');
      assert.equal(stored.venue_layout_preference, 'Theatre');
      assert.deepEqual(stored.accessibility_requirements, { notes: 'Ramp' });
      assert.deepEqual(stored.equipment_requirements, ['Projector']);
      assert.equal(stored.registration_required, true);
      assert.equal(stored.expected_attendance, 25);
      assert.equal(stored.preferred_start.toISOString(), '2026-10-01T02:00:00.000Z');
      assert.equal(stored.preferred_end.toISOString(), '2026-10-01T03:00:00.000Z');
      assert.ok(stored.submitted_at);
      assert.equal((await request('/drafts/' + draft.id)).status, 404);
      assert.equal((await request('/drafts/' + draft.id, 'PUT', complete)).status, 404);
      assert.ok(!(await request('/drafts')).body.some(item => item.id === draft.id));
      assert.deepEqual((await request('/requests/' + draft.id)).body.draft_data, draft.draft_data);
      assert.ok((await request('/requests')).body.some(item => item.id === draft.id));
      // Main's US-008 organiser list must not be shadowed by the coordinator /events/:id route.
      const organiserEvents = await request('/events/mine');
      assert.equal(organiserEvents.status, 200);
      assert.ok(organiserEvents.body.some(item => item.id === draft.id));
      assert.ok((await request('/events/unassigned', 'GET', undefined, coordToken)).body.some(item => item.id === draft.id));
      assert.equal((await request('/events/' + draft.id + '/assign', 'PATCH', {}, coordToken)).status, 200);
      const detail = await request('/events/' + draft.id, 'GET', undefined, coordToken);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.draft_data, draft.draft_data);
    });
    // Lark: US-006-002.
    await t.test('optional None / Not Required values are retained, not made mandatory', async () => {
      for (const registrationNeeds of ['no', 'not_decided']) {
        const draft = await save({ ...complete, accessibilityNeeds: 'None', equipmentRequirements: 'Not Required', registrationNeeds });
        assert.equal((await submit(draft)).status, 200);
        const stored = await row(draft.id);
        assert.deepEqual(stored.draft_data, draft.draft_data);
        assert.deepEqual(stored.accessibility_requirements, {});
        assert.deepEqual(stored.equipment_requirements, []);
        assert.equal(stored.registration_required, registrationNeeds === 'no' ? false : null);
      }
    });
    await t.test('outsiders, other roles, expired sessions and malformed IDs are rejected', async () => {
      const draft = await save();
      const path = '/drafts/' + draft.id + '/submit';
      assert.equal((await request(path, 'POST', { version: draft.version }, token(other))).status, 404);
      const expired = jwt.sign({ sub: owner, role: 'event_organiser' }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: -1 });
      for (const bearer of ['', expired]) assert.equal((await request(path, 'POST', { version: draft.version }, bearer)).status, 401);
      for (const role of ['attendee', 'event_coordinator', 'venue_staff', 'technical_support_staff']) {
        assert.equal((await request(path, 'POST', { version: draft.version }, token(owner, role))).status, 403);
        assert.equal((await request('/requests', 'GET', undefined, token(owner, role))).status, 403);
      }
      assert.equal((await request('/drafts/not-a-uuid/submit', 'POST', { version: draft.version })).status, 404);
      assert.equal((await row(draft.id)).status, 'draft');
      await submit(draft);
      assert.equal((await request('/requests/' + draft.id, 'GET', undefined, token(other))).status, 404);
      assert.deepEqual((await request('/requests', 'GET', undefined, token(other))).body, []);
      assert.equal((await request('/health', 'GET', undefined, '')).status, 200);
    });
    await t.test('stale versions and client-supplied field/status overrides cannot submit', async () => {
      const draft = await save();
      const changed = await save({ ...complete, purpose: 'Updated elsewhere' }, draft.id);
      assert.equal((await submit(draft)).status, 409);
      for (const body of [{}, { version: changed.version, status: 'submitted' }, { version: changed.version, expectedAttendance: 50 }]) {
        assert.equal((await request('/drafts/' + draft.id + '/submit', 'POST', body)).status, 400);
      }
      assert.equal((await row(draft.id)).status, 'draft');
      assert.deepEqual((await row(draft.id)).draft_data, changed.draft_data);
    });
    await t.test('concurrent submissions and retries create one stable submitted receipt', async () => {
      const draft = await save();
      const results = await Promise.all([submit(draft), submit(draft)]);
      assert.deepEqual(results.map(result => result.status), [200, 200]);
      assert.deepEqual(results[0].body, results[1].body);
      assert.deepEqual((await submit(draft)).body, results[0].body);
      assert.equal((await pool.query('SELECT count(*) FROM events WHERE id=$1', [draft.id])).rows[0].count, '1');
      await pool.query("UPDATE events SET status='approved' WHERE id=$1", [draft.id]);
      assert.equal((await submit(draft)).status, 409);
      assert.equal((await row(draft.id)).status, 'approved');
    });
    await t.test('database failure rolls back every field and a retry succeeds', async () => {
      await pool.query("ALTER TABLE events ADD CONSTRAINT forced_submission_failure CHECK (status <> 'submitted' OR title <> 'force failure')");
      const draft = await save({ ...complete, eventName: 'force failure' });
      const before = await row(draft.id);
      assert.equal((await submit(draft)).status, 500);
      assert.deepEqual(await row(draft.id), before);
      await pool.query('ALTER TABLE events DROP CONSTRAINT forced_submission_failure');
      assert.equal((await submit(draft)).status, 200);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.pool = originalPool;
    db.query = originalQuery;
    if (pool) await pool.end();
    // This unique schema contains only this run's test fixtures.
    await originalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await originalPool.end();
  }
});
