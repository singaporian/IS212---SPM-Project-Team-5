const test = require('node:test');
const assert = require('node:assert/strict');
const { User, EventRequest, Venue, Booking } = require('../src/domain');

test('User exposes role-based domain decisions', () => {
  assert.equal(new User({ role: 'event_organiser' }).canCreateEventRequest(), true);
  assert.equal(new User({ role: 'attendee' }).canCreateEventRequest(), false);
  assert.equal(new User({ role: 'event_coordinator' }).canAccessVenueData(), true);
});

test('EventRequest enforces assignment and ownership decisions', () => {
  const request = new EventRequest({ title: 'Demo', status: 'submitted' });
  assert.equal(request.canBeAssigned(), true);
  request.assignTo('coordinator-1');
  assert.equal(request.canBeViewedBy('coordinator-1'), true);
  assert.equal(request.canBeViewedBy('coordinator-2'), false);
  assert.throws(() => request.assignTo('coordinator-2'), /already been assigned/);
});

test('EventRequest lets the Lead assign and reassign active requests only (US-034)', () => {
  const request = new EventRequest({ title: 'Demo', status: 'submitted' });
  assert.equal(request.assignCoordinator('coordinator-1'), null, 'no previous coordinator');
  assert.equal(request.assignCoordinator('coordinator-2'), 'coordinator-1', 'reassignment returns the previous coordinator');
  assert.equal(request.isAssignedTo('coordinator-2'), true);
  assert.throws(() => request.assignCoordinator('coordinator-2'), /already assigned/);
  assert.throws(() => request.assignCoordinator(''), /Choose an Event Coordinator/);
  for (const status of ['approved', 'clarification_requested', 'planning', 'confirmed']) {
    assert.equal(new EventRequest({ title: 'Active', status }).assignCoordinator('coordinator-1'), null, status);
  }
  for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
    assert.throws(() => new EventRequest({ title: 'Closed', status }).assignCoordinator('coordinator-1'), /cannot be changed/, status);
  }
});

test('Venue evaluates event suitability', () => {
  const venue = new Venue({ capacity: 100, facilities: ['projector'], supportedLayouts: ['theatre'] });
  assert.equal(venue.isSuitableFor({ expectedAttendance: 80, requiredFacilities: ['projector'], requiredLayouts: ['theatre'] }), true);
  assert.equal(venue.isSuitableFor({ expectedAttendance: 120 }), false);
});

test('Booking detects venue conflicts including setup and turnaround buffers', () => {
  const first = new Booking({ venueId: 'venue-1', startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z' });
  const second = new Booking({ venueId: 'venue-1', startTime: '2026-10-01T11:15:00Z', endTime: '2026-10-01T12:00:00Z' });
  const otherVenue = new Booking({ venueId: 'venue-2', startTime: '2026-10-01T10:30:00Z', endTime: '2026-10-01T11:30:00Z' });
  assert.equal(first.overlaps(second), true);
  assert.equal(first.overlaps(otherVenue), false);
});
