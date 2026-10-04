<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">{{ $route.params.id ? "Edit Event Draft" : "New Event Request" }}</h5>
      <p class="text-muted small">Fill in what you know now. Fields marked * are required before submission.</p>
      <div v-if="loading" role="status">Loading draft...</div>
      <div v-if="loadError" class="alert alert-danger" role="alert">
        {{ loadError }} <button class="btn btn-sm btn-outline-danger" @click="loadDraft">Retry</button>
      </div>
      <form v-if="!loading && !loadError" @submit.prevent="saveDraft">
        <fieldset :disabled="saving || submitting || submitted">
        <div class="row g-3">
          <div class="col-12">
            <label for="eventName" class="form-label small">Event Name <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <input class="form-control" id="eventName" :class="{ 'is-invalid': fieldError('eventName') }" :aria-invalid="!!fieldError('eventName')" :aria-describedby="fieldError('eventName') ? 'eventName-error' : undefined" @input="clearFieldError('eventName')" v-model="form.eventName" placeholder="e.g. Freshman Orientation Fair" />
            <div v-if="fieldError('eventName')" id="eventName-error" class="invalid-feedback" role="alert">{{ fieldError('eventName') }}</div>
          </div>

          <div class="col-md-3">
            <label for="startDate" class="form-label small">Start Date <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <input type="date" class="form-control" id="startDate" :class="{ 'is-invalid': fieldError('startDate') }" :aria-invalid="!!fieldError('startDate')" :aria-describedby="fieldError('startDate') ? 'startDate-error' : undefined" @input="clearFieldError('startDate')" v-model="form.startDate" />
            <div v-if="fieldError('startDate')" id="startDate-error" class="invalid-feedback" role="alert">{{ fieldError('startDate') }}</div>
          </div>
          <div class="col-md-3">
            <label for="startTime" class="form-label small">Start Time <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <select class="form-select" id="startTime" :class="{ 'is-invalid': fieldError('startTime') }" :aria-invalid="!!fieldError('startTime')" :aria-describedby="fieldError('startTime') ? 'startTime-error' : undefined" @change="clearFieldError('startTime')" v-model="form.startTime">
              <option value="">Select time</option>
              <option v-if="form.startTime && !TIME_OPTIONS.some(t => t.value === form.startTime)" :value="form.startTime" disabled>{{ form.startTime }} (choose a five-minute time)</option>
              <option v-for="t in TIME_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <div v-if="fieldError('startTime')" id="startTime-error" class="invalid-feedback" role="alert">{{ fieldError('startTime') }}</div>
          </div>
          <div class="col-md-3">
            <label for="endDate" class="form-label small">End Date <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <input type="date" class="form-control" id="endDate" :class="{ 'is-invalid': fieldError('endDate') }" :aria-invalid="!!fieldError('endDate')" :aria-describedby="fieldError('endDate') ? 'endDate-error' : undefined" @input="clearFieldError('endDate')" v-model="form.endDate" />
            <div v-if="fieldError('endDate')" id="endDate-error" class="invalid-feedback" role="alert">{{ fieldError('endDate') }}</div>
          </div>
          <div class="col-md-3">
            <label for="endTime" class="form-label small">End Time <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <select class="form-select" id="endTime" :class="{ 'is-invalid': fieldError('endTime') }" :aria-invalid="!!fieldError('endTime')" :aria-describedby="fieldError('endTime') ? 'endTime-error' : undefined" @change="clearFieldError('endTime')" v-model="form.endTime">
              <option value="">Select time</option>
              <option v-if="form.endTime && !TIME_OPTIONS.some(t => t.value === form.endTime)" :value="form.endTime" disabled>{{ form.endTime }} (choose a five-minute time)</option>
              <option v-for="t in TIME_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <div v-if="fieldError('endTime')" id="endTime-error" class="invalid-feedback" role="alert">{{ fieldError('endTime') }}</div>
          </div>

          <div class="col-12"><p class="form-text mb-0">Event times use Singapore time (UTC+8), in five-minute intervals.</p></div>
          <div v-if="duration" class="col-12">
            <div class="form-text">Duration: {{ duration }}</div>
          </div>

          <div class="col-12">
            <label for="expectedAttendance" class="form-label small">Expected Attendance <span class="text-danger" aria-hidden="true">*</span><span class="visually-hidden"> (required for submission)</span></label>
            <input
              class="form-control"
              id="expectedAttendance" :class="{ 'is-invalid': fieldError('expectedAttendance') }" :aria-invalid="!!fieldError('expectedAttendance')" :aria-describedby="fieldError('expectedAttendance') ? 'expectedAttendance-error' : undefined" @input="clearFieldError('expectedAttendance')" v-model="form.expectedAttendance"
              placeholder="e.g. 150 "
            />
            <div class="form-text">Enter a positive whole number.</div>
            <div v-if="fieldError('expectedAttendance')" id="expectedAttendance-error" class="invalid-feedback" role="alert">{{ fieldError('expectedAttendance') }}</div>
          </div>

          <div class="col-12">
            <label for="purpose" class="form-label small">Purpose</label>
            <textarea class="form-control" rows="2" id="purpose" :class="{ 'is-invalid': fieldError('purpose') }" :aria-invalid="!!fieldError('purpose')" :aria-describedby="fieldError('purpose') ? 'purpose-error' : undefined" @input="clearFieldError('purpose')" v-model="form.purpose"></textarea>
            <div v-if="fieldError('purpose')" id="purpose-error" class="invalid-feedback" role="alert">{{ fieldError('purpose') }}</div>
          </div>

          <div class="col-12">
            <label for="description" class="form-label small">Description</label>
            <textarea class="form-control" rows="3" id="description" :class="{ 'is-invalid': fieldError('description') }" :aria-invalid="!!fieldError('description')" :aria-describedby="fieldError('description') ? 'description-error' : undefined" @input="clearFieldError('description')" v-model="form.description"></textarea>
            <div v-if="fieldError('description')" id="description-error" class="invalid-feedback" role="alert">{{ fieldError('description') }}</div>
          </div>

          <div class="col-12">
            <label for="venueRequirements" class="form-label small">Venue Requirements</label>
            <textarea class="form-control" rows="2" id="venueRequirements" :class="{ 'is-invalid': fieldError('venueRequirements') }" :aria-invalid="!!fieldError('venueRequirements')" :aria-describedby="fieldError('venueRequirements') ? 'venueRequirements-error' : undefined" @input="clearFieldError('venueRequirements')" v-model="form.venueRequirements" placeholder="e.g. Theatre-style, 200 seats "></textarea>
            <div v-if="fieldError('venueRequirements')" id="venueRequirements-error" class="invalid-feedback" role="alert">{{ fieldError('venueRequirements') }}</div>
          </div>

          <div class="col-12">
            <label for="accessibilityNeeds" class="form-label small">Accessibility Needs</label>
            <textarea class="form-control" rows="2" id="accessibilityNeeds" :class="{ 'is-invalid': fieldError('accessibilityNeeds') }" :aria-invalid="!!fieldError('accessibilityNeeds')" :aria-describedby="fieldError('accessibilityNeeds') ? 'accessibilityNeeds-error' : undefined" @input="clearFieldError('accessibilityNeeds')" v-model="form.accessibilityNeeds" placeholder="e.g. wheelchair access, None or Not Required"></textarea>
            <div v-if="fieldError('accessibilityNeeds')" id="accessibilityNeeds-error" class="invalid-feedback" role="alert">{{ fieldError('accessibilityNeeds') }}</div>
          </div>

          <div class="col-12">
            <label for="equipmentRequirements" class="form-label small">Equipment Requirements</label>
            <textarea class="form-control" rows="2" id="equipmentRequirements" :class="{ 'is-invalid': fieldError('equipmentRequirements') }" :aria-invalid="!!fieldError('equipmentRequirements')" :aria-describedby="fieldError('equipmentRequirements') ? 'equipmentRequirements-error' : undefined" @input="clearFieldError('equipmentRequirements')" v-model="form.equipmentRequirements" placeholder="e.g. projector, None or Not Required"></textarea>
            <div v-if="fieldError('equipmentRequirements')" id="equipmentRequirements-error" class="invalid-feedback" role="alert">{{ fieldError('equipmentRequirements') }}</div>
          </div>

          <div class="col-12">
            <label for="registrationNeeds" class="form-label small">Registration Needs</label>
            <select class="form-select" id="registrationNeeds" :class="{ 'is-invalid': fieldError('registrationNeeds') }" :aria-invalid="!!fieldError('registrationNeeds')" :aria-describedby="fieldError('registrationNeeds') ? 'registrationNeeds-error' : undefined" @input="clearFieldError('registrationNeeds')" v-model="form.registrationNeeds">
              <option value="not_decided">Not decided</option>
              <option value="yes">Required</option>
              <option value="no">Not required</option>
            </select>
            <div v-if="fieldError('registrationNeeds')" id="registrationNeeds-error" class="invalid-feedback" role="alert">{{ fieldError('registrationNeeds') }}</div>
          </div>
        </div>
        <div class="mt-4 d-flex gap-2 align-items-center">
          <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save Draft' }}</button>
          <button type="button" class="btn btn-success" :disabled="saving || submitting || submitted" @click="submitForReview">
            {{ submitting ? 'Submitting...' : 'Submit for Review' }}
          </button>
          <router-link to="/requests/drafts">My Drafts</router-link>
        </div>
        </fieldset>
        <p v-if="saveError && !Object.keys(saveFields).length && !attendanceError && !endError" class="text-danger mt-3" role="alert">{{ saveError }}</p>
        <p v-if="saveMessage" class="text-success mt-3" role="status">{{ saveMessage }}</p>
        <div v-if="submitError && (!Object.keys(submitFields).length || submitFields.form)" class="alert alert-danger mt-3" role="alert">
          <p class="mb-1">{{ submitError }}</p>
          <p v-if="submitFields.form" class="mb-0">{{ submitFields.form }}</p>
        </div>
        <p v-if="submitted" class="alert alert-success mt-3" role="status">
          Request submitted successfully.
          <router-link :to="{ name: 'submitted-event-request', params: { id: draftId } }">View submitted request</router-link>
        </p>
      </form>
    </div>
  </div>
</template>

<script>
import { draftRequest } from '../services/drafts'

// Recognized placeholder phrases AC2 explicitly allows in place of a real
// value (case-insensitive, whitespace-trimmed match).
const PLACEHOLDER_VALUES = ['not decided', 'none', 'not required']

const TIME_OPTIONS = (() => {
  const options = []
  for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
    const h24 = Math.floor(minutes / 60)
    const m = minutes % 60
    const value = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const period = h24 < 12 ? 'AM' : 'PM'
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    const label = `${h12}:${String(m).padStart(2, '0')} ${period}`
    options.push({ value, label })
  }
  return options
})()

export default {
  name: 'EventRequestForm',
  data() {
    return {
      TIME_OPTIONS,
      draftId: this.$route.params.id || crypto.randomUUID(),
      loading: false,
      loadError: '',
      saving: false,
      saveError: '',
      saveFields: {},
      saveMessage: '',
      savedVersion: '',
      savedForm: '',
      submitting: false,
      submitted: false,
      submitError: '',
      submitFields: {},
      form: {
        eventName: '',
        startDate: '',
        startTime: '',
        endDate: '',
        endTime: '',
        expectedAttendance: '',
        purpose: '',
        description: '',
        venueRequirements: '',
        accessibilityNeeds: '',
        equipmentRequirements: '',
        registrationNeeds: 'not_decided'
      }
    }
  },
  mounted() {
    if (this.$route.params.id) this.loadDraft()
  },
  watch: {
    '$route.params.id'(id) {
      if (id === this.draftId) return
      Object.assign(this, this.$options.data.call(this))
      if (id) this.loadDraft()
    },
    form: { deep: true, handler() { this.saveMessage = '' } }
  },
  methods: {
    async focusFirstError() {
      const id = this.draftId
      // Wait for validation messages and the re-enabled fieldset to render.
      await this.$nextTick()
      if (this.draftId !== id) return
      const field = this.$el.querySelector('input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]')
      if (!field) return
      field.focus({ preventScroll: true })
      field.scrollIntoView({ block: 'center', behavior: 'auto' })
    },
    fieldError(field) {
      return (['startTime', 'endTime'].includes(field) && this.form[field] && !/^(?:[01]\d|2[0-3]):[0-5][05]$/.test(this.form[field]) ? 'Choose a time in five-minute intervals.' : '') ||
        (field === 'expectedAttendance' ? this.attendanceError : '') ||
        (field === this.endErrorField ? this.endError : '') ||
        this.saveFields[field] || this.submitFields[field] || ''
    },
    clearFieldError(field) {
      delete this.saveFields[field]
      delete this.submitFields[field]
      if (['startDate', 'startTime', 'endDate', 'endTime'].includes(field)) {
        for (const key of ['endDate', 'endTime']) {
          delete this.saveFields[key]
          delete this.submitFields[key]
        }
      }
    },
    async loadDraft() {
      const id = this.draftId
      this.loading = true
      this.loadError = ''
      try {
        const draft = await draftRequest('/' + id)
        if (this.draftId !== id) return
        this.form = { ...this.form, ...draft.draft_data }
        this.savedVersion = draft.version || ''
        this.savedForm = JSON.stringify(this.form)
      } catch (error) {
        if (this.draftId === id) this.loadError = error.message || 'Unable to load draft. Please retry.'
      } finally {
        if (this.draftId === id) this.loading = false
      }
    },
    async saveDraft() {
      if (this.saving || this.submitting || this.submitted) return
      this.saveMessage = ''
      this.saveFields = {}
      this.saveError = this.fieldError('startTime') || this.fieldError('endTime') || this.attendanceError || this.endError
      if (this.saveError) {
        await this.focusFirstError()
        return
      }
      const id = this.draftId
      const snapshot = JSON.stringify(this.form)
      this.saving = true
      try {
        const saved = await draftRequest('/' + id, { method: 'PUT', body: snapshot })
        if (this.draftId !== id) return
        this.savedVersion = saved.version || ''
        this.savedForm = snapshot
        this.submitError = ''
        this.submitFields = {}
        this.saveMessage = 'Draft saved successfully. Your request has not been submitted.'
        if (!this.$route.params.id) {
          await this.$router.replace({ name: 'edit-event-draft', params: { id: this.draftId } })
        }
      } catch (error) {
        if (this.draftId !== id) return
        this.saveFields = error.fields || (error.field ? { [error.field]: error.message } : {})
        this.saveError = (error.message || 'Unable to save draft.') + ' Your input has been kept; please retry.'
      } finally {
        if (this.draftId === id) {
          this.saving = false
          if (Object.keys(this.saveFields).length) await this.focusFirstError()
        }
      }
    },
    async submitForReview() {
      if (this.saving || this.submitting || this.submitted) return
      this.submitError = ''
      this.submitFields = {}
      this.saveFields = {}
      this.saveError = ''
      this.saveMessage = ''
      const id = this.draftId
      this.submitting = true
      try {
        await draftRequest('/' + id + '/submit', { method: 'POST', body: JSON.stringify({ version: this.savedVersion || null, draft: this.form }) })
        if (this.draftId !== id) return
        this.submitted = true
        await this.$router.replace({ name: 'submitted-event-request', params: { id }, query: { submitted: '1' } })
      } catch (error) {
        if (this.draftId !== id) return
        this.submitError = error.message || 'Unable to submit. Please retry.'
        this.submitFields = error.fields || {}
      } finally {
        if (this.draftId === id) {
          this.submitting = false
          if (Object.keys(this.submitFields).length) await this.focusFirstError()
        }
      }
    }
  },
  computed: {
    hasUnsavedChanges() { return JSON.stringify(this.form) !== this.savedForm },
    attendanceError() {
      const raw = this.form.expectedAttendance
      if (!raw) return '' // blank is fine (AC2)
      const normalized = raw.trim().toLowerCase()
      if (PLACEHOLDER_VALUES.includes(normalized)) return '' // recognized placeholder text (AC2)
      if (!/^\d+$/.test(raw.trim())) {
        return "Enter a positive whole number."
      }
      return ''
    },
    startDateTime() {
      if (!this.form.startDate || !this.form.startTime) return null
      const d = new Date(`${this.form.startDate}T${this.form.startTime}`)
      return isNaN(d.getTime()) ? null : d
    },
    endDateTime() {
      if (!this.form.endDate || !this.form.endTime) return null
      const d = new Date(`${this.form.endDate}T${this.form.endTime}`)
      return isNaN(d.getTime()) ? null : d
    },
    endErrorField() {
      const { startDate, endDate, startTime, endTime } = this.form
      const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
      if (!validDate(startDate) || !validDate(endDate)) return ''
      if (endDate < startDate) return 'endDate'
      const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      if (endDate === startDate && validTime(startTime) && validTime(endTime) && endTime <= startTime) return 'endTime'
      return ''
    },
    endError() {
      if (this.endErrorField === 'endDate') return 'End date must not be earlier than the start date.'
      if (this.endErrorField === 'endTime') return 'End time must be later than the start time.'
      return ''
    },
    duration() {
      if (!this.startDateTime || !this.endDateTime || this.endError) return ''
      let minutes = Math.round((this.endDateTime.getTime() - this.startDateTime.getTime()) / 60000)
      const days = Math.floor(minutes / 1440)
      minutes -= days * 1440
      const hours = Math.floor(minutes / 60)
      minutes -= hours * 60
      return [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : ''
      ].filter(Boolean).join(' ') || '0m'
    }
  }
}
</script>
