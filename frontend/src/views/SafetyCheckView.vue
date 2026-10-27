<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div><p class="eyebrow mb-1">Safety Officer workspace</p><h1 class="h3 mb-1">Operational Safety Checks</h1><p class="text-muted mb-0">Review confirmed venue and technical arrangements before preparation begins.</p></div>
      <div class="d-flex gap-2"><button class="btn btn-sm" :class="historyMode ? 'btn-outline-secondary' : 'btn-primary'" @click="load('active')">Pending Checks</button><button class="btn btn-sm" :class="historyMode ? 'btn-primary' : 'btn-outline-secondary'" @click="load('history')">Completed Safety Reviews</button><button class="btn btn-outline-primary" @click="load(historyMode ? 'history' : 'active')">Refresh</button></div>
    </div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!checks.length" class="empty-state text-center">{{ historyMode ? 'No completed Safety Reviews recorded yet.' : 'No events are ready for an Operational Safety Check.' }}</div>

    <article v-for="check in checks" :key="check.id" class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3">
          <div><h2 class="h5 mb-1">{{ check.title }}</h2><p class="small text-muted mb-1">Expected attendance: <strong>{{ check.expected_attendance ?? 'Not recorded' }}</strong></p><p class="small text-muted mb-0">Event time: {{ formatDate(check.preferred_start) }} to {{ formatDate(check.preferred_end) }}</p></div>
          <span class="badge" :class="statusClass(check.safety_status)">{{ check.safety_status || 'Pending' }}</span>
        </div>
        <div v-if="historyMode" class="review-outcome"><strong>Decision:</strong> {{ check.safety_status }} <span>on {{ formatDate(check.decided_at) }} by {{ check.safety_decided_by || 'Safety Officer' }}</span><br><strong>Change scope:</strong> {{ check.safety_change_scope?.length ? check.safety_change_scope.join(' and ') : 'None' }}<br><strong>Comments:</strong> {{ check.comments || 'None' }}</div>

        <section class="review-section">
          <h3 class="h6">Event safety context</h3>
          <dl class="review-grid"><dt>Layout preference</dt><dd>{{ check.venue_layout_preference || 'Not specified' }}</dd><dt>Accessibility requirements</dt><dd>{{ describe(check.accessibility_requirements) }}</dd><dt>Equipment placement/requirements</dt><dd>{{ describe(check.equipment_requirements) }}</dd><dt>Emergency access / crowd movement notes</dt><dd>{{ check.special_arrangements || 'Not recorded' }}</dd><dt>Programme</dt><dd>{{ check.programme || 'Not recorded' }}</dd></dl>
        </section>

        <section class="review-section">
          <h3 class="h6">Technical arrangements</h3>
          <dl class="review-grid"><dt>Technical status</dt><dd><span class="badge" :class="check.technical_status === 'confirmed' ? 'bg-success' : 'bg-warning text-dark'">{{ check.technical_status }}</span></dd><dt>Support required</dt><dd>{{ check.technical_support_required ? 'Yes' : 'No technical support required' }}</dd><dt>Staff required</dt><dd>{{ check.technical_staff_required ?? 0 }}</dd><dt>Equipment</dt><dd>{{ formatTechnicalEquipment(check.technical_equipment_requirements) }}</dd><dt>Technical comments</dt><dd>{{ check.technical_decision_comments || 'None' }}</dd></dl>
        </section>

        <section class="review-section">
          <h3 class="h6">Venue arrangements</h3>
          <article v-for="booking in check.bookings" :key="booking.id" class="venue-review">
            <div class="d-flex justify-content-between"><strong>{{ booking.venue_name }}</strong><span class="badge bg-success">{{ booking.status }}</span></div>
            <dl class="review-grid small mt-2"><dt>Capacity</dt><dd>{{ booking.capacity }} seats; expected {{ check.expected_attendance ?? 'not recorded' }}</dd><dt>Booking time</dt><dd>{{ formatDate(booking.start_time) }} to {{ formatDate(booking.end_time) }}</dd><dt>Setup / turnaround</dt><dd>{{ booking.setup_minutes ?? 0 }} / {{ booking.turnaround_minutes ?? 0 }} minutes</dd><dt>Venue requirements</dt><dd>{{ describe(booking.venue_requirements) }}</dd><dt>Facilities</dt><dd>{{ describe(booking.facilities) }}</dd><dt>Venue accessibility</dt><dd>{{ describe(booking.accessibility) }}</dd><dt>Supported layouts</dt><dd>{{ describe(booking.supported_layouts) }}</dd><dt>Restrictions / notes</dt><dd>{{ booking.venue_notes || 'None recorded' }}</dd><dt>Operating hours</dt><dd>{{ formatHours(booking.operating_hours) }}</dd></dl>
            <div v-if="booking.unavailability?.length" class="alert alert-danger py-2 small mb-0"><strong>Unavailability warning:</strong> {{ booking.unavailability.map(period => `${period.reason || 'Unavailable'} (${formatDate(period.start_time)} to ${formatDate(period.end_time)})`).join('; ') }}</div>
          </article>
        </section>

        <section v-if="!historyMode" class="decision-section">
          <h3 class="h6">Safety decision</h3>
          <div class="change-scope mb-2"><div class="small fw-semibold mb-1">Changes required if requesting changes</div><label class="form-check form-check-inline"><input class="form-check-input" type="checkbox" :checked="isScopeSelected(check.id, 'venue')" @change="toggleScope(check.id, 'venue', $event)"><span class="form-check-label">Venue arrangements</span></label><label class="form-check form-check-inline"><input class="form-check-input" type="checkbox" :checked="isScopeSelected(check.id, 'technical')" @change="toggleScope(check.id, 'technical', $event)"><span class="form-check-label">Technical arrangements</span></label></div>
          <textarea v-model="comments[check.id]" class="form-control mb-2" rows="2" placeholder="Comments or required changes"></textarea>
          <div class="d-flex gap-2"><button class="btn btn-success btn-sm" @click="decide(check, 'approved')">Approve</button><button class="btn btn-outline-danger btn-sm" @click="decide(check, 'rejected')">Reject</button><button class="btn btn-outline-warning btn-sm" @click="decide(check, 'changes_requested')">Request Changes</button></div>
        </section>
      </div>
    </article>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'SafetyCheckView',
  data() { return { checks: [], comments: {}, changeScopes: {}, historyMode: false, error: '' } },
  methods: {
    formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' },
    describe(value) {
      if (value == null || value === '') return 'Not recorded'
      if (Array.isArray(value)) return value.length ? value.map(item => typeof item === 'string' ? item : `${item.type || 'Item'}${item.quantity ? ` x${item.quantity}` : ''}`).join(', ') : 'Not specified'
      if (typeof value === 'object') return Object.keys(value).length ? Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${this.describe(item)}`).join('; ') : 'Not specified'
      return String(value)
    },
    formatTechnicalEquipment(items) {
      if (!Array.isArray(items) || !items.length) return 'Not specified'
      return items.map((item) => {
        if (typeof item === 'string') return item
        const name = item.equipment_name || item.name || item.type || item.equipment_type || 'Item'
        return item.quantity ? `${name} x${item.quantity}` : name
      }).join(', ')
    },
    formatHours(hours) { if (!hours?.length) return 'Not recorded'; return hours.map(hour => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][hour.day_of_week]} ${hour.opens_at}–${hour.closes_at}`).join(', ') },
    isScopeSelected(eventId, scope) { return (this.changeScopes[eventId] || []).includes(scope) },
    toggleScope(eventId, scope, event) { const selected = new Set(this.changeScopes[eventId] || []); if (event.target.checked) selected.add(scope); else selected.delete(scope); this.changeScopes[eventId] = [...selected] },
    statusClass(status) { return { 'bg-warning text-dark': !status || status === 'pending', 'bg-success': status === 'approved', 'bg-danger': status === 'rejected', 'bg-info text-dark': status === 'changes_requested' } },
    async load(view = this.historyMode ? 'history' : 'active') {
      this.error = ''
      this.historyMode = view === 'history'
      const response = await fetch(`/api/safety/checks${this.historyMode ? '?view=history' : ''}`, { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load safety checks'; return }
      this.checks = data
    },
    async decide(check, decision) {
      const scopes = this.changeScopes[check.id] || []
      if (decision === 'changes_requested' && !scopes.length) { this.error = 'Select Venue arrangements, Technical arrangements, or both before requesting changes.'; return }
      const response = await fetch(`/api/safety/checks/${check.id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, changeScope: scopes, comments: this.comments[check.id] || '' }) })
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to save safety decision'; return }
      await this.load()
    }
  },
  mounted() { this.load(this.$route.query.view === 'history' ? 'history' : 'active') }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
.review-section, .decision-section { border: 1px solid #e5eaf1; border-radius: .75rem; margin-top: 1rem; padding: 1rem; background: #fbfcff }
.review-outcome { margin-top: .85rem; padding: .75rem 1rem; border-radius: .6rem; background: #f1f5f9; color: #475569; line-height: 1.7 }
.review-section h3, .decision-section h3 { display: flex; align-items: center; gap: .5rem; margin-bottom: .85rem; color: #1e293b }
.review-section h3::before, .decision-section h3::before { content: ''; width: .45rem; height: 1.1rem; border-radius: .2rem; background: #2f6fed }
.review-grid { display: grid; grid-template-columns: minmax(190px, 32%) minmax(0, 1fr); gap: 0; margin-bottom: 0 }
.review-grid dt, .review-grid dd { padding: .55rem .65rem; border-top: 1px solid #edf1f5 }
.review-grid dt { font-weight: 600; color: #475569 }
.review-grid dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #1e293b }
.venue-review { border: 1px solid #dbe4ef; border-radius: .6rem; padding: .85rem; margin-top: .75rem; background: #fff; box-shadow: 0 2px 8px rgba(30, 41, 59, .04) }
@media (max-width: 600px) { .review-grid { grid-template-columns: 1fr } .review-grid dd { padding-top: 0; border-top: 0; margin-bottom: .4rem } }
</style>
