<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">{{ $route.params.id ? "Edit Event Draft" : "New Event Request" }} <span class="badge bg-secondary">Draft</span></h5>
      <p class="text-muted small">
        Fill in what you know now. Leave anything blank, or type "not decided", "none",
        or "not required" where it doesn't apply yet — nothing here is required at this stage.
      </p>

      <div v-if="loading" role="status">Loading draft…</div>
      <div v-if="loadError" class="alert alert-danger" role="alert">
        {{ loadError }} <button class="btn btn-sm btn-outline-danger" @click="loadDraft">Retry</button>
      </div>
      <form v-if="!loading && !loadError" @submit.prevent="saveDraft">
        <fieldset :disabled="saving">
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label small">Event Name</label>
            <input class="form-control" v-model="form.eventName" placeholder="e.g. Freshman Orientation Fair" />
          </div>

          <div class="col-md-3">
            <label class="form-label small">Start Date</label>
            <input type="date" class="form-control" v-model="form.startDate" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Start Time</label>
            <select class="form-select" v-model="form.startTime">
              <option value="">--</option>
              <option v-for="t in TIME_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small">End Date</label>
            <input type="date" class="form-control" v-model="form.endDate" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">End Time</label>
            <select class="form-select" v-model="form.endTime">
              <option value="">--</option>
              <option v-for="t in TIME_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>

          <div v-if="endError" class="col-12">
            <div v-if="endError" class="text-danger small">{{ endError }}</div>
          </div>
          <div v-if="duration" class="col-12">
            <div class="form-text">Duration: {{ duration }}</div>
          </div>

          <div class="col-12">
            <label class="form-label small">Expected Attendance</label>
            <input
              class="form-control"
              :class="{ 'is-invalid': attendanceError }"
              v-model="form.expectedAttendance"
              placeholder="e.g. 150 "
            />
            <div v-if="attendanceError" class="invalid-feedback">{{ attendanceError }}</div>
          </div>

          <div class="col-12">
            <label class="form-label small">Purpose</label>
            <textarea class="form-control" rows="2" v-model="form.purpose"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small">Description</label>
            <textarea class="form-control" rows="3" v-model="form.description"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small">Venue Requirements</label>
            <textarea class="form-control" rows="2" v-model="form.venueRequirements" placeholder="e.g. Theatre-style, 200 seats "></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small">Accessibility Needs</label>
            <textarea class="form-control" rows="2" v-model="form.accessibilityNeeds" placeholder="e.g. wheelchair access "></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small">Equipment Requirements</label>
            <textarea class="form-control" rows="2" v-model="form.equipmentRequirements" placeholder="e.g. projector, 2 microphones — or 'none'"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small">Registration Needs</label>
            <select class="form-select" v-model="form.registrationNeeds">
              <option value="not_decided">Not decided</option>
              <option value="yes">Required</option>
              <option value="no">Not required</option>
            </select>
          </div>
        </div>
        <div class="mt-4 d-flex gap-2 align-items-center">
          <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save Draft' }}</button>
          <router-link to="/requests/drafts">My Drafts</router-link>
        </div>
        </fieldset>
        <p v-if="saveError" class="text-danger mt-3" role="alert">{{ saveError }}</p>
        <p v-if="saveMessage" class="text-success mt-3" role="status">{{ saveMessage }}</p>
      </form>
    </div>
  </div>
</template>

<script>
import { draftRequest } from '../services/drafts'

// Built once at module load: 288 options covering 24h in 5-minute steps,
// e.g. { value: '00:00', label: '12:00 AM' }, { value: '00:05', label: '12:05 AM' }, ...
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

// Recognized placeholder phrases AC2 explicitly allows in place of a real
// value (case-insensitive, whitespace-trimmed match).
const PLACEHOLDER_VALUES = ['not decided', 'none', 'not required']

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
      saveFieldError: '',   // US005
      saveMessage: '',      //US005
      saveMessage: '',
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
    async loadDraft() {
      const id = this.draftId
      this.loading = true
      this.loadError = ''
      try {
        const draft = await draftRequest('/' + id)
        if (this.draftId !== id) return
        this.form = { ...this.form, ...draft.draft_data }
      } catch (error) {
        if (this.draftId === id) this.loadError = error.message || 'Unable to load draft. Please retry.'
      } finally {
        if (this.draftId === id) this.loading = false
      }
    },
    async saveDraft() {
      if (this.saving) return
      this.saveMessage = ''
      this.saveError = this.attendanceError || this.endError
      if (this.saveError) return
      this.saving = true
      try {
        await draftRequest('/' + this.draftId, { method: 'PUT', body: JSON.stringify(this.form) })
        this.saveMessage = 'Draft saved successfully. Your request has not been submitted.'
        if (!this.$route.params.id) {
          await this.$router.replace({ name: 'edit-event-draft', params: { id: this.draftId } })
        }
      } catch (error) {
          this.saveError = (error.message || 'Unable to save draft.') + ' Your input has been kept; please retry.'
          this.saveFieldError = error.field || ''   // NEW — server errors now include res.body.field
      } finally {
        this.saving = false
      }
    }
  },
  computed: {
    attendanceError() {
      const raw = this.form.expectedAttendance
      if (!raw) return '' // blank is fine (AC2)
      const normalized = raw.trim().toLowerCase()
      if (PLACEHOLDER_VALUES.includes(normalized)) return '' // recognized placeholder text (AC2)
      if (!/^\d+$/.test(raw.trim())) {
        return "Expected attendance must be a whole number (or 'not decided')."
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
    endError() {
      if (!this.endDateTime || !this.startDateTime) return ''
      if (this.endDateTime.getTime() <= this.startDateTime.getTime()) {
        return 'End date/time must be later than the start.'
      }
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