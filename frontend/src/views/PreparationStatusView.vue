<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div>
        <p class="eyebrow mb-1">{{ readOnly ? 'Coordinator workspace' : 'Venue workspace' }}</p>
        <h1 class="h3">{{ readOnly ? 'Venue Preparation' : 'Preparation Status' }}</h1>
        <p class="text-muted mb-0">
          {{ readOnly ? 'Preparation status of each venue for your confirmed upcoming events.' : 'Update the preparation status of each venue for confirmed upcoming events.' }}
        </p>
      </div>
      <button class="btn btn-outline-primary" :disabled="loading" @click="load">Refresh</button>
    </div>

    <p v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</p>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="!loading && !rows.length && !error" class="empty-state text-center">No confirmed upcoming venue bookings.</div>

    <table v-if="rows.length" class="table align-middle">
      <thead>
        <tr>
          <th scope="col">Event</th><th scope="col">Venue</th><th scope="col">Date</th><th scope="col">Time</th>
          <th scope="col">Preparation Status</th><th v-if="!readOnly" scope="col">Update</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.event_title }}</td>
          <td>{{ row.venue_name }}</td>
          <td>{{ formatDate(row.start_time) }}</td>
          <td>{{ formatTime(row.start_time, row.end_time) }}</td>
          <td><span class="badge bg-secondary" data-testid="current-status">{{ label(row.preparation_status) }}</span></td>
          <td v-if="!readOnly">
            <div class="d-flex gap-2">
              <select v-model="row.selected" class="form-select form-select-sm" :aria-label="`Preparation status for ${row.venue_name}`">
                <option v-for="(text, value) in labels" :key="value" :value="value">{{ text }}</option>
              </select>
              <button class="btn btn-primary btn-sm" :disabled="busyId === row.id" @click="save(row)">Save</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
import { fetchPreparationBookings, savePreparationStatus, fetchMyPreparation } from '../services/preparation'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000
// US-021 (AC2): must match PREPARATION_STATUSES in backend/src/domain/index.js.
const LABELS = Object.freeze({ not_started: 'Not Started', in_progress: 'In Progress', ready: 'Ready' })

// One page for both roles: Venue Staff update (AC1, AC2), the assigned Coordinator only views (readOnly, AC3).
export default {
  name: 'PreparationStatusView',
  props: { readOnly: { type: Boolean, default: false } },
  data() {
    return { rows: [], labels: LABELS, loading: false, error: '', successMessage: '', busyId: '' }
  },
  methods: {
    async load() {
      this.loading = true
      this.error = ''
      try {
        const rows = await (this.readOnly ? fetchMyPreparation() : fetchPreparationBookings())
        // `selected` is the value chosen in the dropdown; `preparation_status` is the saved value.
        this.rows = rows.map((row) => ({ ...row, selected: row.preparation_status }))
      } catch (error) {
        this.error = error.message || 'Unable to load preparation status. Please retry.'
      } finally {
        this.loading = false
      }
    },

    // AC4: saves one venue booking only. AC6: on failure the saved status stays and the choice is kept for a retry.
    async save(row) {
      if (this.busyId) return
      this.busyId = row.id
      this.error = ''
      this.successMessage = ''
      try {
        const saved = await savePreparationStatus(row.id, row.selected)
        row.preparation_status = saved.preparation_status
        this.successMessage = `Preparation status for ${row.event_title} at ${row.venue_name} saved as ${this.label(saved.preparation_status)}.`
      } catch (error) {
        this.error = error.message || 'Unable to save preparation status. Please retry.'
      } finally {
        this.busyId = ''
      }
    },

    label(status) { return LABELS[status] || status },

    // Singapore time, e.g. "1 Mar 2099" and "9:00 AM – 12:00 PM".
    sgtParts(value) {
      const d = new Date(new Date(value).getTime() + SGT_OFFSET_MS)
      const hours = d.getUTCHours()
      return {
        date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        time: `${hours % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
      }
    },
    formatDate(value) { return value ? this.sgtParts(value).date : 'Not specified' },
    formatTime(start, end) {
      return start && end ? `${this.sgtParts(start).time} – ${this.sgtParts(end).time}` : 'Not specified'
    }
  },
  mounted() {
    this.load()
  }
}
</script>

<style scoped>
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
</style>
