<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4"><div><p class="eyebrow mb-1">Coordinator workspace</p><h1 class="h3">Affected venue bookings</h1><p class="text-muted mb-0">Original bookings remain preserved while you arrange replacement venues.</p></div><button class="btn btn-outline-primary" @click="load">Refresh</button></div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!bookings.length" class="empty-state text-center">No affected bookings require replacement.</div>
    <article v-for="booking in bookings" :key="booking.id" class="card mb-3"><div class="card-body"><div class="d-flex justify-content-between gap-3"><div><h2 class="h5 mb-1">{{ booking.event_title }}</h2><p class="mb-1">Original venue: <strong>{{ booking.venue_name }}</strong></p><p class="small text-muted mb-1">Original status: {{ booking.status }}</p><p class="small text-danger mb-1">Unavailable: {{ formatDate(booking.unavailable_start) }} to {{ formatDate(booking.unavailable_end) }}</p><p class="small text-muted mb-0">Reason: {{ booking.unavailable_reason }}</p></div><span class="badge bg-warning text-dark align-self-start">Replacement required</span></div><router-link class="btn btn-sm btn-accent mt-3" :to="{ name: 'batch-booking-request', query: { eventId: booking.event_id } }">Request replacement venue</router-link></div></article>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default { name: 'AffectedBookingsView', data() { return { bookings: [], error: '' } }, methods: { formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' }, async load() { this.error = ''; const response = await fetch('/api/bookings/affected', { headers: authHeaders() }); if (response.status === 401) { clearSession(); this.$router.push('/login'); return } const data = await response.json(); if (!response.ok) { this.error = data.error || 'Unable to load affected bookings'; return } this.bookings = data } }, mounted() { this.load() } }
</script>
<style scoped>.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }</style>
