// Unit tests for the domain classes in backend/src/domain/index.js.
// Team rule: tests of a domain class method live here, once. [UT-OOP-xx] ids are
// referenced from the story test plans, with the ACs each test covers in its name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { User, EventRequest, Venue, Booking, ChangeRequest } = require('../../src/domain');

test('[UT-OOP-01] User maps rows, exposes role decisions, and omits password data publicly', () => {
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

test('[UT-OOP-02] EventRequest canEdit and canRequestChanges follow the status lifecycle (AC-008-001, AC-031-001)', () => {
  for (const status of ['approved', 'planning', 'confirmed']) assert.equal(new EventRequest({ title: 'Event', status }).canRequestChanges(), true, status);
  for (const status of ['draft', 'submitted', 'clarification_requested', 'rejected', 'completed', 'cancelled']) {
    assert.equal(new EventRequest({ title: 'Event', status }).canRequestChanges(), false, status);
  }
  for (const status of ['submitted', 'clarification_requested']) assert.equal(new EventRequest({ title: 'Event', status }).canEdit(), true, status);
  for (const status of ['draft', 'approved', 'planning', 'confirmed', 'rejected', 'completed', 'cancelled']) assert.equal(new EventRequest({ title: 'Event', status }).canEdit(), false, status);
});

test('[UT-OOP-03] EventRequest assigns, reassigns, and unassigns active requests safely', () => {
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

test('[UT-OOP-04] EventRequest tracks active statuses, major changes, and stored column names', () => {
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

test('[UT-OOP-05] Venue evaluates capacity, facilities, layouts, accessibility, and serialisation (AC-036-003, AC-037-005)', () => {
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

test('[UT-OOP-06] Booking reports confirmation and detects buffered conflicts correctly', () => {
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

test('[UT-OOP-07] ChangeRequest maps rows, identifies pending state, maps supported fields, and detects moves', () => {
  const row = { id: 'change-1', event_id: 'event-1', organiser_id: 'organiser-1', proposed_changes: { preferredStart: '2026-10-02T10:00:00Z', venueLayoutPreference: 'Theatre', equipmentRequirements: ['projector'] }, status: 'pending', created_at: '2026-09-01T00:00:00Z' };
  const request = ChangeRequest.fromRow(row);
  assert.equal(request.isPending(), true);
  assert.equal(request.canBeDecided(), true);
  assert.deepEqual(request.toEventColumns(), { preferred_start: '2026-10-02T10:00:00Z', venue_layout_preference: 'Theatre', equipment_requirements: ['projector'] });
  assert.deepEqual(request.toJSON(), { id: 'change-1', event_id: 'event-1', proposed_changes: row.proposed_changes, status: 'pending', created_at: row.created_at });

  const unchanged = new ChangeRequest({ status: 'approved', proposedChanges: { venueLayoutPreference: 'Theatre' } });
  assert.equal(unchanged.isPending(), false);
  assert.equal(unchanged.canBeDecided(), false);
  // Only a start time proposed, same moment in a different text format: not a move. Kept because
  // [UT-OOP-08] always proposes both times, so this is the only check of the one-sided path.
  assert.equal(new ChangeRequest({ proposedChanges: { preferredStart: '2026-10-01T10:00:00.000Z' } }).movesEvent({ preferred_start: '2026-10-01T10:00:00Z', preferred_end: '2026-10-01T12:00:00Z' }), false);
});

// Singapore time helper for the story tests moved in below.
const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// Moved from change.request.review.test.js [UT-04] (US-032). It replaces two movesEvent asserts
// that were in the ChangeRequest test above (dedupe #3).
const START = at('2099-03-01', '09:00');
const END = at('2099-03-01', '12:00');

test('[UT-OOP-08] ChangeRequest.movesEvent is true only when the start or end time is a different moment (AC-032-005)', () => {
  const event = new EventRequest({ status: 'planning', preferred_start: START, preferred_end: END });
  const moves = (proposedChanges) => new ChangeRequest({ proposedChanges }).movesEvent(event);

  assert.equal(moves({ preferredStart: at('2099-03-05', '14:00'), preferredEnd: at('2099-03-05', '17:00') }), true, 'new date');
  assert.equal(moves({ preferredStart: at('2099-03-01', '10:00'), preferredEnd: at('2099-03-01', '13:00') }), true, 'same day, later');
  assert.equal(moves({ venueLayoutPreference: 'Classroom' }), false, 'no times in the request');
  assert.equal(moves({ preferredStart: START, preferredEnd: END }), false, 'same times');

  // PostgreSQL returns Date objects, the request holds strings: same moment must not count as a move.
  const fromDb = new EventRequest({ status: 'planning', preferred_start: new Date(START), preferred_end: new Date(END) });
  assert.equal(new ChangeRequest({ proposedChanges: { preferredStart: START, preferredEnd: END } }).movesEvent(fromDb), false);
});
