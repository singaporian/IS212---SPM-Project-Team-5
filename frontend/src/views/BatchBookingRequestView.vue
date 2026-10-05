<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Venue workspace</p>
      <h1 class="h3">Submit venue bookings</h1>
      <p class="text-muted">Arrange multiple spaces for one event. Each venue is checked and reviewed independently.</p>
      <div v-if="success" class="alert alert-success">{{ success }} <router-link to="/bookings" class="alert-link ms-1">View all bookings</router-link></div>
      <form v-if="!showSummary && !success" @submit.prevent="review">
        <label class="form-label">Event<select v-model="eventId" class="form-select" required @change="applyEventCapacity"><option value="">Select an assigned submitted event</option><option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }} (expected attendance: {{ event.expected_attendance ?? 'not specified' }})</option></select></label>
        <div v-for="(row, index) in rows" :key="row.key" class="booking-row mt-4">
          <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Venue booking {{ index + 1 }}</h2><button v-if="rows.length > 1" class="btn btn-sm btn-outline-danger" type="button" @click="removeRow(index)">Remove</button></div>
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label">Venue<select v-model="row.venueId" class="form-select" required><option value="">Select a venue</option><option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }} ({{ venue.capacity }} seats)</option></select></label></div>
            <div class="col-md-3"><label class="form-label">Required capacity<input v-model.number="row.requiredCapacity" class="form-control" type="number" min="1" required></label></div>
            <div class="col-md-3"><label class="form-label">Date<input v-model="row.date" class="form-control" type="date" required></label></div>
            <div class="col-md-3"><label class="form-label">Start time<input v-model="row.startTime" class="form-control" type="time" required></label></div>
            <div class="col-md-3"><label class="form-label">End time<input v-model="row.endTime" class="form-control" type="time" required></label></div>
            <div class="col-md-3"><label class="form-label">Setup minutes<input v-model.number="row.setupMinutes" class="form-control" type="number" min="0" required></label></div>
            <div class="col-md-3"><label class="form-label">Turnaround minutes<input v-model.number="row.turnaroundMinutes" class="form-control" type="number" min="0" required></label></div>
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
        <div v-for="(row, index) in rows" :key="row.key" class="summary-row mb-3"><div class="d-flex justify-content-between"><strong>{{ index + 1 }}. {{ venueName(row.venueId) }}</strong><span>{{ row.date }} {{ row.startTime }}–{{ row.endTime }}</span></div><div class="small text-muted">Required capacity {{ row.requiredCapacity }} · Setup {{ row.setupMinutes }} min · Turnaround {{ row.turnaroundMinutes }} min · {{ row.requirements || 'No additional requirements' }}</div><div v-if="row.conflicts.length" class="alert alert-warning py-2 mt-2 mb-0"><strong>Conflict for this venue.</strong><ul class="small mb-0"><li v-for="conflict in row.conflicts" :key="conflict.booking_id">{{ conflict.event_title }} at {{ conflict.venue_name }}: {{ formatDate(conflict.start_time) }}–{{ formatDate(conflict.end_time) }} ({{ conflict.status }})</li></ul></div></div>
        <div v-if="error" class="alert alert-danger">{{ error }}</div>
        <div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" @click="showSummary = false">Go back to edit</button><button class="btn btn-accent" type="button" :disabled="submitting" @click="submit">{{ conflicts.length ? 'Acknowledge conflicts and submit all' : 'Confirm and submit all' }}</button></div>
      </div>
    </div></section>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'
let rowKey = 0
function newRow() { return { key: ++rowKey, venueId: '', requiredCapacity: '', date: '', startTime: '', endTime: '', setupMinutes: 30, turnaroundMinutes: 30, requirements: '', conflicts: [], error: '' } }

export default {
  name: 'BatchBookingRequestView',
  data() { return { events: [], venues: [], eventId: '', rows: [newRow()], showSummary: false, conflicts: [], error: '', submitting: false, success: '' } },
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
    review() {
      this.error = ''; this.conflicts = []
      this.rows.forEach(row => { row.error = ''; row.conflicts = [] })
      for (const row of this.rows) {
        if (!row.date || !row.startTime || !row.endTime) continue
        if (new Date(`${row.date}T${row.endTime}`) <= new Date(`${row.date}T${row.startTime}`)) { row.error = 'End time must be later than the start time.'; return }
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
      const response = await fetch('/api/bookings/requests/batch', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: this.eventId, acknowledgeConflicts: this.conflicts.length > 0, bookings: this.rows.map(row => ({ venueId: row.venueId, requiredCapacity: row.requiredCapacity, startTime: `${row.date}T${row.startTime}:00+08:00`, endTime: `${row.date}T${row.endTime}:00+08:00`, setupMinutes: row.setupMinutes, turnaroundMinutes: row.turnaroundMinutes, venueRequirements: { description: row.requirements } })) }) })
      const data = await response.json()
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (response.status === 409) { this.conflicts = data.conflicts || []; this.conflicts.forEach(entry => { if (this.rows[entry.index]) this.rows[entry.index].conflicts = entry.conflicts }); this.error = data.error; this.submitting = false; return }
      if (!response.ok) { this.error = data.error || 'Unable to submit venue bookings. Your fields are still available.'; this.submitting = false; return }
      this.success = `${data.bookings.length} venue booking requests submitted for ${this.selectedEvent?.title || 'the event'}.`
      this.submitting = false
    }
  },
  mounted() { this.loadOptions() }
}
</script>

<style scoped>
.booking-row, .summary-row { border: 1px solid #e9edf3; border-radius: .75rem; padding: 1rem; background: #fbfcff }
</style>
