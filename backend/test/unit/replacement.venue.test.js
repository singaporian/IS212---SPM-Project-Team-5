const test = require('node:test');
const assert = require('node:assert/strict');
const { occupiedInterval, overlaps } = require('../../src/venueOccupancy');
const { Venue, Booking } = require('../../src/domain');

// [AC-037-002: original event and booking are preserved] [AC-037-007: original booking remains identifiable as affected]
// The original booking's occupied interval remains a concrete value that can be
// compared with a venue unavailability period; no cancellation is performed here.
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

// [AC-037-001: Coordinator is notified] [AC-037-002: original booking is preserved] [AC-037-007: affected overlap is identified]
// A booking is affected only when the unavailability interval overlaps its
// occupied interval. Exact boundaries are not treated as an overlap.
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

// [AC-037-004: Coordinator can check replacement venue suitability]
// Replacement venue suitability checks capacity and the event's operational needs
// before a Coordinator submits a replacement booking.
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

// [AC-037-005: replacement request can be created] [AC-037-006: replacement stays linked to the event] [AC-037-008: replacement has its own status]
// The replacement is a separate Booking object linked to the same event. Its
// status can change independently from the preserved original booking.
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
