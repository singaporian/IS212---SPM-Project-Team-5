// US-041 - Mark an Event as Completed
// Unit tests for the pure "can this event be marked completed" logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventEndTime, assertEventCompletable } = require('../../src/index').__test__;

const PAST = new Date('2026-01-01T10:00:00Z');
const FUTURE = new Date('2099-01-01T10:00:00Z');
const NOW = new Date('2026-06-01T00:00:00Z');

test('eventEndTime uses the latest occupying (approved/confirmed) booking end time', () => {
  const event = { preferred_end: '2026-01-01T08:00:00Z' };
  const bookings = [
    { status: 'confirmed', end_time: '2026-01-01T10:00:00Z' },
    { status: 'approved', end_time: '2026-01-01T12:00:00Z' },
    { status: 'cancelled', end_time: '2026-01-01T23:00:00Z' } // not occupying, ignored
  ];
  assert.equal(eventEndTime(event, bookings).toISOString(), '2026-01-01T12:00:00.000Z');
});

test('eventEndTime falls back to the event\'s own preferred end time with no occupying booking', () => {
  const event = { preferred_end: '2026-01-01T08:00:00Z' };
  assert.equal(eventEndTime(event, []).toISOString(), '2026-01-01T08:00:00.000Z');
});

test('eventEndTime returns null when neither a booking nor a preferred end time exists', () => {
  assert.equal(eventEndTime({ preferred_end: null }, []), null);
});

test('assertEventCompletable rejects anything that is not confirmed', () => {
  for (const status of ['draft', 'submitted', 'approved', 'planning', 'rejected', 'completed', 'cancelled']) {
    assert.throws(
      () => assertEventCompletable({ status, preferred_end: PAST.toISOString() }, [], NOW),
      (err) => err.status === 409 && /Only a confirmed event/.test(err.message)
    );
  }
});

test('assertEventCompletable blocks a confirmed event whose end time has not passed yet', () => {
  assert.throws(
    () => assertEventCompletable({ status: 'confirmed', preferred_end: FUTURE.toISOString() }, [], NOW),
    (err) => err.status === 409 && /has passed/.test(err.message)
  );
});

test('assertEventCompletable blocks a confirmed event with no determinable end time at all', () => {
  assert.throws(
    () => assertEventCompletable({ status: 'confirmed', preferred_end: null }, [], NOW),
    (err) => err.status === 409
  );
});

test('assertEventCompletable allows a confirmed event whose end time has passed', () => {
  assert.equal(assertEventCompletable({ status: 'confirmed', preferred_end: PAST.toISOString() }, [], NOW), true);
});

test('assertEventCompletable uses the booking end time over the preferred time when deciding', () => {
  // Preferred time is in the future, but the actual (occupying) booking already ended.
  const event = { status: 'confirmed', preferred_end: FUTURE.toISOString() };
  const bookings = [{ status: 'confirmed', end_time: PAST.toISOString() }];
  assert.equal(assertEventCompletable(event, bookings, NOW), true);
});
