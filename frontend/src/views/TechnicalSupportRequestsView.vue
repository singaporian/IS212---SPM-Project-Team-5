<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div><p class="eyebrow mb-1">Coordinator workspace</p><h1 class="h3 mb-1">Submitted Technical Support Requirements</h1><p class="text-muted mb-0">View the latest requirements submitted for your assigned events.</p></div>
      <div class="d-flex gap-2"><router-link to="/technical-support/requirements" class="btn btn-accent">Manage Requirements</router-link><button class="btn btn-outline-primary" @click="load">Refresh</button></div>
    </div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!requirements.length" class="empty-state text-center"><i class="bi bi-headset display-5"></i><h2 class="h5 mt-3">No submitted requirements yet</h2><p class="text-muted mb-0">Saved technical support requirements will appear here.</p></div>
    <article v-for="item in requirements" :key="item.id" class="card mb-3 requirement-card" :class="{ selected: selectedId === item.id }" tabindex="0" role="button" @click="toggle(item.id)" @keydown.enter="toggle(item.id)">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3">
          <div><h2 class="h5 mb-1">{{ item.event_title }}</h2><p class="small text-muted mb-1">Last updated {{ formatDate(item.updated_at) }}</p><p class="small text-muted mb-0">{{ eventTime(item) }}</p></div>
          <div class="d-flex gap-1 align-self-start"><span v-if="item.updated" class="badge bg-info text-dark">Updated</span><span v-if="item.late_request" class="badge bg-warning text-dark">Late request</span></div>
        </div>
        <div class="small mt-3"><strong>Staff required:</strong> {{ item.staff_required }} <span class="ms-3"><strong>Equipment types:</strong> {{ item.equipment_requirements.length }}</span></div>
        <div v-if="selectedId === item.id" class="details mt-3" @click.stop>
          <strong>Equipment details</strong>
          <ul class="small mb-0"><li v-for="equipment in item.equipment_requirements" :key="equipment.type">{{ equipment.type }}: {{ equipment.quantity }}<span v-if="equipment.details"> — {{ equipment.details }}</span></li><li v-if="!item.equipment_requirements.length">No equipment specified</li></ul>
        </div>
      </div>
    </article>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'TechnicalSupportRequestsView',
  data() { return { requirements: [], error: '', selectedId: null } },
  methods: {
    async load() {
      this.error = ''
      const response = await fetch('/api/technical-support/my-requirements', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load technical support requirements'; return }
      this.requirements = data
    },
    toggle(id) { this.selectedId = this.selectedId === id ? null : id },
    formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' },
    eventTime(item) {
      if (!item.preferred_start && !item.preferred_end) return 'Event time not specified'
      return `${this.formatDate(item.preferred_start)} to ${this.formatDate(item.preferred_end)}`
    },
  },
  mounted() { this.load() }
}
</script>

<style scoped>
.requirement-card { cursor: pointer; border: 1px solid #e9edf3; border-radius: .75rem }
.requirement-card:hover, .requirement-card:focus, .requirement-card.selected { background: #f8f9ff; outline: none }
.details { border-top: 1px solid #e8ebf2; padding-top: .75rem; color: #52606d; line-height: 1.8 }
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
