<template>
  <div>
    <RequestNavigation />
    <router-link v-if="$route.params.id" to="/requests/submitted" class="d-inline-block mb-3 small">&larr; All submitted requests</router-link>
    <div class="card"><div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div><h2 class="h4 mb-1">{{ $route.params.id ? (request ? request.title : 'Request details') : 'Submitted requests' }}</h2><p class="text-muted mb-0">{{ $route.params.id ? 'Read-only details of your submitted request.' : 'Requests sent for review. Open a request to see its details and current status.' }}</p></div>
      </div>
        <p v-if="$route.query.submitted === '1'" class="alert alert-success" role="status">
          Your request has been submitted successfully and is available to Event Coordinators for review.
        </p>
      <p v-if="loading" role="status">Loading submitted requests…</p>
      <div v-else-if="error" class="alert alert-danger" role="alert">
        {{ error }} <button class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
      </div>
      <template v-else-if="request">
        <p><span class="badge" :class="request.status === 'submitted' ? 'bg-success' : 'bg-primary'">{{ statusLabel(request.status) }}</span></p>
        <p class="text-muted">Submitted {{ formatDate(request.submitted_at) }}. Event times below are Singapore time (UTC+8).</p>
        <dl class="row">
          <template v-for="[key, label] in fields" :key="key">
            <dt class="col-sm-4">{{ label }}</dt>
            <dd class="col-sm-8" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ value(key) }}</dd>
          </template>
        </dl>
        <router-link to="/requests/submitted">All submitted requests</router-link>
      </template>
      <div v-else-if="!requests.length" class="text-center py-5"><h3 class="h5">Nothing submitted yet</h3><p class="text-muted">Complete the required fields, then choose Submit for Review.</p><router-link class="btn btn-primary" to="/requests/drafts">Go to drafts</router-link></div>
      <ul v-else class="list-group">
        <li v-for="item in requests" :key="item.id" class="list-group-item d-flex flex-wrap gap-3 justify-content-between align-items-center py-3">
          <div>
            <router-link :to="{ name: 'submitted-event-request', params: { id: item.id } }">{{ item.title }}</router-link>
            <div class="small text-muted">Submitted {{ formatDate(item.submitted_at) }}</div>
          </div>
          <div class="d-flex align-items-center gap-3"><span class="badge" :class="item.status === 'submitted' ? 'bg-success' : 'bg-primary'">{{ statusLabel(item.status) }}</span><router-link class="btn btn-outline-primary btn-sm" :to="{ name: 'submitted-event-request', params: { id: item.id } }">View request</router-link></div>
        </li>
      </ul>
    </div></div>
  </div>
</template>

<script>
import RequestNavigation from '../components/RequestNavigation.vue'
import { authHeaders } from '../services/auth'

export default {
  name: 'SubmittedRequestsView',
  components: { RequestNavigation },
  data() {
    return {
      request: null, requests: [], loading: true, error: '',
      fields: [['eventName', 'Event Name'], ['purpose', 'Purpose'], ['description', 'Description'],
        ['startDate', 'Start Date'], ['startTime', 'Start Time'], ['endDate', 'End Date'], ['endTime', 'End Time'],
        ['expectedAttendance', 'Expected Attendance'], ['venueRequirements', 'Venue Requirements'],
        ['accessibilityNeeds', 'Accessibility Needs'], ['equipmentRequirements', 'Equipment Requirements'],
        ['registrationNeeds', 'Registration Needs']]
    }
  },
  mounted() { this.load() },
  watch: { '$route.params.id'() { this.load() } },
  methods: {
    statusLabel(status) { return String(status || 'submitted').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) },
    formatDate(value) { return value ? new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) : 'Not recorded' },
    value(key) {
      const value = this.request.draft_data[key]
      if ((key === 'startTime' || key === 'endTime') && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        const [hour, minute] = value.split(':')
        return `${String(Number(hour) % 12 || 12).padStart(2, '0')}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}`
      }
      if (key === 'registrationNeeds') return { yes: 'Required', no: 'Not required', not_decided: 'Not decided' }[value] || 'Not decided'
      return value || 'Not provided'
    },
    async load() {
      const id = this.$route.params.id
      this.loading = true
      this.error = ''
      this.request = null
      this.requests = []
      try {
        const response = await fetch('/api/requests' + (id ? '/' + encodeURIComponent(id) : ''), { headers: authHeaders() })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load submitted requests.')
        if (id !== this.$route.params.id) return
        if (id) this.request = data
        else this.requests = data
      } catch (error) {
        if (id === this.$route.params.id) this.error = error.message || 'Unable to load submitted requests. Please retry.'
      } finally {
        if (id === this.$route.params.id) this.loading = false
      }
    }
  }
}
</script>
