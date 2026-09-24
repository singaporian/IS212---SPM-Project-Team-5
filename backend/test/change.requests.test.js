const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChangeRequestInput } = require('../src/changeRequests');

test('parseChangeRequestInput accepts valid individual fields and rejects invalid ones', () => {
  assert.deepEqual(parseChangeRequestInput({ expectedAttendance: 150 }), { expectedAttendance: 150 });
  assert.deepEqual(parseChangeRequestInput({ equipmentRequirements: ['projector', ' mic '] }), { equipmentRequirements: ['projector', 'mic'] });
  for (const input of [{}, { expectedAttendance: -1 }, { expectedAttendance: 1.5 },
    { preferredStart: '2099-01-02T10:00:00Z', preferredEnd: '2099-01-02T09:00:00Z' },
    { equipmentRequirements: 'not-an-array' }, { unknownField: 'x' }]) {
    assert.throws(() => parseChangeRequestInput(input));
  }
});


// express app + temp `events`/`event_change_requests`/`notifications` tables,
// then assert:
//  - 201 + row created for a submitted event owned by the caller
//  - 409 for a draft event (AC-008-001)
//  - 404 for another organiser's event
//  - the `events` row is byte-for-byte unchanged after the POST (AC-008-004)
//  - a notification row is created only when assigned_coordinator_id is set (AC-008-003)