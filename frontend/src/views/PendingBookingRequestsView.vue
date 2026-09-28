<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <h1 class="h3 mb-4">Pending venue booking requests</h1>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-if="!requests.length && !error" class="empty-state text-center">No pending booking requests.</div>
    <article v-for="request in requests" :key="request.id" class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3">
          <div>
            <h2 class="h5 mb-1">{{ request.event_title }} at {{ request.venue_name }}</h2>
            <p class="small text-muted mb-2">Coordinator: {{ request.coordinator_name || 'Unknown' }} ({{ request.coordinator_email || 'no email' }})</p>
            <p class="small mb-1">{{ formatDate(request.start_time) }} to {{ formatDate(request.end_time) }}</p>
            <p class="small mb-1">Setup: {{ request.setup_minutes }} minutes; turnaround: {{ request.turnaround_minutes }} minutes</p>
            <p v-if="request.conflict_warning" class="alert alert-warning py-2 small mb-0">Conflict warning was acknowledged at submission. Review the existing booking conflict before deciding.</p>
          </div>
          <span class="badge bg-warning text-dark align-self-start">Pending Review</span>
        </div>
        <div class="mt-3 d-flex flex-wrap gap-2">
          <button class="btn btn-success btn-sm" @click="decide(request, 'approved')">Approve</button>
          <button class="btn btn-outline-danger btn-sm" @click="openDecision(request, 'rejected')">Reject</button>
          <button class="btn btn-outline-primary btn-sm" @click="openDecision(request, 'alternative_suggested')">Suggest Alternative</button>
        </div>
        <div v-if="active === request.id" class="decision-panel mt-3 p-3 bg-light rounded">
          <label v-if="decision === 'rejected'" class="form-label">Reason<select v-model="reason" class="form-select"><option value="Capacity Exceeded">Capacity Exceeded</option><option value="Maintenance Conflict">Maintenance Conflict</option><option value="Booking Conflict">Booking Conflict</option><option value="Other">Other</option></select></label>
          <label class="form-label">Comment<textarea v-model="comment" class="form-control" rows="2"></textarea></label>
          <div v-if="decision === 'alternative_suggested'" class="row g-2"><div class="col-md-6"><label class="form-label">Alternative start<input v-model="alternativeStartTime" class="form-control" type="datetime-local" required /></label></div><div class="col-md-6"><label class="form-label">Alternative end<input v-model="alternativeEndTime" class="form-control" type="datetime-local" required /></label></div></div>
          <div v-if="decisionError" class="alert alert-danger py-2">{{ decisionError }}</div>
          <button class="btn btn-accent btn-sm" @click="submitDecision(request.id)">Confirm decision</button>
          <button class="btn btn-link btn-sm" @click="active = ''">Cancel</button>
        </div>
      </div>
    </article>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'PendingBookingRequestsView',
  data() { return { requests: [], error: '', active: '', decision: '', reason: '', comment: '', alternativeStartTime: '', alternativeEndTime: '', decisionError: '' } },
  methods: {
    formatDate(value) { return value ? new Date(value).toLocaleString() : '—' },
    async load() {
      const response = await fetch('/api/bookings/pending', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load requests'; return }
      this.requests = data
    },
    openDecision(request, decision) { this.active = request.id; this.decision = decision; this.reason = ''; this.comment = ''; this.decisionError = '' },
    async submitDecision(id) {
      this.decisionError = ''
      const response = await fetch(`/api/bookings/${id}/decision`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: this.decision, reason: this.reason, comment: this.comment, alternativeStartTime: this.alternativeStartTime || null, alternativeEndTime: this.alternativeEndTime || null }) })
      const data = await response.json()
      if (!response.ok) { this.decisionError = data.error || 'Unable to save decision'; return }
      this.active = ''
      await this.load()
    }
  },
  mounted() { this.load() }
}
</script>
