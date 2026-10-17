<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div>
        <p class="eyebrow mb-1">Coordinator workspace</p>
        <h1 class="h3">Change Requests</h1>
        <p class="text-muted mb-0">Review changes organisers have requested for your assigned events.</p>
      </div>
      <button class="btn btn-outline-primary" :disabled="loading" @click="load">Refresh</button>
    </div>

    <p v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</p>
    <div v-if="loadError" class="alert alert-danger">{{ loadError }}</div>
    <div v-else-if="!loading && !requests.length" class="empty-state text-center">No change requests are waiting for your review.</div>

    <article v-for="request in requests" :key="request.id" class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3 mb-2">
          <h2 class="h5 mb-0">{{ request.event_title }}</h2>
          <span class="badge bg-warning text-dark align-self-start">Pending Review</span>
        </div>
        <p class="small text-muted mb-2">Requested {{ formatDateTime(request.created_at) }}</p>

        <table class="table table-sm align-middle mb-3">
          <thead><tr><th scope="col">Detail</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
          <tbody>
            <tr v-for="change in changes(request)" :key="change.label">
              <th scope="row">{{ change.label }}</th>
              <td class="text-muted">{{ change.current }}</td>
              <td class="fw-semibold">{{ change.proposed }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="decisionError && pendingDecision && pendingDecision.id === request.id" class="alert alert-danger py-2" role="alert">{{ decisionError }}</div>

        <div class="d-flex flex-wrap gap-2">
          <button v-if="pendingDecision && pendingDecision.id === request.id && decisionError" class="btn btn-primary btn-sm" :disabled="busyId === request.id" @click="retry">
            Retry {{ pendingDecision.decision === 'approved' ? 'approve' : 'reject' }}
          </button>
          <button class="btn btn-success btn-sm" :disabled="busyId === request.id" @click="decide(request, 'approved')">Approve</button>
          <button class="btn btn-outline-danger btn-sm" :disabled="busyId === request.id" @click="decide(request, 'rejected')">Reject</button>
        </div>
      </div>
    </article>
  </div>
</template>

<script>
import { fetchPendingChangeRequests, decideChangeRequest } from '../services/changeRequests'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000

export default {
  name: 'ChangeRequestReviewView',
  data() {
    return {
      requests: [],
      loading: false,
      loadError: '',
      successMessage: '',
      decisionError: '',
      pendingDecision: null, // AC-032-007: kept after a failed save so the same decision can be retried
      busyId: ''
    }
  },
  methods: {
    async load() {
      this.loading = true
      this.loadError = ''
      try {
        this.requests = await fetchPendingChangeRequests()
      } catch (error) {
        this.loadError = error.message || 'Unable to load change requests. Please retry.'
      } finally {
        this.loading = false
      }
    },

    // AC-032-002: approve or reject one request.
    async decide(request, decision) {
      if (this.busyId) return
      this.busyId = request.id
      this.decisionError = ''
      this.successMessage = ''
      this.pendingDecision = { id: request.id, decision }
      try {
        const result = await decideChangeRequest(request.id, decision)
        this.requests = this.requests.filter((item) => item.id !== request.id)
        this.pendingDecision = null
        this.successMessage = this.outcomeMessage(request, decision, result)
      } catch (error) {
        // AC-032-007: no success is shown, and the request and chosen decision stay on screen.
        this.decisionError = error.message || 'Unable to save your decision. Please retry.'
      } finally {
        this.busyId = ''
      }
    },

    async retry() {
      if (!this.pendingDecision) return
      const request = this.requests.find((item) => item.id === this.pendingDecision.id)
      if (request) await this.decide(request, this.pendingDecision.decision)
    },

    outcomeMessage(request, decision, result) {
      const title = request.event_title
      if (decision === 'rejected') return `Change request for ${title} rejected. The event is unchanged.`
      // AC-032-005: name the existing arrangements the coordinator now needs to reconsider.
      const reconsider = (result && result.reconsider) || {}
      const items = [
        ...(reconsider.bookings || []).map((b) => `${b.venue_name || 'Venue'} booking (${this.formatRange(b.start_time, b.end_time)})`),
        ...(reconsider.equipment || []).map((r) => `${r.quantity} × ${r.equipment_name || 'equipment'}`)
      ]
      return items.length
        ? `Change request for ${title} approved. Reconsider these existing arrangements: ${items.join(', ')}.`
        : `Change request for ${title} approved. No existing arrangements are affected.`
    },

    // AC-032-001: one row per proposed change, showing the current value beside it.
    changes(request) {
      const proposed = request.proposed_changes || {}
      const current = request.current || {}
      const rows = []
      if (proposed.preferredStart !== undefined || proposed.preferredEnd !== undefined) {
        rows.push({
          label: 'Date & time',
          current: this.formatRange(current.preferredStart, current.preferredEnd),
          proposed: this.formatRange(proposed.preferredStart, proposed.preferredEnd)
        })
      }
      if (proposed.expectedAttendance !== undefined) {
        rows.push({ label: 'Expected attendance', current: this.show(current.expectedAttendance), proposed: this.show(proposed.expectedAttendance) })
      }
      if (proposed.venueLayoutPreference !== undefined) {
        rows.push({ label: 'Venue requirements', current: this.show(current.venueLayoutPreference), proposed: this.show(proposed.venueLayoutPreference) })
      }
      if (proposed.equipmentRequirements !== undefined) {
        rows.push({ label: 'Equipment requirements', current: this.show(current.equipmentRequirements), proposed: this.show(proposed.equipmentRequirements) })
      }
      return rows
    },

    show(value) {
      if (Array.isArray(value)) return value.length ? value.join(', ') : 'None'
      return value === null || value === undefined || value === '' ? 'Not specified' : String(value)
    },

    // Singapore time, e.g. "1 Mar 2099, 9:00 AM".
    sgtParts(value) {
      const d = new Date(new Date(value).getTime() + SGT_OFFSET_MS)
      const hours = d.getUTCHours()
      const minutes = String(d.getUTCMinutes()).padStart(2, '0')
      return {
        date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        time: `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
      }
    },
    formatDateTime(value) {
      if (!value) return 'Not specified'
      const { date, time } = this.sgtParts(value)
      return `${date}, ${time}`
    },
    formatRange(start, end) {
      if (!start || !end) return 'Not specified'
      const from = this.sgtParts(start)
      const to = this.sgtParts(end)
      return from.date === to.date
        ? `${from.date}, ${from.time} – ${to.time}`
        : `${from.date}, ${from.time} – ${to.date}, ${to.time}`
    }
  },
  mounted() {
    this.load()
  }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
