<template>
  <main class="venue-inbox">
    <router-link to="/" class="small">Back to Dashboard</router-link>
    <header class="inbox-heading">
      <div><p class="eyebrow">VENUE WORKSPACE</p><h1>{{ $route.path === '/bookings/reviewed' ? 'Reviewed venue booking requests' : 'Pending venue booking requests' }}</h1><p class="text-muted">Review the requested arrangement before making a decision. Times are in Singapore time.</p></div>
      <button class="btn btn-outline-primary" :disabled="loading" @click="load">Refresh inbox</button>
    </header>
    <nav class="request-tabs" aria-label="Request status"><router-link to="/bookings/pending" :aria-current="$route.path === '/bookings/pending' ? 'page' : undefined">Pending</router-link><router-link to="/bookings/reviewed" :aria-current="$route.path === '/bookings/reviewed' ? 'page' : undefined">Reviewed</router-link></nav>
    <p v-if="loading" role="status">Loading requests...</p>
    <div v-else-if="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-link" @click="load">Retry</button></div>
    <p v-else-if="!requests.length" class="empty-state">No requests in this view.</p>
    <article v-for="request in requests" :key="request.id" class="card inbox-item" :aria-labelledby="'request-title-' + request.id">
      <div class="inbox-card-heading">
        <h2 :id="'request-title-' + request.id">{{ request.event_title }}</h2>
        <span class="workflow-status" :class="workflowStatusClass(summaries[request.id]?.status || request.status)"><span class="workflow-label">Status:</span> {{ statusLabel(summaries[request.id]?.status || request.status) }}</span>
      </div>
      <div class="inbox-content">
        <div class="request-details"><p class="venue-name">{{ request.venue_name }}</p><p class="requested-slot">{{ formatRange(request.start_time, request.end_time) }}</p><p class="coordinator-name">Coordinator: {{ request.coordinator_name || 'Not recorded' }}</p><p v-if="summaries[request.id]" class="attendance">Attendance: {{ summaries[request.id].expected_attendance ?? 'Not recorded' }}</p></div>
        <section class="inbox-status" :aria-label="'Availability for ' + request.event_title">
          <p class="section-label">Availability checks</p>
          <template v-if="summaries[request.id]">
            <ul class="availability-notices">
              <li v-if="summaries[request.id].reserved_conflicts" class="availability-notice notice-reserved"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Warning: Reserved booking conflict</strong><span>{{ summaries[request.id].reserved_conflicts }} approved / confirmed booking{{ summaries[request.id].reserved_conflicts === 1 ? ' overlaps' : 's overlap' }} the occupied slot.</span></div></li>
              <li v-if="summaries[request.id].hold_conflicts" class="availability-notice notice-hold"><span class="notice-icon" aria-hidden="true">◷</span><div><strong>Warning: Active tentative hold conflict</strong><span>{{ summaries[request.id].hold_conflicts }} active hold{{ summaries[request.id].hold_conflicts === 1 ? ' affects' : 's affect' }} the occupied slot.</span></div></li>
              <li v-if="summaries[request.id].unavailable_conflicts" class="availability-notice notice-unavailable"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Warning: Recorded venue unavailability</strong><span>{{ summaries[request.id].unavailable_conflicts }} maintenance / unavailable period{{ summaries[request.id].unavailable_conflicts === 1 ? ' affects' : 's affect' }} the occupied slot.</span></div></li>
              <li v-if="!summaries[request.id].reserved_conflicts && !summaries[request.id].hold_conflicts && !summaries[request.id].unavailable_conflicts" class="availability-notice notice-clear"><span class="notice-icon" aria-hidden="true">✓</span><div><strong>No conflicts identified</strong><span>No reserved booking, active hold or recorded unavailability conflict.</span></div></li>
            </ul>
          </template>
          <p v-else role="status" class="summary-message" :class="{ 'summary-unavailable': summaryErrors[request.id] }">{{ summaryErrors[request.id] || 'Loading attendance and availability...' }}</p>
        </section>
        <router-link class="btn btn-primary review-action" :to="{ name: 'venue-booking-review', params: { id: request.id }, query: { from: $route.path === '/bookings/reviewed' ? 'reviewed' : 'pending' } }">Review Request <span aria-hidden="true">→</span></router-link>
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
    workflowStatusClass(status) {
      return ({ pending: 'status-pending', approved: 'status-approved', confirmed: 'status-approved', rejected: 'status-rejected', alternative_suggested: 'status-alternative' })[status] || 'status-unknown'
    },
    async load() {
      const version = ++this.loadVersion
      this.loading = true; this.error = ''; this.requests = []; this.summaries = {}; this.summaryErrors = {}
      try {
        const response = await fetch(this.$route.path === '/bookings/reviewed' ? '/api/bookings/reviewed' : '/api/bookings/pending', { headers: authHeaders() })
        if (version !== this.loadVersion) return
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        const data = await response.json()
        if (!response.ok) throw new Error('Unable to load requests. Please retry.')
        if (version !== this.loadVersion) return
        const eventId = this.$route.query.eventId
        const eventRequests = eventId ? data.filter(request => request.event_id === eventId) : data
        if (eventId && eventRequests.length === 1) {
          this.$router.replace({ name: 'venue-booking-review', params: { id: eventRequests[0].id } })
          return
        }
        this.requests = eventRequests; this.loading = false
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
  watch: { '$route.path'() { this.load() } },
  mounted() { this.load() }
}
</script>
<style scoped>
.inbox-heading { display:flex; align-items:center; justify-content:space-between; gap:1.5rem; margin:1.5rem 0; }
h1 { font-size:1.75rem; font-weight:700; } .eyebrow { font-size:.75rem; letter-spacing:.1em; color:#64748b; font-weight:700; }
.request-tabs { display:flex; gap:.5rem; border-bottom:1px solid #dce3ed; margin-bottom:1.5rem; padding-bottom:.75rem; }
.request-tabs a { padding:.5rem 1rem; border-radius:.5rem; text-decoration:none; font-weight:600; color:#334155; }
.request-tabs a[aria-current="page"] { background:#eaf0ff; color:#2544a8; }
.inbox-item { margin-bottom:1.25rem; padding:1.5rem; border:1px solid #dce3ed; border-radius:.75rem; box-shadow:0 3px 12px rgba(25,35,60,.04); }
.inbox-card-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; padding-bottom:1rem; margin-bottom:1.1rem; border-bottom:1px solid #edf0f5; }
h2 { font-size:1.2rem; font-weight:700; line-height:1.4; margin:0; overflow-wrap:anywhere; } p { margin-bottom:.5rem; }
.workflow-status { display:inline-flex; flex-wrap:wrap; align-items:center; gap:.3rem; flex-shrink:0; max-width:100%; padding:.35rem .7rem; border:1px solid; border-radius:2rem; font-size:.8rem; font-weight:700; line-height:1.5; }
.workflow-label { font-weight:500; }
.status-pending { background:#fff3cd; color:#664d03; border-color:#e6cc7a; }
.status-approved { background:#e7f4ec; color:#205735; border-color:#b1d1bd; }
.status-rejected { background:#fbe9eb; color:#9b1c31; border-color:#e7b7bf; }
.status-alternative { background:#eaf2ff; color:#174ea6; border-color:#b4caee; }
.status-unknown { background:#f1f5f9; color:#475569; border-color:#cbd5e1; }
.inbox-content { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) auto; align-items:center; gap:1.5rem; }
.request-details { min-width:0; overflow-wrap:anywhere; } .venue-name { color:#334155; font-size:1rem; font-weight:600; } .requested-slot { color:#1e293b; font-size:.95rem; line-height:1.6; }
.coordinator-name { color:#526071; font-size:.875rem; } .attendance { color:#334155; font-size:.9rem; margin-bottom:0; }
.section-label { color:#526071; font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:.5rem; }
.availability-notices { list-style:none; padding:0; margin:0; display:grid; gap:.55rem; }
.availability-notice { display:flex; align-items:flex-start; gap:.65rem; padding:.8rem .9rem; border:1px solid; border-left-width:4px; border-radius:.5rem; font-size:.875rem; line-height:1.5; overflow-wrap:anywhere; }
.availability-notice strong, .availability-notice div > span { display:block; } .availability-notice strong { font-weight:700; } .availability-notice div > span { margin-top:.15rem; font-size:.8rem; }
.notice-icon { display:inline-flex; align-items:center; justify-content:center; flex:0 0 1.35rem; width:1.35rem; height:1.35rem; border:1px solid currentColor; border-radius:50%; font-size:.9rem; font-weight:800; line-height:1; margin-top:.1rem; }
.notice-reserved { background:#fff0f1; color:#9b1c31; border-color:#e6aab4; }
.notice-hold { background:#fff8df; color:#735300; border-color:#d9ba58; }
.notice-unavailable { background:#fff0e5; color:#963b0a; border-color:#e4ae87; }
.notice-clear { background:#f0f8f3; color:#285b3d; border-color:#c1d8c9; }
.summary-message { padding:.8rem .9rem; border:1px solid #dce3ed; border-radius:.5rem; background:#f8fafc; color:#526071; font-size:.875rem; }
.summary-unavailable { border-style:dashed; font-weight:500; }
.review-action { display:inline-flex; justify-content:center; align-items:center; gap:.75rem; white-space:nowrap; padding:.7rem 1rem; font-weight:600; border-radius:.5rem; }
.request-tabs a:focus-visible, .review-action:focus-visible { outline:3px solid #2544a8; outline-offset:3px; }
@media(max-width:1000px) { .inbox-content { grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); } .review-action { grid-column:1 / -1; justify-self:end; } }
@media(max-width:640px) { .inbox-heading { align-items:flex-start; flex-direction:column; gap:.75rem; } h1 { font-size:1.45rem; } .inbox-item { padding:1.1rem; } .inbox-card-heading { flex-direction:column; gap:.75rem; } .inbox-content { grid-template-columns:1fr; gap:1rem; } .review-action { width:100%; } .availability-notice { padding:.75rem; } }
</style>
