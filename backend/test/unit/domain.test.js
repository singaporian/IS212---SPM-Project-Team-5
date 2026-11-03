const test = require('node:test');
const assert = require('node:assert/strict');
const { User, EventRequest, Venue, Booking, ChangeRequest } = require('../../src/domain');

test('User maps rows, exposes role decisions, and omits password data publicly', () => {
  const user = User.fromRow({ id: 'user-1', name: 'Alex', email: 'alex@test.local', role: 'event_organiser', password_hash: 'secret-hash' });
  assert.equal(user.passwordHash, 'secret-hash');
  assert.equal(user.canCreateEventRequest(), true);
  assert.equal(user.canSelfRegister(), true);
  assert.equal(user.canAccessVenueData(), false);
  assert.equal(user.isInternalStaff(), false);
  assert.deepEqual(user.toPublicJSON(), { id: 'user-1', name: 'Alex', email: 'alex@test.local', role: 'event_organiser' });

  for (const role of ['event_coordinator', 'venue_staff']) {
    assert.equal(new User({ role }).canAccessVenueData(), true, role);
  }
  for (const role of ['event_coordinator', 'event_coordinator_lead', 'venue_staff', 'technical_support_staff', 'safety_officer']) {
    assert.equal(new User({ role }).isInternalStaff(), true, role);
    assert.equal(new User({ role }).canSelfRegister(), false, role);
  }
  assert.equal(new User({ role: 'attendee' }).canCreateEventRequest(), false);
  assert.equal(new User({ role: 'attendee' }).canSelfRegister(), true);
});

test('EventRequest enforces lifecycle edit and change-request rules', () => {
  for (const status of ['approved', 'planning', 'confirmed']) assert.equal(new EventRequest({ title: 'Event', status }).canRequestChanges(), true, status);
  for (const status of ['draft', 'submitted', 'clarification_requested', 'rejected', 'completed', 'cancelled']) {
    assert.equal(new EventRequest({ title: 'Event', status }).canRequestChanges(), false, status);
  }
  for (const status of ['submitted', 'clarification_requested']) assert.equal(new EventRequest({ title: 'Event', status }).canEdit(), true, status);
  for (const status of ['draft', 'approved', 'planning', 'confirmed', 'rejected', 'completed', 'cancelled']) assert.equal(new EventRequest({ title: 'Event', status }).canEdit(), false, status);
});

test('EventRequest assigns, reassigns, and unassigns active requests safely', () => {
  const request = new EventRequest({ title: 'Demo', status: 'submitted' });
  assert.equal(request.assignCoordinator('coordinator-1'), null);
  assert.equal(request.assignCoordinator('coordinator-2'), 'coordinator-1');
  assert.equal(request.unassignFrom('coordinator-2'), 'coordinator-2');
  assert.equal(request.assignedCoordinatorId, null);
  assert.throws(() => request.assignCoordinator(''), /Choose an Event Coordinator/);
  assert.throws(() => request.unassignFrom('coordinator-2'), /not assigned/);
  request.assignCoordinator('coordinator-1');
  assert.throws(() => request.assignCoordinator('coordinator-1'), /already assigned/);
  for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
    const closed = new EventRequest({ title: 'Closed', status, assignedCoordinatorId: 'coordinator-1' });
    assert.throws(() => closed.assignCoordinator('coordinator-2'), /cannot be changed/, status);
    assert.throws(() => closed.unassignFrom('coordinator-1'), /cannot be changed/, status);
  }
});

test('EventRequest tracks active statuses, major changes, and stored column names', () => {
  for (const status of ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed']) assert.equal(new EventRequest({ title: 'Active', status }).isActive(), true, status);
  for (const status of ['draft', 'rejected', 'completed', 'cancelled']) assert.equal(new EventRequest({ title: 'Closed', status }).isActive(), false, status);

  const request = new EventRequest({ title: 'Demo', status: 'approved', expected_attendance: 50, preferred_start: '2026-10-01T10:00:00Z', preferred_end: '2026-10-01T12:00:00Z' });
  assert.deepEqual(request.majorChangesIn({ expectedAttendance: 80 }), ['expectedAttendance']);
  assert.deepEqual(request.majorChangesIn({ preferredStart: '2026-10-02T10:00:00Z', preferredEnd: '2026-10-02T12:00:00Z' }), []);
  assert.deepEqual(request.majorChangesIn({ preferredStart: '2026-10-02T10:00:00Z', preferredEnd: '2026-10-02T13:00:00Z' }), ['duration']);
  assert.deepEqual(request.majorChangesIn({}), []);

  const row = { id: 'event-1', title: 'Demo', status: 'approved', organiser_id: 'organiser-1', assigned_coordinator_id: 'coordinator-1', expected_attendance: 50 };
  const fromRow = EventRequest.fromRow(row);
  assert.deepEqual(fromRow.toJSON(), row);
  fromRow.assignCoordinator('coordinator-2');
  assert.equal(fromRow.toJSON().assigned_coordinator_id, 'coordinator-2');
  assert.ok(!('assignedCoordinatorId' in fromRow.toJSON()) && !('organiserId' in fromRow.toJSON()));
});

test('Venue evaluates capacity, facilities, layouts, accessibility, and serialisation', () => {
  const operatingHours = [{ day_of_week: 1, opens_at: '08:00:00', closes_at: '22:00:00' }];
  const venue = new Venue({ id: 'venue-1', name: 'Hall', location: 'Campus', capacity: 100, facilities: ['projector'], accessibility: ['ramp'], supportedLayouts: ['theatre'], operating_hours: operatingHours, default_setup_minutes: 45, default_turnaround_minutes: 20 });
  assert.equal(venue.supportsFacility('projector'), true);
  assert.equal(venue.supportsFacility('microphone'), false);
  assert.equal(venue.supportsLayout('theatre'), true);
  assert.equal(venue.hasAccessibilityNeed('ramp'), true);
  assert.equal(venue.hasAccessibilityNeed('lift'), false);
  assert.equal(venue.isSuitableFor({ expectedAttendance: 80, requiredFacilities: ['projector'], requiredLayouts: ['theatre'], accessibilityNeeds: ['ramp'] }), true);
  assert.equal(venue.isSuitableFor({ expectedAttendance: 101 }), false);
  assert.equal(venue.isSuitableFor({ requiredFacilities: ['microphone'] }), false);
  assert.equal(venue.isSuitableFor({ requiredLayouts: ['classroom'] }), false);
  assert.deepEqual(venue.toJSON(), { id: 'venue-1', name: 'Hall', location: 'Campus', capacity: 100, facilities: ['projector'], accessibility: ['ramp'], supported_layouts: ['theatre'], operating_hours: operatingHours, unavailable_periods: [], images: [], default_setup_minutes: 45, default_turnaround_minutes: 20 });
});

test('Booking reports confirmation and detects buffered conflicts correctly', () => {
  const first = new Booking({ venueId: 'venue-1', startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z', setupMinutes: 30, turnaroundMinutes: 45 });
  const second = new Booking({ venueId: 'venue-1', startTime: '2026-10-01T11:15:00Z', endTime: '2026-10-01T12:00:00Z', status: 'confirmed' });
  const touching = new Booking({ venueId: 'venue-1', startTime: '2026-10-01T11:45:00Z', endTime: '2026-10-01T12:30:00Z', setupMinutes: 0, turnaroundMinutes: 0 });
  const otherVenue = new Booking({ venueId: 'venue-2', startTime: '2026-10-01T10:30:00Z', endTime: '2026-10-01T11:30:00Z', status: 'confirmed' });
  assert.equal(first.isConfirmed(), false);
  assert.equal(second.isConfirmed(), true);
  assert.equal(first.overlaps(second), true);
  assert.equal(first.overlaps(second, false), false);
  assert.equal(first.overlaps(touching), false, 'exactly touching occupied intervals do not overlap');
  assert.equal(first.overlaps(otherVenue), false);
});

test('ChangeRequest maps rows, identifies pending state, maps supported fields, and detects moves', () => {
  const row = { id: 'change-1', event_id: 'event-1', organiser_id: 'organiser-1', proposed_changes: { preferredStart: '2026-10-02T10:00:00Z', venueLayoutPreference: 'Theatre', equipmentRequirements: ['projector'] }, status: 'pending', created_at: '2026-09-01T00:00:00Z' };
  const request = ChangeRequest.fromRow(row);
  assert.equal(request.isPending(), true);
  assert.equal(request.canBeDecided(), true);
  assert.deepEqual(request.toEventColumns(), { preferred_start: '2026-10-02T10:00:00Z', venue_layout_preference: 'Theatre', equipment_requirements: ['projector'] });
  assert.equal(request.movesEvent({ preferred_start: '2026-10-01T10:00:00Z', preferred_end: '2026-10-01T12:00:00Z' }), true);
  assert.deepEqual(request.toJSON(), { id: 'change-1', event_id: 'event-1', proposed_changes: row.proposed_changes, status: 'pending', created_at: row.created_at });

  const unchanged = new ChangeRequest({ status: 'approved', proposedChanges: { venueLayoutPreference: 'Theatre' } });
  assert.equal(unchanged.isPending(), false);
  assert.equal(unchanged.canBeDecided(), false);
  assert.equal(unchanged.movesEvent({ preferred_start: '2026-10-01T10:00:00Z', preferred_end: '2026-10-01T12:00:00Z' }), false);
  assert.equal(new ChangeRequest({ proposedChanges: { preferredStart: '2026-10-01T10:00:00.000Z' } }).movesEvent({ preferred_start: '2026-10-01T10:00:00Z', preferred_end: '2026-10-01T12:00:00Z' }), false);
});
