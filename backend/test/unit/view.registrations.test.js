// US-040 - View Event Registrations
// Pure tests for separating active and withdrawn registration records.
const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionRegistrations } = require('../../src/registrations');

// AC-040-002/003: active and withdrawn registrations are kept in separate lists.
test('partitions registered and withdrawn attendees separately', () => {
  const result = partitionRegistrations([
    { id: 'one', name: 'Active Attendee', status: 'registered' },
    { id: 'two', name: 'Withdrawn Attendee', status: 'withdrawn' }
  ]);
  assert.deepEqual(result.registered.map(row => row.id), ['one']);
  assert.deepEqual(result.withdrawn.map(row => row.id), ['two']);
});

// AC-040-003: withdrawn records are not included in the active registration list.
test('handles an event with no active registrations', () => {
  const result = partitionRegistrations([{ id: 'one', status: 'withdrawn' }]);
  assert.deepEqual(result.registered, []);
  assert.equal(result.withdrawn.length, 1);
});