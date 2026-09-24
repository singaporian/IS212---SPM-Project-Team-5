<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <section class="card"><div class="card-body">
      <p class="eyebrow mb-1">Coordinator workspace</p><h1 class="h3">Technical support requirements</h1><p class="text-muted">Specify the equipment and staff needed for an assigned event.</p>
      <div v-if="message" class="alert alert-success">{{ message }}</div><div v-if="error" class="alert alert-danger">{{ error }}</div>
      <form @submit.prevent="save">
        <label class="form-label">Event<select v-model="eventId" class="form-select" required @change="loadExisting"><option value="">Select an assigned event</option><option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }}</option></select></label>
        <div v-if="eventId" class="mt-4"><h2 class="h5">Equipment required</h2>
          <div v-for="item in equipment" :key="item.type" class="row g-2 align-items-center mb-2"><div class="col-md-4"><div class="form-check"><input :id="item.type" v-model="item.selected" class="form-check-input" type="checkbox"><label class="form-check-label" :for="item.type">{{ item.type }}</label></div></div><div class="col-md-3"><input v-model.number="item.quantity" class="form-control" type="number" min="1" :disabled="!item.selected" :aria-label="`${item.type} quantity`" placeholder="Quantity"></div><div v-if="item.type === 'Other' && item.selected" class="col-md-5"><input v-model.trim="item.details" class="form-control" type="text" maxlength="500" placeholder="Describe the equipment" aria-label="Other equipment details"></div></div>
          <label class="form-label mt-3">Number of staff required<input v-model.number="staffRequired" class="form-control" type="number" min="0" required></label>
          <button class="btn btn-accent" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save requirements' }}</button>
        </div>
      </form>
    </div></section>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'
const EQUIPMENT_TYPES = ['Audio', 'Video & Display', 'Lighting', 'Staging', 'Networking', 'Power & Cabling', 'Furniture', 'Other']
function makeEquipment() { return EQUIPMENT_TYPES.map(type => ({ type, quantity: 1, details: '', selected: false })) }

export default {
  name: 'SupportRequirementsView',
  data() { return { events: [], eventId: '', equipment: makeEquipment(), staffRequired: 0, saving: false, message: '', error: '' } },
  methods: {
    async loadEvents() {
      const response = await fetch('/api/events/assigned', { headers: authHeaders() })
      if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
      this.events = response.ok ? await response.json() : []
    },
    async loadExisting() {
      this.message = ''; this.error = ''; this.equipment = makeEquipment(); this.staffRequired = 0
      if (!this.eventId) return
      const response = await fetch(`/api/events/${this.eventId}/technical-support`, { headers: authHeaders() })
      const data = await response.json()
      if (!response.ok) { this.error = data.error || 'Unable to load requirements'; return }
      this.staffRequired = data.staff_required || 0
      data.equipment_requirements.forEach(saved => { const item = this.equipment.find(entry => entry.type === saved.type); if (item) { item.selected = true; item.quantity = saved.quantity; item.details = saved.details || '' } })
    },
    async save() {
      this.message = ''; this.error = ''; this.saving = true
      const selected = this.equipment.filter(item => item.selected).map(item => ({ type: item.type, quantity: Number(item.quantity), details: item.details }))
      try {
        const response = await fetch(`/api/events/${this.eventId}/technical-support`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ equipment: selected, staffRequired: Number(this.staffRequired) }) })
        const data = await response.json()
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        if (!response.ok) { this.error = `${data.error || 'Unable to save requirements'} Your input has been kept.`; return }
        this.message = data.late_request ? 'Requirements saved. This is marked as a late request for Technical Support Staff.' : 'Technical support requirements saved and shared with Technical Support Staff.'
      } catch (error) { this.error = `${error.message || 'Unable to save requirements'} Your input has been kept.` }
      finally { this.saving = false }
    }
  },
  mounted() { this.loadEvents() }
}
</script>
