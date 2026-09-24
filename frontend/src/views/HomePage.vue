<template>
  <div>
    <section class="hero d-flex align-items-center">
      <div class="me-4" style="flex:1">
          <h1 class="display-5">{{ greeting }}</h1>
          <p class="lead">{{ roleDescription }}</p>
        <div class="d-flex gap-2 mt-3">
            <router-link v-if="canCreateRequest" class="btn btn-accent btn-lg" to="/requests/new">Create Request</router-link>
            <button class="btn btn-outline-secondary btn-lg">{{ secondaryAction }}</button>
        </div>
      </div>
      <div style="width:280px">
        <div class="stat-card text-center">
            <div class="h2 mb-0">{{ venueCount }}</div>
          <div class="small text-muted">Known venues</div>
        </div>
      </div>
    </section>

    <div class="row gx-4">
      <div class="col-lg-8">
        <div class="card mb-4">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <h5 class="card-title">{{ workspaceTitle }}</h5>
                <p class="text-muted small mb-2">{{ workspaceDescription }}</p>
              </div>
              <div>
                <button class="btn btn-sm btn-outline-primary me-2" @click="loadVenues"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
                  <router-link v-if="canSearchVenues" class="btn btn-sm btn-accent" to="/venues"><i class="bi bi-search"></i> Find Venues</router-link>
              </div>
            </div>

            <div class="mt-3">
              <ul class="list-unstyled">
                  <li v-if="!venues.length && canSearchVenues" class="text-muted">Use Find Venues to search the venue directory.</li>
                  <li v-if="canManageEquipment"><router-link class="btn btn-accent" to="/equipment/new"><i class="bi bi-plus-lg"></i> Add Equipment</router-link></li>
                  <li v-else-if="!canSearchVenues" class="text-muted">Your role workspace is ready. More tools will appear as features are added.</li>
                <li v-for="v in venues" :key="v.id" class="list-group-item d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold">{{ v.name }}</div>
                    <div class="small text-muted">{{ v.location || '—' }}</div>
                  </div>
                  <div class="text-end">
                    <div class="badge bg-light text-dark">Capacity: {{ v.capacity }}</div>
                    <div class="small d-block text-muted">{{ (v.facilities && v.facilities.length) ? v.facilities.join(', ') : 'No facilities listed' }}</div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card quick-actions mb-3">
          <div class="card-body">
              <h6>Quick Actions</h6>
              <router-link v-if="canCreateRequest" class="btn btn-outline-primary btn-sm w-100 mb-2" to="/requests/new">Start Draft</router-link>
              <router-link v-if="canManageEquipment" class="btn btn-outline-primary btn-sm w-100 mb-2" to="/equipment/new">Add Equipment</router-link>
              <router-link v-if="role === 'event_coordinator'" class="btn btn-outline-primary btn-sm w-100 mb-2" to="/technical-support/requirements">Technical Support Requirements</router-link>
              <router-link v-if="canManageEquipment" class="btn btn-outline-secondary btn-sm w-100 mb-2" to="/technical-support/queue">Support Requirements Queue</router-link>
              <router-link v-if="role === 'event_coordinator'" class="btn btn-outline-secondary btn-sm w-100 mb-2" to="/coordinator/requests">Assigned Event Requests</router-link>
              <router-link v-else-if="role === 'venue_staff'" class="btn btn-outline-secondary btn-sm w-100 mb-2" to="/bookings/pending">{{ primaryRoleAction }}</router-link>
              <router-link v-else-if="canCreateRequest" class="btn btn-outline-secondary btn-sm w-100 mb-2" to="/requests/drafts">My Drafts</router-link>
              <button v-else class="btn btn-outline-secondary btn-sm w-100 mb-2">{{ primaryRoleAction }}</button>
              <router-link v-if="role === 'event_coordinator'" class="btn btn-outline-success btn-sm w-100" to="/bookings/new">Create Venue Booking Request</router-link>
          </div>
        </div>

        <div v-if="role === 'event_coordinator'" class="card mt-3">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h6 class="mb-0">My Venue Booking Requests</h6>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" @click="loadBookingRequests">Refresh</button>
                <router-link class="btn btn-sm btn-outline-secondary" to="/bookings">View All</router-link>
              </div>
            </div>
            <p v-if="bookingError" class="text-danger small">{{ bookingError }}</p>
            <p v-else-if="!bookingRequests.length" class="text-muted small mb-0">No venue booking requests submitted yet.</p>
            <ul v-else class="list-unstyled mb-0">
              <li v-for="request in bookingRequests" :key="request.id" class="booking-request-item" :class="{ 'booking-request-selected': selectedBookingId === request.id }" tabindex="0" role="button" @click="toggleBookingDetails(request.id)" @keydown.enter="toggleBookingDetails(request.id)">
                <div class="d-flex justify-content-between gap-2">
                  <div>
                    <div class="fw-semibold">{{ request.event_title }}</div>
                    <div class="small text-muted">{{ request.venue_name }}</div>
                    <div class="small text-muted">{{ formatBookingDate(request.start_time) }}</div>
                  </div>
                  <span class="badge" :class="bookingStatusClass(request.status)">{{ bookingStatusLabel(request.status) }}</span>
                </div>
                <div v-if="request.conflict_warning" class="small text-warning mt-2"><i class="bi bi-exclamation-triangle"></i> Conflict flagged for Venue Staff</div>
                <div v-if="selectedBookingId === request.id" class="booking-request-details mt-3" @click.stop>
                  <div><strong>Status:</strong> {{ bookingStatusLabel(request.status) }}</div>
                  <div><strong>Schedule:</strong> {{ formatBookingDate(request.start_time) }} to {{ formatBookingDate(request.end_time) }}</div>
                  <div><strong>Setup:</strong> {{ request.setup_minutes }} minutes</div>
                  <div><strong>Turnaround:</strong> {{ request.turnaround_minutes }} minutes</div>
                  <div><strong>Requirements:</strong> {{ request.venue_requirements?.description || 'None specified' }}</div>
                  <div v-if="request.decision_reason"><strong>Decision reason:</strong> {{ request.decision_reason }}</div>
                  <div v-if="request.decision_comment"><strong>Comment:</strong> {{ request.decision_comment }}</div>
                  <div v-if="request.alternative_start_time"><strong>Suggested alternative:</strong> {{ formatBookingDate(request.alternative_start_time) }} to {{ formatBookingDate(request.alternative_end_time) }}</div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="role === 'event_coordinator'" class="card mt-3">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h6 class="mb-0">Submitted Technical Support Requirements</h6>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" @click="loadSupportRequirements">Refresh</button>
                <router-link class="btn btn-sm btn-outline-secondary" to="/technical-support/requests">View All</router-link>
              </div>
            </div>
            <p v-if="supportError" class="text-danger small">{{ supportError }}</p>
            <p v-else-if="!supportRequirements.length" class="text-muted small mb-0">No technical support requirements submitted yet.</p>
            <ul v-else class="list-unstyled mb-0">
              <li v-for="item in supportRequirements" :key="item.id" class="support-summary-item" :class="{ 'support-summary-selected': selectedSupportId === item.id }" tabindex="0" role="button" @click="toggleSupportDetails(item.id)" @keydown.enter="toggleSupportDetails(item.id)">
                <div class="d-flex justify-content-between gap-2">
                  <div><strong>{{ item.event_title }}</strong><div class="small text-muted">{{ item.staff_required }} staff · {{ item.equipment_requirements.length }} equipment type{{ item.equipment_requirements.length === 1 ? '' : 's' }}</div></div>
                  <div class="d-flex gap-1"><span v-if="item.updated" class="badge bg-info text-dark">Updated</span><span v-if="item.late_request" class="badge bg-warning text-dark">Late</span></div>
                </div>
                <div class="small text-muted mt-1">{{ supportEquipmentSummary(item.equipment_requirements) }}</div>
                <div v-if="selectedSupportId === item.id" class="support-summary-details mt-2" @click.stop><strong>Last updated:</strong> {{ formatBookingDate(item.updated_at) }}<br><strong>Event time:</strong> {{ formatBookingDate(item.preferred_start) }} to {{ formatBookingDate(item.preferred_end) }}</div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'
import { getUser } from '../services/auth'

export default {
  name: 'HomePage',
  data() {
    return {
      venues: [],
      venueCount: 0,
      bookingRequests: [],
      selectedBookingId: null,
      supportRequirements: [],
      selectedSupportId: null,
      supportError: '',
      bookingError: '',
      backendOk: false
    }
  },
  computed: {
    user() { return getUser() || {} },
    role() { return this.user.role || 'attendee' },
    canSearchVenues() { return ['event_coordinator', 'venue_staff'].includes(this.role) },
    canCreateRequest() { return ['event_organiser'].includes(this.role) },
    canManageEquipment() { return this.role === 'technical_support_staff' },
    greeting() { return `Welcome, ${this.user.name || 'there'}` },
    roleDescription() {
      const descriptions = {
        attendee: 'Discover confirmed events, manage your registrations, and stay up to date.',
        event_organiser: 'Shape your event from an early idea into a clear request for ConnectSphere.',
        event_coordinator: 'Coordinate event requests, venues, schedules, and stakeholder decisions.',
        venue_staff: 'Keep venue availability, bookings, and preparation on track.',
        technical_support_staff: 'Plan equipment and technical support for every event.'
      }
      return descriptions[this.role] || descriptions.attendee
    },
    secondaryAction() { return this.role === 'attendee' ? 'Browse Events' : 'View Calendar' },
    workspaceTitle() { return this.canSearchVenues ? 'Venue workspace' : 'Your workspace' },
    workspaceDescription() { return this.canSearchVenues ? 'Search and shortlist suitable venues for your event.' : 'Role-specific tools and updates will appear here.' },
    primaryRoleAction() {
      const actions = { attendee: 'My Registrations', event_organiser: 'My Event Requests', event_coordinator: 'Assigned Requests', venue_staff: 'Upcoming Bookings', technical_support_staff: 'Support Schedule' }
      return actions[this.role] || 'My Workspace'
    }
  },
  methods: {
    async loadVenues() {
      try {
        const res = await fetch('/api/venues', { headers: authHeaders() });
        if (res.status === 401) {
          clearSession();
          this.$router.push('/login');
          return;
        }
        if (!res.ok) throw new Error('network');
        this.venues = await res.json();
      } catch (e) {
        console.error(e);
        this.venues = [];
      }
    },
    async loadVenueCount() {
      try {
        const response = await fetch('/api/venues/count', { headers: authHeaders() })
        if (response.status === 401) {
          clearSession()
          this.$router.push('/login')
          return
        }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to count venues')
        this.venueCount = data.count
      } catch (error) {
        console.error(error)
      }
    },
    async loadBookingRequests() {
      this.bookingError = ''
      try {
        const response = await fetch('/api/bookings/mine', { headers: authHeaders() })
        if (response.status === 401) {
          clearSession()
          this.$router.push('/login')
          return
        }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load booking requests')
        this.bookingRequests = data
      } catch (error) {
        this.bookingError = error.message
      }
    },
    async loadSupportRequirements() {
      this.supportError = ''
      try {
        const response = await fetch('/api/technical-support/my-requirements', { headers: authHeaders() })
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load technical support requirements')
        this.supportRequirements = data
      } catch (error) { this.supportError = error.message }
    },
    supportEquipmentSummary(items) {
      if (!items.length) return 'No equipment specified'
      return items.map(item => `${item.type}: ${item.quantity}${item.details ? ` (${item.details})` : ''}`).join(', ')
    },
    toggleSupportDetails(id) {
      this.selectedSupportId = this.selectedSupportId === id ? null : id
    },
    formatBookingDate(value) {
      return value ? new Date(value).toLocaleString() : 'Time not provided'
    },
    toggleBookingDetails(id) {
      this.selectedBookingId = this.selectedBookingId === id ? null : id
    },
    bookingStatusLabel(status) {
      const labels = { pending: 'Pending Review', alternative_suggested: 'Alternative Suggested' }
      return labels[status] || (status ? status.replaceAll('_', ' ') : 'Unknown Status')
    },
    bookingStatusClass(status) {
      return {
        'bg-warning text-dark': status === 'pending',
        'bg-success': status === 'approved' || status === 'confirmed',
        'bg-danger': status === 'rejected',
        'bg-info text-dark': status === 'alternative_suggested'
      }
    }
  },
  async mounted() {
    try {
      const r = await fetch('/api/health');
      this.backendOk = r.ok;
    } catch (e) {
      this.backendOk = false;
    }
    if (this.role === 'event_coordinator') this.loadBookingRequests()
    if (this.role === 'event_coordinator') this.loadSupportRequirements()
    this.loadVenueCount()
  }
}
</script>

<style scoped>
.card { border-radius: .75rem }
.booking-request-item { border-bottom: 1px solid #eef0f4; padding: .75rem 0 }
.booking-request-item:last-child { border-bottom: 0; padding-bottom: 0 }
.booking-request-item { cursor: pointer; border-radius: .5rem; padding-left: .5rem; padding-right: .5rem }
.booking-request-item:hover, .booking-request-item:focus { background: #f8f9ff; outline: none }
.booking-request-selected { background: #f8f9ff }
.booking-request-details { border-top: 1px solid #e8ebf2; padding-top: .65rem; color: #52606d; font-size: .82rem; line-height: 1.7 }
.support-summary-item { border-bottom: 1px solid #eef0f4; padding: .75rem .5rem; cursor: pointer; border-radius: .5rem }
.support-summary-item:hover, .support-summary-item:focus, .support-summary-selected { background: #f8f9ff; outline: none }
.support-summary-details { border-top: 1px solid #e8ebf2; padding-top: .5rem; color: #52606d; font-size: .82rem; line-height: 1.6 }
</style>