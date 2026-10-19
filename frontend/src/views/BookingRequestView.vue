<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card">
      <div class="card-body">
        <p class="eyebrow mb-1">Venue workspace</p>
        <h1 class="h3">Submit venue booking request</h1>
        <p class="text-muted">Choose an assigned event and venue. Conflicts are flagged for Venue Staff review.</p>

        <div v-if="success" class="alert alert-success">
          Booking request for <strong>{{ submittedEventTitle }}</strong> submitted. Venue Staff can now review this venue arrangement.
          <div class="mt-3 d-flex gap-2">
            <button class="btn btn-sm btn-accent" type="button" @click="addAnotherVenue">Add another venue for this event</button>
            <router-link to="/bookings" class="btn btn-sm btn-outline-secondary">View all venue bookings</router-link>
          </div>
        </div>
        <form v-else class="booking-form" @submit.prevent="reviewRequest">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label" for="booking-event">Event</label>
              <select id="booking-event" v-model="form.eventId" class="form-select" required>
                <option value="">Select an assigned submitted event</option>
                <option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }}</option>
              </select>
            </div>
            <div v-if="selectedEvent" class="col-12"><div class="event-details"><h2 class="h6 mb-2">Event details</h2><dl class="row small mb-0"><dt class="col-sm-4">Event type</dt><dd class="col-sm-8">{{ selectedEvent.event_type || 'Not specified' }}</dd><dt class="col-sm-4">Schedule</dt><dd class="col-sm-8">{{ formatDate(selectedEvent.preferred_start) }} to {{ formatDate(selectedEvent.preferred_end) }}</dd><dt class="col-sm-4">Expected attendance</dt><dd class="col-sm-8">{{ selectedEvent.expected_attendance ?? 'Not specified' }}</dd><dt class="col-sm-4">Purpose</dt><dd class="col-sm-8">{{ selectedEvent.purpose || 'Not specified' }}</dd><dt class="col-sm-4">Layout</dt><dd class="col-sm-8">{{ selectedEvent.venue_layout_preference || 'Not specified' }}</dd><dt class="col-sm-4">Accessibility</dt><dd class="col-sm-8">{{ formatRequirement(selectedEvent.accessibility_requirements) }}</dd><dt class="col-sm-4">Equipment</dt><dd class="col-sm-8">{{ formatRequirement(selectedEvent.equipment_requirements) }}</dd></dl></div></div>
            <div class="col-md-6">
              <label class="form-label" for="booking-venue">Venue</label>
              <select id="booking-venue" v-model="form.venueId" class="form-select" required>
                <option value="">Select a venue</option>
                <option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }} ({{ venue.capacity }} seats)</option>
              </select>
            </div>
            <div class="col-md-3"><label class="form-label">Start date<input v-model="form.startDate" class="form-control" type="date" required /></label></div>
            <div class="col-md-3"><label class="form-label">End date<input v-model="form.endDate" class="form-control" type="date" required /></label></div>
            <div class="col-md-3"><label class="form-label">Start time<input v-model="form.startTime" class="form-control" type="time" required /></label></div>
            <div class="col-md-3"><label class="form-label">End time<input v-model="form.endTime" class="form-control" :class="{ 'is-invalid': timeValidationError }" type="time" required /><div v-if="timeValidationError" class="invalid-feedback">{{ timeValidationError }}</div></label></div>
            <div class="col-12"><label class="form-label">Venue requirements<textarea v-model="form.requirements" class="form-control" rows="3" placeholder="Layout, accessibility, facilities, or other requirements"></textarea></label></div>
          </div>
          <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
          <button class="btn btn-accent mt-2" type="submit">Review request</button>
        </form>

        <div v-if="showSummary && !success" class="booking-summary mt-4">
          <h2 class="h5">Review before submitting</h2>
          <dl class="row small">
            <dt class="col-sm-4">Event</dt><dd class="col-sm-8">{{ selectedEvent?.title || '—' }}</dd>
            <dt class="col-sm-4">Venue</dt><dd class="col-sm-8">{{ selectedVenue?.name || '—' }}</dd>
            <dt class="col-sm-4">Date and time</dt><dd class="col-sm-8">{{ form.startDate }} {{ form.startTime }} to {{ form.endDate }} {{ form.endTime }}</dd>
            <dt class="col-sm-4">Requirements</dt><dd class="col-sm-8">{{ form.requirements || 'None specified' }}</dd>
          </dl>

          <div v-if="conflicts.length" class="alert alert-warning">
            <strong>Potential booking conflict detected.</strong>
            <p class="small mb-2">You must acknowledge this warning before submitting. Venue Staff will see the conflict flag.</p>
            <ul class="small mb-2"><li v-for="conflict in conflicts" :key="conflict.booking_id">{{ conflict.event_title }} at {{ conflict.venue_name }}: {{ formatDate(conflict.start_time) }} to {{ formatDate(conflict.end_time) }} ({{ conflictStatusLabel(conflict.status) }})</li></ul>
          </div>
          <div v-if="error" class="alert alert-danger">{{ error }}</div>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary" type="button" @click="showSummary = false">Go back to edit</button>
            <button class="btn btn-accent" type="button" :disabled="submitting" @click="submitRequest">{{ conflicts.length ? 'Acknowledge conflict and submit' : 'Confirm and submit' }}</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'BookingRequestView',
  data() {
    return {
      events: [],
      venues: [],
      showSummary: false,
      conflicts: [],
      error: '',
      timeValidationError: '',
      submitting: false,
      success: false,
      submittedEventTitle: '',
      form: { eventId: '', venueId: '', startDate: '', endDate: '', startTime: '', endTime: '', setupMinutes: 30, turnaroundMinutes: 30, requirements: '' }
    }
  },
  computed: {
    selectedEvent() { return this.events.find((event) => event.id === this.form.eventId) },
    selectedVenue() { return this.venues.find((venue) => venue.id === this.form.venueId) }
  },
  methods: {
    reviewRequest() {
      this.error = ''
      this.timeValidationError = ''
      if (!this.form.startDate || !this.form.endDate || !this.form.startTime || !this.form.endTime) {
        this.showSummary = true
        return
      }
      const start = new Date(`${this.form.startDate}T${this.form.startTime}`)
      const end = new Date(`${this.form.endDate}T${this.form.endTime}`)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        this.timeValidationError = 'End time must be later than the start time.'
        return
      }
      this.showSummary = true
    },
    formatDate(value) { return value ? new Date(value).toLocaleString() : '—' },
    formatRequirement(value) { if (!value || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return 'Not specified'; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : `${item.type || 'Item'}${item.quantity ? ` x${item.quantity}` : ''}`).join(', '); return value.notes || value.description || JSON.stringify(value) },
    conflictStatusLabel(status) {
      if (status === 'pending') return 'Pending booking confirmation'
      if (status === 'approved') return 'Approved booking'
      if (status === 'confirmed') return 'Confirmed booking'
      return status ? status.replaceAll('_', ' ') : 'Existing booking'
    },
    async loadOptions() {
      const headers = authHeaders()
      const [eventsResponse, venuesResponse] = await Promise.all([
        fetch('/api/events/assigned', { headers }),
        fetch('/api/venues', { headers })
      ])
      if (eventsResponse.status === 401 || venuesResponse.status === 401) {
        clearSession(); this.$router.push('/login'); return
      }
      this.events = eventsResponse.ok ? await eventsResponse.json() : []
      this.venues = venuesResponse.ok ? await venuesResponse.json() : []
    },
    async submitRequest() {
      this.submitting = true
      this.error = ''
      const startTime = `${this.form.startDate}T${this.form.startTime}:00+08:00`
      const endTime = `${this.form.endDate}T${this.form.endTime}:00+08:00`
      const response = await fetch('/api/bookings/requests', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: this.form.eventId,
          venueId: this.form.venueId,
          startTime,
          endTime,
          setupMinutes: this.form.setupMinutes,
          turnaroundMinutes: this.form.turnaroundMinutes,
          venueRequirements: { description: this.form.requirements },
          acknowledgeConflict: this.conflicts.length > 0
        })
      })
      const data = await response.json()
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (response.status === 409) { this.conflicts = data.conflicts || []; this.error = data.error; this.showSummary = true; this.submitting = false; return }
      if (!response.ok) { this.error = data.error || 'Unable to submit booking request. Please retry.'; this.submitting = false; return }
      this.submittedEventTitle = this.selectedEvent?.title || 'this event'
      this.success = true
      this.submitting = false
    },
    addAnotherVenue() {
      this.success = false
      this.showSummary = false
      this.conflicts = []
      this.error = ''
      this.timeValidationError = ''
      this.form = {
        eventId: this.form.eventId,
        venueId: '',
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        setupMinutes: 30,
        turnaroundMinutes: 30,
        requirements: ''
      }
    }
  },
  mounted() { this.loadOptions() }
}
</script>

<style scoped>
.booking-form { max-width: 980px }
.booking-form > .row { background: #f8fafc; border: 1px solid #e5eaf1; border-radius: .75rem; padding: 1.15rem; }
.booking-form .form-label { color: #334155; font-size: .9rem; font-weight: 600 }
.booking-form .form-control, .booking-form .form-select { min-height: 2.65rem; border-color: #cbd5e1; }
.booking-form textarea.form-control { min-height: 5.5rem; }
.event-details { border-left: 4px solid #2f6fed; padding: .75rem 1rem; background: #f4f7fb }
.booking-summary { max-width: 980px; border-top: 1px solid #e5eaf1; padding-top: 1.25rem }
</style>
