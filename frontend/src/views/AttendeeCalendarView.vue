<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4"><div><p class="eyebrow mb-1">Attendee workspace</p><h1 class="h3 mb-1">My Event Calendar</h1><p class="text-muted mb-0">Events you are currently registered for.</p></div><button class="btn btn-outline-primary" @click="load">Refresh</button></div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!events.length" class="empty-state text-center">You are not registered for any events.</div>
    <div v-else class="calendar-list"><article v-for="event in events" :key="event.registration_id" class="calendar-event"><div><h2 class="h5 mb-1">{{ event.title }}</h2><p class="mb-1">{{ formatDate(event.preferred_start) }} to {{ formatDate(event.preferred_end) }}</p><p class="small text-muted mb-1">{{ event.venue_name || 'Venue to be confirmed' }}<span v-if="event.venue_location">, {{ event.venue_location }}</span></p><p class="small mb-0">{{ event.description || 'No description provided.' }}</p></div><span class="badge bg-success">Registered</span></article></div>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default { name: 'AttendeeCalendarView', data() { return { events: [], error: '' } }, methods: { formatDate(value) { return value ? new Date(value).toLocaleString() : 'Time to be confirmed' }, async load() { this.error = ''; const response = await fetch('/api/events/registered', { headers: authHeaders() }); if (response.status === 401) { clearSession(); this.$router.push('/login'); return } const data = await response.json(); if (!response.ok) { this.error = data.error || 'Unable to load your registered events'; return } this.events = data } }, mounted() { this.load() } }
</script>
<style scoped>.calendar-event { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; padding:1rem; border:1px solid #e5eaf1; border-radius:.75rem; margin-bottom:.75rem; background:#fbfcff }.empty-state { border:1px dashed #cbd5e1; border-radius:.75rem; padding:3rem 1rem; color:#52606d } .eyebrow { font-size:.75rem; letter-spacing:.08em; color:#64748b; font-weight:700 }</style>