// US-037 — Venue Unavailability and Replacement Venues
// These tests check replacement-booking rules in memory. Database preservation,
// notifications, and API behavior are covered by integration tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Booking } = require('../../src/domain');

// AC-037-002/007: setup and turnaround determine the original booking's affected interval.
// Covered by backend/test/unit/venue-holds.test.js [UT-05] (setup) and [UT-06] (turnaround) (dedupe #4).

// AC-037-001/002/007: a booking is affected only when unavailability overlaps its occupied
// interval. A period that starts exactly when the booking ends is not an overlap.
// Covered by backend/test/unit/venue-holds.test.js [UT-09] (overlap) and [UT-11] (exact touch) (dedupe #4).

// AC-037-005: a replacement venue must meet the event's capacity, facility, layout, and
// accessibility needs.
// Covered by backend/test/unit/domain.test.js [UT-OOP-05] (Venue.isSuitableFor) (dedupe #14).

// AC-037-006/007/008: a replacement is a separate booking for the same event, so its status can
// change without changing the preserved original booking.
test('keeps original and replacement bookings associated but independent', () => {
  const original = new Booking({
    id: 'original-booking',
    eventId: 'event-1',
    venueId: 'original-venue',
    startTime: '2027-02-10T10:00:00+08:00',
    endTime: '2027-02-10T12:00:00+08:00',
    status: 'approved'
  });
  const replacement = new Booking({
    id: 'replacement-booking',
    eventId: 'event-1',
    venueId: 'replacement-venue',
    startTime: '2027-02-10T10:00:00+08:00',
    endTime: '2027-02-10T12:00:00+08:00',
    status: 'pending'
  });

  assert.equal(original.eventId, replacement.eventId);
  assert.notEqual(original.id, replacement.id);
  assert.notEqual(original.venueId, replacement.venueId);
  assert.equal(original.status, 'approved');
  assert.equal(replacement.status, 'pending');
  replacement.status = 'confirmed';
  assert.equal(original.status, 'approved');
});
