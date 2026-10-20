// Unit tests for the change request review logic (US-032).
// No database, server or test doubles: real functions with plain inputs.
// [UT-xx] ids link each test to docs/testing/US-032-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChangeRequestDecision } = require('../../src/changeRequests');
const { ChangeRequest, EventRequest } = require('../../src/domain');

const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const START = at('2099-03-01', '09:00');
const END = at('2099-03-01', '12:00');

test('[UT-02] parseChangeRequestDecision accepts approved or rejected and refuses anything else', () => {
  assert.deepEqual(parseChangeRequestDecision({ decision: 'approved' }), { decision: 'approved' });
  assert.deepEqual(parseChangeRequestDecision({ decision: ' rejected ' }), { decision: 'rejected' }, 'spaces are trimmed');
  for (const body of [{ decision: 'cancelled' }, { decision: '' }, {}, null, [], { decision: 42 }]) {
    assert.throws(() => parseChangeRequestDecision(body),
      (error) => error.status === 400 && error.message === 'Choose to approve or reject the change request.',
      JSON.stringify(body));
  }
});

test('[UT-04] ChangeRequest.movesEvent is true only when the start or end time is a different moment', () => {
  const event = new EventRequest({ status: 'planning', preferred_start: START, preferred_end: END });
  const moves = (proposedChanges) => new ChangeRequest({ proposedChanges }).movesEvent(event);

  assert.equal(moves({ preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00') }), true, 'new date');
  assert.equal(moves({ preferredStart: at('2099-03-01', '10:00'), preferredEnd: at('2099-03-01', '13:00') }), true, 'same day, later');
  assert.equal(moves({ venueLayoutPreference: 'Classroom' }), false, 'no times in the request');
  assert.equal(moves({ preferredStart: START, preferredEnd: END }), false, 'same times');

  // PostgreSQL returns Date objects, the request holds strings: same moment must not count as a move.
  const fromDb = new EventRequest({ status: 'planning', preferred_start: new Date(START), preferred_end: new Date(END) });
  assert.equal(new ChangeRequest({ proposedChanges: { preferredStart: START, preferredEnd: END } }).movesEvent(fromDb), false);
});
