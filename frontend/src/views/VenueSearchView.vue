<template>
  <div class="venue-search-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Venue workspace</p>
        <h1 class="mb-1">Find a suitable venue</h1>
        <p class="text-muted mb-0">Search venues that fit your event requirements and schedule.</p>
      </div>
      <router-link class="btn btn-outline-secondary" to="/">Back to Home</router-link>
    </div>

    <section class="card search-panel mb-4">
      <div class="card-body">
        <form @submit.prevent="searchVenues">
          <div class="input-group input-group-lg mb-3">
            <span class="input-group-text"><i class="bi bi-search"></i></span>
            <input v-model.trim="filters.search" class="form-control" type="search" placeholder="Search by venue name or location" aria-label="Search by venue name or location">
            <button class="btn btn-accent" type="submit" :disabled="loading">{{ loading ? 'Searching...' : 'Search venues' }}</button>
          </div>

          <div class="row g-3">
            <div class="col-md-3">
              <label class="form-label" for="venue-date">Date</label>
              <input id="venue-date" v-model="filters.date" class="form-control" type="date">
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-start">Start time</label>
              <input id="venue-start" v-model="filters.startTime" class="form-control" type="time">
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-end">End time</label>
              <input id="venue-end" v-model="filters.endTime" class="form-control" type="time">
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-attendance">Expected attendance</label>
              <input id="venue-attendance" v-model.number="filters.attendance" class="form-control" type="number" min="1" placeholder="Any capacity">
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-layout">Room layout</label>
              <select id="venue-layout" v-model="filters.layout" class="form-select">
                <option value="">Any layout</option>
                <option v-for="layout in layouts" :key="layout" :value="layout">{{ layout }}</option>
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-facility">Facility</label>
              <input id="venue-facility" v-model.trim="filters.facility" class="form-control" type="text" placeholder="e.g. Projector">
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-accessibility">Accessibility needs</label>
              <input id="venue-accessibility" v-model.trim="filters.accessibility" class="form-control" type="text" placeholder="e.g. wheelchair access">
            </div>
          </div>
          <p v-if="formError" class="text-danger small mt-3 mb-0">{{ formError }}</p>
        </form>
      </div>
    </section>

    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h5 mb-0">{{ venues.length }} matching venue{{ venues.length === 1 ? '' : 's' }}</h2>
      <button v-if="hasFilters" class="btn btn-link btn-sm text-decoration-none" type="button" @click="clearFilters">Clear filters</button>
    </div>

    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-else-if="!loading && !venues.length" class="empty-state text-center">
      <i class="bi bi-building-exclamation fs-2"></i>
      <h2 class="h5 mt-3">No venues match your criteria</h2>
      <p class="text-muted mb-0">Try adjusting your date, time, capacity, or other filters.</p>
    </div>
    <div v-else class="row g-4">
      <div v-for="venue in venues" :key="venue.id" class="col-lg-6">
        <article class="card venue-card h-100">
          <div v-if="venue.images && venue.images.length" class="venue-image-panel">
            <img class="venue-image" :src="venue.images[0].url" :alt="venue.images[0].alt_text || `${venue.name} venue`">
          </div>
          <div class="card-body venue-content">
            <div class="venue-heading mb-3">
              <div>
                <h2 class="h5 mb-1">{{ venue.name }}</h2>
                <p class="text-muted mb-0"><i class="bi bi-geo-alt me-1"></i>{{ venue.location || 'Location not provided' }}</p>
                <span class="capacity-badge">{{ venue.capacity }} seats</span>
              </div>
            </div>
            <div class="venue-details">
              <div>
                <span class="detail-label">Supported layouts</span>
                <span>{{ listValue(venue.supported_layouts) }}</span>
              </div>
              <div>
                <span class="detail-label">Accessibility</span>
                <span>{{ listValue(venue.accessibility) }}</span>
              </div>
              <div>
                <span class="detail-label">Facilities</span>
                <span>{{ listValue(venue.facilities) }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script>
import { authHeaders, clearSession } from '../services/auth'

export default {
  name: 'VenueSearchView',
  data() {
    return {
      venues: [],
      loading: false,
      error: '',
      formError: '',
      layouts: ['Theatre', 'Classroom', 'Boardroom', 'U-shape', 'Banquet', 'Cabaret'],
      filters: {
        search: '',
        date: '',
        startTime: '',
        endTime: '',
        attendance: null,
        layout: '',
        facility: '',
        accessibility: ''
      }
    }
  },
  computed: {
    hasFilters() {
      return Object.values(this.filters).some(value => value !== '' && value !== null)
    }
  },
  methods: {
    async searchVenues() {
      this.formError = ''
      this.error = ''
      if ((this.filters.startTime || this.filters.endTime) && !this.filters.date) {
        this.formError = 'Select a date when filtering by time.'
        return
      }
      if ((this.filters.startTime && !this.filters.endTime) || (!this.filters.startTime && this.filters.endTime)) {
        this.formError = 'Enter both a start and end time.'
        return
      }
      if (this.filters.startTime && this.filters.endTime && this.filters.endTime <= this.filters.startTime) {
        this.formError = 'End time must be later than start time.'
        return
      }

      this.loading = true
      const query = new URLSearchParams()
      Object.entries(this.filters).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) query.set(key, value)
      })
      try {
        const response = await fetch(`/api/venues?${query.toString()}`, { headers: authHeaders() })
        if (response.status === 401) {
          clearSession()
          this.$router.push('/login')
          return
        }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to search venues')
        this.venues = data
      } catch (err) {
        this.error = err.message
        this.venues = []
      } finally {
        this.loading = false
      }
    },
    clearFilters() {
      this.filters = { search: '', date: '', startTime: '', endTime: '', attendance: null, layout: '', facility: '', accessibility: '' }
      this.searchVenues()
    },
    listValue(value) {
      if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not listed'
      return value || 'Not listed'
    },
  },
  mounted() {
    this.searchVenues()
  }
}
</script>

<style scoped>
.search-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
.venue-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); overflow: hidden; border: 1px solid #e9edf3; border-radius: .75rem }
.venue-image-panel { min-height: 100%; background: #eef2f5 }
.venue-image { width: 100%; height: 100%; min-height: 240px; object-fit: cover }
.venue-content { min-width: 0 }
.venue-heading { min-width: 0 }
.venue-heading > div:first-child { min-width: 0 }
.capacity-badge { display: block; margin-top: .45rem; color: #0d6efd; white-space: nowrap; font-size: .95rem; font-weight: 700 }
.venue-details { display: grid; gap: .85rem; color: #495057; font-size: .92rem }
.detail-label { display: block; color: #6c757d; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: .15rem }
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }

@media (max-width: 575.98px) {
  .venue-card { grid-template-columns: 1fr }
  .venue-image { height: 200px; min-height: 0 }
}
</style>
