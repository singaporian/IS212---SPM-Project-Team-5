const PUBLIC_REGISTRATION_ROLES = ['attendee', 'event_organiser'];
const INTERNAL_ROLES = ['event_coordinator', 'venue_staff', 'technical_support_staff'];

class User {
  constructor({ id, name, email, role, passwordHash = null }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.role = role;
    this.passwordHash = passwordHash;
  }

  static fromRow(row) {
    return new User({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      passwordHash: row.password_hash
    });
  }

  canAccessVenueData() {
    return this.role === 'event_coordinator' || this.role === 'venue_staff';
  }

  canCreateEventRequest() {
    return this.role === 'event_organiser';
  }

  canSelfRegister() {
    return PUBLIC_REGISTRATION_ROLES.includes(this.role);
  }

  isInternalStaff() {
    return INTERNAL_ROLES.includes(this.role);
  }

  toPublicJSON() {
    return { id: this.id, name: this.name, email: this.email, role: this.role };
  }
}

class EventRequest {
  constructor({ id, title, status = 'draft', organiserId = null, assignedCoordinatorId = null, ...details }) {
    this.id = id;
    this.title = title;
    this.status = status;
    this.organiserId = organiserId;
    this.assignedCoordinatorId = assignedCoordinatorId;
    Object.assign(this, details);
  }

  static fromRow(row) {
    return new EventRequest({
      ...row,
      organiserId: row.organiser_id,
      assignedCoordinatorId: row.assigned_coordinator_id
    });
  }

  canBeAssigned() {
    return this.status === 'submitted' && !this.assignedCoordinatorId;
  }

  canRequestChanges() {
    return this.status !== 'draft'; // AC-008-001: only a submitted event can receive a change request
  }

  assignTo(coordinatorId) {
    if (!this.canBeAssigned()) throw new Error('This request has already been assigned');
    this.assignedCoordinatorId = coordinatorId;
  }

  unassignFrom(coordinatorId) {
    if (this.assignedCoordinatorId !== coordinatorId) {
      throw new Error('Request not found or not assigned to you');
    }
    this.assignedCoordinatorId = null;
  }

  isAssignedTo(coordinatorId) {
    return this.assignedCoordinatorId === coordinatorId;
  }

  canBeViewedBy(coordinatorId) {
    return this.isAssignedTo(coordinatorId);
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      status: this.status,
      organiser_id: this.organiserId,
      assigned_coordinator_id: this.assignedCoordinatorId,
      ...Object.fromEntries(Object.entries(this).filter(([key]) => !['id', 'title', 'status', 'organiserId', 'assignedCoordinatorId'].includes(key)))
    };
  }
}

class Venue {
  constructor({ id, name, location, capacity = 0, facilities = [], accessibility = {}, supportedLayouts = [], unavailablePeriods = [], images = [] }) {
    this.id = id;
    this.name = name;
    this.location = location;
    this.capacity = Number(capacity);
    this.facilities = Array.isArray(facilities) ? facilities : [];
    this.accessibility = accessibility || {};
    this.supportedLayouts = Array.isArray(supportedLayouts) ? supportedLayouts : [];
    this.unavailablePeriods = unavailablePeriods;
    this.images = images;
  }

  supportsFacility(facility) {
    return this.facilities.includes(facility);
  }

  supportsLayout(layout) {
    return this.supportedLayouts.includes(layout);
  }

  hasAccessibilityNeed(need) {
    return Array.isArray(this.accessibility) ? this.accessibility.includes(need) : Boolean(this.accessibility[need]);
  }

  isSuitableFor({ expectedAttendance = 0, requiredFacilities = [], requiredLayouts = [], accessibilityNeeds = [] }) {
    return this.capacity >= Number(expectedAttendance)
      && requiredFacilities.every((facility) => this.supportsFacility(facility))
      && requiredLayouts.every((layout) => this.supportsLayout(layout))
      && accessibilityNeeds.every((need) => this.hasAccessibilityNeed(need));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      location: this.location,
      capacity: this.capacity,
      facilities: this.facilities,
      accessibility: this.accessibility,
      supported_layouts: this.supportedLayouts,
      unavailable_periods: this.unavailablePeriods,
      images: this.images
    };
  }
}

class Booking {
  constructor({ id, eventId, venueId, startTime, endTime, status = 'pending', setupMinutes = 30, turnaroundMinutes = 30 }) {
    this.id = id;
    this.eventId = eventId;
    this.venueId = venueId;
    this.startTime = new Date(startTime);
    this.endTime = new Date(endTime);
    this.status = status;
    this.setupMinutes = Number(setupMinutes);
    this.turnaroundMinutes = Number(turnaroundMinutes);
  }

  overlaps(otherBooking, includeBuffer = true) {
    const ownStart = includeBuffer ? this.startTime.getTime() - this.setupMinutes * 60000 : this.startTime.getTime();
    const ownEnd = includeBuffer ? this.endTime.getTime() + this.turnaroundMinutes * 60000 : this.endTime.getTime();
    const otherStart = includeBuffer ? otherBooking.startTime.getTime() - otherBooking.setupMinutes * 60000 : otherBooking.startTime.getTime();
    const otherEnd = includeBuffer ? otherBooking.endTime.getTime() + otherBooking.turnaroundMinutes * 60000 : otherBooking.endTime.getTime();
    return this.venueId === otherBooking.venueId && ownStart < otherEnd && ownEnd > otherStart;
  }

  isConfirmed() {
    return this.status === 'confirmed';
  }
}

class ChangeRequest {
  constructor({ id, eventId, organiserId, proposedChanges = {}, status = 'pending', createdAt = null }) {
    this.id = id;
    this.eventId = eventId;
    this.organiserId = organiserId;
    this.proposedChanges = proposedChanges;
    this.status = status;
    this.createdAt = createdAt;
  }

  static fromRow(row) {
    return new ChangeRequest({
      id: row.id,
      eventId: row.event_id,
      organiserId: row.organiser_id,
      proposedChanges: row.proposed_changes,
      status: row.status,
      createdAt: row.created_at
    });
  }

  isPending() {
    return this.status === 'pending';
  }

  toJSON() {
    return {
      id: this.id,
      event_id: this.eventId,
      proposed_changes: this.proposedChanges,
      status: this.status,
      created_at: this.createdAt
    };
  }
}
module.exports = { User, EventRequest, Venue, Booking, ChangeRequest }; //changed for Us-008
