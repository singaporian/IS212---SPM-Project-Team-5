<template>
  <div>
    <router-link to="/events" class="d-inline-block mb-3 small">&laquo; Back to My Event Requests</router-link>
    <div class="card">
      <div class="card-body">
        <h5 class="card-title">Request a Change</h5>
        <p class="text-muted small">Leave anything blank to leave it as is. Propose at least one change.</p>

        <form @submit.prevent="submit">
          <fieldset :disabled="submitting">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label small">New Start</label>
                <input type="datetime-local" class="form-control" v-model="form.preferredStart" />
              </div>
              <div class="col-md-6">
                <label class="form-label small">New End</label>
                <input type="datetime-local" class="form-control" v-model="form.preferredEnd" />
              </div>
              <div class="col-12">
                <label class="form-label small">New Expected Attendance</label>
                <input class="form-control" v-model="form.expectedAttendance" placeholder="e.g. 200" />
              </div>
              <div class="col-12">
                <label class="form-label small">New Venue Requirements</label>
                <textarea class="form-control" rows="2" v-model="form.venueLayoutPreference"></textarea>
              </div>
              <div class="col-12">
                <label class="form-label small">New Equipment Requirements</label>
                <textarea class="form-control" rows="2" v-model="equipmentRequirementsText" placeholder="Comma-separated, e.g. projector, 2 microphones"></textarea>
              </div>
            </div>
            <button type="submit" class="btn btn-primary mt-3">{{ submitting ? 'Submitting…' : 'Submit Change Request' }}</button>
          </fieldset>
          <p v-if="error" class="text-danger mt-3" role="alert">{{ error }}</p>
          <p v-if="successMessage" class="text-success mt-3" role="status">{{ successMessage }}</p>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { submitChangeRequest } from '../services/changeRequests'

export default {
  name: 'EventChangeRequestView',
  data() {
    return {
      submitting: false,
      error: '',
      successMessage: '',
      equipmentRequirementsText: '',
      form: { preferredStart: '', preferredEnd: '', expectedAttendance: '', venueLayoutPreference: '' }
    }
  },
  methods: {
    async submit() {
      this.error = ''
      this.successMessage = ''
      const payload = {}
      if (this.form.preferredStart) payload.preferredStart = new Date(this.form.preferredStart).toISOString()
      if (this.form.preferredEnd) payload.preferredEnd = new Date(this.form.preferredEnd).toISOString()
      if (this.form.expectedAttendance) payload.expectedAttendance = Number(this.form.expectedAttendance)
      if (this.form.venueLayoutPreference) payload.venueLayoutPreference = this.form.venueLayoutPreference
      if (this.equipmentRequirementsText) payload.equipmentRequirements = this.equipmentRequirementsText.split(',').map(s => s.trim()).filter(Boolean)

      if (!Object.keys(payload).length) { this.error = 'Propose at least one change.'; return }

      this.submitting = true
      try {
        await submitChangeRequest(this.$route.params.id, payload)
        this.successMessage = 'Your change request has been submitted for review.'   // AC-008-005
      } catch (error) {
        this.error = error.message || 'Unable to submit change request.'
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>