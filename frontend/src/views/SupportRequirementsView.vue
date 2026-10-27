<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card">
      <div class="card-body">
        <p class="eyebrow mb-1">Coordinator workspace</p>
        <h1 class="h3">Technical support requirements</h1>
        <p class="text-muted">Select the exact inventory equipment needed for your assigned event.</p>
        <div v-if="message" class="alert alert-success">{{ message }}</div>
        <div v-if="error" class="alert alert-danger">{{ error }}</div>

        <form @submit.prevent="save">
          <label class="form-label">
            Event
            <select v-model="eventId" class="form-select" required @change="loadExisting">
              <option value="">Select an assigned event</option>
              <option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }}</option>
            </select>
          </label>

          <div v-if="eventId" class="mt-4">
            <div v-if="safetyComments && safetyChangeScope.includes('technical')" class="alert alert-warning py-2">
              <strong>Safety Officer requested technical changes:</strong> {{ safetyComments }}
            </div>
            <div class="form-check mb-3">
              <input id="no-support" v-model="noSupportRequired" class="form-check-input" type="checkbox">
              <label class="form-check-label" for="no-support">No technical support required</label>
            </div>

            <template v-if="!noSupportRequired">
              <h2 class="h5">Equipment required</h2>
              <p class="small text-muted mb-2">Equipment list is sourced from the technical inventory.</p>
              <div v-if="!equipmentCatalog.length" class="alert alert-warning py-2 mb-3">
                No inventory equipment is available to select right now.
              </div>
              <div v-else class="table-responsive">
                <table class="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th style="width: 38%;">Equipment</th>
                      <th style="width: 22%;">Type</th>
                      <th style="width: 20%;" class="text-end">Available now</th>
                      <th style="width: 20%;" class="text-end">Quantity needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in equipmentCatalog" :key="item.id">
                      <td>
                        <div class="form-check">
                          <input :id="`equipment-${item.id}`" v-model="item.selected" class="form-check-input" type="checkbox">
                          <label class="form-check-label" :for="`equipment-${item.id}`">{{ item.name }}</label>
                        </div>
                      </td>
                      <td>{{ item.equipment_type }}</td>
                      <td class="text-end">{{ item.available_quantity }}</td>
                      <td class="text-end">
                        <input
                          v-model.number="item.quantity"
                          class="form-control form-control-sm text-end"
                          type="number"
                          min="1"
                          :disabled="!item.selected"
                          :aria-label="`${item.name} quantity`"
                          placeholder="Qty"
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="missingRequestedEquipment.length" class="alert alert-warning py-2 small">
                Some previously requested equipment is no longer in inventory and was not preselected:
                {{ missingRequestedEquipment.join(', ') }}.
              </div>
            </template>

            <label v-if="!noSupportRequired" class="form-label mt-3">
              Number of staff required
              <input v-model.number="staffRequired" class="form-control" type="number" min="0" required>
            </label>
            <button class="btn btn-accent" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save requirements' }}</button>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

function normalizeEquipmentCatalog(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item.id === 'string')
    .map(item => ({
      id: item.id,
      name: item.name || 'Unnamed equipment',
      equipment_type: item.equipment_type || 'Unspecified',
      available_quantity: Number.isInteger(item.available_quantity) ? item.available_quantity : 0,
      selected: false,
      quantity: 1
    }))
}

export default {
  name: 'SupportRequirementsView',
  data() {
    return {
      events: [],
      eventId: '',
      equipmentCatalog: [],
      missingRequestedEquipment: [],
      staffRequired: 0,
      noSupportRequired: false,
      safetyComments: '',
      safetyChangeScope: [],
      saving: false,
      message: '',
      error: ''
    }
  },
  computed: {
    selectedEvent() { return this.events.find((event) => event.id === this.eventId) },
  },
  methods: {
    resetSelections() {
      this.equipmentCatalog = this.equipmentCatalog.map(item => ({ ...item, selected: false, quantity: 1 }))
      this.missingRequestedEquipment = []
    },
    async loadEquipmentCatalog() {
      const response = await fetch('/api/technical-support/equipment-catalog', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return false }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load equipment inventory')
      this.equipmentCatalog = normalizeEquipmentCatalog(data)
      return true
    },
    async loadEvents() {
      const response = await fetch('/api/events/assigned', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return false }
      this.events = response.ok ? await response.json() : []
      return true
    },
    async loadExisting() {
      this.message = ''
      this.error = ''
      this.resetSelections()
      this.staffRequired = 0
      this.noSupportRequired = false
      this.safetyComments = ''
      this.safetyChangeScope = []
      if (!this.eventId) return
      const response = await fetch(`/api/events/${this.eventId}/technical-support`, { headers: authHeaders() })
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load requirements'; return }
      this.staffRequired = data.staff_required || 0
      this.noSupportRequired = data.support_required === false
      this.safetyComments = data.safety_comments || ''
      this.safetyChangeScope = data.safety_change_scope || []

      const missing = []
      for (const saved of (data.equipment_requirements || [])) {
        const item = saved?.equipment_id ? this.equipmentCatalog.find(entry => entry.id === saved.equipment_id) : null
        if (item) {
          item.selected = true
          item.quantity = saved.quantity
        } else {
          const fallbackName = saved?.equipment_name || saved?.type
          if (fallbackName) missing.push(fallbackName)
        }
      }
      this.missingRequestedEquipment = missing
    },
    async save() {
      this.message = ''
      this.error = ''
      this.saving = true
      if (this.selectedEvent?.preferred_end && new Date() > new Date(this.selectedEvent.preferred_end)) {
        this.error = 'Technical support requirements cannot be submitted after the event has ended. Your input has been kept.'
        this.saving = false
        return
      }
      const selected = this.noSupportRequired
        ? []
        : this.equipmentCatalog
          .filter(item => item.selected)
          .map(item => ({ equipmentId: item.id, quantity: Number(item.quantity) }))
      try {
        const response = await fetch(`/api/events/${this.eventId}/technical-support`, {
          method: 'PUT',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            equipment: selected,
            staffRequired: this.noSupportRequired ? 0 : Number(this.staffRequired),
            noSupportRequired: this.noSupportRequired
          })
        })
        const data = await response.json()
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        if (!response.ok) { this.error = `${data.error || 'Unable to save requirements'} Your input has been kept.`; return }
        this.message = data.late_request ? 'Requirements saved. This is marked as a late request for Technical Support Staff.' : 'Technical support requirements saved and shared with Technical Support Staff.'
      } catch (error) {
        this.error = `${error.message || 'Unable to save requirements'} Your input has been kept.`
      } finally {
        this.saving = false
      }
    }
  },
  async mounted() {
    this.error = ''
    try {
      const [eventsLoaded, equipmentLoaded] = await Promise.all([this.loadEvents(), this.loadEquipmentCatalog()])
      if (!eventsLoaded || !equipmentLoaded) return
      const eventId = this.$route.query.eventId
      if (eventId && this.events.some((event) => event.id === eventId)) {
        this.eventId = eventId
        await this.loadExisting()
      }
    } catch (error) {
      this.error = error.message || 'Unable to load form data'
    }
  }
}
</script>
