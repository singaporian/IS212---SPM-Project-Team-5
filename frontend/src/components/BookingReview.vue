<template>
  <section class="mt-3 border rounded p-3" aria-label="Venue booking review">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h3 class="h5 mb-0">Review arrangement</h3>
      <button class="btn btn-outline-primary btn-sm" :disabled="loading" @click="load">Refresh review</button>
    </div>
    <p v-if="loading" role="status">Loading review information…</p>
    <div v-else-if="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-link" @click="load">Retry</button></div>
    <template v-else-if="review">
      <p class="small text-muted">All times are Singapore time (UTC+8). Availability reflects the latest successful review load.</p>
      <h4 class="h6">Submitted booking arrangement</h4>
      <dl class="row">
        <dt class="col-sm-4">Requested slot</dt><dd class="col-sm-8">{{ formatDate(review.request.start_time) }} – {{ formatDate(review.request.end_time) }}</dd>
        <dt class="col-sm-4">Venue requirements</dt><dd class="col-sm-8" style="white-space: pre-wrap">{{ describe(review.request.venue_requirements) }}</dd>
        <dt class="col-sm-4">Recorded setup / turnaround</dt><dd class="col-sm-8">{{ buffer(review.request.setup_minutes) }} / {{ buffer(review.request.turnaround_minutes) }}</dd>
        <dt class="col-sm-4">Occupied interval</dt><dd class="col-sm-8">{{ formatDate(review.occupied.start) }} – {{ formatDate(review.occupied.end) }}</dd>
      </dl>
      <h4 class="h6">Event information</h4>
      <p class="small text-muted">These are event values, shown separately from the submitted booking arrangement.</p>
      <dl class="row">
        <dt class="col-sm-4">Expected attendance</dt><dd class="col-sm-8">{{ review.request.expected_attendance ?? 'Not recorded' }}</dd>
        <dt class="col-sm-4">Event preferred slot</dt><dd class="col-sm-8">{{ formatDate(review.request.preferred_start) }} – {{ formatDate(review.request.preferred_end) }}</dd>
        <dt class="col-sm-4">Event venue requirements</dt><dd class="col-sm-8">{{ describe(review.request.draft_data?.venueRequirements || review.request.venue_layout_preference) }}</dd>
        <dt class="col-sm-4">Accessibility requirements</dt><dd class="col-sm-8">{{ describe(review.request.draft_data?.accessibilityNeeds || review.request.accessibility_requirements) }}</dd>
        <dt class="col-sm-4">Equipment / facility requirements</dt><dd class="col-sm-8">{{ describe(review.request.draft_data?.equipmentRequirements || review.request.equipment_requirements) }}</dd>
      </dl>
      <h4 class="h6">Venue information: {{ review.venue.name }}</h4>
      <dl class="row">
        <dt class="col-sm-4">Capacity</dt><dd class="col-sm-8">{{ review.venue.capacity }}</dd>
        <dt class="col-sm-4">Facilities</dt><dd class="col-sm-8">{{ describe(review.venue.facilities) }}</dd>
        <dt class="col-sm-4">Accessibility</dt><dd class="col-sm-8">{{ describe(review.venue.accessibility) }}</dd>
        <dt class="col-sm-4">Layouts</dt><dd class="col-sm-8">{{ describe(review.venue.supported_layouts) }}</dd>
        <dt class="col-sm-4">Recorded availability dates</dt><dd class="col-sm-8">{{ review.venue.available_from }} – {{ review.venue.available_until }}</dd>
        <dt class="col-sm-4">Operating notes</dt><dd class="col-sm-8">{{ describe(review.venue.notes) }}</dd>
      </dl>
      <p v-if="!review.operating_hours.length">No operating hours recorded.</p>
      <ul v-else aria-label="Recorded operating hours"><li v-for="hours in review.operating_hours" :key="hours.day_of_week">{{ days[hours.day_of_week] }}: {{ formatClock(hours.opens_at) }} – {{ formatClock(hours.closes_at) }}</li></ul>
      <h4 class="h6">Availability conflicts</h4>
      <div v-if="review.conflicts.length" class="alert alert-warning" role="status">
        <ul class="mb-0"><li v-for="conflict in review.conflicts" :key="conflict.type + conflict.id">{{ conflict.type === 'booking' ? 'Confirmed booking' : 'Recorded unavailability' }}: {{ conflict.title }} — {{ formatDate(conflict.start) }} – {{ formatDate(conflict.end) }}</li></ul>
      </div>
      <p v-else role="status">No overlapping confirmed bookings or recorded unavailability found.</p>
      <h4 class="h6">Bookings around this slot</h4>
      <p class="small text-muted">Conflict checks include confirmed bookings and recorded unavailability. Other booking statuses are shown for context. Occupied intervals include recorded setup and turnaround.</p>
      <p v-if="!review.bookings.length">No other bookings recorded for these dates.</p>
      <ul v-else><li v-for="booking in review.bookings" :key="booking.id">{{ booking.event_title || 'Booking' }} — {{ statusLabel(booking.status) }}; {{ formatDate(booking.start_time) }} – {{ formatDate(booking.end_time) }}. Occupied: {{ formatDate(booking.occupied.start) }} – {{ formatDate(booking.occupied.end) }}.</li></ul>
      <h4 class="h6">Recorded unavailability around this slot</h4>
      <p v-if="!review.unavailability.length">No blocked periods recorded for these dates.</p>
      <ul v-else><li v-for="period in review.unavailability" :key="period.id">{{ period.reason || 'Recorded unavailability' }} — {{ formatDate(period.start_time) }} – {{ formatDate(period.end_time) }}</li></ul>
    </template>
  </section>
</template>

<script>
import { authHeaders } from '../services/auth'

export default {
  name: 'BookingReview',
  props: { bookingId: { type: String, required: true } },
  data() { return { review: null, loading: true, error: '', days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] } },
  mounted() { this.load() },
  watch: { bookingId() { this.load() } },
  methods: {
    formatDate(value) {
      if (!value) return 'Not recorded'
      return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am|pm/gi, value => value.toUpperCase())
    },
    formatClock(value) {
      if (!value) return 'Not recorded'
      const [hour, minute] = value.split(':')
      return `${String(Number(hour) % 12 || 12).padStart(2, '0')}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}`
    },
    buffer(value) { return value == null ? 'Not recorded' : `${value} minutes` },
    statusLabel(value) { return value === 'pending' ? 'Pending Review' : String(value || 'Not recorded').replaceAll('_', ' ') },
    describe(value) {
      if (value == null || value === '') return 'Not recorded'
      if (Array.isArray(value)) return value.length ? value.map(this.describe).join(', ') : 'Not recorded'
      if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${this.describe(item)}`).join('; ') || 'Not recorded'
      return String(value)
    },
    async load() {
      const id = this.bookingId
      this.loading = true
      this.error = ''
      this.review = null
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(id)}/review`, { headers: authHeaders() })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load booking review. Please retry.')
        if (this.bookingId === id) this.review = data
      } catch (error) {
        if (this.bookingId === id) this.error = 'Unable to load booking review. Please retry.'
      } finally {
        if (this.bookingId === id) this.loading = false
      }
    }
  }
}
</script>
