<template>
  <div>
    <RequestNavigation />
    <div class="card"><div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div><h2 class="h4 mb-1">Drafts</h2></div>
      </div>
      <p v-if="loading" role="status">Loading drafts…</p>
      <div v-else-if="error" class="alert alert-danger" role="alert">
        {{ error }} <button class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
      </div>
      <div v-else-if="!drafts.length" class="text-center py-5"><h3 class="h5">Start with an idea</h3><p class="text-muted">You can save a draft before you know every detail.</p><router-link class="btn btn-primary" to="/requests/new">Create your first draft</router-link></div>
      <ul v-else class="list-group">
        <li v-for="draft in drafts" :key="draft.id" class="list-group-item d-flex flex-wrap gap-3 justify-content-between align-items-center py-3">
          <div>
            <router-link :to="{ name: 'edit-event-draft', params: { id: draft.id } }">{{ draft.title || 'Untitled event' }}</router-link>
            <div class="small text-muted">Last saved {{ new Date(draft.updated_at).toLocaleString() }}</div>
          </div>
          <div class="d-flex align-items-center gap-3"><span class="badge bg-secondary">Draft not submitted</span><router-link class="btn btn-outline-primary btn-sm" :to="{ name: 'edit-event-draft', params: { id: draft.id } }">Continue editing</router-link></div>
        </li>
      </ul>
    </div></div>
  </div>
</template>

<script>
import RequestNavigation from '../components/RequestNavigation.vue'
import { draftRequest } from '../services/drafts'

export default {
  name: 'DraftsView',
  components: { RequestNavigation },
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
