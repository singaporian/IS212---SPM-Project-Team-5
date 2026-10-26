// US-033: isolated decision parsing. SQL availability/transactions remain integration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBookingDecision } = require('../../src/bookingDecisions');

test('[UT-01] parseBookingDecision accepts approval and rejection with optional information', () => {
  for (const decision of ['approved', 'rejected']) {
    assert.deepEqual(parseBookingDecision({ decision, reason: ' Reason ', comment: ' Comment ' }), {
      decision, reason: 'Reason', comment: 'Comment', alternativeStart: null, alternativeEnd: null
    });
  }
  assert.equal(parseBookingDecision({ decision: 'rejected' }).reason, '');
});

test('[UT-02] parseBookingDecision rejects unsupported or missing decisions', () => {
  for (const body of [null, {}, { decision: 'confirmed' }, { decision: 42 }]) {
    assert.throws(() => parseBookingDecision(body), { status: 400, message: 'Invalid booking decision' });
  }
});

test('[UT-03] parseBookingDecision preserves alternative moments and accompanying comment', () => {
  const input = { decision: 'alternative_suggested', alternativeStartTime: '2099-03-01T10:03:00+08:00', alternativeEndTime: '2099-03-01T11:07:00+08:00', comment: 'Later arrangement' };
  const result = parseBookingDecision(input);
  assert.equal(result.alternativeStart.toISOString(), '2099-03-01T02:03:00.000Z');
  assert.equal(result.alternativeEnd.toISOString(), '2099-03-01T03:07:00.000Z');
  assert.equal(result.comment, input.comment);
  assert.equal(input.alternativeStartTime, '2099-03-01T10:03:00+08:00');
});

test('[UT-04] parseBookingDecision rejects incomplete, invalid and unordered alternatives', () => {
  const start = '2099-03-01T10:00:00+08:00';
  for (const [alternativeStartTime, alternativeEndTime] of [[undefined, start], [start, undefined], ['bad', start], [start, start], [start, '2099-03-01T09:59:00+08:00']]) {
    assert.throws(() => parseBookingDecision({ decision: 'alternative_suggested', alternativeStartTime, alternativeEndTime }), { status: 400 });
  }
});

test('[UT-05] parseBookingDecision rejects non-text reason or comment', () => {
  for (const field of ['reason', 'comment']) {
    assert.throws(() => parseBookingDecision({ decision: 'rejected', [field]: {} }), { status: 400 });
  }
});
