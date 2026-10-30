// US-013 - Approve/Reject Event Request
// Unit tests for the pure validation and message-building logic behind
// PATCH /api/events/:id/decision.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEventDecisionInput, describeEventDecision } = require('../../src/index').__test__;

test('parseEventDecisionInput accepts a bare approval', () => {
  const result = parseEventDecisionInput({ decision: 'approved' });
  assert.deepEqual(result, { decision: 'approved', reason: null, reasonDetail: null });
});

test('parseEventDecisionInput trims whitespace around the decision', () => {
  const result = parseEventDecisionInput({ decision: '  approved  ' });
  assert.equal(result.decision, 'approved');
});

test('parseEventDecisionInput rejects a missing decision', () => {
  assert.throws(() => parseEventDecisionInput({}), (err) => err.status === 400 && /either approved or rejected/.test(err.message));
});

test('parseEventDecisionInput rejects an unknown decision value', () => {
  assert.throws(() => parseEventDecisionInput({ decision: 'maybe' }), (err) => err.status === 400);
});

test('parseEventDecisionInput requires a valid reason when rejecting', () => {
  assert.throws(() => parseEventDecisionInput({ decision: 'rejected' }), (err) => err.status === 400 && /valid rejection reason/.test(err.message));
});

test('parseEventDecisionInput rejects an unrecognised reason code', () => {
  assert.throws(
    () => parseEventDecisionInput({ decision: 'rejected', reason: 'not_a_real_reason' }),
    (err) => err.status === 400 && /valid rejection reason/.test(err.message)
  );
});

test('parseEventDecisionInput accepts each known reason other than "other" with no detail', () => {
  for (const reason of ['insufficient_information', 'infeasible_requirements', 'duplicate_request']) {
    const result = parseEventDecisionInput({ decision: 'rejected', reason });
    assert.equal(result.reason, reason);
    assert.equal(result.reasonDetail, '');
  }
});

test('parseEventDecisionInput requires a free-text detail when the reason is "other"', () => {
  assert.throws(
    () => parseEventDecisionInput({ decision: 'rejected', reason: 'other' }),
    (err) => err.status === 400 && /required when the reason is Other/.test(err.message)
  );
  assert.throws(
    () => parseEventDecisionInput({ decision: 'rejected', reason: 'other', reasonDetail: '   ' }),
    (err) => err.status === 400
  );
});

test('parseEventDecisionInput accepts "other" once a non-blank detail is given, trimmed', () => {
  const result = parseEventDecisionInput({ decision: 'rejected', reason: 'other', reasonDetail: '  Venue too small  ' });
  assert.equal(result.reasonDetail, 'Venue too small');
});

test('parseEventDecisionInput keeps a comment for a non-"other" reason too (AC-009-002)', () => {
  const result = parseEventDecisionInput({ decision: 'rejected', reason: 'duplicate_request', reasonDetail: 'Already requested by someone else' });
  assert.equal(result.reasonDetail, 'Already requested by someone else');
});

test('describeEventDecision builds the approval summary and notification', () => {
  const { summary, notificationMessage } = describeEventDecision(
    { decision: 'approved', reason: null, reasonDetail: null },
    { title: 'Town Hall', coordinatorId: 'coord-1' }
  );
  assert.equal(summary, 'Decision: approved by coordinator coord-1');
  assert.equal(notificationMessage, 'Your event request "Town Hall" was approved and can proceed to venue search and booking.');
});

test('describeEventDecision builds the rejection summary and notification with the reason label', () => {
  const { summary, notificationMessage } = describeEventDecision(
    { decision: 'rejected', reason: 'infeasible_requirements', reasonDetail: '' },
    { title: 'Town Hall', coordinatorId: 'coord-1' }
  );
  assert.equal(summary, 'Decision: rejected by coordinator coord-1 for reason: Infeasible Requirements');
  assert.equal(notificationMessage, 'Your event request "Town Hall" was rejected. Reason: Infeasible Requirements');
});

test('describeEventDecision appends the detail text only when a comment is present', () => {
  const { summary, notificationMessage } = describeEventDecision(
    { decision: 'rejected', reason: 'other', reasonDetail: 'Venue too small' },
    { title: 'Town Hall', coordinatorId: 'coord-1' }
  );
  assert.equal(summary, 'Decision: rejected by coordinator coord-1 for reason: Other Details: Venue too small');
  assert.equal(notificationMessage, 'Your event request "Town Hall" was rejected. Reason: Other Details: Venue too small');
});
