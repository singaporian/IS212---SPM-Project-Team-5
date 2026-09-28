<template>
  <section>
    <div class="d-flex justify-content-between align-items-end mb-4">
      <div>
        <p class="eyebrow mb-1">Event workspace</p>
        <h1 class="h3 mb-1">Events</h1>
        <p class="text-muted mb-0">Your event activity will appear here as event workflows are added.</p>
      </div>
      <router-link to="/" class="btn btn-outline-secondary">Back to Dashboard</router-link>
    </div>
    <div v-if="isOrganiser" class="card">
      <div class="card-body">
        <h5 class="card-title">My Event Requests</h5>

        <!-- Three mutually exclusive states while data loads, in order of priority:
             loading spinner text, then an error with a retry button, then the
             actual list (or an empty-state message if the list is empty). -->
        <p v-if="loading" role="status">Loading…</p>
        <div v-else-if="error" class="alert alert-danger" role="alert">
          {{ error }} <button class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
        </div>
        <p v-else-if="!events.length" class="text-muted small mb-0">No submitted event requests yet.</p>

        <!-- The actual list: one row per event, title + status on the left,
             a "Request Changes" link on the right that routes to the change-request
             form for that specific event (its id is passed as a route param). -->
        <ul v-else class="list-unstyled">
          <li v-for="ev in events" :key="ev.id"
            class="d-flex justify-content-between align-items-center border-bottom py-2">
            <div>
              <div class="fw-semibold">{{ ev.title || 'Untitled event' }}</div>
              <div class="small text-muted">Status: {{ ev.status }}</div>
            </div>
            <router-link class="btn btn-sm btn-outline-primary"
              :to="{ name: 'event-change-request', params: { id: ev.id } }">Request Changes</router-link>
          </li>
        </ul>
      </div>
    </div>

    <div class="card">
      <div class="card-body py-5 text-center">
        <i class="bi bi-calendar-event display-5 text-primary"></i>
        <h2 class="h5 mt-3">Welcome, {{ user.name || 'there' }}</h2>
        <p class="text-muted mb-0">You are signed in as {{ roleLabel }}. Events relevant to your role will be shown
          here.</p>
      </div>
    </div>
  </section>
</template>

<script>
import { getUser } from '../services/auth'
import { fetchMyEvents } from '../services/changeRequests'

export default {
  name: 'EventsView',
  data() { return { events: [], loading: false, error: '' } },
  computed: {
    user() { return getUser() || {} },
     isOrganiser() { return this.user.role === 'event_organiser' },
    roleLabel() {
      return (this.user.role || 'attendee').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    }
},
 mounted() { if (this.isOrganiser) this.load() },
  methods: {
    // NEW: fetches the Organiser's own non-draft events and tracks loading/error
    // state for the three template branches above. Also called by the Retry button.
    async load() {
      this.loading = true
      this.error = ''
      try { this.events = await fetchMyEvents() }
      catch (error) { this.error = error.message || 'Unable to load your event requests.' }
      finally { this.loading = false }
    }
  }
}
</script>
