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
            <input v-model.trim="filters.search" @input="searchVenues" class="form-control" type="search" placeholder="Search by venue name or location" aria-label="Search by venue name or location">
            <button class="btn btn-accent" type="submit" :disabled="loading">{{ loading ? 'Searching...' : 'Search venues' }}</button>
          </div>

          <div class="row g-3">
            <div class="col-md-3">
              <label class="form-label" for="venue-date">Date</label>
              <input id="venue-date" v-model="filters.date" @change="handleDateChange" class="form-control" type="date">
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-start">Start time</label>
              <div class="time-selectors">
                <select id="venue-start" v-model="startHour" class="form-select" aria-label="Start hour" @change="handleTimeInput">
                  <option value="">Hour</option>
                  <option v-for="hour in hours" :key="`start-hour-${hour}`" :value="hour">{{ hour }}</option>
                </select>
                <select v-model="startMinute" class="form-select" aria-label="Start minute" @change="handleTimeInput">
                  <option value="">Minute</option>
                  <option v-for="minute in minutes" :key="`start-minute-${minute}`" :value="minute">{{ minute }}</option>
                </select>
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-end">End time</label>
              <div class="time-selectors">
                <select id="venue-end" v-model="endHour" class="form-select" aria-label="End hour" @change="handleTimeInput">
                  <option value="">Hour</option>
                  <option v-for="hour in hours" :key="`end-hour-${hour}`" :value="hour">{{ hour }}</option>
                </select>
                <select v-model="endMinute" class="form-select" aria-label="End minute" @change="handleTimeInput">
                  <option value="">Minute</option>
                  <option v-for="minute in minutes" :key="`end-minute-${minute}`" :value="minute">{{ minute }}</option>
                </select>
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="venue-attendance">Expected attendance</label>
              <input id="venue-attendance" v-model.number="filters.attendance" @input="searchVenues" class="form-control" type="number" min="1" step="1" placeholder="Any capacity">
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-layout">Room layout</label>
              <div class="layout-dropdown" @click.stop>
                <button id="venue-layout" class="form-select layout-dropdown-toggle text-start" type="button" :aria-expanded="layoutDropdownOpen" @click="layoutDropdownOpen = !layoutDropdownOpen">
                  {{ filters.layout.length ? filters.layout.join(', ') : 'Any layout' }}
                </button>
                <div v-if="layoutDropdownOpen" class="layout-dropdown-menu">
                  <label v-for="layout in layouts" :key="layout" class="layout-option">
                    <input v-model="filters.layout" type="checkbox" :value="layout" @change="searchVenues">
                    <span>{{ layout }}</span>
                  </label>
                  <button v-if="filters.layout.length" class="btn btn-link btn-sm layout-clear" type="button" @click="clearLayoutFilter">Clear selection</button>
                </div>
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-facility">Facility</label>
              <div class="layout-dropdown" @click.stop>
                <button id="venue-facility" class="form-select layout-dropdown-toggle text-start" type="button" :aria-expanded="facilityDropdownOpen" @click="facilityDropdownOpen = !facilityDropdownOpen">
                  {{ filters.facility.length ? filters.facility.join(', ') : 'Any facility' }}
                </button>
                <div v-if="facilityDropdownOpen" class="layout-dropdown-menu">
                  <label v-for="facility in facilities" :key="facility" class="layout-option">
                    <input v-model="filters.facility" type="checkbox" :value="facility" @change="searchVenues">
                    <span>{{ facility }}</span>
                  </label>
                  <button v-if="filters.facility.length" class="btn btn-link btn-sm layout-clear" type="button" @click="clearFacilityFilter">Clear selection</button>
                </div>
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label" for="venue-accessibility">Accessibility needs</label>
              <div class="layout-dropdown" @click.stop>
                <button id="venue-accessibility" class="form-select layout-dropdown-toggle text-start" type="button" :aria-expanded="accessibilityDropdownOpen" @click="accessibilityDropdownOpen = !accessibilityDropdownOpen">
                  {{ filters.accessibility.length ? filters.accessibility.join(', ') : 'Any accessibility need' }}
                </button>
                <div v-if="accessibilityDropdownOpen" class="layout-dropdown-menu">
                  <label v-for="need in accessibilityNeeds" :key="need" class="layout-option">
                    <input v-model="filters.accessibility" type="checkbox" :value="need" @change="searchVenues">
                    <span>{{ need }}</span>
                  </label>
                  <button v-if="filters.accessibility.length" class="btn btn-link btn-sm layout-clear" type="button" @click="clearAccessibilityFilter">Clear selection</button>
                </div>
              </div>
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
                <div v-if="venue.unavailable_periods && venue.unavailable_periods.length" class="unavailability-note">
                  <span class="detail-label">Unavailable</span>
                  <span v-for="period in venue.unavailable_periods" :key="`${period.start_time}-${period.end_time}`">
                    {{ formatUnavailablePeriod(period) }}<span v-if="period.reason"> [{{ period.reason }}]</span>
                  </span>
                </div>
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
      layoutDropdownOpen: false,
      facilityDropdownOpen: false,
      accessibilityDropdownOpen: false,
      hours: Array.from({ length: 15 }, (_, index) => String(index + 8).padStart(2, '0')),
      minutes: ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'],
      layouts: ['Theater', 'Classroom', 'Banquet', 'Boardroom'],
      facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
      accessibilityNeeds: ['wheelchair ramps', 'accessible parking'],
      filters: {
        search: '',
        date: '',
        startTime: '',
        endTime: '',
        attendance: null,
        layout: [],
        facility: [],
        accessibility: []
      }
    }
  },
  computed: {
    startHour: {
      get() { return this.filters.startTime ? this.filters.startTime.split(':')[0] : '' },
      set(value) { this.filters.startTime = value ? `${value}:${this.startMinute || '00'}` : '' }
    },
    startMinute: {
      get() { return this.filters.startTime ? this.filters.startTime.split(':')[1] : '' },
      set(value) { this.filters.startTime = value ? `${this.startHour || '08'}:${value}` : '' }
    },
    endHour: {
      get() { return this.filters.endTime ? this.filters.endTime.split(':')[0] : '' },
      set(value) { this.filters.endTime = value ? `${value}:${this.endMinute || '00'}` : '' }
    },
    endMinute: {
      get() { return this.filters.endTime ? this.filters.endTime.split(':')[1] : '' },
      set(value) { this.filters.endTime = value ? `${this.endHour || '08'}:${value}` : '' }
    },
    hasFilters() {
      return Object.values(this.filters).some(value => Array.isArray(value) ? value.length > 0 : value !== '' && value !== null)
    }
  },
  methods: {
    async searchVenues() {
      this.formError = ''
      this.error = ''
      const today = new Date()
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      if (this.filters.date && this.filters.date < todayString) {
        this.formError = 'No past dates are allowed.'
        return
      }
      if (this.filters.attendance !== '' && this.filters.attendance !== null && this.filters.attendance !== undefined && (!Number.isInteger(Number(this.filters.attendance)) || Number(this.filters.attendance) <= 0)) {
        this.formError = 'Expected attendance must be a positive whole number.'
        return
      }
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
        if (Array.isArray(value)) {
          value.forEach(item => query.append(key, item))
        } else if (value !== '' && value !== null && value !== undefined) {
          query.set(key, value)
        }
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
    handleTimeInput() {
      if ((this.filters.startTime || this.filters.endTime) && !this.filters.date) {
        this.formError = 'Select a date when filtering by time.'
        return
      }
      this.searchVenues()
    },
    handleDateChange() {
      this.formError = ''
      this.searchVenues()
    },
    clearFilters() {
      this.filters = { search: '', date: '', startTime: '', endTime: '', attendance: null, layout: [], facility: [], accessibility: [] }
      this.searchVenues()
    },
    clearLayoutFilter() {
      this.filters.layout = []
      this.searchVenues()
    },
    clearFacilityFilter() {
      this.filters.facility = []
      this.searchVenues()
    },
    clearAccessibilityFilter() {
      this.filters.accessibility = []
      this.searchVenues()
    },
    listValue(value) {
      if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not listed'
      return value || 'Not listed'
    },
    formatUnavailablePeriod(period) {
      const dateFormatter = new Intl.DateTimeFormat('en-SG', {
        dateStyle: 'medium',
        timeZone: 'Asia/Singapore'
      })
      const timeFormatter = new Intl.DateTimeFormat('en-SG', {
        timeStyle: 'short',
        timeZone: 'Asia/Singapore'
      })
      const start = new Date(period.start_time)
      const end = new Date(period.end_time)
      return `${dateFormatter.format(start)}, ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`
    },
    closeDropdowns() {
      this.layoutDropdownOpen = false
      this.facilityDropdownOpen = false
      this.accessibilityDropdownOpen = false
    }
  },
  mounted() {
    document.addEventListener('click', this.closeDropdowns)
    this.searchVenues()
  },
  beforeUnmount() {
    document.removeEventListener('click', this.closeDropdowns)
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
.unavailability-note { margin-top: 1rem }
.venue-details { display: grid; gap: .85rem; color: #495057; font-size: .92rem }
.detail-label { display: block; color: #6c757d; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: .15rem }
.empty-state { border: 1px dashed #cbd5e1; border-radius: .75rem; padding: 3rem 1rem; color: #52606d }
.layout-dropdown { position: relative }
.layout-dropdown-toggle { overflow: hidden; padding-right: 2rem; text-overflow: ellipsis; white-space: nowrap }
.layout-dropdown-toggle::after { position: absolute; top: 50%; right: 1rem; transform: translateY(-50%); content: '\25BC'; font-size: .65rem }
.layout-dropdown-menu { position: absolute; z-index: 10; top: calc(100% + .25rem); left: 0; width: 100%; padding: .5rem; border: 1px solid #dee2e6; border-radius: .375rem; background: #fff; box-shadow: 0 .5rem 1rem rgba(0, 0, 0, .15) }
.layout-option { display: flex; align-items: center; gap: .5rem; padding: .45rem .5rem; cursor: pointer; font-weight: 400 }
.layout-option:hover { background: #f8f9fa }
.layout-clear { padding: .25rem .5rem }
.time-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem }

@media (max-width: 575.98px) {
  .venue-card { grid-template-columns: 1fr }
  .venue-image { height: 200px; min-height: 0 }
}
</style>
