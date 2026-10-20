<template>
  <div class="inventory-page">
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <p class="eyebrow mb-1">Equipment inventory</p>
        <h1 class="mb-1">Inventory</h1>
        <p class="text-muted mb-0">Review every equipment record and keep damaged or under-maintenance units out of available stock.</p>
      </div>
      <div class="d-flex gap-2">
        <router-link class="btn btn-accent" to="/equipment/new"><i class="bi bi-plus-lg"></i> Add Equipment</router-link>
        <router-link class="btn btn-outline-secondary" to="/">Back to Home</router-link>
      </div>
    </div>

    <div v-if="equipment.length" class="row g-3 mb-4">
      <div v-for="tile in summary" :key="tile.label" class="col-6 col-md-3">
        <div class="card stat-tile h-100">
          <div class="card-body">
            <div class="small text-muted">{{ tile.label }}</div>
            <div class="fs-4 fw-semibold" :class="tile.className">{{ tile.value }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card form-panel">
      <div class="card-body">
        <div class="row g-2 align-items-end mb-3">
          <div class="col-md-5">
            <label class="form-label small mb-1" for="inventory-search">Search</label>
            <input id="inventory-search" v-model="search" class="form-control" type="search" placeholder="Name or type">
          </div>
          <div class="col-md-4">
            <label class="form-label small mb-1" for="inventory-status">Status</label>
            <select id="inventory-status" v-model="statusFilter" class="form-select">
              <option value="">All statuses</option>
              <option value="available">Fully available</option>
              <option value="damaged">Has damaged units</option>
              <option value="maintenance">Has units under maintenance</option>
            </select>
          </div>
          <div class="col-md-3 d-grid">
            <button class="btn btn-outline-primary" type="button" :disabled="loading" @click="load"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
          </div>
        </div>

        <div v-if="loading && !equipment.length" class="text-muted small">Loading inventory...</div>
        <div v-else-if="loadError" class="alert alert-danger mb-0" role="alert">{{ loadError }}</div>
        <p v-else-if="!equipment.length" class="text-muted mb-0">The inventory is empty. <router-link to="/equipment/new">Add equipment</router-link> to get started.</p>
        <p v-else-if="!filtered.length" class="text-muted mb-0">No equipment matches these filters.</p>
        <div v-else class="table-responsive">
          <table class="table align-middle mb-0">
            <thead>
              <tr>
                <th scope="col">Equipment</th>
                <th scope="col">Type</th>
                <th scope="col" class="text-center">Total</th>
                <th scope="col" class="text-center">Available</th>
                <th scope="col" class="text-center">Damaged</th>
                <th scope="col" class="text-center">Under Maintenance</th>
                <th scope="col">Status</th>
                <th scope="col"><span class="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filtered" :key="item.id">
                <td>
                  <div class="fw-semibold">{{ item.name }}</div>
                  <div class="small text-muted">{{ specSummary(item.specs) }}</div>
                </td>
                <td>{{ item.equipment_type || '—' }}</td>
                <td class="text-center">{{ item.total_quantity }}</td>
                <td class="text-center fw-semibold">{{ item.available_quantity }}</td>
                <td class="text-center">{{ item.damaged_quantity }}</td>
                <td class="text-center">{{ item.maintenance_quantity }}</td>
                <td>
                  <div class="d-flex flex-wrap gap-1">
                    <span v-for="badge in statusBadges(item)" :key="badge.label" class="badge" :class="badge.className">{{ badge.label }}</span>
                  </div>
                </td>
                <td class="text-end">
                  <router-link class="btn btn-sm btn-outline-primary" :to="`/equipment/${item.id}/edit`" :aria-label="`Edit ${item.name}`"><i class="bi bi-pencil"></i> Edit</router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { listEquipment } from '../services/equipment'

export default {
  name: 'EquipmentInventoryView',
  data() {
    return {
      equipment: [],
      loading: false,
      loadError: '',
      search: '',
      statusFilter: ''
    }
  },
  computed: {
    filtered() {
      const term = this.search.trim().toLowerCase()
      return this.equipment.filter(item => {
        if (term && !`${item.name} ${item.equipment_type || ''}`.toLowerCase().includes(term)) return false
        if (this.statusFilter === 'available') return item.available_quantity === item.total_quantity
        if (this.statusFilter === 'damaged') return item.damaged_quantity > 0
        if (this.statusFilter === 'maintenance') return item.maintenance_quantity > 0
        return true
      })
    },
    summary() {
      const sum = key => this.equipment.reduce((total, item) => total + item[key], 0)
      return [
        { label: 'Total units', value: sum('total_quantity'), className: '' },
        { label: 'Available', value: sum('available_quantity'), className: 'text-success' },
        { label: 'Damaged', value: sum('damaged_quantity'), className: 'text-danger' },
        { label: 'Under Maintenance', value: sum('maintenance_quantity'), className: 'text-warning-emphasis' }
      ]
    }
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.loadError = ''
      try {
        this.equipment = await listEquipment()
      } catch (error) {
        this.loadError = error.message || 'Unable to load the equipment inventory. Please retry.'
      } finally {
        this.loading = false
      }
    },
    // One badge per status that has units, so a partly damaged batch shows both.
    statusBadges(item) {
      if (item.status && item.status !== 'available') return [{ label: 'Out of service', className: 'bg-secondary' }]
      const badges = []
      if (item.available_quantity > 0) badges.push({ label: `${item.available_quantity} Available`, className: 'bg-success' })
      if (item.damaged_quantity > 0) badges.push({ label: `${item.damaged_quantity} Damaged`, className: 'bg-danger' })
      if (item.maintenance_quantity > 0) badges.push({ label: `${item.maintenance_quantity} Under Maintenance`, className: 'bg-warning text-dark' })
      return badges
    },
    specSummary(specs) {
      const entries = Object.entries(specs || {})
      if (!entries.length) return 'No specifications'
      const shown = entries.slice(0, 2).map(([label, value]) => `${label}: ${value}`).join(' · ')
      return entries.length > 2 ? `${shown} · +${entries.length - 2} more` : shown
    }
  }
}
</script>

<style scoped>
.form-panel { border: 0; box-shadow: 0 14px 35px rgba(25, 35, 60, .08) }
.stat-tile { border: 0; box-shadow: 0 6px 18px rgba(25, 35, 60, .06) }
</style>
