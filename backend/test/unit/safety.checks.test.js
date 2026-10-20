const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSafetyDecision } = require('../../src/safetyChecks');
const { promoteEventIfReady } = require('../../src/eventReadiness');

// [AC-039-003: Safety Officer decision is one of approved, rejected, or changes_requested]
// Approved and rejected decisions preserve their trimmed comments; omitted comments
// are stored as an empty value rather than causing the request to fail.
test('parses valid Safety Officer decisions and trims comments', () => {
  assert.deepEqual(parseSafetyDecision({ decision: 'approved', comments: '  Looks safe.  ' }), {
    decision: 'approved', comments: 'Looks safe.', scopes: []
  });
  assert.deepEqual(parseSafetyDecision({ decision: 'rejected' }), {
    decision: 'rejected', comments: '', scopes: []
  });
});

// [AC-039-004: Request Changes identifies the affected arrangement]
// The Safety Officer must select venue, technical, or both. Duplicate checkbox
// values are collapsed so the Coordinator receives one clear scope per arrangement.
test('requires a valid venue or technical scope for requested changes', () => {
  assert.deepEqual(parseSafetyDecision({ decision: 'changes_requested', changeScope: ['venue', 'venue', 'technical'] }).scopes, ['venue', 'technical']);
  assert.throws(() => parseSafetyDecision({ decision: 'changes_requested' }), /Select whether/);
  assert.throws(() => parseSafetyDecision({ decision: 'changes_requested', changeScope: ['crowd'] }), /Select whether/);
});

// [AC-039-006: invalid decisions and oversized comments are rejected before persistence]
// Unknown statuses cannot be submitted, and comments longer than 2,000 characters
// are rejected with a client error so invalid audit data is never saved.
test('rejects unknown decisions and comments over 2,000 characters', () => {
  assert.throws(() => parseSafetyDecision({ decision: 'pending' }), /Choose approve/);
  assert.throws(() => parseSafetyDecision({ decision: 'approved', comments: 'x'.repeat(2001) }), /2,000/);
});

// [AC-039-007: after arrangements are corrected, the Safety Check is reopened]
// When all venue and technical arrangements make an event ready again, the event is
// promoted to confirmed and an earlier changes_requested record is reset to pending,
// allowing the Safety Officer to review the corrected arrangements again.
test('reopens a changes-requested Safety Check when readiness is restored', async () => {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('UPDATE events')) return { rows: [{ id: 'event-1', title: 'Conference' }] };
    return { rows: [] };
  };
  const event = await promoteEventIfReady(query, 'event-1');
  assert.deepEqual(event, { id: 'event-1', title: 'Conference' });
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /status = 'pending'/);
  assert.deepEqual(queries[1].params, ['event-1']);
});