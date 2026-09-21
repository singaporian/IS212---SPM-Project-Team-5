const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { router, validateEquipment, EQUIPMENT_TYPES } = require('../src/equipment');

const valid = { name: 'Wireless microphone', type: 'Audio', quantity: 4, specifications: { 'Frequency range': '470-530 MHz' } };

test('equipment validation accepts complete records and trims text', () => {
  assert.deepEqual(validateEquipment(valid), valid);
  assert.deepEqual(validateEquipment({ ...valid, name: '  Spare cable  ', specifications: undefined }),
    { name: 'Spare cable', type: 'Audio', quantity: 4, specifications: {} });
  assert.deepEqual(validateEquipment({ ...valid, specifications: { ' Power ': ' 12V ' } }).specifications, { Power: '12V' });
  for (const type of EQUIPMENT_TYPES) assert.equal(validateEquipment({ ...valid, type }).type, type);
  assert.equal(validateEquipment({ ...valid, quantity: 2147483647 }).quantity, 2147483647);
});

test('every mandatory field must be populated', () => {
  for (const missing of ['name', 'type', 'quantity']) {
    const input = { ...valid };
    delete input[missing];
    assert.throws(() => validateEquipment(input), new RegExp(missing, 'i'));
  }
  for (const input of [{ ...valid, name: '' }, { ...valid, name: '   ' }, { ...valid, type: '' }, { ...valid, quantity: '' }, { ...valid, quantity: null }]) {
    assert.throws(() => validateEquipment(input));
  }
  assert.throws(() => validateEquipment(null));
  assert.throws(() => validateEquipment([]));
});

test('quantity only accepts positive integers', () => {
  for (const quantity of [0, -1, -10, 1.5, 0.1, NaN, Infinity, '5', 'abc', true, {}, [], 2147483648]) {
    assert.throws(() => validateEquipment({ ...valid, quantity }), /Quantity/, String(quantity));
  }
  for (const quantity of [1, 2, 100]) assert.equal(validateEquipment({ ...valid, quantity }).quantity, quantity);
});

test('type must be one of the known categories and specifications must be well formed', () => {
  assert.throws(() => validateEquipment({ ...valid, type: 'Weapons' }), /valid equipment type/);
  assert.throws(() => validateEquipment({ ...valid, name: 'x'.repeat(201) }), /200/);
  for (const specifications of [[], 'text', { '': 'value' }, { Label: '' }, { Label: '  ' }, { Label: 5 },
    { Label: 'a', label: 'b' }, { L: 'x'.repeat(501) }]) {
    assert.throws(() => validateEquipment({ ...valid, specifications }), undefined, JSON.stringify(specifications));
  }
});

test('equipment API creates Available records and enforces access in PostgreSQL', async t => {
  const client = await db.pool.connect();
  const originalQuery = db.query;
  let server;
  try {
    await client.query('BEGIN');
    // A temporary table shadows the real one, so the test never touches real inventory.
    await client.query('CREATE TEMP TABLE equipment (LIKE public.equipment INCLUDING ALL) ON COMMIT DROP');
    db.query = (sql, params) => client.query(sql, params);
    const app = express();
    app.use(express.json());
    app.use('/api/equipment', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/api/equipment';
    const token = (role = 'technical_support_staff', options) => jwt.sign({ sub: randomUUID(), role },
      process.env.JWT_SECRET || 'local-development-secret-change-me', options);
    async function post(body, bearer = token()) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    }
    const count = async () => Number((await client.query('SELECT count(*) FROM equipment')).rows[0].count);

    await t.test('a valid record is stored with Available status and its specifications', async () => {
      const result = await post(valid);
      assert.equal(result.status, 201);
      assert.equal(result.body.name, valid.name);
      assert.equal(result.body.equipment_type, 'Audio');
      assert.equal(result.body.total_quantity, 4);
      assert.equal(result.body.status, 'available');
      assert.deepEqual(result.body.specs, valid.specifications);
      const stored = (await client.query('SELECT * FROM equipment WHERE id = $1', [result.body.id])).rows[0];
      assert.equal(stored.status, 'available');
      assert.equal(stored.total_quantity, 4);
      assert.equal(await count(), 1);
    });
    await t.test('specifications are optional', async () => {
      const result = await post({ name: 'Extension lead', type: 'Power & Cabling', quantity: 12 });
      assert.equal(result.status, 201);
      assert.deepEqual(result.body.specs, {});
    });
    await t.test('clients cannot choose the status', async () => {
      const result = await post({ ...valid, name: 'Sneaky', status: 'retired' });
      assert.equal(result.status, 201);
      assert.equal(result.body.status, 'available');
    });
    await t.test('invalid submissions are rejected without modifying the inventory', async () => {
      const before = await count();
      for (const body of [{ ...valid, name: '' }, { ...valid, type: '' }, { ...valid, quantity: 0 }, { ...valid, quantity: -3 },
        { ...valid, quantity: 2.5 }, { ...valid, quantity: '7' }, { type: 'Audio', quantity: 1 }, {}]) {
        const result = await post(body);
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.ok(result.body.error);
      }
      assert.equal(await count(), before);
    });
    await t.test('missing, expired and non-technical-support tokens are rejected', async () => {
      const before = await count();
      assert.equal((await post(valid, '')).status, 401);
      assert.equal((await post(valid, token('technical_support_staff', { expiresIn: -1 }))).status, 401);
      for (const role of ['attendee', 'event_organiser', 'event_coordinator', 'venue_staff']) {
        assert.equal((await post(valid, token(role))).status, 403, role);
      }
      assert.equal(await count(), before);
    });
    await t.test('a database failure returns a retryable error and saves nothing', async () => {
      await client.query("ALTER TABLE equipment ADD CONSTRAINT test_write_failure CHECK (name <> 'force failure')");
      const before = await count();
      await client.query('SAVEPOINT failure');
      const result = await post({ ...valid, name: 'force failure' });
      await client.query('ROLLBACK TO SAVEPOINT failure');
      assert.equal(result.status, 500);
      assert.match(result.body.error, /retry/);
      assert.equal(await count(), before);
    });
  } finally {
    db.query = originalQuery;
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.pool.end();
  }
});
