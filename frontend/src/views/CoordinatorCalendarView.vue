<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4"><div><p class="eyebrow mb-1">Coordinator workspace</p><h1 class="h3 mb-1">My Event Calendar</h1><p class="text-muted mb-0">Assigned events and their current arrangements.</p></div><button class="btn btn-outline-primary" @click="load">Refresh</button></div>
    <div v-if="actionMessage" class="alert alert-success">{{ actionMessage }}</div>
    <div v-if="actionError" class="alert alert-danger">{{ actionError }}</div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-else-if="!events.length" class="empty-state text-center">No events are currently assigned to you.</div>
    <div v-else class="calendar-list"><article v-for="event in events" :key="event.id" class="event-card"><div class="d-flex justify-content-between gap-3"><div><h2 class="h5 mb-1">{{ event.title }}</h2><p class="mb-1">{{ formatDate(event.preferred_start) }} to {{ formatDate(event.preferred_end) }}</p><p class="small text-muted mb-1">Expected attendance: {{ event.expected_attendance ?? 'Not recorded' }}</p><p class="small text-muted mb-0">{{ event.purpose || 'No purpose recorded' }}</p></div><span class="badge" :class="eventClass(event.status)">{{ eventLabel(event.status) }}</span></div><div class="status-row mt-3"><span><strong>Technical:</strong> {{ technicalLabel(event.technical_status) }}</span><span><strong>Safety:</strong> {{ safetyLabel(event.safety_status) }}</span></div><div class="mt-3"><strong class="small">Venue arrangements</strong><p v-if="!event.bookings.length" class="small text-muted mb-0">No venue bookings submitted.</p><div v-for="booking in event.bookings" :key="booking.id" class="booking-row"><span>{{ booking.venue_name || 'Venue not selected' }} · {{ formatDate(booking.start_time) }} to {{ formatDate(booking.end_time) }}</span><span class="badge" :class="bookingClass(booking.status)">{{ bookingLabel(booking.status) }}</span></div></div><div class="d-flex flex-wrap gap-2 mt-3"><router-link v-if="event.registration_required" class="btn btn-sm btn-outline-primary" :to="{ name: 'event-registrations', params: { id: event.id } }">View Registrations</router-link><button v-if="event.status === 'confirmed'" class="btn btn-sm btn-outline-success" :disabled="actingEventId === event.id + ':complete'" @click="markCompleted(event)">{{ actingEventId === event.id + ':complete' ? 'Marking completed…' : 'Mark Completed' }}</button><button v-if="!['completed', 'cancelled'].includes(event.status)" class="btn btn-sm btn-outline-danger" :disabled="actingEventId === event.id + ':cancel'" @click="cancelEvent(event)">{{ actingEventId === event.id + ':cancel' ? 'Cancelling…' : 'Cancel Event' }}</button></div></article></div>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default { name: 'CoordinatorCalendarView', data() { return { events: [], error: '', actionMessage: '', actionError: '', actingEventId: '' } }, methods: { formatDate(value) { return value ? new Date(value).toLocaleString() : 'Not specified' }, eventLabel(status) { return ({ approved: 'Approved for planning', planning: 'Planning', confirmed: 'Confirmed', submitted: 'Submitted', clarification_requested: 'Clarification requested', rejected: 'Rejected', completed: 'Completed', cancelled: 'Cancelled' })[status] || 'Unknown' }, technicalLabel(status) { return ({ confirmed: 'Confirmed', pending: 'Pending confirmation', changes_requested: 'Changes requested' })[status] || 'Not submitted' }, safetyLabel(status) { return ({ approved: 'Approved', pending: 'Pending review', rejected: 'Rejected', changes_requested: 'Changes requested' })[status] || 'Not reviewed' }, bookingLabel(status) { return ({ approved: 'Reserved', confirmed: 'Reserved', pending: 'Pending review', rejected: 'Rejected', alternative_suggested: 'Alternative suggested' })[status] || 'Unknown' }, eventClass(status) { return { 'bg-success': ['confirmed', 'planning', 'approved'].includes(status), 'bg-warning text-dark': ['submitted', 'clarification_requested'].includes(status), 'bg-secondary': ['completed', 'cancelled', 'rejected'].includes(status) } }, bookingClass(status) { return { 'bg-success': ['approved', 'confirmed'].includes(status), 'bg-warning text-dark': status === 'pending', 'bg-danger': status === 'rejected', 'bg-info text-dark': status === 'alternative_suggested' } }, async load() { this.error = ''; const response = await fetch('/api/events/coordinator-calendar', { headers: authHeaders() }); if (response.status === 401) { clearSession(); this.$router.push('/login'); return } const data = await response.json(); if (!response.ok) { this.error = data.error || 'Unable to load your event calendar'; return } this.events = data },
    async markCompleted(event) {
      this.actionMessage = ''; this.actionError = ''; this.actingEventId = event.id + ':complete'
      const response = await fetch(`/api/events/${event.id}/complete`, { method: 'PATCH', headers: authHeaders() })
      const data = await response.json()
      this.actingEventId = ''
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.actionError = data.error || 'Unable to mark this event completed'; return }
      this.actionMessage = data.message || `"${event.title}" was marked completed.`
      await this.load()
    },
    async cancelEvent(event) {
      if (!window.confirm(`Cancel "${event.title}"? This stops it progressing further and frees its reserved equipment. This cannot be undone.`)) return
      this.actionMessage = ''; this.actionError = ''; this.actingEventId = event.id + ':cancel'
      const response = await fetch(`/api/events/${event.id}/cancel`, { method: 'PATCH', headers: authHeaders() })
      const data = await response.json()
      this.actingEventId = ''
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.actionError = data.error || 'Unable to cancel this event'; return }
      this.actionMessage = data.message || `"${event.title}" was cancelled.`
      await this.load()
    }
  }, mounted() { this.load() } }
</script>
<style scoped>.eyebrow { font-size:.75rem; letter-spacing:.08em; color:#64748b; font-weight:700 }.event-card { border:1px solid #e5eaf1; border-radius:.75rem; padding:1rem; margin-bottom:.85rem; background:#fbfcff }.status-row { display:flex; flex-wrap:wrap; gap:.75rem; padding:.65rem .8rem; border-radius:.5rem; background:#f1f5f9; font-size:.85rem }.booking-row { display:flex; justify-content:space-between; gap:1rem; align-items:center; padding:.6rem 0; border-top:1px solid #e5eaf1; font-size:.85rem }.empty-state { border:1px dashed #cbd5e1; border-radius:.75rem; padding:3rem 1rem; color:#52606d }</style>