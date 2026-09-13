<template>
  <div>
    <h1 class="h3 mb-4">Assigned Requests</h1>

    <div class="card mb-4">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="card-title mb-0">Unassigned Queue</h5>
          <button class="btn btn-sm btn-outline-primary" @click="loadAll">Refresh</button>
        </div>
        <p v-if="!unassigned.length" class="text-muted small mb-0">No unassigned requests right now.</p>
        <ul class="list-unstyled" v-else>
          <li v-for="ev in unassigned" :key="ev.id" class="d-flex justify-content-between align-items-center border-bottom py-2">
            <div>
              <div class="fw-semibold">{{ ev.title }}</div>
              <div class="small text-muted">Submitted {{ formatDate(ev.created_at) }}</div>
            </div>
            <button class="btn btn-sm btn-accent" @click="assignToSelf(ev.id)">Assign to Me</button>
          </li>
        </ul>
        <div v-if="assignError" class="alert alert-warning mt-2 py-2 small mb-0">{{ assignError }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h5 class="card-title">My Assigned Requests</h5>
        <p v-if="!assigned.length" class="text-muted small mb-0">You have no assigned requests yet.</p>
        <ul class="list-unstyled" v-else>
          <li v-for="ev in assigned" :key="ev.id" class="border-bottom py-2">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <div class="fw-semibold">{{ ev.title }}</div>
                <div class="small text-muted">Status: {{ ev.status }}</div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-secondary" @click="viewDetails(ev.id)">View Details</button>
                <button class="btn btn-sm btn-outline-danger" @click="unassign(ev.id)">Unassign</button>
              </div>
            </div>
            <div v-if="selected && selected.id === ev.id" class="mt-3 p-3 bg-light rounded small">
              <div><strong>Event Type:</strong> {{ selected.event_type || '—' }}</div>
              <div><strong>Preferred Start:</strong> {{ formatDate(selected.preferred_start) }}</div>
              <div><strong>Preferred End:</strong> {{ formatDate(selected.preferred_end) }}</div>
              <div><strong>Expected Attendance:</strong> {{ selected.expected_attendance ?? '—' }}</div>
              <div><strong>Purpose:</strong> {{ selected.purpose || '—' }}</div>
              <div><strong>Venue Layout Preference:</strong> {{ selected.venue_layout_preference || '—' }}</div>
              <div><strong>Programme:</strong> {{ selected.programme || '—' }}</div>
              <div><strong>Registration Required:</strong> {{ selected.registration_required ? 'Yes' : 'No' }}</div>
              <div><strong>Special Arrangements:</strong> {{ selected.special_arrangements || '—' }}</div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'CoordinatorRequestsView',
  data() {
    return {
      unassigned: [],
      assigned: [],
      selected: null,
      assignError: ''
    }
  },
  methods: {
    formatDate(v) {
      if (!v) return '—'
      return new Date(v).toLocaleString()
    },
    async loadAll() {
      await Promise.all([this.loadUnassigned(), this.loadAssigned()])
    },
    async loadUnassigned() {
      const res = await fetch('/api/events/unassigned', { headers: authHeaders() })
      if (res.status === 401) { clearSession(); this.$router.push('/login'); return }
      this.unassigned = res.ok ? await res.json() : []
    },
    async loadAssigned() {
      const res = await fetch('/api/events/assigned', { headers: authHeaders() })
      if (res.status === 401) { clearSession(); this.$router.push('/login'); return }
      this.assigned = res.ok ? await res.json() : []
    },
    async assignToSelf(id) {
      this.assignError = ''
      const res = await fetch(`/api/events/${id}/assign`, { method: 'PATCH', headers: authHeaders() })
      if (res.status === 409) {
        this.assignError = 'This request has already been assigned.'
        await this.loadAll()
        return
      }
      if (!res.ok) { this.assignError = 'Could not assign this request. Please try again.'; return }
      await this.loadAll()
    },
    async unassign(id) {
      const res = await fetch(`/api/events/${id}/unassign`, { method: 'PATCH', headers: authHeaders() })
      if (res.ok) {
        if (this.selected && this.selected.id === id) this.selected = null
        await this.loadAll()
      }
    },
    async viewDetails(id) {
      if (this.selected && this.selected.id === id) { this.selected = null; return }
      const res = await fetch(`/api/events/${id}`, { headers: authHeaders() })
      if (res.ok) this.selected = await res.json()
    }
  },
  mounted() {
    this.loadAll()
  }
}
</script>