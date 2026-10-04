<template>
  <main class="venue-inbox">
    <router-link to="/" class="small">Back to Dashboard</router-link>
    <header class="inbox-heading">
      <div><p class="eyebrow">VENUE WORKSPACE</p><h1>Pending venue booking requests</h1><p class="text-muted">Review the requested arrangement before making a decision. Times are in Singapore time.</p></div>
      <button class="btn btn-outline-primary" :disabled="loading" @click="load">Refresh inbox</button>
    </header>
    <p v-if="loading" role="status">Loading requests...</p>
    <div v-else-if="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-link" @click="load">Retry</button></div>
    <p v-else-if="!requests.length" class="empty-state">No requests in this view.</p>
    <article v-for="request in requests" :key="request.id" class="card inbox-item">
      <div class="inbox-content">
        <div><h2>{{ request.event_title }}</h2><p class="venue-name">{{ request.venue_name }}</p><p>{{ formatRange(request.start_time, request.end_time) }}</p><p class="small text-muted">Coordinator: {{ request.coordinator_name || 'Not recorded' }}</p></div>
        <div class="inbox-status">
          <span class="badge bg-warning text-dark">{{ statusLabel(summaries[request.id]?.status || request.status) }}</span>
          <template v-if="summaries[request.id]">
            <p>Attendance: {{ summaries[request.id].expected_attendance ?? 'Not recorded' }}</p>
            <p>{{ summaries[request.id].reserved_conflicts ? 'Warning: Reserved booking conflict' : 'No reserved booking conflict' }}</p>
            <p>{{ summaries[request.id].unavailable_conflicts ? 'Warning: Recorded venue unavailability' : 'No recorded unavailability conflict' }}</p>
          </template>
          <p v-else role="status" class="text-muted">{{ summaryErrors[request.id] || 'Loading attendance and availability...' }}</p>
        </div>
        <router-link class="btn btn-primary" :to="{ name: 'venue-booking-review', params: { id: request.id } }">Review Request</router-link>
      </div>
    </article>
  </main>
</template>
<script>
import BookingReview from '../components/BookingReview.vue'
import { authHeaders, clearSession } from '../services/auth'
export default {
  name: 'PendingBookingRequestsView',
  data() { return { requests: [], summaries: {}, summaryErrors: {}, loading: true, error: '', loadVersion: 0 } },
  methods: {
    formatRange: BookingReview.methods.formatRange,
    formatDate: BookingReview.methods.formatDate,
    statusLabel: BookingReview.methods.statusLabel,
    async load() {
      const version = ++this.loadVersion
      this.loading = true; this.error = ''; this.requests = []; this.summaries = {}; this.summaryErrors = {}
      try {
        const response = await fetch('/api/bookings/pending', { headers: authHeaders() })
        if (version !== this.loadVersion) return
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        const data = await response.json()
        if (!response.ok) throw new Error('Unable to load requests. Please retry.')
        if (version !== this.loadVersion) return
        this.requests = data; this.loading = false
        await Promise.all(data.map(async request => {
          try {
            const result = await fetch(`/api/bookings/${encodeURIComponent(request.id)}/review?summary=1`, { headers: authHeaders() })
            if (!result.ok) throw new Error('Summary unavailable')
            const summary = await result.json()
            if (version === this.loadVersion) this.summaries[request.id] = summary
          } catch {
            if (version === this.loadVersion) this.summaryErrors[request.id] = 'Attendance and availability unavailable. Open the review to retry.'
          }
        }))
      } catch { if (version === this.loadVersion) this.error = 'Unable to load requests. Please retry.' }
      finally { if (version === this.loadVersion) this.loading = false }
    }
  },
  mounted() { this.load() }
}
</script>
<style scoped>
.inbox-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:1.5rem 0; }
h1 { font-size:1.65rem; } .eyebrow { font-size:.75rem; letter-spacing:.1em; color:#64748b; font-weight:700; }
.inbox-item { margin-bottom:1rem; padding:1.4rem; } .inbox-content { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto; align-items:center; gap:1.5rem; }
h2 { font-size:1.15rem; margin-bottom:.3rem; } p { margin-bottom:.4rem; } .venue-name { color:#475569; } .inbox-status { font-size:.88rem; } .badge { margin-bottom:.6rem; }
@media(max-width:800px) { .inbox-heading { align-items:flex-start; flex-direction:column; } .inbox-content { grid-template-columns:1fr; gap:1rem; } }
</style>
