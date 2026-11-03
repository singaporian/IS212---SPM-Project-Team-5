// Unit tests for the change request review logic (US-032).
// No database, server or test doubles: real functions with plain inputs.
// [UT-xx] ids link each test to docs/testing/US-032-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChangeRequestDecision } = require('../../src/changeRequests');

test('[UT-02] parseChangeRequestDecision accepts approved or rejected and refuses anything else', () => {
  assert.deepEqual(parseChangeRequestDecision({ decision: 'approved' }), { decision: 'approved' });
  assert.deepEqual(parseChangeRequestDecision({ decision: ' rejected ' }), { decision: 'rejected' }, 'spaces are trimmed');
  for (const body of [{ decision: 'cancelled' }, { decision: '' }, {}, null, [], { decision: 42 }]) {
    assert.throws(() => parseChangeRequestDecision(body),
      (error) => error.status === 400 && error.message === 'Choose to approve or reject the change request.',
      JSON.stringify(body));
  }
});

// [UT-04] ChangeRequest.movesEvent (AC-032-005): moved unchanged to
// backend/test/unit/domain.test.js [UT-OOP-08], where domain class tests live (dedupe #3).
