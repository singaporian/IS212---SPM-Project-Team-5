<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card">
      <div class="card-body">
        <p class="eyebrow mb-1">Venue workspace</p>
        <h1 class="h3">Submit venue booking request</h1>
        <p class="text-muted">Choose an assigned event and venue. Conflicts are flagged for Venue Staff review.</p>

        <div v-if="success" class="alert alert-success">
          Booking request submitted. Venue Staff can now review it.
          <router-link to="/" class="alert-link ms-1">Return to dashboard</router-link>
        </div>
        <form v-else @submit.prevent="showSummary = true">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label" for="booking-event">Event</label>
              <select id="booking-event" v-model="form.eventId" class="form-select" required>
                <option value="">Select an assigned submitted event</option>
                <option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }}</option>
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label" for="booking-venue">Venue</label>
              <select id="booking-venue" v-model="form.venueId" class="form-select" required>
                <option value="">Select a venue</option>
                <option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }} ({{ venue.capacity }} seats)</option>
              </select>
            </div>
            <div class="col-md-3"><label class="form-label">Event date<input v-model="form.date" class="form-control" type="date" required /></label></div>
            <div class="col-md-3"><label class="form-label">Start time<input v-model="form.startTime" class="form-control" type="time" required /></label></div>
            <div class="col-md-3"><label class="form-label">End time<input v-model="form.endTime" class="form-control" type="time" required /></label></div>
            <div class="col-md-3"><label class="form-label">Setup minutes<input v-model.number="form.setupMinutes" class="form-control" type="number" min="0" required /></label></div>
            <div class="col-md-3"><label class="form-label">Turnaround minutes<input v-model.number="form.turnaroundMinutes" class="form-control" type="number" min="0" required /></label></div>
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
            <dt class="col-sm-4">Date and time</dt><dd class="col-sm-8">{{ form.date }} from {{ form.startTime }} to {{ form.endTime }}</dd>
            <dt class="col-sm-4">Setup / turnaround</dt><dd class="col-sm-8">{{ form.setupMinutes }} / {{ form.turnaroundMinutes }} minutes</dd>
            <dt class="col-sm-4">Requirements</dt><dd class="col-sm-8">{{ form.requirements || 'None specified' }}</dd>
          </dl>

          <div v-if="conflicts.length" class="alert alert-warning">
            <strong>Potential booking conflict detected.</strong>
            <p class="small mb-2">You must acknowledge this warning before submitting. Venue Staff will see the conflict flag.</p>
            <ul class="small mb-2"><li v-for="conflict in conflicts" :key="conflict.booking_id">{{ conflict.event_title }}: {{ formatDate(conflict.start_time) }} to {{ formatDate(conflict.end_time) }} ({{ conflict.status }})</li></ul>
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
      submitting: false,
      success: false,
      form: { eventId: '', venueId: '', date: '', startTime: '', endTime: '', setupMinutes: 30, turnaroundMinutes: 30, requirements: '' }
    }
  },
  computed: {
    selectedEvent() { return this.events.find((event) => event.id === this.form.eventId) },
    selectedVenue() { return this.venues.find((venue) => venue.id === this.form.venueId) }
  },
  methods: {
    formatDate(value) { return value ? new Date(value).toLocaleString() : '—' },
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
      const startTime = `${this.form.date}T${this.form.startTime}:00+08:00`
      const endTime = `${this.form.date}T${this.form.endTime}:00+08:00`
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
      this.success = true
      this.submitting = false
    }
  },
  mounted() { this.loadOptions() }
}
</script>
