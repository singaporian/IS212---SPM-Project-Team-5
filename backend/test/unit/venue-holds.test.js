// US-038 unit tests: real exported helpers, fixed clocks; no queries or HTTP.
// [UT-xx] IDs map to docs/testing/US-038-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveHoldStatus } = require('../../src/holdAvailability');
const { occupiedInterval, overlaps } = require('../../src/venueOccupancy');
const { validateExpiry } = require('../../src/venueHolds');

const EXPIRY = '2099-03-01T10:00:00+08:00';
const hold = { status: 'active', expiry_at: EXPIRY };
const booking = { start_time: EXPIRY, end_time: '2099-03-01T11:00:00+08:00' };
const interval = (start, end) => ({ start: `2099-03-01T${start}:00+08:00`, end: `2099-03-01T${end}:00+08:00` });

test('[UT-01] effectiveHoldStatus returns active before expiry', () => {
  assert.equal(effectiveHoldStatus(hold, new Date(Date.parse(EXPIRY) - 1)), 'active');
});

test('[UT-02] effectiveHoldStatus returns expired exactly at expiry', () => {
  assert.equal(effectiveHoldStatus(hold, new Date(EXPIRY)), 'expired');
});

test('[UT-03] effectiveHoldStatus returns expired after expiry', () => {
  assert.equal(effectiveHoldStatus(hold, new Date(Date.parse(EXPIRY) + 1)), 'expired');
});

test('[UT-04] effectiveHoldStatus preserves historical non-active statuses', () => {
  // These are input-preservation checks, not new lifecycle states or actions.
  for (const status of ['released', 'expired']) {
    for (const now of [new Date(Date.parse(EXPIRY) - 1), new Date(Date.parse(EXPIRY) + 1)]) {
      assert.equal(effectiveHoldStatus({ ...hold, status }, now), status);
    }
  }
  assert.equal(hold.status, 'active', 'deriving expiry does not mutate the stored row');
});

test('[UT-05] occupiedInterval subtracts recorded setup from start', () => {
  assert.deepEqual(occupiedInterval({ ...booking, setup_minutes: 23 }), {
    start: '2099-03-01T01:37:00.000Z', end: '2099-03-01T03:00:00.000Z'
  });
});

test('[UT-06] occupiedInterval adds recorded turnaround after end', () => {
  assert.deepEqual(occupiedInterval({ ...booking, turnaround_minutes: 17 }), {
    start: '2099-03-01T02:00:00.000Z', end: '2099-03-01T03:17:00.000Z'
  });
});

test('[UT-07] occupiedInterval adds no duration for zero, null or missing buffers', () => {
  for (const buffers of [{}, { setup_minutes: 0, turnaround_minutes: 0 }, { setup_minutes: null, turnaround_minutes: null }]) {
    assert.deepEqual(occupiedInterval({ ...booking, ...buffers }), {
      start: '2099-03-01T02:00:00.000Z', end: '2099-03-01T03:00:00.000Z'
    });
  }
});

test('[UT-08] occupiedInterval extends setup and turnaround across Singapore midnight', () => {
  assert.deepEqual(occupiedInterval({ start_time: '2099-03-01T00:10:00+08:00', end_time: '2099-03-01T23:50:00+08:00', setup_minutes: 20, turnaround_minutes: 20 }), {
    start: '2099-02-28T15:50:00.000Z', end: '2099-03-01T16:10:00.000Z'
  });
});

test('[UT-09] overlaps detects intersecting and contained intervals in either order', () => {
  const first = interval('10:00', '11:00');
  for (const second of [interval('10:30', '11:30'), interval('10:15', '10:45')]) {
    assert.equal(overlaps(first, second), true);
    assert.equal(overlaps(second, first), true);
  }
});

test('[UT-10] overlaps rejects separated intervals in either order', () => {
  const first = interval('10:00', '11:00'), second = interval('11:01', '12:00');
  assert.equal(overlaps(first, second), false);
  assert.equal(overlaps(second, first), false);
});

test('[UT-11] overlaps excludes exact touching under the existing implementation convention', () => {
  // Technical convention regression, not a new customer acceptance criterion.
  const first = interval('10:00', '11:00'), second = interval('11:00', '12:00');
  assert.equal(overlaps(first, second), false);
  assert.equal(overlaps(second, first), false);
});

test('[UT-12] recorded setup or turnaround makes touching event slots overlap', () => {
  const next = { start_time: booking.end_time, end_time: '2099-03-01T12:00:00+08:00' };
  assert.equal(overlaps(occupiedInterval(booking), occupiedInterval(next)), false);
  assert.equal(overlaps(occupiedInterval({ ...booking, turnaround_minutes: 1 }), occupiedInterval(next)), true);
  assert.equal(overlaps(occupiedInterval(booking), occupiedInterval({ ...next, setup_minutes: 1 })), true);
});

test('[UT-13] validateExpiry accepts and normalises a future timestamp', () => {
  assert.equal(validateExpiry(EXPIRY, '2099-03-01T09:00:00+08:00'), '2099-03-01T02:00:00.000Z');
  assert.equal(validateExpiry('2099-03-01T02:00:00Z', '2099-03-01T09:00:00+08:00'), '2099-03-01T02:00:00.000Z');
});

test('[UT-14] validateExpiry rejects timestamps at or before current time', () => {
  for (const expiry of [EXPIRY, '2099-03-01T09:59:59.999+08:00']) {
    assert.throws(() => validateExpiry(expiry, EXPIRY), {
      status: 400, message: 'Expiry must be later than the current time.'
    });
  }
});

test('[UT-15] validateExpiry rejects malformed input and timestamps without a timezone', () => {
  for (const expiry of [undefined, null, 42, '', 'bad', 'badZ', '2099-03-01T25:00:00+08:00', '2099-03-01T10:00:00']) {
    assert.throws(() => validateExpiry(expiry, '2099-03-01T09:00:00+08:00'), {
      status: 400, message: 'Enter a valid expiry date and time.'
    });
  }
});
