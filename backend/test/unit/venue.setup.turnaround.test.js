// US-035 - Configure Venue Setup and Turnaround Time
// Pure unit tests for the setup/turnaround input validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const { validateSetupTurnaroundInput } = app.__test__;

// AC-035-001/002: both values are required and must be whole, non-negative minutes.
test('accepts whole non-negative minutes for both values', () => {
  const result = validateSetupTurnaroundInput({ setupMinutes: 45, turnaroundMinutes: 15 });
  assert.deepEqual(result, { setupMinutes: 45, turnaroundMinutes: 15 });
});

test('accepts zero for either value', () => {
  const result = validateSetupTurnaroundInput({ setupMinutes: 0, turnaroundMinutes: 0 });
  assert.deepEqual(result, { setupMinutes: 0, turnaroundMinutes: 0 });
});

test('rejects a negative setup time', () => {
  assert.throws(
    () => validateSetupTurnaroundInput({ setupMinutes: -5, turnaroundMinutes: 10 }),
    err => err.status === 400
  );
});

test('rejects a negative turnaround time', () => {
  assert.throws(
    () => validateSetupTurnaroundInput({ setupMinutes: 10, turnaroundMinutes: -1 }),
    err => err.status === 400
  );
});

test('rejects a fractional minute value', () => {
  assert.throws(
    () => validateSetupTurnaroundInput({ setupMinutes: 10.5, turnaroundMinutes: 10 }),
    err => err.status === 400
  );
});

test('rejects a missing value', () => {
  assert.throws(
    () => validateSetupTurnaroundInput({ setupMinutes: 10 }),
    err => err.status === 400
  );
});

test('rejects a non-numeric value', () => {
  assert.throws(
    () => validateSetupTurnaroundInput({ setupMinutes: 'soon', turnaroundMinutes: 10 }),
    err => err.status === 400
  );
});
