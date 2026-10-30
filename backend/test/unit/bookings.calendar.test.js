// US-017 - View Upcoming Bookings Calendar
// Unit tests for the pure filter-building logic behind GET /api/bookings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBookingFilters } = require('../../src/index').__test__;

test('buildBookingFilters always requires approved/confirmed status', () => {
  const { where, params } = buildBookingFilters({});
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed')");
  assert.deepEqual(params, []);
});

test('buildBookingFilters with no filters passed at all (undefined query)', () => {
  const { where, params } = buildBookingFilters();
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed')");
  assert.deepEqual(params, []);
});

test('buildBookingFilters adds a venue filter when venueId is given', () => {
  const { where, params } = buildBookingFilters({ venueId: 'venue-123' });
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed') AND b.venue_id = $1");
  assert.deepEqual(params, ['venue-123']);
});

test('buildBookingFilters adds a from-date filter when from is given', () => {
  const { where, params } = buildBookingFilters({ from: '2026-11-01' });
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed') AND b.start_time::date >= $1::date");
  assert.deepEqual(params, ['2026-11-01']);
});

test('buildBookingFilters adds a to-date filter when to is given', () => {
  const { where, params } = buildBookingFilters({ to: '2026-11-30' });
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed') AND b.start_time::date <= $1::date");
  assert.deepEqual(params, ['2026-11-30']);
});

test('buildBookingFilters combines venueId, from and to, with params in order', () => {
  const { where, params } = buildBookingFilters({ venueId: 'venue-123', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(
    where,
    "WHERE b.status IN ('approved', 'confirmed') AND b.venue_id = $1 AND b.start_time::date >= $2::date AND b.start_time::date <= $3::date"
  );
  assert.deepEqual(params, ['venue-123', '2026-11-01', '2026-11-30']);
});

test('buildBookingFilters treats an empty-string filter as not provided', () => {
  const { where, params } = buildBookingFilters({ venueId: '', from: '', to: '' });
  assert.equal(where, "WHERE b.status IN ('approved', 'confirmed')");
  assert.deepEqual(params, []);
});
