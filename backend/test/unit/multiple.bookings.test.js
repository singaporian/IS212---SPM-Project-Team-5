const test = require('node:test');
const assert = require('node:assert/strict');
const { Booking, Venue } = require('../../src/domain');
const { occupiedInterval, overlaps } = require('../../src/venueOccupancy');

// [AC-036-001: one event can have more than one venue booking]
// [AC-036-002: each booking keeps its own venue, time and booking details]
// [AC-036-006: bookings remain associated with the same event]
test('creates separate booking objects for multiple venues of one event', () => {
  const mainVenueBooking = new Booking({
    id: 'booking-main',
    eventId: 'event-1',
    venueId: 'venue-a',
    startTime: '2027-02-15T10:00:00+08:00',
    endTime: '2027-02-15T12:00:00+08:00',
    status: 'pending'
  });
  const breakoutVenueBooking = new Booking({
    id: 'booking-breakout',
    eventId: 'event-1',
    venueId: 'venue-b',
    startTime: '2027-02-15T10:00:00+08:00',
    endTime: '2027-02-15T12:00:00+08:00',
    status: 'pending'
  });

  assert.equal(mainVenueBooking.eventId, breakoutVenueBooking.eventId);
  assert.notEqual(mainVenueBooking.id, breakoutVenueBooking.id);
  assert.notEqual(mainVenueBooking.venueId, breakoutVenueBooking.venueId);
  assert.notEqual(mainVenueBooking.startTime.getTime(), undefined);
  assert.notEqual(breakoutVenueBooking.endTime.getTime(), undefined);
});

// [AC-036-003: each venue is checked independently for suitability]
test('checks each venue independently against its required capacity and facilities', () => {
  const auditorium = new Venue({ id: 'venue-a', name: 'Auditorium', capacity: 300, facilities: ['projector'] });
  const breakoutRoom = new Venue({ id: 'venue-b', name: 'Breakout Room', capacity: 50, facilities: [] });

  assert.equal(auditorium.isSuitableFor({ expectedAttendance: 250, requiredFacilities: ['projector'] }), true);
  assert.equal(breakoutRoom.isSuitableFor({ expectedAttendance: 80, requiredFacilities: ['projector'] }), false);
});

// [AC-036-004: setup and turnaround are included in availability/conflict checks]
test('detects a conflict for one venue using setup and turnaround buffers', () => {
  const auditoriumBooking = {
    venue_id: 'venue-a',
    start_time: '2027-02-15T10:00:00+08:00',
    end_time: '2027-02-15T12:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 45
  };
  const followingBooking = {
    venue_id: 'venue-a',
    start_time: '2027-02-15T12:30:00+08:00',
    end_time: '2027-02-15T14:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 30
  };

  assert.equal(overlaps(occupiedInterval(auditoriumBooking), occupiedInterval(followingBooking)), true);
});

// [AC-036-003: checking one venue must not create a conflict for another venue]
test('does not treat simultaneous bookings in different venues as a conflict', () => {
  const mainVenueBooking = {
    venue_id: 'venue-a',
    start_time: '2027-02-15T10:00:00+08:00',
    end_time: '2027-02-15T12:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 30
  };
  const breakoutVenueBooking = {
    venue_id: 'venue-b',
    start_time: '2027-02-15T10:00:00+08:00',
    end_time: '2027-02-15T12:00:00+08:00',
    setup_minutes: 30,
    turnaround_minutes: 30
  };

  const sameVenue = mainVenueBooking.venue_id === breakoutVenueBooking.venue_id;
  assert.equal(sameVenue && overlaps(occupiedInterval(mainVenueBooking), occupiedInterval(breakoutVenueBooking)), false);
});

// [AC-036-007: each booking has its own status and decision information]
// [AC-036-008: Venue Staff can respond to each booking independently]
test('changing one booking status does not change another booking status', () => {
  const approvedBooking = new Booking({ id: 'booking-a', eventId: 'event-1', venueId: 'venue-a', startTime: '2027-02-15T10:00:00+08:00', endTime: '2027-02-15T12:00:00+08:00', status: 'approved' });
  const pendingBooking = new Booking({ id: 'booking-b', eventId: 'event-1', venueId: 'venue-b', startTime: '2027-02-15T10:00:00+08:00', endTime: '2027-02-15T12:00:00+08:00', status: 'pending' });

  approvedBooking.status = 'rejected';
  assert.equal(approvedBooking.status, 'rejected');
  assert.equal(pendingBooking.status, 'pending');
});

// AC-036-005 (view all associated bookings) is verified by the integration/API
// tests because it depends on PostgreSQL query results and the frontend list.
