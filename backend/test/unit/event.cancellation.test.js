// US-042 - Cancel an Event
// Unit tests for the pure "can this event be cancelled" logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertEventCancellable } = require('../../src/index').__test__;

test('assertEventCancellable allows every status except completed/cancelled', () => {
  for (const status of ['draft', 'submitted', 'approved', 'planning', 'confirmed', 'rejected', 'clarification_requested']) {
    assert.equal(assertEventCancellable({ status }), true);
  }
});

test('assertEventCancellable rejects an already-completed event', () => {
  assert.throws(
    () => assertEventCancellable({ status: 'completed' }),
    (err) => err.status === 409 && /already completed/.test(err.message)
  );
});

test('assertEventCancellable rejects an already-cancelled event', () => {
  assert.throws(
    () => assertEventCancellable({ status: 'cancelled' }),
    (err) => err.status === 409 && /already cancelled/.test(err.message)
  );
});
