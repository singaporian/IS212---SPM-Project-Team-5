<template>
  <div class="assign-coordinator-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Coordinator assignment</p>
        <h1 class="mb-1">Assign coordinators</h1>
        <p class="text-muted mb-0">Review incoming event requests, assign each to an Event Coordinator, and rebalance active work across the team.</p>
      </div>
      <router-link class="btn btn-outline-secondary" to="/">Back to Home</router-link>
    </div>

    <div ref="feedback">
      <div v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</div>
      <div v-if="conflictMessage" class="alert alert-warning" role="alert"><strong>Not changed.</strong> {{ conflictMessage }}</div>
      <div v-if="saveError" class="alert alert-danger" role="alert">{{ saveError }}</div>
    </div>

    <div v-if="loading && !loaded" class="text-muted">Loading assignments...</div>
    <div v-else-if="loadError && !loaded" class="d-flex align-items-center gap-2">
      <span class="text-danger">{{ loadError }}</span>
      <button class="btn btn-sm btn-outline-primary" type="button" @click="loadOverview">Retry</button>
    </div>

    <template v-else>
      <div v-if="loadError" class="alert alert-danger d-flex align-items-center justify-content-between gap-2" role="alert">
        <span>{{ loadError }} Showing the last loaded assignments.</span>
        <button class="btn btn-sm btn-outline-danger" type="button" @click="loadOverview">Retry</button>
      </div>

      <div class="card form-panel mb-4">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <h5 class="card-title mb-0">Unassigned queue <span class="badge bg-warning text-dark ms-1">{{ unassigned.length }}</span></h5>
            <button class="btn btn-sm btn-outline-primary" type="button" :disabled="loading" @click="loadOverview"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
          </div>
          <p class="text-muted small">Oldest first. Review a request's details, then choose a coordinator.</p>
          <p v-if="!unassigned.length" class="text-muted small mb-0">Every active event request has a coordinator.</p>
          <ul v-else class="list-unstyled mb-0">
            <li v-for="event in unassigned" :key="event.id" class="queue-item" :class="{ 'queue-item-open': reviewingId === event.id }">
              <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div>
                  <div class="fw-semibold">{{ event.title }}</div>
                  <div class="small text-muted">{{ event.event_type || 'Event type not specified' }} · Submitted {{ formatDate(event.submitted_at || event.created_at) }}</div>
                  <div class="small text-muted">{{ formatSchedule(event) }}</div>
                </div>
                <button class="btn btn-sm" :class="reviewingId === event.id ? 'btn-outline-secondary' : 'btn-accent'" type="button"
                  :aria-expanded="reviewingId === event.id" @click="toggleReview(event)">{{ reviewingId === event.id ? 'Close' : 'Review & assign' }}</button>
              </div>

              <div v-if="reviewingId === event.id" class="review-panel mt-3">
                <dl class="row small mb-3">
                  <dt class="col-sm-4">Organiser</dt><dd class="col-sm-8">{{ event.organiser_name || '—' }}<span v-if="event.organiser_email" class="text-muted"> ({{ event.organiser_email }})</span></dd>
                  <dt class="col-sm-4">Status</dt><dd class="col-sm-8">{{ statusLabel(event.status) }}</dd>
                  <dt class="col-sm-4">Event type</dt><dd class="col-sm-8">{{ event.event_type || '—' }}</dd>
                  <dt class="col-sm-4">Schedule</dt><dd class="col-sm-8">{{ formatSchedule(event) }}</dd>
                  <dt class="col-sm-4">Expected attendance</dt><dd class="col-sm-8">{{ event.expected_attendance ?? '—' }}</dd>
                  <dt class="col-sm-4">Purpose</dt><dd class="col-sm-8 pre-wrap">{{ event.purpose || '—' }}</dd>
                  <dt class="col-sm-4">Description</dt><dd class="col-sm-8 pre-wrap">{{ event.description || '—' }}</dd>
                </dl>
                <form class="row g-2 align-items-start" novalidate @submit.prevent="assign(event)">
                  <div class="col-md-8">
                    <label class="form-label small mb-1" :for="`assign-${event.id}`">Assign to</label>
                    <select :id="`assign-${event.id}`" v-model="assignTo" class="form-select" :class="{ 'is-invalid': showAssignError && !assignTo }" :disabled="saving">
                      <option value="">Select an Event Coordinator</option>
                      <option v-for="coordinator in coordinators" :key="coordinator.id" :value="coordinator.id">{{ coordinatorOption(coordinator) }}</option>
                    </select>
                    <div v-if="showAssignError && !assignTo" class="invalid-feedback">Choose an Event Coordinator.</div>
                  </div>
                  <div class="col-md-4">
                    <span class="form-label small mb-1 d-none d-md-block invisible" aria-hidden="true">Assign</span>
                    <button class="btn btn-accent w-100" type="submit" :disabled="saving || !coordinators.length">{{ saving ? 'Assigning...' : 'Assign' }}</button>
                  </div>
                </form>
                <p v-if="!coordinators.length" class="text-muted small mt-2 mb-0">There are no Event Coordinator accounts to assign to.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div class="card form-panel mb-4">
        <div class="card-body">
          <h5 class="card-title">Coordinator workload</h5>
          <p class="text-muted small">Active requests per coordinator. Select a coordinator to filter their assignments below.</p>
          <p v-if="!coordinators.length" class="text-muted small mb-0">There are no Event Coordinator accounts yet.</p>
          <div v-else class="workload-grid">
            <button v-for="coordinator in coordinators" :key="coordinator.id" type="button" class="workload-tile"
              :class="{ 'workload-tile-active': filterCoordinatorId === coordinator.id }" :aria-pressed="filterCoordinatorId === coordinator.id"
              @click="toggleFilter(coordinator.id)">
              <span class="workload-count">{{ coordinator.active_count }}</span>
              <span class="fw-semibold">{{ coordinator.name }}</span>
              <span class="small text-muted text-truncate">{{ coordinator.email }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="card form-panel">
        <div class="card-body">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <h5 class="card-title mb-0">Active assignments <span class="badge bg-primary ms-1">{{ filteredAssignments.length }}</span></h5>
            <div class="d-flex align-items-center gap-2">
              <label class="small text-muted text-nowrap" for="assignment-filter">Coordinator</label>
              <select id="assignment-filter" v-model="filterCoordinatorId" class="form-select form-select-sm">
                <option value="">All coordinators</option>
                <option v-for="coordinator in coordinators" :key="coordinator.id" :value="coordinator.id">{{ coordinator.name }}</option>
              </select>
            </div>
          </div>
          <p v-if="!filteredAssignments.length" class="text-muted small mb-0">{{ filterCoordinatorId ? 'This coordinator has no active requests.' : 'No event requests are assigned yet.' }}</p>
          <div v-else class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Event request</th>
                  <th scope="col">Status</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Coordinator</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="event in filteredAssignments" :key="event.id">
                  <td>
                    <div class="fw-semibold">{{ event.title }}</div>
                    <div class="small text-muted">{{ event.event_type || '—' }}</div>
                  </td>
                  <td><span class="badge" :class="statusClass(event.status)">{{ statusLabel(event.status) }}</span></td>
                  <td class="small">{{ formatSchedule(event) }}</td>
                  <td>{{ event.coordinator_name }}</td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary" type="button" :disabled="saving || coordinators.length < 2" @click="openReassign(event)">Reassign</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <template v-if="reassigning">
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="reassign-title" @click.self="cancelReassign" @keydown.esc="cancelReassign">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content" novalidate @submit.prevent="confirmReassign">
            <div class="modal-header">
              <h5 id="reassign-title" class="modal-title">Reassign event request</h5>
              <button class="btn-close" type="button" aria-label="Close" :disabled="saving" @click="cancelReassign"></button>
            </div>
            <div class="modal-body">
              <p class="fw-semibold mb-1">{{ reassigning.title }}</p>
              <p class="small text-muted mb-3">{{ statusLabel(reassigning.status) }} · {{ formatSchedule(reassigning) }}<span v-if="reassigning.organiser_name"> · Organiser: {{ reassigning.organiser_name }}</span></p>
              <p class="small mb-2">Currently assigned to <strong>{{ reassigning.coordinator_name }}</strong>.</p>
              <label class="form-label" for="reassign-to">Reassign to</label>
              <select id="reassign-to" ref="reassignSelect" v-model="reassignTo" class="form-select" :class="{ 'is-invalid': showReassignError && !reassignTo }" :disabled="saving">
                <option value="">Select an Event Coordinator</option>
                <option v-for="coordinator in reassignOptions" :key="coordinator.id" :value="coordinator.id">{{ coordinatorOption(coordinator) }}</option>
              </select>
              <div v-if="showReassignError && !reassignTo" class="invalid-feedback">Choose an Event Coordinator.</div>
              <p class="text-muted small mt-3 mb-0">Both coordinators will be notified. {{ reassigning.coordinator_name }} will no longer be able to manage this request.</p>
              <div v-if="reassignError" class="alert alert-danger small mt-3 mb-0" role="alert">{{ reassignError }}</div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="cancelReassign">Cancel</button>
              <button class="btn btn-accent" type="submit" :disabled="saving">{{ saving ? 'Reassigning...' : (reassignError ? 'Try again' : 'Reassign') }}</button>
            </div>
          </form>
        </div>
      </div>
      <div class="modal-backdrop fade show"></div>
    </template>
  </div>
</template>

<script>
import { getAssignmentOverview, assignCoordinator } from '../services/coordinatorAssignments'

const STATUS_LABELS = {
  submitted: 'Submitted',
  clarification_requested: 'Clarification requested',
  approved: 'Approved',
  planning: 'Planning',
  confirmed: 'Confirmed'
}

export default {
  name: 'AssignCoordinatorView',
  data() {
    return {
      unassigned: [],
      assignments: [],
      coordinators: [],
      loading: false,
      loaded: false,
      loadError: '',
      reviewingId: '',
      assignTo: '',
      showAssignError: false,
      filterCoordinatorId: '',
      reassigning: null,
      reassignTo: '',
      showReassignError: false,
      reassignError: '',
      saving: false,
      successMessage: '',
      conflictMessage: '',
      saveError: ''
    }
  },
  computed: {
    filteredAssignments() {
      if (!this.filterCoordinatorId) return this.assignments
      return this.assignments.filter(event => event.assigned_coordinator_id === this.filterCoordinatorId)
    },
    reassignOptions() {
      if (!this.reassigning) return []
      return this.coordinators.filter(coordinator => coordinator.id !== this.reassigning.assigned_coordinator_id)
    }
  },
  mounted() {
    this.loadOverview()
  },
  methods: {
    statusLabel(status) {
      return STATUS_LABELS[status] || (status ? status.replaceAll('_', ' ') : 'Unknown')
    },
    statusClass(status) {
      return {
        'bg-warning text-dark': status === 'submitted' || status === 'clarification_requested',
        'bg-success': status === 'approved' || status === 'planning' || status === 'confirmed'
      }
    },
    coordinatorOption(coordinator) {
      return `${coordinator.name} — ${coordinator.active_count} active request${coordinator.active_count === 1 ? '' : 's'}`
    },
    formatDate(value) {
      if (!value) return '—'
      return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    },
    formatSchedule(event) {
      if (!event.preferred_start) return 'Schedule not specified'
      const options = { timeZone: 'Asia/Singapore' }
      const start = new Date(event.preferred_start)
      const day = value => value.toLocaleDateString('en-GB', { ...options, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      const time = value => value.toLocaleTimeString('en-US', { ...options, hour: 'numeric', minute: '2-digit', hour12: true })
      if (!event.preferred_end) return `${day(start)}, ${time(start)}`
      const end = new Date(event.preferred_end)
      return day(start) === day(end)
        ? `${day(start)}, ${time(start)} – ${time(end)}`
        : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`
    },
    clearMessages() {
      this.successMessage = ''
      this.conflictMessage = ''
      this.saveError = ''
    },
    async loadOverview() {
      this.loading = true
      this.loadError = ''
      try {
        const data = await getAssignmentOverview()
        this.unassigned = data.unassigned
        this.assignments = data.assignments
        this.coordinators = data.coordinators
        this.loaded = true
        // Close a review panel or filter whose request or coordinator is gone.
        if (this.reviewingId && !this.unassigned.some(event => event.id === this.reviewingId)) this.closeReview()
        if (this.filterCoordinatorId && !this.coordinators.some(coordinator => coordinator.id === this.filterCoordinatorId)) this.filterCoordinatorId = ''
      } catch (error) {
        this.loadError = error.message || 'Unable to load coordinator assignments.'
      } finally {
        this.loading = false
      }
    },
    toggleReview(event) {
      if (this.reviewingId === event.id) return this.closeReview()
      this.clearMessages()
      this.reviewingId = event.id
      this.assignTo = ''
      this.showAssignError = false
    },
    closeReview() {
      this.reviewingId = ''
      this.assignTo = ''
      this.showAssignError = false
    },
    toggleFilter(coordinatorId) {
      this.filterCoordinatorId = this.filterCoordinatorId === coordinatorId ? '' : coordinatorId
    },
    async assign(event) {
      if (this.saving) return
      this.clearMessages()
      this.showAssignError = true
      if (!this.assignTo) return
      this.saving = true
      try {
        const result = await assignCoordinator(event.id, this.assignTo, null)
        this.successMessage = result.message || 'Coordinator assigned.'
        this.closeReview()
        await this.loadOverview()
      } catch (error) {
        if (error.status === 409) {
          this.conflictMessage = error.message
          await this.loadOverview()
        } else {
          this.saveError = (error.message || 'Unable to save the assignment.') + ' Your selection has been kept.'
        }
      } finally {
        this.saving = false
        this.scrollToFeedback()
      }
    },
    openReassign(event) {
      if (this.saving) return
      this.clearMessages()
      this.reassigning = event
      this.reassignTo = ''
      this.showReassignError = false
      this.reassignError = ''
      this.$nextTick(() => { if (this.$refs.reassignSelect) this.$refs.reassignSelect.focus() })
    },
    cancelReassign() {
      if (this.saving) return
      this.reassigning = null
      this.reassignTo = ''
      this.showReassignError = false
      this.reassignError = ''
    },
    async confirmReassign() {
      const event = this.reassigning
      if (!event || this.saving) return
      this.clearMessages()
      this.reassignError = ''
      this.showReassignError = true
      if (!this.reassignTo) return
      this.saving = true
      try {
        const result = await assignCoordinator(event.id, this.reassignTo, event.assigned_coordinator_id)
        this.reassigning = null
        this.successMessage = result.message || 'Coordinator reassigned.'
        await this.loadOverview()
      } catch (error) {
        if (error.status === 409 || error.status === 404) {
          this.reassigning = null
          this.conflictMessage = error.message
          await this.loadOverview()
        } else {
          // Keep the dialog open so the Lead can retry; the assignment is unchanged.
          this.reassignError = (error.message || 'Unable to save the assignment.') + ' The current assignment is unchanged.'
        }
      } finally {
        this.saving = false
        if (!this.reassigning) this.scrollToFeedback()
      }
    },
    scrollToFeedback() {
      this.$nextTick(() => {
        if (this.$refs.feedback && this.$refs.feedback.scrollIntoView) this.$refs.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }
}
</script>

<style scoped>
.form-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
.queue-item { border-bottom: 1px solid #eef0f4; padding: .75rem .5rem; border-radius: .5rem }
.queue-item:last-child { border-bottom: 0 }
.queue-item-open { background: #f8f9ff }
.review-panel { border-top: 1px solid #e8ebf2; padding-top: .75rem }
.review-panel dt { color: #52606d; font-weight: 600 }
.pre-wrap { white-space: pre-wrap }
.workload-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .75rem }
.workload-tile { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; padding: .75rem 1rem; border: 1px solid #e3e7ef; border-radius: .75rem; background: #fff }
.workload-tile:hover, .workload-tile:focus-visible { background: #f8f9ff }
.workload-tile-active { border-color: var(--bs-primary, #0d6efd); background: #f8f9ff }
.workload-count { font-size: 1.5rem; font-weight: 700; line-height: 1.2 }
.workload-tile .text-truncate { max-width: 100% }
</style>
