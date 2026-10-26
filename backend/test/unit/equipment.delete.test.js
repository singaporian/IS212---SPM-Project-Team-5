// US-025: remove equipment records; deletion needs a typed confirmation and is blocked by upcoming reservations.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDeletion, deleteEquipment, loadBlockingReservations } = require('../../src/equipment');

const UPDATED_AT = '2026-01-01T00:00:00.000Z';
const item = {
  id: 'mic', name: 'Wireless microphone', equipment_type: 'Audio', status: 'available',
  total_quantity: 5, damaged_quantity: 1, maintenance_quantity: 0, specs: { Range: '100 m' }, updated_at: new Date(UPDATED_AT)
};
const blockingRow = (title, quantity, startsAt = '2099-03-01T10:00:00.000Z') =>
  ({ id: 'res-' + title, quantity, event_id: 'event-' + title, title, event_status: 'approved', starts_at: startsAt });

// Records every statement so tests can check what was (and was not) written.
function fakeQuery({ record = item, blocking = [], actor = { name: 'Tan Wei Ling' } } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT') && sql.includes('FROM equipment WHERE id = $1 FOR UPDATE')) return { rows: record ? [record] : [] };
    if (sql.includes('FROM equipment_reservations r')) return { rows: blocking };
    if (sql.includes('FROM users WHERE id')) return { rows: actor ? [actor] : [] };
    return { rows: [] };
  };
  const wrote = pattern => calls.some(c => pattern.test(c.sql));
  return { query, calls, wrote };
}
const confirm = (overrides = {}) => validateDeletion({ confirmName: 'Wireless microphone', expectedUpdatedAt: UPDATED_AT, ...overrides });

test('validateDeletion accepts a typed name and an optional record version', () => {
  assert.deepEqual(validateDeletion({ confirmName: '  Wireless microphone ' }), { confirmName: 'Wireless microphone', expectedUpdatedAt: null });
  assert.deepEqual(validateDeletion({ confirmName: 'Mic', expectedUpdatedAt: UPDATED_AT }), { confirmName: 'Mic', expectedUpdatedAt: UPDATED_AT });
  assert.equal(validateDeletion({ confirmName: 'Mic', expectedUpdatedAt: null }).expectedUpdatedAt, null);
});

test('validateDeletion requires the confirmation name (AC2)', () => {
  for (const body of [undefined, null, [], {}, { confirmName: '' }, { confirmName: '   ' }, { confirmName: 42 }, { confirmName: true }]) {
    assert.throws(() => validateDeletion(body), { message: 'Type the equipment name to confirm the deletion.' }, JSON.stringify(body));
  }
});

test('validateDeletion rejects an invalid record version', () => {
  for (const expectedUpdatedAt of ['yesterday', 123, {}]) {
    assert.throws(() => validateDeletion({ confirmName: 'Mic', expectedUpdatedAt }), /Invalid record version/, String(expectedUpdatedAt));
  }
});

test('loadBlockingReservations maps rows and excludes released events', async () => {
  const { query, calls } = fakeQuery({ blocking: [blockingRow('Summit', 1), blockingRow('Unscheduled', 2, null)] });
  const conflicts = await loadBlockingReservations(query, 'mic');
  assert.deepEqual(conflicts, [
    { id: 'res-Summit', eventId: 'event-Summit', title: 'Summit', eventStatus: 'approved', quantity: 1, startsAt: '2099-03-01T10:00:00.000Z' },
    { id: 'res-Unscheduled', eventId: 'event-Unscheduled', title: 'Unscheduled', eventStatus: 'approved', quantity: 2, startsAt: null }
  ]);
  const [equipmentId, released] = calls[0].params;
  assert.equal(equipmentId, 'mic');
  assert.deepEqual([...released].sort(), ['cancelled', 'completed', 'rejected']);
});

test('loadBlockingReservations counts events that are unscheduled or have any booking still to finish', async () => {
  const { query, calls } = fakeQuery();
  await loadBlockingReservations(query, 'mic');
  const sql = calls[0].sql;
  // Every booking counts, whatever its status, and an event with no bookings yet still blocks.
  assert.match(sql, /LEFT JOIN bookings b ON b\.event_id = e\.id\s/);
  assert.doesNotMatch(sql, /b\.status/);
  assert.match(sql, /HAVING max\(b\.end_time\) IS NULL OR max\(b\.end_time\) > now\(\)/);
});

test('deleteEquipment removes the record, confirms success and notifies staff', async t => {
  await t.test('the row is locked before any check, then deleted (AC3)', async () => {
    const { query, calls } = fakeQuery();
    const result = await deleteEquipment(query, 'mic', confirm(), 'staff-1');
    assert.match(calls[0].sql, /FOR UPDATE/);
    const deletion = calls.find(c => c.sql.startsWith('DELETE FROM equipment'));
    assert.deepEqual(deletion.params, ['mic']);
    assert.ok(calls.indexOf(deletion) > calls.findIndex(c => c.sql.includes('FROM equipment_reservations r')), 'reservations are checked first');
    assert.deepEqual(result.deleted, { id: 'mic', name: 'Wireless microphone', equipment_type: 'Audio', total_quantity: 5 });
    assert.equal(result.message, '"Wireless microphone" (Audio, 5 units) was deleted from the inventory.');
  });

  await t.test('every technical support staff member is told who deleted it (AC5)', async () => {
    const { query, calls } = fakeQuery();
    await deleteEquipment(query, 'mic', confirm(), 'staff-1');
    assert.deepEqual(calls.find(c => c.sql.includes('FROM users WHERE id')).params, ['staff-1']);
    const notice = calls.find(c => c.sql.includes('INSERT INTO notifications'));
    assert.ok(notice.sql.includes("role = 'technical_support_staff'"));
    assert.deepEqual(notice.params, ['Equipment "Wireless microphone" (Audio, 5 units) was removed from the inventory by Tan Wei Ling.']);
  });

  await t.test('without a known actor the notification falls back to a generic name', async () => {
    for (const [actorId, actor] of [[null, { name: 'unused' }], ['ghost', null]]) {
      const { query, calls } = fakeQuery({ actor });
      await deleteEquipment(query, 'mic', confirm(), actorId);
      assert.equal(calls.find(c => c.sql.includes('INSERT INTO notifications')).params[0],
        'Equipment "Wireless microphone" (Audio, 5 units) was removed from the inventory by a technical support staff member.');
    }
  });

  await t.test('messages use the singular for one unit and cope with a missing type', async () => {
    const { query, calls } = fakeQuery({ record: { ...item, name: 'Lectern', equipment_type: null, total_quantity: 1 } });
    const result = await deleteEquipment(query, 'mic', confirm({ confirmName: 'Lectern' }));
    assert.equal(result.message, '"Lectern" (no type, 1 unit) was deleted from the inventory.');
    assert.match(calls.find(c => c.sql.includes('INSERT INTO notifications')).params[0], /"Lectern" \(no type, 1 unit\)/);
  });

  await t.test('the version check is skipped when no version is sent', async () => {
    const { query, wrote } = fakeQuery();
    await deleteEquipment(query, 'mic', confirm({ expectedUpdatedAt: null }));
    assert.ok(wrote(/^DELETE FROM equipment/));
  });

  await t.test('a record name with surrounding spaces still matches its trimmed confirmation', async () => {
    const { query, wrote } = fakeQuery({ record: { ...item, name: ' Wireless microphone ' } });
    await deleteEquipment(query, 'mic', confirm());
    assert.ok(wrote(/^DELETE FROM equipment/));
  });
});

test('deleteEquipment is blocked while upcoming events hold reservations (AC4)', async t => {
  await t.test('one conflicting event is identified and nothing is written', async () => {
    const { query, wrote } = fakeQuery({ blocking: [blockingRow('Annual Gala', 2)] });
    await assert.rejects(deleteEquipment(query, 'mic', confirm()), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'reserved');
      assert.equal(error.message, '"Wireless microphone" cannot be deleted because it is reserved for an upcoming event: "Annual Gala". ' +
        'Remove those reservations first, then try again.');
      assert.deepEqual(error.conflicts.map(c => [c.title, c.eventId, c.quantity]), [['Annual Gala', 'event-Annual Gala', 2]]);
      return true;
    });
    assert.equal(wrote(/^DELETE/), false);
    assert.equal(wrote(/INSERT INTO notifications/), false);
  });

  await t.test('several conflicting events are all listed, in the order loaded', async () => {
    const { query } = fakeQuery({ blocking: [blockingRow('Tech Summit', 1), blockingRow('Annual Gala', 2), blockingRow('Unscheduled', 1, null)] });
    await assert.rejects(deleteEquipment(query, 'mic', confirm()), error => {
      assert.match(error.message, /reserved for 3 upcoming events: "Tech Summit", "Annual Gala", "Unscheduled"\./);
      assert.deepEqual(error.conflicts.map(c => c.title), ['Tech Summit', 'Annual Gala', 'Unscheduled']);
      assert.equal(error.conflicts[2].startsAt, null);
      return true;
    });
  });
});

test('deleteEquipment refuses unsafe deletions without writing anything', async t => {
  await t.test('a missing record is a 404', async () => {
    const { query, wrote } = fakeQuery({ record: null });
    await assert.rejects(deleteEquipment(query, 'gone', confirm()),
      { status: 404, message: 'Equipment not found. It may already have been removed.' });
    assert.equal(wrote(/^DELETE|INSERT/), false);
  });

  await t.test('a record changed since it was reviewed is rejected with the latest details', async () => {
    const changed = { ...item, total_quantity: 9, updated_at: new Date('2026-02-01T00:00:00Z') };
    const { query, wrote } = fakeQuery({ record: changed });
    await assert.rejects(deleteEquipment(query, 'mic', confirm()), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'stale');
      assert.equal(error.equipment.total_quantity, 9);
      assert.equal(error.equipment.available_quantity, 8);
      return true;
    });
    assert.equal(wrote(/^DELETE|INSERT/), false);
  });

  await t.test('the typed name must match exactly, including case (AC2)', async () => {
    for (const confirmName of ['wireless microphone', 'Wireless mic', 'Projector']) {
      const { query, wrote } = fakeQuery();
      await assert.rejects(deleteEquipment(query, 'mic', confirm({ confirmName })),
        { status: 400, code: 'name_mismatch', message: 'The name you typed does not match this equipment record. Nothing was deleted.' }, confirmName);
      assert.equal(wrote(/^DELETE|INSERT/), false);
    }
  });

  await t.test('a mismatched name is rejected before reservations are looked up', async () => {
    const { query, calls } = fakeQuery({ blocking: [blockingRow('Annual Gala', 2)] });
    await assert.rejects(deleteEquipment(query, 'mic', confirm({ confirmName: 'Projector' })), { code: 'name_mismatch' });
    assert.equal(calls.some(c => c.sql.includes('FROM equipment_reservations r')), false);
  });

  await t.test('a failing database call propagates and stops the deletion', async () => {
    const { query: base } = fakeQuery();
    const calls = [];
    const query = async (sql, params) => {
      calls.push(sql);
      if (sql.includes('FROM equipment_reservations r')) throw new Error('connection lost');
      return base(sql, params);
    };
    await assert.rejects(deleteEquipment(query, 'mic', confirm()), { message: 'connection lost' });
    assert.equal(calls.some(sql => sql.startsWith('DELETE')), false);
  });
});
