<template>
  <div>
    <router-link to="/" class="btn btn-sm btn-outline-secondary mb-3">← Back to Home</router-link>

    <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
      <h1 class="h3 mb-0">Upcoming Bookings Calendar</h1>
      <button class="btn btn-sm btn-outline-primary" @click="refresh">Refresh</button>
    </div>

    <div class="d-flex flex-wrap gap-3 align-items-center mb-4">
      <div class="btn-group" role="group" aria-label="Calendar view">
        <button class="btn btn-sm" :class="viewMode === 'day' ? 'btn-primary' : 'btn-outline-secondary'" @click="viewMode = 'day'">Day</button>
        <button class="btn btn-sm" :class="viewMode === 'week' ? 'btn-primary' : 'btn-outline-secondary'" @click="viewMode = 'week'">Week</button>
        <button class="btn btn-sm" :class="viewMode === 'month' ? 'btn-primary' : 'btn-outline-secondary'" @click="viewMode = 'month'">Month</button>
      </div>

      <label class="d-flex align-items-center gap-2 mb-0">
        <span class="small text-muted">Venue</span>
        <select v-model="selectedVenueId" class="form-select form-select-sm" @change="loadBookings">
          <option value="">All venues</option>
          <option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }}</option>
        </select>
      </label>
    </div>

    <div v-if="error" class="alert alert-danger small">{{ error }}</div>

    <div v-if="loadingBookings" class="alert alert-light border small text-muted">
      Loading confirmed bookings...
    </div>
    <div v-else-if="groupedBookings.length === 0 && !error" class="alert alert-light border small text-muted">
      No confirmed bookings available for the selected venue and range.
    </div>

    <div v-for="group in groupedBookings" :key="group.label" class="booking-group mb-4">
      <h2 class="h5 mb-3 mt-2">{{ group.label }}</h2>
      <div class="list-group gap-2">
        <div
          v-for="booking in group.items"
          :key="booking.id"
          class="list-group-item list-group-item-action text-start booking-entry"
          :class="{ 'booking-warning': isInsufficientTurnaround(booking), 'selected': selectedBookingId === booking.id }"
          @click="toggleDetails(booking.id)"
        >
          <div class="d-flex justify-content-between align-items-start gap-3 py-1">
            <div>
              <div class="fw-semibold">{{ booking.event_title }}</div>
              <div class="small text-muted">{{ booking.venue_name }}</div>
              <div class="small">{{ formatRange(booking.start_time, booking.end_time) }}</div>
              <div class="small text-muted">Expected attendance: {{ booking.expected_attendance ?? '—' }}</div>
            </div>
            <div class="text-end">
              <span v-if="isInsufficientTurnaround(booking)" class="badge bg-danger-subtle text-danger border border-danger-subtle">Turnaround warning</span>
            </div>
          </div>

          <div v-if="selectedBookingId === booking.id" class="mt-3 p-3 border rounded bg-light small expanded-details">
            <div><strong>Event:</strong> {{ booking.event_title }}</div>
            <div><strong>Venue:</strong> {{ booking.venue_name }}</div>
            <div><strong>Start:</strong> {{ formatDateTime(booking.start_time) }}</div>
            <div><strong>End:</strong> {{ formatDateTime(booking.end_time) }}</div>
            <div><strong>Expected attendance:</strong> {{ booking.expected_attendance ?? '—' }}</div>
            <div><strong>Setup minutes:</strong> {{ booking.setup_minutes ?? 0 }}</div>
            <div><strong>Turnaround minutes:</strong> {{ booking.turnaround_minutes ?? 0 }}</div>
            <div><strong>Status:</strong> {{ booking.status }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'VenueBookingsCalendarView',
  data() {
    return {
      viewMode: 'week',
      venues: [],
      bookings: [],
      loadingBookings: false,
      selectedVenueId: '',
      error: '',
      selectedBookingId: null
    }
  },
  computed: {
    filteredBookings() {
      return [...this.bookings]
        .filter((booking) => !this.selectedVenueId || booking.venue_id === this.selectedVenueId)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    },
    groupedBookings() {
      const groups = {}
      for (const booking of this.filteredBookings) {
        const key = this.groupKeyFor(booking.start_time)
        if (!groups[key]) groups[key] = []
        groups[key].push(booking)
      }
      return Object.entries(groups)
        .map(([label, items]) => ({ label, items }))
        .sort((a, b) => new Date(a.items[0].start_time) - new Date(b.items[0].start_time))
    }
  },
  methods: {
    formatDateTime(value) {
      if (!value) return '—'
      return new Date(value).toLocaleString()
    },
    formatRange(startTime, endTime) {
      if (!startTime || !endTime) return '—'
      const start = new Date(startTime)
      const end = new Date(endTime)
      return `${this.formatTime(start)} – ${this.formatTime(end)}`
    },
    formatTime(date) {
      return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
    groupKeyFor(dateString) {
      const date = new Date(dateString)
      const dateKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      if (this.viewMode === 'day') return dateKey(date)
      if (this.viewMode === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const startOfWeek = new Date(date)
      const day = startOfWeek.getDay()
      const diff = (day === 0 ? -6 : 1 - day)
      startOfWeek.setDate(startOfWeek.getDate() + diff)
      return dateKey(startOfWeek)
    },
    isInsufficientTurnaround(booking) {
      const venueBookings = this.filteredBookings.filter((item) => item.venue_id === booking.venue_id)
      const index = venueBookings.findIndex((item) => item.id === booking.id)
      if (index < 0 || index === venueBookings.length - 1) return false
      const next = venueBookings[index + 1]
      const currentEnd = new Date(booking.end_time).getTime()
      const nextStart = new Date(next.start_time).getTime()
      const gapMinutes = (nextStart - currentEnd) / 60000
      const requiredGap = Number(booking.turnaround_minutes || 0) + Number(next.setup_minutes || 0)
      return gapMinutes < requiredGap
    },
    toggleDetails(bookingId) {
      this.selectedBookingId = this.selectedBookingId === bookingId ? null : bookingId
    },
    async refresh() {
      await this.loadVenues()
      await this.loadBookings()
    },
    async loadVenues() {
      const res = await fetch('/api/venues', { headers: authHeaders() })
      if (res.status === 401) {
        clearSession()
        this.$router.push('/login')
        return
      }
      if (!res.ok) {
        this.error = 'Unable to load venue list.'
        return
      }
      this.venues = await res.json()
    },
    async loadBookings() {
      this.error = ''
      this.loadingBookings = true
      const params = new URLSearchParams()
      if (this.selectedVenueId) params.set('venueId', this.selectedVenueId)

      try {
        const res = await fetch(`/api/bookings${params.toString() ? `?${params.toString()}` : ''}`, { headers: authHeaders() })
        if (res.status === 401) {
          clearSession()
          this.$router.push('/login')
          return
        }
        const data = await res.json().catch(() => [])
        if (!res.ok) {
          this.error = data.error || 'Unable to load bookings.'
          this.bookings = []
          return
        }
        this.bookings = data
        this.selectedBookingId = null
      } catch {
        this.error = 'Unable to load bookings.'
        this.bookings = []
      } finally {
        this.loadingBookings = false
      }
    }
  },
  mounted() {
    this.refresh()
  }
}
</script>

<style scoped>
.booking-entry {
  margin-bottom: 0.75rem;
  padding: 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.booking-entry:hover {
  background-color: #f8f9fa;
}

.booking-group + .booking-group {
  margin-top: 1.5rem;
}

.booking-entry.selected {
  border-color: rgba(13, 110, 253, 0.25);
}

.booking-warning {
  border-left: 4px solid #dc3545 !important;
  background: #fff5f5;
}

.expanded-details {
  background-color: #f8f9fa;
  border-radius: 0.5rem;
  padding: 1rem;
}
</style>
