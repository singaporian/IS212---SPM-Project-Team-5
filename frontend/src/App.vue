<template>
  <div class="app-root">
    <Header />
    <main class="container py-5">
      <section class="hero d-flex align-items-center">
        <div class="me-4" style="flex:1">
          <h1 class="display-5">ConnectSphere</h1>
          <p class="lead">Seamless campus event planning — requests, bookings, equipment and registrations in one place.</p>
          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-accent btn-lg">Create Request</button>
            <button class="btn btn-outline-secondary btn-lg">View Calendar</button>
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
                  <h5 class="card-title">Venues</h5>
                  <p class="text-muted small mb-2">Search and shortlist suitable venues for your event.</p>
                </div>
                <div>
                  <button class="btn btn-sm btn-outline-primary me-2" @click="loadVenues"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
                  <button class="btn btn-sm btn-accent" @click="loadVenues"><i class="bi bi-search"></i> Find Venues</button>
                </div>
              </div>

              <div class="mt-3">
                <ul class="list-unstyled">
                  <li v-if="!venues.length" class="text-muted">No venues loaded — click Find Venues.</li>
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
              <button class="btn btn-outline-primary btn-sm w-100 mb-2">Start Draft</button>
              <button class="btn btn-outline-secondary btn-sm w-100 mb-2">My Assigned Requests</button>
              <button class="btn btn-outline-success btn-sm w-100">Create Booking</button>
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

      <footer class="footer text-center mt-5">
        <div class="container">
          <div>ConnectSphere — IS212 Team 5</div>
        </div>
      </footer>
    </main>
  </div>
</template>

<script>
import Header from './components/Header.vue'

export default {
  name: 'App',
  components: { Header },
  data() {
    return {
      venues: [],
      backendOk: false
    }
  },
  methods: {
    async loadVenues() {
      try {
        const res = await fetch('/api/venues');
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
.app-root { background: linear-gradient(180deg,#f8fafc,#ffffff); min-height:100vh }
.card { border-radius: .75rem }
</style>
