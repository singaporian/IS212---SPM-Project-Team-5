<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Venue Staff workspace</p><h1 class="h3">Mark venue unavailable</h1><p class="text-muted">Existing bookings are preserved and affected Coordinators will be notified.</p>
      <div v-if="message" class="alert alert-success">{{ message }}</div><div v-if="error" class="alert alert-danger">{{ error }}</div>
      <form @submit.prevent="save">
        <label class="form-label">Venue<select v-model="form.venueId" class="form-select" required><option value="">Select a venue</option><option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }}</option></select></label>
        <div class="row g-3"><div class="col-md-6"><label class="form-label">Unavailable from<input v-model="form.startTime" class="form-control" type="datetime-local" required></label></div><div class="col-md-6"><label class="form-label">Unavailable until<input v-model="form.endTime" class="form-control" type="datetime-local" required></label></div></div>
        <label class="form-label mt-3">Reason<select v-model="form.reason" class="form-select" required><option value="">Select a reason</option><option>Maintenance</option><option>Equipment failure</option><option>Renovation</option><option>Safety concern</option><option>Other</option></select></label>
        <label v-if="form.reason === 'Other'" class="form-label">Details<input v-model.trim="form.details" class="form-control" required placeholder="Describe the operational reason"></label>
        <button class="btn btn-accent mt-2" :disabled="saving" type="submit">{{ saving ? 'Saving...' : 'Mark unavailable' }}</button>
      </form>
      <div v-if="affected.length" class="mt-4"><h2 class="h5">Affected bookings</h2><ul><li v-for="booking in affected" :key="booking.id">{{ booking.event_title }} — {{ booking.status }} (Coordinator notified)</li></ul></div>
    </div></section>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default {
  name: 'VenueUnavailabilityView',
  data() { return { venues: [], affected: [], saving: false, message: '', error: '', form: { venueId: '', startTime: '', endTime: '', reason: '', details: '' } } },
  methods: {
    async loadVenues() { const response = await fetch('/api/venues', { headers: authHeaders() }); if (response.status === 401) { clearSession(); this.$router.push('/login'); return } this.venues = response.ok ? await response.json() : [] },
    async save() {
      this.error = ''; this.message = ''; this.saving = true
      // US-020: send the reason as a code, with details only for Other
      const reasonCodes = { 'Maintenance': 'maintenance', 'Equipment failure': 'equipment_failure', 'Renovation': 'renovation', 'Safety concern': 'safety_concerns', 'Other': 'other' }
      const reasonCode = reasonCodes[this.form.reason]
      const reasonDetail = this.form.reason === 'Other' ? this.form.details : ''
      const response = await fetch(`/api/venues/${this.form.venueId}/unavailability`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ startTime: this.form.startTime, endTime: this.form.endTime, reasonCode, reasonDetail }) })
      const data = await response.json()
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.error = data.error || 'Unable to mark venue unavailable'; this.saving = false; return }
      this.affected = data.affected_bookings || []
      this.message = this.affected.length ? `Venue marked unavailable. ${this.affected.length} affected booking(s) were identified and Coordinators notified.` : 'Venue marked unavailable. No existing bookings were affected.'
      this.form = { venueId: '', startTime: '', endTime: '', reason: '', details: '' }
      this.saving = false
    }
  },
  mounted() { this.loadVenues() }
}
</script>
