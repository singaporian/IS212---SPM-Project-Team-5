<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div>
        <p class="eyebrow mb-1">Coordinator workspace</p>
        <h1 class="h3 mb-1">All Venue Booking Requests</h1>
        <p class="text-muted mb-0">Review the venue requests submitted for your assigned events.</p>
      </div>
      <button class="btn btn-outline-primary" @click="loadRequests">Refresh</button>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!requests.length" class="empty-state text-center">
      <i class="bi bi-calendar2-x display-5"></i>
      <h2 class="h5 mt-3">No venue booking requests yet</h2>
      <p class="text-muted mb-0">Submitted requests will appear here.</p>
    </div>
    <div v-else class="row g-3">
      <div v-for="request in requests" :key="request.id" class="col-lg-6">
        <article class="card h-100 booking-card" :class="{ 'booking-card-selected': selectedId === request.id }" tabindex="0" role="button" @click="toggleDetails(request.id)" @keydown.enter="toggleDetails(request.id)">
          <div class="card-body">
            <div class="d-flex justify-content-between gap-3">
              <div>
                <h2 class="h5 mb-1">{{ request.event_title }}</h2>
                <p class="text-muted mb-1">{{ request.venue_name }}</p>
                <p class="small text-muted mb-0">{{ formatDate(request.start_time) }} to {{ formatDate(request.end_time) }}</p>
              </div>
              <span class="badge align-self-start" :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span>
            </div>
            <div v-if="request.conflict_warning" class="small text-warning mt-3"><i class="bi bi-exclamation-triangle"></i> Conflict flagged for Venue Staff</div>
            <div v-if="selectedId === request.id" class="details mt-3" @click.stop>
              <div><strong>Setup:</strong> {{ request.setup_minutes }} minutes</div>
              <div><strong>Turnaround:</strong> {{ request.turnaround_minutes }} minutes</div>
              <div><strong>Requirements:</strong> {{ request.venue_requirements?.description || 'None specified' }}</div>
              <div v-if="request.decision_reason"><strong>Decision reason:</strong> {{ request.decision_reason }}</div>
              <div v-if="request.decision_comment"><strong>Comment:</strong> {{ request.decision_comment }}</div>
              <div v-if="request.alternative_start_time"><strong>Suggested alternative:</strong> {{ formatDate(request.alternative_start_time) }} to {{ formatDate(request.alternative_end_time) }}</div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'BookingRequestsView',
  data() { return { requests: [], error: '', selectedId: null } },
  methods: {
    async loadRequests() {
      this.error = ''
      const response = await fetch('/api/bookings/mine', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load booking requests'; return }
      this.requests = data
    },
    toggleDetails(id) { this.selectedId = this.selectedId === id ? null : id },
    formatDate(value) { return value ? new Date(value).toLocaleString() : 'Time not provided' },
    statusLabel(status) {
      const labels = { pending: 'Pending Review', alternative_suggested: 'Alternative Suggested' }
      return labels[status] || (status ? status.replaceAll('_', ' ') : 'Unknown Status')
    },
    statusClass(status) {
      return { 'bg-warning text-dark': status === 'pending', 'bg-success': status === 'approved' || status === 'confirmed', 'bg-danger': status === 'rejected', 'bg-info text-dark': status === 'alternative_suggested' }
    }
  },
  mounted() { this.loadRequests() }
}
</script>

<style scoped>
.booking-card { cursor: pointer; border: 1px solid #e9edf3; border-radius: .75rem }
.booking-card:hover, .booking-card:focus, .booking-card-selected { background: #f8f9ff; outline: none }
.details { border-top: 1px solid #e8ebf2; padding-top: .75rem; color: #52606d; font-size: .85rem; line-height: 1.8 }
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
