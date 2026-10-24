// US-039 — Operational Safety Check
// These tests check Safety Officer input rules in memory. API persistence,
// notifications, and event status changes are covered by integration tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSafetyDecision } = require('../../src/safetyChecks');

// Only the three supported Safety Officer decisions are accepted, and comments
// are trimmed before the decision is passed to the application logic.
test('parses valid Safety Officer decisions and trims comments', () => {
  assert.deepEqual(parseSafetyDecision({ decision: 'approved', comments: '  Looks safe.  ' }), {
    decision: 'approved', comments: 'Looks safe.', scopes: []
  });
  assert.deepEqual(parseSafetyDecision({ decision: 'rejected' }), {
    decision: 'rejected', comments: '', scopes: []
  });
});

// Request Changes must identify whether the Venue arrangements, Technical
// arrangements, or both need to be changed.
test('requires a valid venue or technical scope for requested changes', () => {
  assert.deepEqual(parseSafetyDecision({ decision: 'changes_requested', changeScope: ['venue', 'venue', 'technical'] }).scopes, ['venue', 'technical']);
  assert.throws(() => parseSafetyDecision({ decision: 'changes_requested' }), /Select whether/);
  assert.throws(() => parseSafetyDecision({ decision: 'changes_requested', changeScope: ['crowd'] }), /Select whether/);
});

// Unknown decisions are rejected before anything could be saved. Comments are
// free-form text because the user story does not define a length restriction.
test('rejects unknown decisions and accepts long comments', () => {
  assert.throws(() => parseSafetyDecision({ decision: 'pending' }), /Choose approve/);
  assert.equal(parseSafetyDecision({ decision: 'approved', comments: 'x'.repeat(2001) }).comments.length, 2001);
});
