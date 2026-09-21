<template>
  <div class="add-equipment-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Equipment inventory</p>
        <h1 class="mb-1">Add new equipment</h1>
        <p class="text-muted mb-0">Record newly available equipment so it can be tracked and used for events.</p>
      </div>
      <router-link class="btn btn-outline-secondary" to="/">Back to Home</router-link>
    </div>

    <div class="card form-panel">
      <div class="card-body">
        <div ref="feedback">
          <div v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</div>
          <div v-if="saveError" class="alert alert-danger" role="alert">{{ saveError }}</div>
        </div>

        <form novalidate @submit.prevent="save" @input="successMessage = ''">
          <fieldset :disabled="saving">
            <div class="row g-3">
              <div class="col-md-8">
                <label class="form-label" for="equipment-name">Name <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="equipment-name" v-model="form.name" class="form-control" :class="{ 'is-invalid': showErrors && errors.name }" type="text" maxlength="200" placeholder="e.g. Wireless handheld microphone" required aria-required="true">
                <div v-if="showErrors && errors.name" class="invalid-feedback">{{ errors.name }}</div>
              </div>

              <div class="col-md-4">
                <label class="form-label" for="equipment-type">Type <span class="text-danger" aria-hidden="true">*</span></label>
                <select id="equipment-type" v-model="form.type" class="form-select" :class="{ 'is-invalid': showErrors && errors.type }" required aria-required="true">
                  <option value="">Select a type</option>
                  <option v-for="type in equipmentTypes" :key="type" :value="type">{{ type }}</option>
                </select>
                <div v-if="showErrors && errors.type" class="invalid-feedback">{{ errors.type }}</div>
              </div>

              <div class="col-md-4">
                <label class="form-label" for="equipment-quantity">Quantity <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="equipment-quantity" v-model="form.quantity" class="form-control" :class="{ 'is-invalid': (showErrors || form.quantity !== '') && errors.quantity }" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 10" required aria-required="true">
                <div v-if="(showErrors || form.quantity !== '') && errors.quantity" class="invalid-feedback">{{ errors.quantity }}</div>
              </div>

              <div class="col-md-8">
                <label class="form-label" for="equipment-status">Status</label>
                <input id="equipment-status" class="form-control" type="text" value="Available" readonly aria-describedby="equipment-status-help">
                <div id="equipment-status-help" class="form-text">New equipment is always recorded as Available.</div>
              </div>

              <div class="col-12">
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
            </div>

            <div class="mt-4 d-flex gap-2">
              <button class="btn btn-accent" type="submit">{{ saving ? 'Saving...' : 'Add to Inventory' }}</button>
              <button class="btn btn-outline-secondary" type="button" @click="cancel">Cancel</button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { createEquipment } from '../services/equipment'

const EQUIPMENT_TYPES = ['Audio', 'Video & Display', 'Lighting', 'Staging', 'Networking', 'Power & Cabling', 'Furniture', 'Other']
const MAX_QUANTITY = 2147483647

let specKey = 0
function newSpec() {
  return { key: ++specKey, label: '', value: '' }
}

function emptyForm() {
  return { name: '', type: '', quantity: '', specs: [newSpec()] }
}

export default {
  name: 'AddEquipmentView',
  data() {
    return {
      equipmentTypes: EQUIPMENT_TYPES,
      form: emptyForm(),
      showErrors: false,
      saving: false,
      saveError: '',
      successMessage: ''
    }
  },
  computed: {
    errors() {
      const name = this.form.name.trim()
      const quantity = String(this.form.quantity).trim()
      const errors = { name: '', type: '', quantity: '', specs: [] }
      if (!name) errors.name = 'Name is required.'
      if (!this.form.type) errors.type = 'Type is required.'
      if (!quantity) errors.quantity = 'Quantity is required.'
      else if (!/^\d+$/.test(quantity) || Number(quantity) <= 0) errors.quantity = 'Quantity must be a positive whole number.'
      else if (Number(quantity) > MAX_QUANTITY) errors.quantity = 'Quantity is too large.'

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
      return Boolean(this.errors.name || this.errors.type || this.errors.quantity || this.errors.specs.some(Boolean))
    }
  },
  methods: {
    addSpec() {
      this.form.specs.push(newSpec())
    },
    removeSpec(index) {
      this.form.specs.splice(index, 1)
    },
    async save() {
      if (this.saving) return
      this.successMessage = ''
      this.saveError = ''
      this.showErrors = true
      if (this.hasErrors) return

      const specifications = {}
      this.form.specs.forEach(spec => {
        if (spec.label.trim()) specifications[spec.label.trim()] = spec.value.trim()
      })
      this.saving = true
      try {
        const record = await createEquipment({
          name: this.form.name.trim(),
          type: this.form.type,
          quantity: Number(String(this.form.quantity).trim()),
          specifications
        })
        this.successMessage = `"${record.name}" was added to the inventory (${record.total_quantity} unit${record.total_quantity === 1 ? '' : 's'}, status: Available).`
        this.form = emptyForm()
        this.showErrors = false
      } catch (error) {
        this.saveError = (error.message || 'Unable to save the equipment record.') + ' Your input has been kept.'
      } finally {
        this.saving = false
        this.$nextTick(() => {
          if (this.$refs.feedback && this.$refs.feedback.scrollIntoView) this.$refs.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
    },
    // Nothing is sent to the server until save(), so discarding is just leaving the page.
    cancel() {
      this.form = emptyForm()
      this.$router.push('/')
    }
  }
}
</script>

<style scoped>
.form-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
</style>
