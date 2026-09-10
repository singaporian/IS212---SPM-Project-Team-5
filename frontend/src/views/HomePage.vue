<template>
  <div>
    <section class="hero d-flex align-items-center">
      <div class="me-4" style="flex:1">
          <h1 class="display-5">{{ greeting }}</h1>
          <p class="lead">{{ roleDescription }}</p>
        <div class="d-flex gap-2 mt-3">
            <router-link v-if="canCreateRequest" class="btn btn-accent btn-lg" to="/requests/new">Create Request</router-link>
            <button class="btn btn-outline-secondary btn-lg">{{ secondaryAction }}</button>
        </div>
      </div>
      <div style="width:280px">
        <div class="stat-card text-center">
          <div class="h2 mb-0">{{ venues.length }}</div>
          <div class="small text-muted">Known venues</div>
        </div>
      </div>
    </section>

    <div class="row gx-4">
      <div class="col-lg-8">
        <div class="card mb-4">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <h5 class="card-title">{{ workspaceTitle }}</h5>
                <p class="text-muted small mb-2">{{ workspaceDescription }}</p>
              </div>
              <div>
                <button class="btn btn-sm btn-outline-primary me-2" @click="loadVenues"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
                  <router-link v-if="canSearchVenues" class="btn btn-sm btn-accent" to="/venues"><i class="bi bi-search"></i> Find Venues</router-link>
              </div>
            </div>

            <div class="mt-3">
              <ul class="list-unstyled">
                  <li v-if="!venues.length && canSearchVenues" class="text-muted">Use Find Venues to search the venue directory.</li>
                  <li v-if="!canSearchVenues" class="text-muted">Your role workspace is ready. More tools will appear as features are added.</li>
                <li v-for="v in venues" :key="v.id" class="list-group-item d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold">{{ v.name }}</div>
                    <div class="small text-muted">{{ v.location || '—' }}</div>
                  </div>
                  <div class="text-end">
                    <div class="badge bg-light text-dark">Capacity: {{ v.capacity }}</div>
                    <div class="small d-block text-muted">{{ (v.facilities && v.facilities.length) ? v.facilities.join(', ') : 'No facilities listed' }}</div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card quick-actions mb-3">
          <div class="card-body">
              <h6>Quick Actions</h6>
              <router-link v-if="canCreateRequest" class="btn btn-outline-primary btn-sm w-100 mb-2" to="/requests/new">Start Draft</router-link>
              <button class="btn btn-outline-secondary btn-sm w-100 mb-2">{{ primaryRoleAction }}</button>
              <button v-if="canSearchVenues" class="btn btn-outline-success btn-sm w-100">Create Booking</button>
          </div>
        </div>

        <div class="card mb-3">
          <div class="card-body">
            <h6>Status</h6>
            <p class="mb-0">Backend: <span :class="{'text-success': backendOk, 'text-danger': !backendOk}">{{ backendOk ? 'OK' : 'Not reachable' }}</span></p>
          </div>
        </div>

        <div class="card">
          <div class="card-body">
            <h6>Help</h6>
            <p class="small text-muted mb-0">Need help? Check the project README for startup instructions or contact your team lead.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'
import { getUser } from '../services/auth'

export default {
  name: 'HomePage',
  data() {
    return {
      venues: [],
      backendOk: false
    }
  },
  computed: {
    user() { return getUser() || {} },
    role() { return this.user.role || 'attendee' },
    canSearchVenues() { return ['event_coordinator', 'venue_staff'].includes(this.role) },
    canCreateRequest() { return ['event_organiser'].includes(this.role) },
    greeting() { return `Welcome, ${this.user.name || 'there'}` },
    roleDescription() {
      const descriptions = {
        attendee: 'Discover confirmed events, manage your registrations, and stay up to date.',
        event_organiser: 'Shape your event from an early idea into a clear request for ConnectSphere.',
        event_coordinator: 'Coordinate event requests, venues, schedules, and stakeholder decisions.',
        venue_staff: 'Keep venue availability, bookings, and preparation on track.',
        technical_support_staff: 'Plan equipment and technical support for every event.'
      }
      return descriptions[this.role] || descriptions.attendee
    },
    secondaryAction() { return this.role === 'attendee' ? 'Browse Events' : 'View Calendar' },
    workspaceTitle() { return this.canSearchVenues ? 'Venue workspace' : 'Your workspace' },
    workspaceDescription() { return this.canSearchVenues ? 'Search and shortlist suitable venues for your event.' : 'Role-specific tools and updates will appear here.' },
    primaryRoleAction() {
      const actions = { attendee: 'My Registrations', event_organiser: 'My Event Requests', event_coordinator: 'Assigned Requests', venue_staff: 'Upcoming Bookings', technical_support_staff: 'Support Schedule' }
      return actions[this.role] || 'My Workspace'
    }
  },
  methods: {
    async loadVenues() {
      try {
        const res = await fetch('/api/venues', { headers: authHeaders() });
        if (res.status === 401) {
          clearSession();
          this.$router.push('/login');
          return;
        }
        if (!res.ok) throw new Error('network');
        this.venues = await res.json();
      } catch (e) {
        console.error(e);
        this.venues = [];
      }
    }
  },
  async mounted() {
    try {
      const r = await fetch('/api/health');
      this.backendOk = r.ok;
    } catch (e) {
      this.backendOk = false;
    }
  }
}
</script>

<style scoped>
.card { border-radius: .75rem }
</style>