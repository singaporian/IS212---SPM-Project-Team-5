<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Venue Staff workspace</p><h1 class="h3">Configure setup &amp; turnaround time</h1><p class="text-muted">These defaults are used to work out a venue's availability, both when Coordinators search for venues and when their booking requests are reviewed.</p>
      <div v-if="message" class="alert alert-success">{{ message }}</div><div v-if="error" class="alert alert-danger">{{ error }}</div>
      <label class="form-label">Venue
        <select v-model="selectedVenueId" class="form-select" @change="onVenueChange">
          <option value="">Select a venue</option>
          <option v-for="venue in venues" :key="venue.id" :value="venue.id">{{ venue.name }}</option>
        </select>
      </label>
      <form v-if="selectedVenueId" @submit.prevent="save" class="mt-3">
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Setup time (minutes before the event)<input v-model.number="form.setupMinutes" class="form-control" type="number" min="0" step="1" required></label></div>
          <div class="col-md-6"><label class="form-label">Turnaround time (minutes after the event)<input v-model.number="form.turnaroundMinutes" class="form-control" type="number" min="0" step="1" required></label></div>
        </div>
        <button class="btn btn-accent mt-3" :disabled="saving" type="submit">{{ saving ? 'Saving...' : 'Save defaults' }}</button>
      </form>
    </div></section>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'
export default {
  name: 'VenueSetupTurnaroundView',
  data() { return { venues: [], selectedVenueId: '', saving: false, message: '', error: '', form: { setupMinutes: 30, turnaroundMinutes: 30 } } },
  methods: {
    async loadVenues() {
      const response = await fetch('/api/venues', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      this.venues = response.ok ? await response.json() : []
    },
    onVenueChange() {
      this.message = ''; this.error = ''
      const venue = this.venues.find((item) => item.id === this.selectedVenueId)
      this.form.setupMinutes = venue?.default_setup_minutes ?? 30
      this.form.turnaroundMinutes = venue?.default_turnaround_minutes ?? 30
    },
    async save() {
      this.error = ''; this.message = ''; this.saving = true
      const response = await fetch(`/api/venues/${this.selectedVenueId}/setup-turnaround`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupMinutes: this.form.setupMinutes, turnaroundMinutes: this.form.turnaroundMinutes })
      })
      const data = await response.json()
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.error = data.error || 'Unable to update setup and turnaround times'; this.saving = false; return }
      const venue = this.venues.find((item) => item.id === this.selectedVenueId)
      if (venue) { venue.default_setup_minutes = data.default_setup_minutes; venue.default_turnaround_minutes = data.default_turnaround_minutes }
      this.message = `Saved: ${data.name} now uses ${data.default_setup_minutes} min setup / ${data.default_turnaround_minutes} min turnaround.`
      this.saving = false
    }
  },
  mounted() { this.loadVenues() }
}
</script>
