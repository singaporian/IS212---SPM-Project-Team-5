<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <template v-else-if="data">
      <div class="d-flex justify-content-between align-items-end mb-4"><div><p class="eyebrow mb-1">Registration management</p><h1 class="h3 mb-1">{{ data.event.title }}</h1><p class="text-muted mb-0">Event registrations</p></div><button class="btn btn-outline-primary" @click="load">Refresh</button></div>
      <div v-if="!data.registration_enabled" class="alert alert-info">Registration is not enabled for this event.</div>
      <template v-else><div class="summary-row mb-3"><strong>{{ data.registered_count }}</strong> registered <span class="text-muted mx-2">|</span> <strong>{{ data.withdrawn_count }}</strong> withdrawn</div><section class="card mb-3"><div class="card-body"><h2 class="h5">Registered attendees</h2><p v-if="!data.registrations.length" class="text-muted small">No registrations yet.</p><div v-else class="table-responsive"><table class="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Registered</th></tr></thead><tbody><tr v-for="registration in data.registrations" :key="registration.id"><td>{{ registration.name }}</td><td>{{ registration.email }}</td><td>{{ registration.phone || 'Not provided' }}</td><td>{{ formatDate(registration.created_at) }}</td></tr></tbody></table></div></div></section><section class="card"><div class="card-body"><h2 class="h5">Withdrawn registrations</h2><p v-if="!data.withdrawn.length" class="text-muted small">No withdrawn registrations.</p><div v-else class="table-responsive"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Withdrawn</th></tr></thead><tbody><tr v-for="registration in data.withdrawn" :key="registration.id"><td>{{ registration.name }}</td><td>{{ registration.email }}</td><td>{{ registration.phone || 'Not provided' }}</td><td>{{ formatDate(registration.updated_at) }}</td></tr></tbody></table></div></div></section></template>
    </template>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default { name: 'EventRegistrationsView', data() { return { data: null, error: '' } }, methods: { formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not recorded' }, async load() { this.error = ''; const response = await fetch(`/api/events/${this.$route.params.id}/registrations`, { headers: authHeaders() }); if (response.status === 401) { clearSession(); this.$router.push('/login'); return } const data = await response.json(); if (!response.ok) { this.error = data.error || 'Unable to load registrations'; return } this.data = data } }, mounted() { this.load() } }
</script>
<style scoped>.eyebrow { font-size:.75rem; letter-spacing:.08em; color:#64748b; font-weight:700 }.summary-row { padding:.85rem 1rem; border-radius:.6rem; background:#f1f5f9 }</style>