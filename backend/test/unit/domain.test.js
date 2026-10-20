const test = require('node:test');
const assert = require('node:assert/strict');
const { User, EventRequest, Venue, Booking } = require('../../src/domain');

test('User exposes role-based domain decisions', () => {
  assert.equal(new User({ role: 'event_organiser' }).canCreateEventRequest(), true);
  assert.equal(new User({ role: 'attendee' }).canCreateEventRequest(), false);
  assert.equal(new User({ role: 'event_coordinator' }).canAccessVenueData(), true);
});

test('EventRequest lets the Lead assign and reassign active requests only (US-034)', () => {
  const request = new EventRequest({ title: 'Demo', status: 'submitted' });
  assert.equal(request.assignCoordinator('coordinator-1'), null, 'no previous coordinator');
  assert.equal(request.assignCoordinator('coordinator-2'), 'coordinator-1', 'reassignment returns the previous coordinator');
  assert.equal(request.assignedCoordinatorId, 'coordinator-2');
  assert.throws(() => request.assignCoordinator('coordinator-2'), /already assigned/);
  assert.throws(() => request.assignCoordinator(''), /Choose an Event Coordinator/);
  for (const status of ['approved', 'clarification_requested', 'planning', 'confirmed']) {
    assert.equal(new EventRequest({ title: 'Active', status }).assignCoordinator('coordinator-1'), null, status);
  }
  for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
    assert.throws(() => new EventRequest({ title: 'Closed', status }).assignCoordinator('coordinator-1'), /cannot be changed/, status);
  }
});

test('EventRequest counts only requests a Coordinator still works on as active (US-034)', () => {
  for (const status of ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed']) {
    assert.equal(new EventRequest({ title: 'Active', status }).isActive(), true, status);
  }
  for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
    assert.equal(new EventRequest({ title: 'Closed', status }).isActive(), false, status);
  }
  const fresh = new EventRequest({ title: 'New' });
  assert.deepEqual([fresh.status, fresh.organiserId, fresh.assignedCoordinatorId, fresh.isActive()], ['draft', null, null, false]);
});

test('EventRequest records only the currently assigned Coordinator (US-034)', () => {
  const request = new EventRequest({ title: 'Demo', status: 'submitted' });
  assert.equal(request.assignedCoordinatorId, null, 'nobody before assignment');
  request.assignCoordinator('coordinator-1');
  assert.equal(request.assignedCoordinatorId, 'coordinator-1');
  request.assignCoordinator('coordinator-2');
  assert.equal(request.assignedCoordinatorId, 'coordinator-2', 'the previous Coordinator no longer holds it after reassignment');
});

test('EventRequest reads and writes the stored current Coordinator (US-034)', () => {
  const row = { id: 'event-1', title: 'Demo', status: 'approved', organiser_id: 'organiser-1', assigned_coordinator_id: 'coordinator-1', expected_attendance: 50 };
  const request = EventRequest.fromRow(row);
  assert.equal(request.organiserId, 'organiser-1');
  assert.equal(request.assignedCoordinatorId, 'coordinator-1');
  assert.equal(request.expected_attendance, 50, 'other columns are kept');
  assert.deepEqual(request.toJSON(), row, 'round-trips to the stored column names');
  request.assignCoordinator('coordinator-2');
  assert.deepEqual(request.toJSON(), { ...row, assigned_coordinator_id: 'coordinator-2' });
  assert.ok(!('assignedCoordinatorId' in request.toJSON()) && !('organiserId' in request.toJSON()), 'no duplicate camelCase fields');
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
