<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div><p class="eyebrow mb-1">Technical support workspace</p><h1 class="h3 mb-1">Technical support requirements</h1><p class="text-muted mb-0">Review the latest equipment and staff requirements for events.</p></div>
      <button class="btn btn-outline-primary" @click="load">Refresh</button>
    </div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!requirements.length" class="empty-state text-center">No technical support requirements have been submitted yet.</div>
    <article v-for="item in requirements" :key="item.id" class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between gap-3">
          <div><h2 class="h5 mb-1">{{ item.event_title }}</h2><p class="small text-muted mb-2">Last updated {{ formatDate(item.updated_at) }}</p></div>
          <div class="d-flex gap-2"><span v-if="item.updated" class="badge bg-info text-dark align-self-start">Updated</span><span v-if="item.late_request" class="badge bg-warning text-dark align-self-start">Late request</span></div>
        </div>
        <div class="row small g-2"><div class="col-md-6"><strong>Staff required:</strong> {{ item.staff_required }}</div><div class="col-md-6"><strong>Event time:</strong> {{ eventTime(item) }}</div></div>
        <div class="mt-3"><strong class="small">Equipment</strong><ul class="small mb-0"><li v-for="equipment in item.equipment_requirements" :key="equipment.type">{{ equipment.type }}: {{ equipment.quantity }}<span v-if="equipment.details"> — {{ equipment.details }}</span></li><li v-if="!item.equipment_requirements.length">No equipment specified</li></ul></div>
      </div>
    </article>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'TechnicalSupportRequirementsView',
  data() { return { requirements: [], error: '' } },
  methods: {
    formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' },
    eventTime(item) {
      if (!item.preferred_start && !item.preferred_end) return 'Event time not specified'
      return `${this.formatDate(item.preferred_start)} to ${this.formatDate(item.preferred_end)}`
    },
    async load() {
      this.error = ''
      const response = await fetch('/api/technical-support/requirements', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load requirements'; return }
      this.requirements = data
    }
  },
  mounted() { this.load() }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
