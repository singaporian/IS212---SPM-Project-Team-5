<template>
  <div>
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="delete-equipment-title" @click.self="close" @keydown.esc="close">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 id="delete-equipment-title" class="modal-title">{{ title }}</h5>
            <button class="btn-close" type="button" aria-label="Close" :disabled="deleting" @click="close"></button>
          </div>

          <div class="modal-body">
            <div v-if="checking" class="text-muted small">Checking upcoming reservations...</div>

            <div v-else-if="checkError" class="alert alert-danger mb-0" role="alert">{{ checkError }}</div>

            <template v-else-if="record">
              <div v-if="notice" class="alert alert-info small" role="status">{{ notice }}</div>

              <!-- Blocked: the item is reserved for upcoming events. -->
              <div v-if="conflicts.length" class="alert alert-danger" role="alert">
                <p class="mb-2"><i class="bi bi-slash-circle me-1"></i><strong>This equipment cannot be deleted.</strong> It is reserved for {{ conflicts.length === 1 ? 'an upcoming event' : `${conflicts.length} upcoming events` }}:</p>
                <ul class="mb-2">
                  <li v-for="conflict in conflicts" :key="conflict.id">
                    <router-link :to="{ path: '/equipment/reserve', query: { eventId: conflict.eventId } }" class="alert-link" @click="$emit('close')">{{ conflict.title }}</router-link>
                    — {{ conflict.quantity }} unit{{ conflict.quantity === 1 ? '' : 's' }} reserved<span v-if="conflict.startsAt">, starts {{ formatDate(conflict.startsAt) }}</span><span v-else>, not yet scheduled</span>
                  </li>
                </ul>
                <p class="small mb-0">Remove these reservations first, then try deleting again.</p>
              </div>

              <!-- Step 1: review what will be deleted. -->
              <template v-if="step === 'review'">
                <p v-if="!conflicts.length" class="mb-3">Review this record before deleting it. <span class="text-muted">Step 1 of 2.</span></p>
                <dl class="row mb-0 record-details">
                  <dt class="col-sm-4">Name</dt>
                  <dd class="col-sm-8">{{ record.name }}</dd>
                  <dt class="col-sm-4">Type</dt>
                  <dd class="col-sm-8">{{ record.equipment_type || '—' }}</dd>
                  <dt class="col-sm-4">Quantity</dt>
                  <dd class="col-sm-8">
                    {{ record.total_quantity }} unit{{ record.total_quantity === 1 ? '' : 's' }}
                    <div class="small text-muted">{{ record.available_quantity }} available · {{ record.damaged_quantity || 0 }} damaged · {{ record.maintenance_quantity || 0 }} under maintenance</div>
                  </dd>
                  <dt class="col-sm-4">Specifications</dt>
                  <dd class="col-sm-8 mb-0">
                    <ul v-if="specs.length" class="list-unstyled mb-0">
                      <li v-for="[label, value] in specs" :key="label"><span class="text-muted">{{ label }}:</span> {{ value }}</li>
                    </ul>
                    <span v-else class="text-muted">No specifications</span>
                  </dd>
                </dl>
              </template>

              <!-- Step 2: type the name to confirm. -->
              <form v-else id="delete-equipment-form" novalidate @submit.prevent="confirmDelete">
                <div class="alert alert-warning small" role="alert">
                  <i class="bi bi-exclamation-triangle-fill me-1"></i>
                  <strong>This cannot be undone.</strong> "{{ record.name }}" and its {{ record.total_quantity }} unit{{ record.total_quantity === 1 ? '' : 's' }} will be permanently removed from the inventory, along with its reservation history for past events.
                </div>
                <label class="form-label" for="delete-confirm-name">Type <strong class="user-select-all">{{ record.name }}</strong> to confirm. <span class="text-muted">Step 2 of 2.</span></label>
                <input id="delete-confirm-name" ref="confirmInput" v-model="typedName" class="form-control" type="text" autocomplete="off" spellcheck="false" :disabled="deleting" :aria-invalid="Boolean(typedName) && !nameMatches" aria-describedby="delete-confirm-help">
                <div id="delete-confirm-help" class="form-text">The name must match exactly.</div>
              </form>

              <div v-if="deleteError" class="alert alert-danger small mt-3 mb-0" role="alert"><strong>Not deleted.</strong> {{ deleteError }}</div>
            </template>
          </div>

          <div class="modal-footer">
            <template v-if="checkError">
              <button class="btn btn-outline-secondary" type="button" @click="close">Close</button>
              <button v-if="!notFound" class="btn btn-outline-primary" type="button" @click="check">Retry</button>
            </template>
            <template v-else-if="conflicts.length || checking">
              <button ref="cancelButton" class="btn btn-outline-secondary" type="button" @click="close">Close</button>
            </template>
            <template v-else-if="step === 'review'">
              <button ref="cancelButton" class="btn btn-outline-secondary" type="button" @click="close">Cancel</button>
              <button class="btn btn-danger" type="button" @click="goToConfirm">Continue to delete</button>
            </template>
            <template v-else>
              <button class="btn btn-outline-secondary" type="button" :disabled="deleting" @click="step = 'review'">Back</button>
              <button class="btn btn-danger" type="submit" form="delete-equipment-form" :disabled="!nameMatches || deleting">{{ deleting ? 'Deleting...' : 'Delete permanently' }}</button>
            </template>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop fade show"></div>
  </div>
</template>

<script>
import { getDeletionCheck, deleteEquipment } from '../services/equipment'

// US-025: two-step deletion. Step 1 shows the latest record (and blocks if it is reserved for upcoming events);
// step 2 asks the staff member to type the name. The server repeats every check before deleting.
export default {
  name: 'DeleteEquipmentDialog',
  props: {
    equipmentId: { type: String, required: true }
  },
  emits: ['close', 'deleted'],
  data() {
    return {
      record: null,
      conflicts: [],
      checking: false,
      checkError: '',
      notFound: false,
      step: 'review',
      typedName: '',
      deleting: false,
      deleteError: '',
      notice: ''
    }
  },
  computed: {
    title() {
      if (this.conflicts.length) return 'Equipment is reserved'
      return this.step === 'confirm' ? 'Confirm deletion' : 'Delete equipment?'
    },
    specs() {
      return Object.entries((this.record && this.record.specs) || {})
    },
    nameMatches() {
      return Boolean(this.record) && this.typedName.trim() === this.record.name.trim()
    }
  },
  created() {
    this.check()
  },
  methods: {
    async check() {
      this.checking = true
      this.checkError = ''
      this.notFound = false
      try {
        const result = await getDeletionCheck(this.equipmentId)
        this.record = result.equipment
        this.conflicts = result.conflicts || []
      } catch (error) {
        this.notFound = error.status === 404
        this.checkError = error.message || 'Unable to check whether this equipment can be deleted. Please retry.'
      } finally {
        this.checking = false
        this.focus('cancelButton')
      }
    },
    goToConfirm() {
      this.deleteError = ''
      this.typedName = ''
      this.step = 'confirm'
      this.focus('confirmInput')
    },
    async confirmDelete() {
      if (!this.nameMatches || this.deleting) return
      this.deleting = true
      this.deleteError = ''
      this.notice = ''
      try {
        const result = await deleteEquipment(this.record.id, { confirmName: this.typedName.trim(), expectedUpdatedAt: this.record.updated_at })
        this.$emit('deleted', result)
      } catch (error) {
        if (error.code === 'reserved' && error.conflicts) {
          // A reservation was made after the dialog opened.
          this.conflicts = error.conflicts
          this.step = 'review'
        } else if (error.code === 'stale' && error.equipment) {
          // Someone edited the record: show the new details and ask again from step 1.
          this.record = error.equipment
          this.step = 'review'
          this.notice = 'This record was changed by someone else after you opened it. Review the latest details below before deleting.'
        } else {
          this.deleteError = error.message || 'Unable to delete the equipment record. Please retry.'
        }
      } finally {
        this.deleting = false
      }
    },
    close() {
      if (!this.deleting) this.$emit('close')
    },
    focus(ref) {
      this.$nextTick(() => { if (this.$refs[ref]) this.$refs[ref].focus() })
    },
    formatDate(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
  }
}
</script>

<style scoped>
.record-details dt { font-weight: 600 }
</style>
