<template>
  <section class="booking-review mt-3" aria-label="Venue booking review">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h3 class="h5 mb-0">Review summary</h3>
      <button class="btn btn-outline-primary btn-sm" :disabled="loading" @click="load">Refresh review</button>
    </div>
    <p v-if="loading" role="status">Loading review information…</p>
    <div v-else-if="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-link" @click="load">Retry</button></div>
    <template v-else-if="review">
      <p role="status" :class="capacityExceeded ? 'alert alert-warning' : 'text-muted'">{{ capacityText }}</p>
      <p>Expected attendance: {{ review.request.expected_attendance ?? 'Not recorded' }}</p>
      <p class="small text-muted">Occupied: {{ formatRange(review.occupied.start, review.occupied.end) }} (Singapore time)</p>
      <p role="status">{{ review.conflicts.some(c => c.type === 'booking') ? 'Warning: Reserved booking overlaps occupied period' : 'No reserved booking conflict' }}</p>
      <p role="status">{{ review.conflicts.some(c => c.type === 'unavailability') ? 'Warning: Venue unavailable during requested period' : 'No recorded unavailability conflict' }}</p>
      <button v-if="!fullPage" class="btn btn-outline-primary btn-sm" :aria-expanded="expanded" :aria-controls="'review-details-' + bookingId" @click="toggleDetails">{{ expanded ? 'Hide details' : 'Review details' }}</button>
      <div v-if="fullPage || expanded" :id="'review-details-' + bookingId" class="review-details">
      <h4 class="h6">Booking Request</h4>
      <dl class="review-grid">
        <dt >Requested slot</dt><dd  :class="{ 'text-muted': (formatRange(review.request.start_time, review.request.end_time)) === 'Not recorded' }">{{ formatRange(review.request.start_time, review.request.end_time) }}</dd>
        <dt >Venue requirements</dt><dd  style="white-space: pre-wrap" :class="{ 'text-muted': (describe(review.request.venue_requirements)) === 'Not recorded' }">{{ describe(review.request.venue_requirements) }}</dd>
        <dt >Recorded setup / turnaround</dt><dd >{{ buffer(review.request.setup_minutes) }} / {{ buffer(review.request.turnaround_minutes) }}</dd>
        <dt >Occupied interval</dt><dd  :class="{ 'text-muted': (formatRange(review.occupied.start, review.occupied.end)) === 'Not recorded' }">{{ formatRange(review.occupied.start, review.occupied.end) }}</dd>
      </dl>
      <h4 class="h6">Event Requirements</h4>
      <p class="small text-muted">These are event values, shown separately from the submitted booking arrangement.</p>
      <dl class="review-grid">
        <dt >Expected attendance</dt><dd  :class="{ 'text-muted': (review.request.expected_attendance ?? 'Not recorded') === 'Not recorded' }">{{ review.request.expected_attendance ?? 'Not recorded' }}</dd>
        <dt >Event preferred slot</dt><dd  :class="{ 'text-muted': (formatRange(review.request.preferred_start, review.request.preferred_end)) === 'Not recorded' }">{{ formatRange(review.request.preferred_start, review.request.preferred_end) }}</dd>
        <dt >Room layout preference</dt><dd  :class="{ 'text-muted': (describe(review.request.venue_layout_preference)) === 'Not recorded' }">{{ describe(review.request.venue_layout_preference) }}</dd>
        <dt >Event venue requirements</dt><dd  :class="{ 'text-muted': (describe(review.request.draft_data?.venueRequirements || review.request.venue_layout_preference)) === 'Not recorded' }">{{ describe(review.request.draft_data?.venueRequirements || review.request.venue_layout_preference) }}</dd>
        <dt >Accessibility requirements</dt><dd  :class="{ 'text-muted': (describe(review.request.draft_data?.accessibilityNeeds || review.request.accessibility_requirements)) === 'Not recorded' }">{{ describe(review.request.draft_data?.accessibilityNeeds || review.request.accessibility_requirements) }}</dd>
        <dt >Equipment / facility requirements</dt><dd  :class="{ 'text-muted': (describe(review.request.draft_data?.equipmentRequirements || review.request.equipment_requirements)) === 'Not recorded' }">{{ describe(review.request.draft_data?.equipmentRequirements || review.request.equipment_requirements) }}</dd>
      </dl>
      <h4 class="h6">Venue information: {{ review.venue.name }}</h4>
      <dl class="review-grid">
        <dt >Location</dt><dd  :class="{ 'text-muted': (describe(review.venue.location)) === 'Not recorded' }">{{ describe(review.venue.location) }}</dd>
        <dt >Capacity</dt><dd  :class="{ 'text-muted': (review.venue.capacity) === 'Not recorded' }">{{ review.venue.capacity }}</dd>
        <dt >Facilities</dt><dd  :class="{ 'text-muted': (describe(review.venue.facilities)) === 'Not recorded' }">{{ describe(review.venue.facilities) }}</dd>
        <dt >Accessibility</dt><dd  :class="{ 'text-muted': (describe(review.venue.accessibility)) === 'Not recorded' }">{{ describe(review.venue.accessibility) }}</dd>
        <dt >Layouts</dt><dd  :class="{ 'text-muted': (describe(review.venue.supported_layouts)) === 'Not recorded' }">{{ describe(review.venue.supported_layouts) }}</dd>
        <dt >Recorded availability dates</dt><dd >{{ review.venue.available_from }} – {{ review.venue.available_until }}</dd>
        <dt >Operating notes</dt><dd  :class="{ 'text-muted': (describe(review.venue.notes)) === 'Not recorded' }">{{ describe(review.venue.notes) }}</dd>
      </dl>
      <p v-if="!review.operating_hours.length">No operating hours recorded.</p>
      <ul v-else aria-label="Recorded operating hours"><li v-for="hours in operatingHours()" :key="hours">{{ hours }}</li></ul>
      <h4 class="h6">Availability &amp; Conflicts</h4>
      <div v-if="review.conflicts.length" class="alert alert-warning" role="status">
        <ul class="mb-0"><li v-for="conflict in review.conflicts" :key="conflict.type + conflict.id">{{ conflict.type === 'booking' ? (conflict.status === 'approved' ? 'Approved — venue reserved' : 'Confirmed booking') : 'Recorded unavailability' }}: {{ conflict.title }} — {{ formatRange(conflict.start, conflict.end) }}{{ conflict.type === 'booking' ? ' (including recorded setup and turnaround)' : '' }}</li></ul>
      </div>
      <p v-else role="status">No overlapping reserved bookings or recorded unavailability found.</p>
      <h4 class="h6">Bookings around this slot</h4>
      <p class="small text-muted">Conflict checks include approved and confirmed bookings and recorded unavailability. Other booking statuses are shown for context. Occupied intervals include recorded setup and turnaround.</p>
      <p v-if="!review.bookings.length">No other bookings recorded for these dates.</p>
      <ul v-else><li v-for="booking in review.bookings" :key="booking.id">{{ booking.event_title || 'Booking' }} — {{ statusLabel(booking.status) }}; {{ formatRange(booking.start_time, booking.end_time) }}. Occupied: {{ formatRange(booking.occupied.start, booking.occupied.end) }}.<span v-if="booking.status === 'pending'" class="d-block text-muted">Context only; pending status does not reserve the venue.</span></li></ul>
      <h4 class="h6">Recorded unavailability around this slot</h4>
      <p v-if="!review.unavailability.length">No blocked periods recorded for these dates.</p>
      <ul v-else><li v-for="period in review.unavailability" :key="period.id">{{ period.reason || 'Recorded unavailability' }} — {{ formatRange(period.start_time, period.end_time) }}</li></ul>
      </div>
    </template>
  </section>
</template>

<script>
import { authHeaders } from '../services/auth'

export default {
  name: 'BookingReview',
  props: { bookingId: { type: String, required: true }, fullPage: Boolean },
  data() { return { expanded: false, review: null, loading: true, error: '', days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] } },
  emits: ['loaded', 'loading'],
  mounted() { this.load() },
  watch: { bookingId() { this.load() } },
  computed: {
    capacityExceeded() { return Number(this.review?.request.expected_attendance) > Number(this.review?.venue.capacity) && Number(this.review?.venue.capacity) > 0 },
    capacityText() {
      const attendance = Number(this.review?.request.expected_attendance), capacity = Number(this.review?.venue.capacity)
      if (!(attendance > 0) || !(capacity > 0)) return 'Capacity assessment unavailable: attendance or venue capacity is not recorded.'
      return attendance > capacity ? `Capacity exceeded: Expected attendance is ${attendance}, but this venue accommodates ${capacity}.` : `Recorded attendance (${attendance}) is within venue capacity (${capacity}).`
    }
  },
  methods: {
    toggleDetails() { this.expanded = !this.expanded },
    operatingHours() {
      const hours = this.review.operating_hours
      if (hours.length === 7 && new Set(hours.map(h => h.day_of_week)).size === 7 && hours.every(h => h.opens_at === hours[0].opens_at && h.closes_at === hours[0].closes_at)) return [`Every day: ${this.formatClock(hours[0].opens_at)} - ${this.formatClock(hours[0].closes_at)}`]
      return hours.map(h => `${this.days[h.day_of_week]}: ${this.formatClock(h.opens_at)} - ${this.formatClock(h.closes_at)}`)
    },
    formatRange(start, end) {
      if (!start || !end) return `${this.formatDate(start)} - ${this.formatDate(end)}`
      const date = value => new Date(value).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' })
      const time = value => new Date(value).toLocaleTimeString('en-US', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', hour12: true })
      return date(start) === date(end) ? `${date(start)}, ${time(start)}–${time(end)}` : `${date(start)}, ${time(start)} – ${date(end)}, ${time(end)}`
    },
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
    statusLabel(value) { return ({ pending: 'Pending Review', approved: 'Approved — venue reserved', confirmed: 'Confirmed booking', rejected: 'Rejected', alternative_suggested: 'Alternative Suggested' })[value] || String(value || 'Not recorded').replaceAll('_', ' ') },
    describe(value) {
      if (value == null || value === '') return 'Not recorded'
      if (Array.isArray(value)) return value.length ? value.map(this.describe).join(', ') : 'Not recorded'
      if (typeof value === 'object' && Object.keys(value).length === 1 && 'description' in value) return this.describe(value.description)
      if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${this.describe(item)}`).join('; ') || 'Not recorded'
      return String(value)
    },
    async load() {
      const id = this.bookingId
      this.$emit?.('loading')
      this.loading = true
      this.error = ''
      this.review = null
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(id)}/review`, { headers: authHeaders() })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load booking review. Please retry.')
        if (this.bookingId === id) { this.review = data; this.$emit?.('loaded', data) }
      } catch (error) {
        if (this.bookingId === id) this.error = 'Unable to load booking review. Please retry.'
      } finally {
        if (this.bookingId === id) this.loading = false
      }
    }
  }
}
</script>

<style scoped>
.review-details h4 { border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1.25rem; font-weight: 650; }
.review-grid { display: grid; grid-template-columns: minmax(150px, 30%) minmax(0, 1fr); gap: .5rem 1.25rem; }
.review-grid dt { font-weight: 600; }
.review-grid dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.review-details li { margin-bottom: .5rem; overflow-wrap: anywhere; }
@media (max-width: 575px) { .review-grid { grid-template-columns: minmax(0, 1fr); gap: .2rem; } .review-grid dd { margin-bottom: .65rem; } }
</style>
