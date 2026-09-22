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

    <div class="card">
      <div class="card-body py-5 text-center">
        <i class="bi bi-calendar-event display-5 text-primary"></i>
        <h2 class="h5 mt-3">Welcome, {{ user.name || 'there' }}</h2>
        <p class="text-muted mb-0">You are signed in as {{ roleLabel }}. Events relevant to your role will be shown here.</p>
      </div>
    </div>
  </section>
</template>

<script>
import { getUser } from '../services/auth'

export default {
  name: 'EventsView',
  computed: {
    user() { return getUser() || {} },
    roleLabel() {
      return (this.user.role || 'attendee').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    }
  }
}
</script>
