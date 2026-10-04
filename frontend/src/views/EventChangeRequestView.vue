<template>
  <div>
    <RequestNavigation />
    <router-link :to="{ name: 'submitted-event-request', params: { id: $route.params.id } }" class="d-inline-block mb-3 small">&larr; Back to request</router-link>

    <div class="card"><div class="card-body">
      <h2 class="h4 mb-1">Request changes{{ request ? ': ' + request.title : '' }}</h2>
      <p class="text-muted">Your event has been approved, so changes go to your Event Coordinator for review. Your current details stay the same until the Coordinator decides.</p>

      <p v-if="loading" role="status">Loading request…</p>
      <div v-else-if="loadError" class="alert alert-danger" role="alert">
        {{ loadError }} <button class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
      </div>

      <!-- AC-008-001 / 006: only approved events (Planning or Confirmed) can take a change request. -->
      <div v-else-if="!allowed" class="alert alert-info" role="status">
        <template v-if="request.status === 'submitted'">
          This request is still waiting for Coordinator approval. Change requests become available once it is approved.
        </template>
        <template v-else>
          Change requests are not available for {{ statusLabel(request.status).toLowerCase() }} events.
        </template>
      </div>

      <!-- AC-008-005: confirmation after a successful submission. -->
      <div v-else-if="submitted" class="alert alert-success" role="status">
        Your change request has been submitted for review. Your Event Coordinator has been notified.
        <div class="mt-2"><router-link :to="{ name: 'submitted-event-request', params: { id: request.id } }">Back to request</router-link></div>
      </div>
      <div v-else-if="majorChange" class="alert alert-warning" role="alert">
        <h3 class="h6">This is a major change</h3>
        <p class="mb-2">{{ majorChange.message }}</p>
        <p class="small mb-3">If you continue, this event will be cancelled and a new draft will open with your current details and the changes you entered. Review it and submit it for approval again.</p>
        <div v-if="error" class="text-danger small mb-2">{{ error }}</div>
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-danger" :disabled="resubmitting" @click="confirmResubmit">{{ resubmitting ? 'Cancelling…' : 'Cancel this event and resubmit' }}</button>
          <button type="button" class="btn btn-outline-secondary" :disabled="resubmitting" @click="backToForm">Go back and edit my change</button>
        </div>
      </div>
      <form v-else novalidate @submit.prevent="submit">
        <p class="small text-muted">Fill in only what you want to change. Leave a field blank to keep the current value. Times are Singapore time (UTC+8).</p>
        <fieldset :disabled="submitting">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label" for="cr-date">New date</label>
              <input id="cr-date" v-model="form.date" type="date" class="form-control" :class="{ 'is-invalid': fieldErrors.date }" />
              <div class="form-text">Current: {{ current('startDate') }}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label" for="cr-start">New start time</label>
              <input id="cr-start" v-model="form.startTime" type="time" class="form-control" :class="{ 'is-invalid': fieldErrors.date }" />
              <div class="form-text">Current: {{ current('startTime') }}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label" for="cr-end">New end time</label>
              <input id="cr-end" v-model="form.endTime" type="time" class="form-control" :class="{ 'is-invalid': fieldErrors.date }" />
              <div class="form-text">Current: {{ current('endTime') }}</div>
            </div>
            <div v-if="fieldErrors.date" class="col-12 text-danger small" role="alert">{{ fieldErrors.date }}</div>

            <div class="col-md-6">
              <label class="form-label" for="cr-attendance">New expected attendance</label>
              <input id="cr-attendance" v-model="form.expectedAttendance" inputmode="numeric" class="form-control" :class="{ 'is-invalid': fieldErrors.expectedAttendance }" placeholder="e.g. 200" />
              <div v-if="fieldErrors.expectedAttendance" class="invalid-feedback">{{ fieldErrors.expectedAttendance }}</div>
              <div class="form-text">Current: {{ current('expectedAttendance') }}</div>
            </div>
            <div class="col-12">
              <label class="form-label" for="cr-venue">New venue requirements</label>
              <textarea id="cr-venue" v-model="form.venueRequirements" rows="2" class="form-control"></textarea>
              <div class="form-text">Current: {{ current('venueRequirements') }}</div>
            </div>
            <div class="col-12">
              <label class="form-label" for="cr-equipment">New equipment requirements</label>
              <textarea id="cr-equipment" v-model="form.equipment" rows="2" class="form-control" placeholder="Comma-separated, e.g. projector, 2 microphones"></textarea>
              <div class="form-text">Current: {{ current('equipmentRequirements') }}</div>
            </div>
          </div>

          <div v-if="error" class="alert alert-danger mt-3" role="alert">{{ error }}</div>
          <div class="d-flex gap-2 mt-3">
            <button type="submit" class="btn btn-primary">{{ submitting ? 'Submitting…' : 'Submit change request' }}</button>
            <router-link :to="{ name: 'submitted-event-request', params: { id: request.id } }" class="btn btn-outline-secondary">Cancel</router-link>
          </div>
                <!-- US-010 (AC-010-003/004): a major change can't be a change request. -->
        </fieldset>
      </form>
    </div></div>
  </div>
</template>

<script>
import RequestNavigation from '../components/RequestNavigation.vue'
import { canRequestChanges, fetchSubmittedRequest, submitChangeRequest, cancelAndResubmit } from '../services/changeRequests'
export default {
  name: 'EventChangeRequestView',
  components: { RequestNavigation },
  data() {
    return {
      request: null,
      loading: true,
      loadError: '',
      submitting: false,
      submitted: false,
      majorChange: null,     // US-010: { message, aspects, payload } when the server reports a major change
      resubmitting: false,
      error: '',
      fieldErrors: {},
      form: { date: '', startTime: '', endTime: '', expectedAttendance: '', venueRequirements: '', equipment: '' }
    }
  },
  computed: {
    allowed() { return Boolean(this.request) && canRequestChanges(this.request.status) }
  },
  mounted() { this.load() },
  methods: {
    statusLabel(status) { return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) },
    current(key) {
      const value = this.request && this.request.draft_data ? this.request.draft_data[key] : ''
      return value && String(value).trim() ? value : 'Not provided'
    },
    async load() {
      this.loading = true
      this.loadError = ''
      try { this.request = await fetchSubmittedRequest(this.$route.params.id) }
      catch (error) { this.loadError = error.message || 'Unable to load this request. Please retry.' }
      finally { this.loading = false }
    },
    // Builds only the fields the Organiser filled in (AC-008-002). Returns null if the form is invalid.
    buildPayload() {
      const f = this.form
      const errors = {}
      const payload = {}
      const anyTiming = f.date || f.startTime || f.endTime
      if (anyTiming) {
        if (!f.date || !f.startTime || !f.endTime) errors.date = 'To change the date or time, enter the date, start time and end time.'
        else if (f.endTime <= f.startTime) errors.date = 'End time must be later than the start time.'
        else {
          payload.preferredStart = `${f.date}T${f.startTime}:00+08:00`
          payload.preferredEnd = `${f.date}T${f.endTime}:00+08:00`
        }
      }
      const attendance = String(f.expectedAttendance).trim()
      if (attendance) {
        if (!/^\d+$/.test(attendance) || Number(attendance) < 1) errors.expectedAttendance = 'Enter a positive whole number.'
        else payload.expectedAttendance = Number(attendance)
      }
      if (f.venueRequirements.trim()) payload.venueLayoutPreference = f.venueRequirements.trim()
      const equipment = f.equipment.split(',').map(item => item.trim()).filter(Boolean)
      if (equipment.length) payload.equipmentRequirements = equipment
      this.fieldErrors = errors
      if (Object.keys(errors).length) return null
      if (!Object.keys(payload).length) { this.error = 'Propose at least one change.'; return null }
      return payload
    },
    async submit() {
      this.error = ''
      const payload = this.buildPayload()
      if (!payload) return
      this.submitting = true
      try {
        await submitChangeRequest(this.request.id, payload)
        this.submitted = true
      } catch (error) {
        if (error.code === 'MAJOR_CHANGE') {                        // US-010
          this.majorChange = { message: error.message, aspects: error.majorChanges || [], payload }
        } else {
          this.error = error.message || 'Unable to submit change request. Please retry.'
        }
      } finally {
        this.submitting = false
      }
    },
    // US-010 (AC-010-004): back to the form with everything they typed still there.
    backToForm() {
      this.majorChange = null
      this.error = ''
    },
    // US-010 (AC-010-004): cancel the event and continue in the new pre-filled draft.
    async confirmResubmit() {
      if (this.resubmitting) return
      this.error = ''
      this.resubmitting = true
      try {
        const result = await cancelAndResubmit(this.request.id, this.majorChange.payload)
        this.$router.push({ name: 'edit-event-draft', params: { id: result.draftId } })
      } catch (error) {
        this.error = error.message || 'Unable to cancel and resubmit. Please retry.'
      } finally {
        this.resubmitting = false
      }
    }
  }
}
</script>