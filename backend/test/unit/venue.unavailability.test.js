// US-020 - Mark Venue Unavailable
// Pure unit tests for the unavailability reason validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const { validateUnavailabilityReason } = app.__test__;

// AC-020-001: a reasonCode from the fixed list is required.
test('accepts a known reasonCode without detail', () => {
  const result = validateUnavailabilityReason({ reasonCode: 'maintenance' });
  assert.deepEqual(result, { reasonCode: 'maintenance', reasonDetail: '', reasonText: 'Maintenance' });
});

test('rejects an unknown reasonCode', () => {
  assert.throws(
    () => validateUnavailabilityReason({ reasonCode: 'bad-code' }),
    err => err.status === 400
  );
});

test('rejects a missing reasonCode with no legacy reason either', () => {
  assert.throws(
    () => validateUnavailabilityReason({}),
    err => err.status === 400
  );
});

// AC-020-002: "Other" requires a free-text detail.
test('rejects "other" without a detail', () => {
  assert.throws(
    () => validateUnavailabilityReason({ reasonCode: 'other' }),
    err => err.status === 400
  );
});

test('accepts "other" with a detail, and uses it as the display text', () => {
  const result = validateUnavailabilityReason({ reasonCode: 'other', reasonDetail: 'Pest control' });
  assert.deepEqual(result, { reasonCode: 'other', reasonDetail: 'Pest control', reasonText: 'Pest control' });
});

// Legacy free-text `reason` field support (older clients/tests).
test('maps a legacy free-text reason to its known code', () => {
  const result = validateUnavailabilityReason({ reason: 'Equipment Failure' });
  assert.equal(result.reasonCode, 'equipment_failure');
  assert.equal(result.reasonText, 'Equipment Failure');
});

test('maps an unrecognised legacy reason to "other" using its own text as the detail', () => {
  const result = validateUnavailabilityReason({ reason: 'Flooded basement' });
  assert.equal(result.reasonCode, 'other');
  assert.equal(result.reasonDetail, 'Flooded basement');
  assert.equal(result.reasonText, 'Flooded basement');
});

test('an explicit reasonCode takes priority over a legacy reason', () => {
  const result = validateUnavailabilityReason({ reasonCode: 'renovation', reason: 'Equipment Failure' });
  assert.equal(result.reasonCode, 'renovation');
});

test('each known reason code maps to its display label', () => {
  assert.equal(validateUnavailabilityReason({ reasonCode: 'maintenance' }).reasonText, 'Maintenance');
  assert.equal(validateUnavailabilityReason({ reasonCode: 'equipment_failure' }).reasonText, 'Equipment Failure');
  assert.equal(validateUnavailabilityReason({ reasonCode: 'renovation' }).reasonText, 'Renovation');
  assert.equal(validateUnavailabilityReason({ reasonCode: 'safety_concerns' }).reasonText, 'Safety Concerns');
});
