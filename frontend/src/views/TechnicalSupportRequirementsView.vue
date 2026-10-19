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
          <div class="d-flex gap-2"><span class="badge" :class="item.status === 'confirmed' ? 'bg-success' : 'bg-warning text-dark'">{{ item.status || 'pending' }}</span><span v-if="item.updated" class="badge bg-info text-dark align-self-start">Updated</span><span v-if="item.late_request" class="badge bg-warning text-dark align-self-start">Late request</span></div>
        </div>
        <div class="row small g-2"><div class="col-md-6"><strong>Staff required:</strong> {{ item.staff_required }}</div><div class="col-md-6"><strong>Event time:</strong> {{ eventTime(item) }}</div></div>
        <div class="mt-3"><strong class="small">Equipment</strong><ul class="small mb-0"><li v-for="equipment in item.equipment_requirements" :key="equipment.type">{{ equipment.type }}: {{ equipment.quantity }}<span v-if="equipment.details"> — {{ equipment.details }}</span></li><li v-if="!item.equipment_requirements.length">No equipment specified</li></ul></div>
        <p v-if="item.support_required === false" class="small text-muted mt-3 mb-2">Coordinator declared that no technical support is required.</p>
        <div class="mt-3"><textarea v-model="comments[item.event_id]" class="form-control mb-2" rows="2" placeholder="Comments or required changes"></textarea><div class="d-flex gap-2"><button class="btn btn-success btn-sm" @click="decide(item, 'confirmed')">Confirm arrangements</button><button class="btn btn-outline-warning btn-sm" @click="decide(item, 'changes_requested')">Request Changes</button></div></div>
      </div>
    </article>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'TechnicalSupportRequirementsView',
  data() { return { requirements: [], comments: {}, error: '' } },
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
    },
    async decide(item, decision) {
      const response = await fetch(`/api/events/${item.event_id}/technical-support/decision`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comments: this.comments[item.event_id] || '' }) })
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to save technical support decision'; return }
      await this.load()
    }
  },
  mounted() { this.load() }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
