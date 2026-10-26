<template>
  <main>
    <nav class="small mb-3" aria-label="Breadcrumb"><router-link :to="$route.query?.from === 'reviewed' ? '/bookings/reviewed' : '/bookings/pending'">Back to requests</router-link><span v-if="review"> / {{ review.request.event_title }}</span></nav>
    <header class="case-header">
      <p class="eyebrow">VENUE REQUEST REVIEW</p>
      <h1>{{ review?.request.event_title || 'Review venue booking request' }}</h1>
      <template v-if="review"><p>{{ review.venue.name }} <span class="badge bg-light text-dark">{{ statusLabel(review.request.status) }}</span></p><p class="small text-muted">Coordinator: {{ review.request.coordinator_name || 'Not recorded' }}<span v-if="review.request.coordinator_email"> ({{ review.request.coordinator_email }})</span></p><p v-if="review.request.created_at" class="small text-muted">Submitted {{ formatDate(review.request.created_at) }}</p></template>
      <p v-if="review?.request.decided_at" class="small">Decision by: {{ review.request.decision_author || 'Not recorded' }}<br>Decision timestamp: {{ formatDate(review.request.decided_at) }}</p>
      <router-link v-if="review && review.request.status !== 'pending'" to="/bookings/reviewed">View reviewed requests</router-link>
    </header>
    <div class="case-layout">
      <div class="card review-card"><BookingReview :key="String($route.params.id)" :booking-id="String($route.params.id)" full-page :review-override="latestReview" :disabled="saving" @loading="onLoading" @loaded="onLoaded" /></div>
      <aside class="card decision-card" aria-label="Decision">
        <h2>Decision</h2>
        <p v-if="!review">Load the review information before deciding.</p>
        <template v-else>
          <p>Current status: <strong>{{ statusLabel(review.request.status) }}</strong></p>
          <p v-if="success" class="alert alert-success" role="status">{{ success }}</p>
          <template v-if="review.request.status === 'pending'">
            <div v-if="!decision" class="decision-actions"><button class="btn btn-success" @click="openDecision('approved')">Approve Request</button><button class="btn btn-outline-danger" @click="openDecision('rejected')">Reject Request</button><button class="btn btn-outline-primary" @click="openDecision('alternative_suggested')">Suggest Alternative</button></div>
            <form v-else @submit.prevent="submitDecision">
              <h3>{{ decisionTitle() }}</h3>
              <p><strong>{{ review.request.event_title }}</strong><br>{{ review.venue.name }}<br>{{ formatRange(review.request.start_time, review.request.end_time) }}</p>
              <p class="small">{{ review.conflicts.some(c => c.type === 'booking') ? 'Warning: Reserved booking overlap' : 'No reserved booking conflict' }}<br>{{ review.conflicts.some(c => c.type === 'unavailability') ? 'Warning: Recorded venue unavailability' : 'No recorded unavailability conflict' }}<br>{{ review.conflicts.some(c => c.type === 'hold') ? 'Warning: Active tentative hold' : 'No active tentative hold conflict' }}</p>
              <fieldset :disabled="saving">
                <label v-if="decision === 'rejected'" class="form-label">Reason (optional)<select v-model="reason" class="form-select"><option disabled value="">Choose a reason</option><option>Capacity Exceeded</option><option>Maintenance Conflict</option><option>Booking Conflict</option><option>Other</option></select></label>
                <template v-if="decision === 'alternative_suggested'"><label class="form-label">Alternative start (Singapore time) *<input v-model="alternativeStartTime" type="datetime-local" step="60" class="form-control" required></label><label class="form-label">Alternative end (Singapore time) *<input v-model="alternativeEndTime" type="datetime-local" step="60" class="form-control" required></label></template>
                <label class="form-label">Additional comments<textarea v-model="comment" class="form-control" rows="3"></textarea></label>
                <p v-if="decisionError" class="alert alert-danger" role="alert">{{ decisionError }}</p>
                <div class="decision-actions"><button type="submit" class="btn btn-primary">{{ saving ? 'Saving...' : confirmationLabel() }}</button><button type="button" class="btn btn-outline-secondary" @click="decision = ''">Cancel</button></div>
              </fieldset>
            </form>
          </template>
          <p v-else-if="!success" class="text-muted">This request is no longer pending review.</p>
        </template>
      </aside>
    </div>
  </main>
</template>
<script>
import BookingReview from '../components/BookingReview.vue'
import { authHeaders } from '../services/auth'
export default {
  name: 'VenueBookingReviewView',
  components: { BookingReview },
  data() { return { review: null, latestReview: null, decision: '', reason: '', comment: '', alternativeStartTime: '', alternativeEndTime: '', decisionError: '', saving: false, success: '' } },
  watch: { '$route.params.id'() { this.review = null; this.latestReview = null; this.decision = ''; this.success = ''; this.decisionError = ''; this.saving = false } },
  methods: {
    formatRange: BookingReview.methods.formatRange,
    formatDate: BookingReview.methods.formatDate,
    statusLabel: BookingReview.methods.statusLabel,
    onLoading() { this.review = null; this.latestReview = null; this.decision = '' },
    onLoaded(data) { this.review = data },
    openDecision(decision) { this.decision = decision; this.reason = ''; this.comment = ''; this.alternativeStartTime = ''; this.alternativeEndTime = ''; this.decisionError = '' },
    decisionTitle() { return { approved: 'Approve Venue Request', rejected: 'Reject Venue Request', alternative_suggested: 'Suggest Alternative' }[this.decision] },
    confirmationLabel() { return { approved: 'Confirm Approval', rejected: 'Confirm Rejection', alternative_suggested: 'Confirm Alternative' }[this.decision] },
    async submitDecision() {
      if (this.saving || !this.review || this.review.request.status !== 'pending' || !this.decision) return
      if (this.decision === 'alternative_suggested' && (!this.alternativeStartTime || !this.alternativeEndTime)) { this.decisionError = 'Enter an alternative start and end.'; return }
      const id = String(this.$route.params.id)
      this.saving = true; this.decisionError = ''
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(id)}/decision`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: this.decision, reason: this.reason, comment: this.comment, alternativeStartTime: this.alternativeStartTime ? this.alternativeStartTime + '+08:00' : null, alternativeEndTime: this.alternativeEndTime ? this.alternativeEndTime + '+08:00' : null }) })
        const data = await response.json()
        if (String(this.$route.params.id) !== id) return
        if (response.status === 409 && data.review) {
          this.review = data.review; this.latestReview = data.review
          this.decisionError = data.error
          return
        }
        if (!response.ok) { this.decisionError = data.error || 'Unable to save decision. Please retry.'; return }
        if (String(this.$route.params.id) !== id) return
        Object.assign(this.review.request, data)
        this.latestReview = this.review
        try {
        const refreshed = await fetch(`/api/bookings/${encodeURIComponent(id)}/review`, { headers: authHeaders() })
        if (refreshed.ok) { const details = await refreshed.json(); if (String(this.$route.params.id) === id) { this.review = details; this.latestReview = details } }
        } catch { /* Decision already saved; detail can be refreshed separately. */ }
        if (String(this.$route.params.id) !== id) return
        this.decision = ''; this.success = 'Decision saved successfully.'
      } catch (error) {
        if (String(this.$route.params.id) === id) this.decisionError = 'Unable to save decision. Please retry. Your entries have been kept.'
      } finally { if (String(this.$route.params.id) === id) this.saving = false }
    }
  }
}
</script>
<style scoped>
.case-header { margin-bottom:1.5rem; } h1 { font-size:1.8rem; } .eyebrow { font-size:.75rem; letter-spacing:.1em; color:#64748b; font-weight:700; }
.case-layout { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:1.5rem; align-items:start; }
.review-card, .decision-card { padding:1.5rem; } .decision-card { position:sticky; top:1rem; } .decision-card h2 { font-size:1.25rem; } .decision-card h3 { font-size:1.05rem; }
.decision-actions { display:flex; flex-direction:column; gap:.65rem; } .form-label { display:block; width:100%; } fieldset { min-width:0; }
@media(max-width:900px) { .case-layout { grid-template-columns:1fr; } .decision-card { position:static; } }
</style>
