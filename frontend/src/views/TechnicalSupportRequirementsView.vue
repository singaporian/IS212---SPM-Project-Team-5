<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div>
        <p class="eyebrow mb-1">Technical support workspace</p>
        <h1 class="h3 mb-1">Technical support requirements</h1>
        <p class="text-muted mb-0">Review requested equipment and staff resources, including current availability.</p>
      </div>
      <button class="btn btn-outline-primary" @click="load">Refresh</button>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!requirements.length" class="empty-state text-center">No technical support requirements have been submitted yet.</div>
    <article v-for="item in requirements" :key="item.id" class="card mb-3" :class="{ 'queue-flag': item.status === 'changes_requested' || item.re_review_safety_check }">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3">
          <div>
            <h2 class="h5 mb-1">{{ item.event_title }}</h2>
            <p class="small text-muted mb-2">Last updated {{ formatDate(item.updated_at) }}</p>
          </div>
          <div class="d-flex flex-wrap justify-content-end gap-2">
            <span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
            <span v-if="item.re_review_safety_check" class="badge bg-warning text-dark">Re-review – Safety Check</span>
            <span v-if="item.updated" class="badge bg-info text-dark">Updated</span>
            <span v-if="item.late_request" class="badge bg-warning text-dark">Late request</span>
          </div>
        </div>

        <div class="row small g-2">
          <div class="col-md-6"><strong>Date/Time:</strong> {{ eventTime(item) }}</div>
          <div class="col-md-6"><strong>Venue:</strong> {{ venueText(item) }}</div>
          <div class="col-md-6"><strong>Staff needed:</strong> {{ item.staff_required }}</div>
          <div class="col-md-6"><strong>Availability basis:</strong> {{ availabilityBasis(item.equipment_availability_window_basis) }}</div>
        </div>

        <div class="mt-3">
          <strong class="small">Requested equipment</strong>
          <ul class="small mb-0">
            <li v-for="equipment in item.equipment_requirements" :key="equipment.equipment_id || equipment.equipment_name">
              {{ equipmentLabel(equipment) }}: {{ equipment.quantity }}<span v-if="equipment.details"> — {{ equipment.details }}</span>
            </li>
            <li v-if="!item.equipment_requirements.length">No equipment specified</li>
          </ul>
        </div>

        <div class="mt-3" v-if="item.equipment_availability?.length">
          <strong class="small">Current availability for requested time</strong>
          <div class="table-responsive mt-2">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th class="text-end">Requested</th>
                  <th class="text-end">Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="availability in item.equipment_availability" :key="availability.key || availability.equipment_id || availability.equipment_name">
                  <td>{{ availability.equipment_name }}</td>
                  <td class="text-end">{{ availability.requested_quantity }}</td>
                  <td class="text-end">{{ availability.available_quantity }}</td>
                  <td>
                    <span class="badge" :class="availability.sufficient ? 'bg-success' : 'bg-danger'">
                      {{ availability.sufficient ? 'Sufficient' : 'Shortfall' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p v-if="item.support_required === false" class="small text-muted mt-3 mb-2">Coordinator declared that no technical support is required.</p>

        <div v-if="item.re_review_safety_check && item.safety_comments" class="alert alert-warning py-2 small mt-3 mb-0">
          <strong>Safety Officer comments:</strong> {{ item.safety_comments }}
        </div>

        <div class="mt-3">
          <textarea
            v-model="comments[item.event_id]"
            class="form-control mb-2"
            rows="2"
            placeholder="Optional note (required details if resources are insufficient)"
          ></textarea>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-success btn-sm" @click="decide(item, 'sufficient_resources_available', { redirectToReserve: true })">Sufficient Resources Available</button>
            <button class="btn btn-outline-danger btn-sm" @click="decide(item, 'insufficient_resources')">Insufficient Resources</button>
          </div>
        </div>
      </div>
    </article>

    <template v-if="safetyGateModal.visible">
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="safety-gate-title" @click.self="closeSafetyGateModal" @keydown.esc="closeSafetyGateModal">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 id="safety-gate-title" class="modal-title">Safety approval required</h5>
              <button class="btn-close" type="button" aria-label="Close" @click="closeSafetyGateModal"></button>
            </div>
            <div class="modal-body">
              <p class="mb-2">
                <strong>{{ safetyGateModal.eventTitle || 'This event' }}</strong> is marked as <strong>Re-review – Safety Check</strong>.
              </p>
              <p class="mb-0 text-muted">
                The Safety Officer has not yet approved the technical arrangements. Your “Sufficient Resources Available” decision can be saved, but you cannot proceed to reserve equipment yet.
              </p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary" type="button" @click="closeSafetyGateModal">Understood</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show"></div>
    </template>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'TechnicalSupportRequirementsView',
  data() {
    return {
      requirements: [],
      comments: {},
      error: '',
      safetyGateModal: { visible: false, eventTitle: '' }
    }
  },
  methods: {
    formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' },
    statusLabel(status) {
      const labels = {
        pending: 'Pending Review',
        confirmed: 'Sufficient Resources Available',
        changes_requested: 'Insufficient Resources'
      }
      return labels[status] || 'Pending Review'
    },
    statusClass(status) {
      return {
        'bg-warning text-dark': status === 'pending',
        'bg-success': status === 'confirmed',
        'bg-danger': status === 'changes_requested'
      }
    },
    eventTime(item) {
      if (!item.preferred_start && !item.preferred_end) return 'Event time not specified'
      return `${this.formatDate(item.preferred_start)} to ${this.formatDate(item.preferred_end)}`
    },
    equipmentLabel(item) {
      return item.equipment_name || item.type || item.equipment_type || 'Unknown equipment'
    },
    venueText(item) {
      if (!item.venues?.length) return 'Venue not specified'
      return item.venues.join(', ')
    },
    availabilityBasis(basis) {
      if (basis === 'bookings') return 'Approved/confirmed venue bookings'
      if (basis === 'event_preferred_time') return 'Event preferred time'
      return 'No event schedule recorded yet'
    },
    async load() {
      this.error = ''
      const response = await fetch('/api/technical-support/requirements', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load requirements'; return }
      this.requirements = data
    },
    shouldBlockSufficientDecision(item) {
      return Array.isArray(item?.safety_change_scope) &&
        item.safety_change_scope.includes('technical') &&
        item?.safety_status !== 'approved'
    },
    openSafetyGateModal(item) {
      this.safetyGateModal = { visible: true, eventTitle: item?.event_title || '' }
    },
    closeSafetyGateModal() {
      this.safetyGateModal = { visible: false, eventTitle: '' }
    },
    async decide(item, decision, options = {}) {
      const { redirectToReserve = false } = options
      const blockReserveRedirect = redirectToReserve && this.shouldBlockSufficientDecision(item)
      const response = await fetch(`/api/events/${item.event_id}/technical-support/decision`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comments: this.comments[item.event_id] || '' }) })
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to save technical support decision'; return }
      await this.load()
      if (redirectToReserve) {
        const latest = this.requirements.find((entry) => entry.event_id === item.event_id) || item
        if (blockReserveRedirect || this.shouldBlockSufficientDecision(latest)) {
          this.openSafetyGateModal(latest)
          return
        }
        this.$router.push({ name: 'reserve-equipment', query: { eventId: item.event_id } })
      }
    }
  },
  mounted() { this.load() }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
.queue-flag { border-left: 4px solid #dc3545; }
</style>
