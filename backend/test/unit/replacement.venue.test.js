// US-037 — Venue Unavailability and Replacement Venues
// These tests check replacement-booking rules in memory. Database preservation,
// notifications, and API behavior are covered by integration tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { occupiedInterval, overlaps } = require('../../src/venueOccupancy');
const { Venue, Booking } = require('../../src/domain');

// Setup and turnaround determine the full occupied interval of the original booking.
test('calculates the original booking occupied interval with setup and turnaround', () => {
  const booking = {
    start_time: '2027-02-10T10:00:00+08:00',
    end_time: '2027-02-10T12:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 45
  };

  assert.deepEqual(occupiedInterval(booking), {
    start: '2027-02-10T01:30:00.000Z',
    end: '2027-02-10T04:45:00.000Z'
  });
});

// A booking is affected only when the unavailable period overlaps its occupied
// interval. A period that starts exactly when the booking ends is not an overlap.
test('detects an affected booking only when unavailability overlaps occupancy', () => {
  const booking = {
    start_time: '2027-02-10T10:00:00+08:00',
    end_time: '2027-02-10T12:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 45
  };
  const occupied = occupiedInterval(booking);

  assert.equal(overlaps(occupied, { start: '2027-02-10T01:00:00.000Z', end: '2027-02-10T02:00:00.000Z' }), true);
  assert.equal(overlaps(occupied, { start: occupied.end, end: '2027-02-10T06:00:00.000Z' }), false);
});

// A replacement venue must meet the event's capacity, facility, layout, and
// accessibility needs.
test('checks replacement venue suitability independently', () => {
  const replacementVenue = new Venue({
    id: 'replacement-venue',
    name: 'Breakout Room',
    capacity: 80,
    facilities: ['projector'],
    supportedLayouts: ['Classroom'],
    accessibility: ['wheelchair ramps']
  });

  assert.equal(replacementVenue.isSuitableFor({
    expectedAttendance: 60,
    requiredFacilities: ['projector'],
    requiredLayouts: ['Classroom'],
    accessibilityNeeds: ['wheelchair ramps']
  }), true);
  assert.equal(replacementVenue.isSuitableFor({ expectedAttendance: 100 }), false);
});

// A replacement is a separate booking for the same event, so its status can
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
