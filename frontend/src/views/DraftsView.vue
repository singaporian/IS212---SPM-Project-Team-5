<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3">&laquo; Back to Dashboard</router-link>
    <div class="card"><div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h4">My Drafts</h1>
        <router-link class="btn btn-primary" to="/requests/new">Start Draft</router-link>
      </div>
      <p v-if="loading" role="status">Loading drafts…</p>
      <div v-else-if="error" class="alert alert-danger" role="alert">
        {{ error }} <button class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
      </div>
      <p v-else-if="!drafts.length" class="text-muted">No saved drafts yet. Start a draft and save your progress.</p>
      <ul v-else class="list-group">
        <li v-for="draft in drafts" :key="draft.id" class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <router-link :to="{ name: 'edit-event-draft', params: { id: draft.id } }">{{ draft.title || 'Untitled event' }}</router-link>
            <div class="small text-muted">Last saved {{ new Date(draft.updated_at).toLocaleString() }}</div>
          </div>
          <span class="badge bg-secondary">Draft</span>
        </li>
      </ul>
    </div></div>
  </div>
</template>

<script>
import { draftRequest } from '../services/drafts'

export default {
  name: 'DraftsView',
  data() { return { drafts: [], loading: true, error: '' } },
  mounted() { this.load() },
  methods: {
    async load() {
      this.loading = true
      this.error = ''
      try { this.drafts = await draftRequest() }
      catch (error) { this.error = error.message || 'Unable to load drafts. Please retry.' }
      finally { this.loading = false }
    }
  }
}
</script>
