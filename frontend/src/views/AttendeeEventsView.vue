<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Attendee workspace</p><h1 class="h3">Events open for registration</h1>
      <div v-if="message" class="alert alert-success">{{ message }}</div><div v-if="error" class="alert alert-danger">{{ error }}</div>
      <p v-if="loading" role="status">Loading…</p>
      <p v-else-if="!events.length" class="text-muted small mb-0">No events are currently open for registration.</p>

      <div v-else class="d-flex flex-column gap-3">
        <div v-for="ev in events" :key="ev.id" class="border rounded p-3">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap"><div class="fw-semibold">{{ ev.title }}</div><span v-if="ev.event_type" class="badge bg-light text-dark border">{{ ev.event_type }}</span></div>
              <div class="small text-muted mt-1">{{ formatWhen(ev) }}</div>
              <div class="small mt-2" v-if="ev.venue_name"><strong>Venue:</strong> {{ ev.venue_name }}<span v-if="ev.venue_location">, {{ ev.venue_location }}</span></div>
              <p v-if="ev.purpose" class="small mt-2 mb-1"><strong>Purpose:</strong> {{ ev.purpose }}</p>
              <p class="small mt-2 mb-1">{{ ev.description || 'No event description provided.' }}</p>
              <dl class="row small mb-0 mt-3 event-details">
                <template v-if="ev.expected_attendance != null"><dt class="col-sm-4">Expected attendance</dt><dd class="col-sm-8">{{ ev.expected_attendance }}</dd></template>
                <template v-if="accessibilityText(ev.accessibility_requirements)"><dt class="col-sm-4">Accessibility</dt><dd class="col-sm-8">{{ accessibilityText(ev.accessibility_requirements) }}</dd></template>
                <template v-if="ev.special_arrangements"><dt class="col-sm-4">Special arrangements</dt><dd class="col-sm-8">{{ ev.special_arrangements }}</dd></template>
              </dl>
              <div class="small text-muted mt-3" v-if="ev.registration_capacity != null">{{ ev.registered_count }} / {{ ev.registration_capacity }} registration places filled</div>
            </div>
            <div class="text-end">
              <div v-if="ev.my_registration_id" class="d-flex flex-column align-items-end gap-1">
                <span class="badge bg-success">You're registered</span>
                <button class="btn btn-sm btn-outline-danger" :disabled="withdrawing === ev.my_registration_id" @click="withdraw(ev)">
                  {{ withdrawing === ev.my_registration_id ? 'Withdrawing...' : 'Withdraw registration' }}
                </button>
              </div>
              <div><span class="badge mb-2" :class="ev.registration_status === 'open' ? 'bg-success' : 'bg-secondary'">Registration {{ ev.registration_status }}</span></div>
              <div v-if="ev.registration_open">
                <button class="btn btn-sm btn-accent" @click="openForm(ev)">Register</button>
              </div>
              <span v-else class="small text-muted">{{ ev.registration_closed_reason }}</span>
            </div>
          </div>

          <form v-if="formEventId === ev.id" class="mt-3 border-top pt-3" @submit.prevent="submitRegistration(ev)">
            <div class="row g-2">
              <div class="col-md-4"><label class="form-label small">Name<input v-model.trim="form.name" class="form-control form-control-sm" required></label></div>
              <div class="col-md-4"><label class="form-label small">Email<input v-model.trim="form.email" type="email" class="form-control form-control-sm" required></label></div>
              <div class="col-md-4"><label class="form-label small">Phone<input v-model.trim="form.phone" class="form-control form-control-sm" required></label></div>
            </div>
            <div v-if="formError" class="text-danger small mt-2">{{ formError }}</div>
            <div class="mt-2 d-flex gap-2">
              <button class="btn btn-sm btn-accent" :disabled="submitting" type="submit">{{ submitting ? 'Registering...' : 'Confirm registration' }}</button>
              <button class="btn btn-sm btn-outline-secondary" type="button" @click="closeForm">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div></section>
  </div>
</template>
<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'AttendeeEventsView',
  data() {
    return {
      events: [], loading: false, error: '', message: '',
      formEventId: '', form: { name: '', email: '', phone: '' }, formError: '', submitting: false,
      withdrawing: ''
    }
  },
  methods: {
    formatWhen(ev) {
      if (!ev.preferred_start) return 'Date to be confirmed'
      const start = new Date(ev.preferred_start)
      const end = ev.preferred_end ? new Date(ev.preferred_end) : null
      const opts = { dateStyle: 'medium', timeStyle: 'short' }
      return end ? `${start.toLocaleString(undefined, opts)} – ${end.toLocaleTimeString()}` : start.toLocaleString(undefined, opts)
    },
    accessibilityText(value) {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.join(', ')
      if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(', ')
      return String(value)
    },
    async load() {
      this.loading = true; this.error = ''
      const response = await fetch('/api/events/registrable', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.error = 'Unable to load events open for registration'; this.loading = false; return }
      this.events = await response.json()
      this.loading = false
    },
    openForm(ev) {
      this.message = ''; this.formError = ''
      this.formEventId = ev.id
      this.form = { name: '', email: '', phone: '' }
    },
    closeForm() {
      this.formEventId = ''
      this.formError = ''
    },
    async submitRegistration(ev) {
      this.formError = ''; this.submitting = true
      const response = await fetch(`/api/events/${ev.id}/register`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(this.form)
      })
      const data = await response.json()
      this.submitting = false
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.formError = data.error || 'Unable to register for this event'; return }
      this.message = `You're registered for "${ev.title}".`
      this.formEventId = ''
      await this.load()
    },
    async withdraw(ev) {
      if (!window.confirm('Are you sure you would like to withdraw?')) return
      this.error = ''; this.message = ''; this.withdrawing = ev.my_registration_id
      const response = await fetch(`/api/events/registrations/${ev.my_registration_id}/withdraw`, {
        method: 'PATCH', headers: authHeaders()
      })
      const data = await response.json()
      this.withdrawing = ''
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      if (!response.ok) { this.error = data.error || 'Unable to withdraw your registration'; return }
      this.message = `You've withdrawn your registration for "${ev.title}".`
      await this.load()
    }
  },
  mounted() { this.load() }
}
</script>
<style scoped>
.event-details { max-width: 46rem; }
.event-details dt, .event-details dd { margin-bottom: .35rem; }
</style>
