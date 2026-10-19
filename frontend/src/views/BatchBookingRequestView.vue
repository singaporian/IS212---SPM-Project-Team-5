<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Venue workspace</p>
      <h1 class="h3">{{ editingBookingId ? 'Edit replacement venue request' : 'Submit venue bookings' }}</h1>
      <p class="text-muted">Arrange multiple spaces for one event. Each venue is checked and reviewed independently.</p>
      <div v-if="success" class="alert alert-success">{{ success }} <router-link to="/bookings" class="alert-link ms-1">View all bookings</router-link></div>
      <form v-if="!showSummary && !success" class="booking-form" @submit.prevent="review">
        <label class="form-label">Event<select v-model="eventId" class="form-select" required @change="applyEventCapacity"><option value="">Select an assigned active event</option><option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }} ({{ event.status }}, expected attendance: {{ event.expected_attendance ?? 'not specified' }})</option></select></label>
        <div v-if="selectedEvent" class="event-details mt-3 mb-4"><div class="d-flex justify-content-between"><h2 class="h6 mb-2">Event details</h2><span class="badge bg-light text-dark">{{ selectedEvent.status }}</span></div><dl class="row small mb-0"><dt class="col-sm-4">Event type</dt><dd class="col-sm-8">{{ selectedEvent.event_type || 'Not specified' }}</dd><dt class="col-sm-4">Schedule</dt><dd class="col-sm-8">{{ formatDate(selectedEvent.preferred_start) }} to {{ formatDate(selectedEvent.preferred_end) }}</dd><dt class="col-sm-4">Expected attendance</dt><dd class="col-sm-8">{{ selectedEvent.expected_attendance ?? 'Not specified' }}</dd><dt class="col-sm-4">Purpose</dt><dd class="col-sm-8">{{ selectedEvent.purpose || 'Not specified' }}</dd><dt class="col-sm-4">Layout</dt><dd class="col-sm-8">{{ selectedEvent.venue_layout_preference || 'Not specified' }}</dd><dt class="col-sm-4">Accessibility</dt><dd class="col-sm-8">{{ formatRequirement(selectedEvent.accessibility_requirements) }}</dd><dt class="col-sm-4">Equipment</dt><dd class="col-sm-8">{{ formatRequirement(selectedEvent.equipment_requirements) }}</dd></dl></div>
        <div v-for="(row, index) in rows" :key="row.key" class="booking-row mt-4">
          <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Venue booking {{ index + 1 }}</h2><button v-if="rows.length > 1" class="btn btn-sm btn-outline-danger" type="button" @click="removeRow(index)">Remove</button></div>
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label">Venue<select v-model="row.venueId" class="form-select" required><option value="">Select a venue</option><option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }} ({{ venue.capacity }} seats)</option></select></label></div>
            <div class="col-md-3"><label class="form-label">Required capacity<input v-model.number="row.requiredCapacity" class="form-control" type="number" min="1" required></label></div>
            <div class="col-md-3"><label class="form-label">Start date<input v-model="row.startDate" class="form-control" type="date" required></label></div>
            <div class="col-md-3"><label class="form-label">End date<input v-model="row.endDate" class="form-control" type="date" required></label></div>
            <div class="col-md-3"><label class="form-label">Start time<input v-model="row.startTime" class="form-control" type="time" required></label></div>
            <div class="col-md-3"><label class="form-label">End time<input v-model="row.endTime" class="form-control" type="time" required></label></div>
            <div class="col-12"><label class="form-label">Venue requirements<textarea v-model="row.requirements" class="form-control" rows="2" placeholder="Layout, accessibility, facilities"></textarea></label></div>
            <div v-if="row.error" class="col-12"><div class="alert alert-danger py-2 mb-0">{{ row.error }}</div></div>
          </div>
        </div>
        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
        <div class="mt-4 d-flex gap-2"><button class="btn btn-outline-primary" type="button" @click="addRow">Add another venue booking</button><button class="btn btn-accent" type="submit">Review all bookings</button></div>
      </form>

      <div v-if="showSummary && !success" class="mt-4">
        <h2 class="h5">Review all venue bookings</h2>
        <p class="text-muted">{{ selectedEvent?.title }} will receive {{ rows.length }} venue booking request{{ rows.length === 1 ? '' : 's' }}.</p>
        <div v-for="(row, index) in rows" :key="row.key" class="summary-row mb-3"><div class="d-flex justify-content-between"><strong>{{ index + 1 }}. {{ venueName(row.venueId) }}</strong><span>{{ row.startDate }} {{ row.startTime }}–{{ row.endDate }} {{ row.endTime }}</span></div><div class="small text-muted">Required capacity {{ row.requiredCapacity }} · {{ row.requirements || 'No additional requirements' }}</div><div v-if="row.conflicts.length" class="alert alert-warning py-2 mt-2 mb-0"><strong>Conflict for this venue.</strong><ul class="small mb-0"><li v-for="conflict in row.conflicts" :key="conflict.booking_id">{{ conflict.event_title }} at {{ conflict.venue_name }}: {{ formatDate(conflict.start_time) }}–{{ formatDate(conflict.end_time) }} ({{ conflict.status }})</li></ul></div></div>
        <div v-if="error" class="alert alert-danger">{{ error }}</div>
        <div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" @click="showSummary = false">Go back to edit</button><button class="btn btn-accent" type="button" :disabled="submitting" @click="submit">{{ editingBookingId ? 'Save replacement request' : (conflicts.length ? 'Acknowledge conflicts and submit all' : 'Confirm and submit all') }}</button></div>
      </div>
    </div></section>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'
let rowKey = 0
function newRow() { return { key: ++rowKey, venueId: '', requiredCapacity: '', startDate: '', endDate: '', startTime: '', endTime: '', setupMinutes: 30, turnaroundMinutes: 30, requirements: '', conflicts: [], error: '' } }

export default {
  name: 'BatchBookingRequestView',
  data() { return { events: [], venues: [], eventId: '', rows: [newRow()], editingBookingId: '', replacementForBookingId: '', showSummary: false, conflicts: [], error: '', submitting: false, success: '' } },
  computed: { selectedEvent() { return this.events.find((event) => event.id === this.eventId) } },
  methods: {
    addRow() { this.rows.push(newRow()) },
    applyEventCapacity() {
      const attendance = this.selectedEvent?.expected_attendance
      if (attendance) this.rows.forEach((row) => { if (!row.requiredCapacity) row.requiredCapacity = attendance })
    },
    removeRow(index) { this.rows.splice(index, 1) },
    venueName(id) { return this.venues.find((venue) => venue.id === id)?.name || 'Venue not selected' },
    formatDate(value) { return value ? new Date(value).toLocaleString() : '—' },
    formatRequirement(value) { if (!value || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return 'Not specified'; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : `${item.type || 'Item'}${item.quantity ? ` x${item.quantity}` : ''}`).join(', '); return value.notes || value.description || JSON.stringify(value) },
    singaporeParts(value) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value))
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
      return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
    },
    review() {
      this.error = ''; this.conflicts = []
      this.rows.forEach(row => { row.error = ''; row.conflicts = [] })
      for (const row of this.rows) {
        if (!row.startDate || !row.endDate || !row.startTime || !row.endTime) continue
        if (new Date(`${row.endDate}T${row.endTime}`) <= new Date(`${row.startDate}T${row.startTime}`)) { row.error = 'End date and time must be later than the start date and time.'; return }
      }
      this.showSummary = true
    },
    async loadOptions() {
      const headers = authHeaders()
      const [eventsResponse, venuesResponse] = await Promise.all([fetch('/api/events/assigned', { headers }), fetch('/api/venues', { headers })])
      if (eventsResponse.status === 401 || venuesResponse.status === 401) { clearSession(); this.$router.push('/login'); return }
      this.events = eventsResponse.ok ? await eventsResponse.json() : []
      this.venues = venuesResponse.ok ? await venuesResponse.json() : []
    },
    async submit() {
      this.error = ''; this.submitting = true
      const row = this.rows[0]
      const booking = { venueId: row.venueId, requiredCapacity: row.requiredCapacity, startTime: `${row.startDate}T${row.startTime}:00+08:00`, endTime: `${row.endDate}T${row.endTime}:00+08:00`, setupMinutes: row.setupMinutes, turnaroundMinutes: row.turnaroundMinutes, venueRequirements: { description: row.requirements } }
      const response = this.editingBookingId
        ? await fetch(`/api/bookings/${this.editingBookingId}/replacement`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: this.eventId, ...booking }) })
        : await fetch('/api/bookings/requests/batch', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: this.eventId, replacementForBookingId: this.replacementForBookingId || undefined, acknowledgeConflicts: this.conflicts.length > 0, bookings: this.rows.map(currentRow => ({ venueId: currentRow.venueId, requiredCapacity: currentRow.requiredCapacity, startTime: `${currentRow.startDate}T${currentRow.startTime}:00+08:00`, endTime: `${currentRow.endDate}T${currentRow.endTime}:00+08:00`, setupMinutes: currentRow.setupMinutes, turnaroundMinutes: currentRow.turnaroundMinutes, venueRequirements: { description: currentRow.requirements } })) }) })
      const data = await response.json()
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (response.status === 409) { this.conflicts = data.conflicts || []; this.conflicts.forEach(entry => { if (this.rows[entry.index]) this.rows[entry.index].conflicts = entry.conflicts }); this.error = data.error; this.submitting = false; return }
      if (!response.ok) { this.error = data.error || 'Unable to submit venue bookings. Your fields are still available.'; this.submitting = false; return }
      this.success = this.editingBookingId ? `Replacement venue request updated for ${this.selectedEvent?.title || 'the event'}.` : `${data.bookings.length} venue booking requests submitted for ${this.selectedEvent?.title || 'the event'}.`
      this.submitting = false
    }
  },
  async mounted() {
    await this.loadOptions()
    const eventId = this.$route.query.eventId
    if (eventId && this.events.some((event) => event.id === eventId)) {
      this.eventId = eventId
      this.applyEventCapacity()
    }
    this.replacementForBookingId = this.$route.query.replacementForBookingId || ''
    this.editingBookingId = this.$route.query.editBookingId || ''
    if (this.editingBookingId) {
      const response = await fetch('/api/bookings/mine', { headers: authHeaders() })
      const booking = response.ok ? (await response.json()).find(item => item.id === this.editingBookingId) : null
      if (booking) {
        this.eventId = booking.event_id
        const parts = this.singaporeParts(booking.start_time)
        const endParts = this.singaporeParts(booking.end_time)
        this.rows = [{ ...newRow(), venueId: booking.venue_id, requiredCapacity: booking.required_capacity, startDate: parts.date, endDate: endParts.date, startTime: parts.time, endTime: endParts.time, requirements: booking.venue_requirements?.description || '' }]
      }
    }
  }
}
</script>

<style scoped>
.booking-row, .summary-row { border: 1px solid #e9edf3; border-radius: .75rem; padding: 1rem; background: #fbfcff }
.booking-form { max-width: 1080px }
.booking-form > .booking-row { box-shadow: 0 3px 12px rgba(30, 41, 59, .04); }
.booking-form .form-label { color: #334155; font-size: .9rem; font-weight: 600 }
.booking-form .form-control, .booking-form .form-select { min-height: 2.65rem; border-color: #cbd5e1; }
.booking-form textarea.form-control { min-height: 5rem; }
.event-details { border-left: 4px solid #2f6fed; padding: .75rem 1rem; background: #f4f7fb }
</style>
