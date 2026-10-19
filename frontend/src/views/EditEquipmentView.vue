<template>
  <div class="edit-equipment-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Equipment inventory</p>
        <h1 class="mb-1">Edit equipment</h1>
        <p class="text-muted mb-0">Update the record, or mark units as damaged or under maintenance so they are not treated as available for events.</p>
      </div>
      <router-link class="btn btn-outline-secondary" to="/equipment">Back to Inventory</router-link>
    </div>

    <div v-if="loading" class="text-muted">Loading equipment record...</div>
    <div v-else-if="loadError" class="alert alert-danger d-flex flex-wrap justify-content-between align-items-center gap-2" role="alert">
      <span>{{ loadError }}</span>
      <button v-if="!notFound" class="btn btn-sm btn-outline-danger" type="button" @click="load">Retry</button>
    </div>

    <div v-else-if="record" class="card form-panel">
      <div class="card-body">
        <div ref="feedback">
          <div v-if="successMessage" class="alert alert-success" role="status">
            <i class="bi bi-check-circle-fill me-1"></i>{{ successMessage }}
            <router-link class="alert-link ms-1" to="/equipment">Back to inventory</router-link>
          </div>
          <div v-if="saveError" class="alert alert-danger d-flex flex-wrap justify-content-between align-items-center gap-2" role="alert">
            <span><strong>Changes not saved.</strong> {{ saveError }}</span>
            <button v-if="stale" class="btn btn-sm btn-outline-danger" type="button" @click="load">Reload latest</button>
          </div>
          <div v-if="impact" class="alert alert-warning" role="alert">
            <p class="mb-2"><strong>Upcoming reservations are affected.</strong> Only {{ impact.inService }} unit{{ impact.inService === 1 ? '' : 's' }} would remain in service, which is fewer than these events have reserved:</p>
            <ul class="mb-3">
              <li v-for="reservation in impact.reservations" :key="reservation.id">
                <strong>{{ reservation.title }}</strong> — {{ reservation.quantity }} reserved<span v-if="reservation.startsAt">, starts {{ formatDate(reservation.startsAt) }}</span>
              </li>
            </ul>
            <p class="small mb-3">Saving anyway keeps those reservations but flags them for reconsideration.</p>
            <div class="d-flex flex-wrap gap-2">
              <button class="btn btn-warning" type="button" :disabled="saving" @click="save(true)">{{ saving ? 'Saving...' : 'Save anyway and flag reservations' }}</button>
              <button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="impact = null">Keep editing</button>
            </div>
          </div>
        </div>

        <form novalidate @submit.prevent="save(false)" @input="onInput">
          <fieldset :disabled="saving">
            <div class="row g-3">
              <div class="col-md-8">
                <label class="form-label" for="equipment-name">Name <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="equipment-name" v-model="form.name" class="form-control" :class="{ 'is-invalid': showErrors && errors.name }" type="text" maxlength="200" required aria-required="true">
                <div v-if="showErrors && errors.name" class="invalid-feedback">{{ errors.name }}</div>
              </div>

              <div class="col-md-4">
                <label class="form-label" for="equipment-type">Type</label>
                <input id="equipment-type" class="form-control" type="text" :value="record.equipment_type || '—'" readonly aria-describedby="equipment-type-help">
                <div id="equipment-type-help" class="form-text">The type cannot be changed.</div>
              </div>

              <div class="col-md-4">
                <label class="form-label" for="equipment-quantity">Total quantity <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="equipment-quantity" v-model="form.quantity" class="form-control" :class="{ 'is-invalid': (showErrors || touched) && errors.quantity }" type="text" inputmode="numeric" autocomplete="off" required aria-required="true">
                <div v-if="(showErrors || touched) && errors.quantity" class="invalid-feedback">{{ errors.quantity }}</div>
              </div>
            </div>

            <fieldset class="status-panel mt-4">
              <legend class="form-label fs-6 fw-semibold mb-1">Status</legend>
              <p class="form-text mt-0 mb-3">Units marked Damaged or Under Maintenance are excluded from available stock as soon as you save.</p>
              <div class="row g-3">
                <div class="col-sm-4">
                  <label class="form-label" for="equipment-available">Available</label>
                  <input id="equipment-available" class="form-control fw-semibold" type="text" :value="preview.available === null ? '—' : preview.available" readonly aria-describedby="equipment-available-help">
                  <div id="equipment-available-help" class="form-text">Total minus damaged and under maintenance.</div>
                </div>
                <div class="col-sm-4">
                  <label class="form-label" for="equipment-damaged">Damaged</label>
                  <input id="equipment-damaged" v-model="form.damaged" class="form-control" :class="{ 'is-invalid': (showErrors || touched) && (errors.damaged || errors.outOfService) }" type="text" inputmode="numeric" autocomplete="off">
                  <div v-if="(showErrors || touched) && errors.damaged" class="invalid-feedback">{{ errors.damaged }}</div>
                </div>
                <div class="col-sm-4">
                  <label class="form-label" for="equipment-maintenance">Under Maintenance</label>
                  <input id="equipment-maintenance" v-model="form.maintenance" class="form-control" :class="{ 'is-invalid': (showErrors || touched) && (errors.maintenance || errors.outOfService) }" type="text" inputmode="numeric" autocomplete="off">
                  <div v-if="(showErrors || touched) && errors.maintenance" class="invalid-feedback">{{ errors.maintenance }}</div>
                </div>
                <div v-if="(showErrors || touched) && errors.outOfService" class="col-12 text-danger small" role="alert">{{ errors.outOfService }}</div>
                <div v-else-if="preview.reduced" class="col-12 small text-warning-emphasis">
                  <i class="bi bi-exclamation-triangle"></i> {{ preview.reduced }} fewer unit{{ preview.reduced === 1 ? '' : 's' }} will be available for events after saving.
                </div>
              </div>
            </fieldset>

            <div class="mt-4">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <label class="form-label mb-0" for="spec-label-0">Specifications <span class="text-muted fw-normal">(optional)</span></label>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="addSpec"><i class="bi bi-plus-lg"></i> Add specification</button>
              </div>
              <div v-for="(spec, index) in form.specs" :key="spec.key" class="row g-2 mb-2">
                <div class="col-sm-5">
                  <input :id="`spec-label-${index}`" v-model="spec.label" class="form-control" :class="{ 'is-invalid': showErrors && errors.specs[index] }" type="text" maxlength="100" placeholder="Label, e.g. Frequency range" :aria-label="`Specification ${index + 1} label`">
                </div>
                <div class="col-sm-5">
                  <input v-model="spec.value" class="form-control" :class="{ 'is-invalid': showErrors && errors.specs[index] }" type="text" maxlength="500" placeholder="Value, e.g. 470-530 MHz" :aria-label="`Specification ${index + 1} value`">
                </div>
                <div class="col-sm-2 d-grid">
                  <button class="btn btn-outline-secondary" type="button" :aria-label="`Remove specification ${index + 1}`" @click="removeSpec(index)"><i class="bi bi-x-lg"></i></button>
                </div>
                <div v-if="showErrors && errors.specs[index]" class="col-12 text-danger small">{{ errors.specs[index] }}</div>
              </div>
              <p v-if="!form.specs.length" class="text-muted small mb-0">No specifications added.</p>
            </div>

            <div v-if="confirmingCancel" class="alert alert-secondary d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4 mb-0" role="alert">
              <span>Discard your unsaved changes? The record will stay exactly as it was.</span>
              <span class="d-flex gap-2">
                <button class="btn btn-sm btn-danger" type="button" @click="discard">Discard changes</button>
                <button class="btn btn-sm btn-outline-secondary" type="button" @click="confirmingCancel = false">Keep editing</button>
              </span>
            </div>

            <div class="mt-4 d-flex flex-wrap gap-2 align-items-center">
              <button class="btn btn-accent" type="submit" :disabled="!dirty || Boolean(impact)">{{ saving ? 'Saving...' : 'Save changes' }}</button>
              <button class="btn btn-outline-secondary" type="button" @click="cancel">Cancel</button>
              <span v-if="!dirty && !successMessage" class="small text-muted">No unsaved changes.</span>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { getEquipment, updateEquipment } from '../services/equipment'

const MAX_QUANTITY = 2147483647

let specKey = 0
function newSpec(label = '', value = '') {
  return { key: ++specKey, label, value }
}

function formFrom(record) {
  const specs = Object.entries(record.specs || {}).map(([label, value]) => newSpec(label, value))
  return {
    name: record.name,
    quantity: String(record.total_quantity),
    damaged: String(record.damaged_quantity || 0),
    maintenance: String(record.maintenance_quantity || 0),
    specs
  }
}

function wholeNumberError(raw, label, { allowZero }) {
  const value = String(raw).trim()
  if (!value) return `${label} is required.`
  if (!/^\d+$/.test(value) || (!allowZero && Number(value) <= 0)) return allowZero ? `${label} must be a whole number of 0 or more.` : `${label} must be a positive whole number.`
  if (Number(value) > MAX_QUANTITY) return `${label} is too large.`
  return ''
}

export default {
  name: 'EditEquipmentView',
  data() {
    return {
      record: null,
      form: null,
      loading: false,
      loadError: '',
      notFound: false,
      showErrors: false,
      touched: false,
      saving: false,
      saveError: '',
      stale: false,
      successMessage: '',
      impact: null,
      confirmingCancel: false,
      leaving: false
    }
  },
  computed: {
    errors() {
      const errors = { name: '', quantity: '', damaged: '', maintenance: '', outOfService: '', specs: [] }
      if (!this.form) return errors
      if (!this.form.name.trim()) errors.name = 'Name is required.'
      errors.quantity = wholeNumberError(this.form.quantity, 'Quantity', { allowZero: false })
      errors.damaged = wholeNumberError(this.form.damaged, 'Damaged quantity', { allowZero: true })
      errors.maintenance = wholeNumberError(this.form.maintenance, 'Under maintenance quantity', { allowZero: true })
      if (!errors.quantity && !errors.damaged && !errors.maintenance) {
        const outOfService = Number(this.form.damaged) + Number(this.form.maintenance)
        if (outOfService > Number(this.form.quantity)) {
          errors.outOfService = `Damaged and under-maintenance units (${outOfService}) cannot exceed the total quantity (${Number(this.form.quantity)}).`
        }
      }

      const seen = new Set()
      errors.specs = this.form.specs.map(spec => {
        const label = spec.label.trim()
        const value = spec.value.trim()
        if (!label && !value) return '' // a blank row is ignored
        if (!label) return 'Enter a label for this specification.'
        if (!value) return 'Enter a value for this specification.'
        if (seen.has(label.toLowerCase())) return 'This specification label is already used.'
        seen.add(label.toLowerCase())
        return ''
      })
      return errors
    },
    hasErrors() {
      const e = this.errors
      return Boolean(e.name || e.quantity || e.damaged || e.maintenance || e.outOfService || e.specs.some(Boolean))
    },
    // Live preview of the stock that will be available for events after saving.
    preview() {
      const e = this.errors
      if (!this.form || e.quantity || e.damaged || e.maintenance || e.outOfService) return { available: null, reduced: 0 }
      const available = Number(this.form.quantity) - Number(this.form.damaged) - Number(this.form.maintenance)
      return { available, reduced: Math.max(0, this.record.available_quantity - available) }
    },
    payload() {
      const specifications = {}
      this.form.specs.forEach(spec => {
        if (spec.label.trim()) specifications[spec.label.trim()] = spec.value.trim()
      })
      return {
        name: this.form.name.trim(),
        quantity: Number(String(this.form.quantity).trim()),
        damagedQuantity: Number(String(this.form.damaged).trim()),
        maintenanceQuantity: Number(String(this.form.maintenance).trim()),
        specifications
      }
    },
    dirty() {
      if (!this.form || !this.record) return false
      const original = formFrom(this.record)
      const normalise = form => JSON.stringify({
        name: form.name.trim(),
        quantity: String(form.quantity).trim(),
        damaged: String(form.damaged).trim(),
        maintenance: String(form.maintenance).trim(),
        specs: form.specs.filter(s => s.label.trim() || s.value.trim()).map(s => [s.label.trim(), s.value.trim()])
      })
      return normalise(this.form) !== normalise(original)
    }
  },
  created() {
    this.load()
  },
  beforeRouteLeave(to, from, next) {
    if (this.dirty && !this.leaving && typeof window !== 'undefined' && !window.confirm('Discard your unsaved changes? The record will stay exactly as it was.')) return next(false)
    next()
  },
  methods: {
    async load() {
      this.loading = true
      this.loadError = ''
      this.notFound = false
      this.saveError = ''
      this.stale = false
      this.impact = null
      try {
        this.setRecord(await getEquipment(this.$route.params.id))
      } catch (error) {
        this.notFound = error.status === 404
        this.loadError = error.message || 'Unable to load the equipment record. Please retry.'
      } finally {
        this.loading = false
      }
    },
    setRecord(record) {
      this.record = record
      this.form = formFrom(record)
      if (!this.form.specs.length) this.form.specs.push(newSpec())
      this.showErrors = false
      this.touched = false
    },
    onInput() {
      this.touched = true
      this.successMessage = ''
      this.impact = null
      this.confirmingCancel = false
    },
    addSpec() {
      this.form.specs.push(newSpec())
    },
    removeSpec(index) {
      this.form.specs.splice(index, 1)
      this.onInput()
    },
    async save(confirmReconsideration = false) {
      if (this.saving) return
      this.successMessage = ''
      this.saveError = ''
      this.stale = false
      this.showErrors = true
      if (this.hasErrors) return
      if (!confirmReconsideration) this.impact = null

      this.saving = true
      try {
        const result = await updateEquipment(this.record.id, {
          ...this.payload,
          expectedUpdatedAt: this.record.updated_at,
          ...(confirmReconsideration ? { confirmReconsideration: true } : {})
        })
        this.setRecord(result.equipment)
        this.impact = null
        this.successMessage = result.message
      } catch (error) {
        if (error.code === 'reservations_affected' && error.impact) {
          this.impact = error.impact
        } else {
          this.impact = null
          this.stale = error.code === 'stale'
          this.saveError = (error.message || 'Unable to save your changes.') + (this.stale ? '' : ' Your edits have been kept so you can retry.')
        }
      } finally {
        this.saving = false
        this.$nextTick(() => {
          if (this.$refs.feedback && this.$refs.feedback.scrollIntoView) this.$refs.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
    },
    // Nothing is sent to the server until save(), so cancelling only has to throw the edits away.
    cancel() {
      if (this.dirty) {
        this.confirmingCancel = true
        return
      }
      this.leave()
    },
    discard() {
      this.setRecord(this.record)
      this.confirmingCancel = false
      this.saveError = ''
      this.impact = null
      this.leave()
    },
    leave() {
      this.leaving = true
      this.$router.push('/equipment')
    },
    formatDate(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
  }
}
</script>

<style scoped>
.form-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
.status-panel { border: 1px solid var(--bs-border-color); border-radius: .5rem; padding: 1rem }
</style>
