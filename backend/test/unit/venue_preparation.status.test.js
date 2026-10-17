// US-021 unit test: checks the function that validates a preparation status. No server or database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePreparationStatus } = require('../../src/preparation');

test('[UT-01] parsePreparationStatus accepts "ready" and rejects "done" (AC2)', () => {
  assert.equal(parsePreparationStatus({ status: 'ready' }), 'ready'); // valid: returned as-is
  assert.throws(() => parsePreparationStatus({ status: 'done' }));   // invalid: throws an error
});