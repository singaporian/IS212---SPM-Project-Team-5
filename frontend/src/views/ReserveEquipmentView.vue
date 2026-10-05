<template>
  <div class="reserve-equipment-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Equipment inventory</p>
        <h1 class="mb-1">Reserve equipment</h1>
        <p class="text-muted mb-0">Commit available equipment to an approved event. Units already committed to an overlapping event cannot be reserved twice.</p>
      </div>
      <router-link class="btn btn-outline-secondary" to="/">Back to Home</router-link>
    </div>

    <div ref="feedback">
      <div v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</div>
      <div v-if="conflictMessage" class="alert alert-warning" role="alert"><strong>Not reserved.</strong> {{ conflictMessage }}</div>
      <div v-if="saveError" class="alert alert-danger" role="alert">{{ saveError }}</div>
    </div>

    <div class="card form-panel mb-4">
      <div class="card-body">
        <label class="form-label" for="reservation-event">Event <span class="text-danger" aria-hidden="true">*</span></label>
        <div v-if="loadingEvents" class="text-muted small">Loading events...</div>
        <div v-else-if="eventsError" class="d-flex align-items-center gap-2">
          <span class="text-danger small">{{ eventsError }}</span>
          <button class="btn btn-sm btn-outline-primary" type="button" @click="loadEvents">Retry</button>
        </div>
        <p v-else-if="!events.length" class="text-muted small mb-0">There are no approved events with an upcoming venue booking to reserve equipment for.</p>
        <template v-else>
          <select id="reservation-event" v-model="selectedEventId" class="form-select" :disabled="saving" @change="selectEvent">
            <option value="">Select an event</option>
            <option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }} — {{ formatWindow(event.windows[0]) }}{{ event.windows.length > 1 ? ` (+${event.windows.length - 1} more)` : '' }}</option>
          </select>
          <div v-if="selectedEvent" class="mt-2 small">
            <span class="text-muted">Scheduled:</span>
            <ul class="mb-0 ps-3">
              <li v-for="(window, index) in selectedEvent.windows" :key="index">{{ formatWindow(window) }}<span v-if="window.venue" class="text-muted"> · {{ window.venue }}</span></li>
            </ul>
          </div>
        </template>
      </div>
    </div>

    <template v-if="selectedEventId">
      <div class="card form-panel mb-4">
        <div class="card-body">
          <h5 class="card-title">Reserve for this event</h5>
          <form novalidate @submit.prevent="reserve" @input="successMessage = ''">
            <fieldset :disabled="saving || loadingAvailability">
              <div class="row g-3 align-items-start">
                <div class="col-md-6">
                  <label class="form-label" for="reservation-equipment">Equipment <span class="text-danger" aria-hidden="true">*</span></label>
                  <select id="reservation-equipment" v-model="form.equipmentId" class="form-select" :class="{ 'is-invalid': showErrors && errors.equipmentId }">
                    <option value="">Select equipment</option>
                    <option v-for="item in reservableEquipment" :key="item.id" :value="item.id">{{ item.name }} — {{ item.available }} of {{ item.total_quantity }} available</option>
                  </select>
                  <div v-if="showErrors && errors.equipmentId" class="invalid-feedback">{{ errors.equipmentId }}</div>
                </div>
                <div class="col-md-3">
                  <label class="form-label" for="reservation-quantity">Quantity <span class="text-danger" aria-hidden="true">*</span></label>
                  <input id="reservation-quantity" v-model="form.quantity" class="form-control" :class="{ 'is-invalid': (showErrors || form.quantity !== '') && errors.quantity }" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 2">
                  <div v-if="(showErrors || form.quantity !== '') && errors.quantity" class="invalid-feedback">{{ errors.quantity }}</div>
                </div>
                <div class="col-md-3">
                  <span class="form-label d-none d-md-block invisible" aria-hidden="true">Reserve</span>
                  <button class="btn btn-accent w-100" type="submit">{{ saving ? 'Reserving...' : 'Reserve' }}</button>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>

      <div class="card form-panel">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="card-title mb-0">Equipment during this event</h5>
            <button class="btn btn-sm btn-outline-primary" type="button" :disabled="loadingAvailability" @click="loadAvailability"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
          </div>
          <div v-if="loadingAvailability && !equipment.length" class="text-muted small">Loading equipment...</div>
          <div v-else-if="availabilityError" class="text-danger small">{{ availabilityError }}</div>
          <p v-else-if="!equipment.length" class="text-muted small mb-0">The inventory is empty. Add equipment first.</p>
          <div v-else class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Equipment</th>
                  <th scope="col" class="text-end">Total</th>
                  <th scope="col" class="text-end">Overlapping events</th>
                  <th scope="col" class="text-end">This event</th>
                  <th scope="col" class="text-end">Available</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in equipment" :key="item.id">
                  <td>
                    <div class="fw-semibold">{{ item.name }}</div>
                    <div class="small text-muted">{{ item.equipment_type || '—' }}</div>
                    <div v-if="item.overlapping_events.length" class="small text-muted">Held by: {{ item.overlapping_events.map(e => `${e.title} (${e.quantity})`).join(', ') }}</div>
                  </td>
                  <td class="text-end">{{ item.total_quantity }}</td>
                  <td class="text-end">{{ item.committed_elsewhere }}</td>
                  <td class="text-end">{{ item.reserved_for_event }}</td>
                  <td class="text-end">{{ item.available }}</td>
                  <td>
                    <span v-if="item.reservation" class="badge bg-primary">Reserved</span>
                    <span v-else-if="item.status !== 'available'" class="badge bg-secondary">Out of service</span>
                    <span v-else-if="item.available === 0" class="badge bg-warning text-dark">Fully committed</span>
                    <span v-else class="badge bg-success">Available</span>
                  </td>
                  <td class="text-end">
                    <button v-if="item.reservation" class="btn btn-sm btn-outline-danger" type="button" :disabled="saving || removingId === item.reservation.id" @click="askRemoval(item)">Remove</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <template v-if="pendingRemoval">
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="remove-reservation-title" @click.self="cancelRemoval" @keydown.esc="cancelRemoval">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 id="remove-reservation-title" class="modal-title">Remove reservation?</h5>
              <button class="btn-close" type="button" aria-label="Close" :disabled="Boolean(removingId)" @click="cancelRemoval"></button>
            </div>
            <div class="modal-body">
              <p class="mb-2">Remove the reservation of <strong>{{ pendingRemoval.reservation.quantity }} "{{ pendingRemoval.name }}"</strong> unit{{ pendingRemoval.reservation.quantity === 1 ? '' : 's' }} for <strong>{{ selectedEvent ? selectedEvent.title : 'this event' }}</strong>?</p>
              <p class="text-muted small mb-0">The units return to available stock immediately.</p>
              <div v-if="removalError" class="alert alert-danger small mt-3 mb-0" role="alert">{{ removalError }}</div>
            </div>
            <div class="modal-footer">
              <button ref="cancelRemovalButton" class="btn btn-outline-secondary" type="button" :disabled="Boolean(removingId)" @click="cancelRemoval">Keep reservation</button>
              <button class="btn btn-danger" type="button" :disabled="Boolean(removingId)" @click="remove">{{ removingId ? 'Removing...' : (removalError ? 'Try again' : 'Remove reservation') }}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show"></div>
    </template>
  </div>
</template>

<script>
import { listReservableEvents, getEquipmentAvailability, reserveEquipment, removeReservation } from '../services/equipment'

const MAX_QUANTITY = 2147483647

export default {
  name: 'ReserveEquipmentView',
  data() {
    return {
      events: [],
      loadingEvents: false,
      eventsError: '',
      selectedEventId: '',
      equipment: [],
      loadingAvailability: false,
      availabilityError: '',
      form: { equipmentId: '', quantity: '' },
      showErrors: false,
      saving: false,
      removingId: '',
      pendingRemoval: null,
      removalError: '',
      successMessage: '',
      conflictMessage: '',
      saveError: ''
    }
  },
  computed: {
    selectedEvent() {
      return this.events.find(event => event.id === this.selectedEventId) || null
    },
    reservableEquipment() {
      return this.equipment.filter(item => item.status === 'available')
    },
    errors() {
      const quantity = String(this.form.quantity).trim()
      const errors = { equipmentId: '', quantity: '' }
      if (!this.form.equipmentId) errors.equipmentId = 'Choose the equipment to reserve.'
      if (!quantity) errors.quantity = 'Quantity is required.'
      else if (!/^\d+$/.test(quantity) || Number(quantity) <= 0) errors.quantity = 'Quantity must be a positive whole number.'
      else if (Number(quantity) > MAX_QUANTITY) errors.quantity = 'Quantity is too large.'
      return errors
    },
    hasErrors() {
      return Boolean(this.errors.equipmentId || this.errors.quantity)
    }
  },
  mounted() {
    this.loadEvents()
  },
  methods: {
    formatWindow(window) {
      if (!window) return ''
      const options = { timeZone: 'Asia/Singapore' }
      const start = new Date(window.start), end = new Date(window.end)
      const day = start.toLocaleDateString('en-GB', { ...options, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      const time = value => value.toLocaleTimeString('en-US', { ...options, hour: 'numeric', minute: '2-digit', hour12: true })
      return `${day}, ${time(start)} – ${time(end)}`
    },
    clearMessages() {
      this.successMessage = ''
      this.conflictMessage = ''
      this.saveError = ''
    },
    async loadEvents() {
      this.loadingEvents = true
      this.eventsError = ''
      try {
        this.events = await listReservableEvents()
      } catch (error) {
        this.eventsError = error.message || 'Unable to load events.'
      } finally {
        this.loadingEvents = false
      }
    },
    selectEvent() {
      this.clearMessages()
      this.form = { equipmentId: '', quantity: '' }
      this.showErrors = false
      this.equipment = []
      if (this.selectedEventId) return this.loadAvailability()
    },
    async loadAvailability() {
      const eventId = this.selectedEventId
      if (!eventId) return
      this.loadingAvailability = true
      this.availabilityError = ''
      try {
        const data = await getEquipmentAvailability(eventId)
        if (eventId === this.selectedEventId) this.equipment = data.equipment
      } catch (error) {
        if (eventId === this.selectedEventId) this.availabilityError = error.message || 'Unable to load equipment availability.'
      } finally {
        this.loadingAvailability = false
      }
    },
    async reserve() {
      if (this.saving) return
      this.clearMessages()
      this.showErrors = true
      if (this.hasErrors) return
      this.saving = true
      try {
        const result = await reserveEquipment({
          eventId: this.selectedEventId,
          equipmentId: this.form.equipmentId,
          quantity: Number(String(this.form.quantity).trim())
        })
        this.successMessage = result.message || 'Reservation saved.'
        this.form = { equipmentId: '', quantity: '' }
        this.showErrors = false
        await this.loadAvailability()
      } catch (error) {
        // The form keeps its values so staff can adjust or retry; the table still reflects the last saved state.
        if (error.status === 409) {
          this.conflictMessage = error.message
          await this.loadAvailability()
        } else {
          this.saveError = (error.message || 'Unable to save the reservation.') + ' Your input has been kept.'
        }
      } finally {
        this.saving = false
        this.scrollToFeedback()
      }
    },
    askRemoval(item) {
      if (!item.reservation || this.removingId) return
      this.pendingRemoval = item
      this.removalError = ''
      this.$nextTick(() => { if (this.$refs.cancelRemovalButton) this.$refs.cancelRemovalButton.focus() })
    },
    cancelRemoval() {
      if (this.removingId) return
      this.pendingRemoval = null
      this.removalError = ''
    },
    async remove() {
      const item = this.pendingRemoval
      if (!item || this.removingId) return
      this.clearMessages()
      this.removalError = ''
      this.removingId = item.reservation.id
      try {
        const result = await removeReservation(item.reservation.id)
        this.pendingRemoval = null
        this.successMessage = result.message || 'Reservation removed.'
        await this.loadAvailability()
      } catch (error) {
        if (error.status === 404) {
          this.pendingRemoval = null
          this.saveError = error.message
          await this.loadAvailability()
        } else {
          // Keep the dialog open so staff can retry; the reservation is still in place.
          this.removalError = (error.message || 'Unable to remove the reservation.') + ' The reservation is unchanged.'
        }
      } finally {
        this.removingId = ''
        if (!this.pendingRemoval) this.scrollToFeedback()
      }
    },
    scrollToFeedback() {
      this.$nextTick(() => {
        if (this.$refs.feedback && this.$refs.feedback.scrollIntoView) this.$refs.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }
}
</script>

<style scoped>
.form-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
</style>
