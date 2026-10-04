<template>
  <section class="mb-4">
    <router-link to="/" class="small text-decoration-none">&larr; Dashboard</router-link>
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3 mb-3">
      <div>
        <h1 class="h3 mb-1">My event requests</h1>
        <p class="text-muted mb-0">Prepare your draft, submit it for review, and follow its progress.</p>
      </div>
      <router-link v-if="$route.name !== 'new-event-request'" to="/requests/new" class="btn btn-primary">+ New event request</router-link>
    </div>
    <nav class="nav nav-tabs" aria-label="Event request sections">
      <router-link to="/requests/drafts" class="nav-link" :class="{ active: !isSubmitted }" :aria-current="!isSubmitted ? 'page' : undefined">Drafts</router-link>
      <router-link to="/requests/submitted" class="nav-link" :class="{ active: isSubmitted }" :aria-current="isSubmitted ? 'page' : undefined">Submitted</router-link>
    </nav>
  </section>
</template>
<script>
export default {
  name: 'RequestNavigation',
  computed: { isSubmitted() { return this.$route.path.startsWith('/requests/submitted') } }
}
</script>
<style scoped>
.nav-link { color: #475569; padding: .8rem 1.4rem; }
.nav-link.active { color: #244aca; font-weight: 600; border-top: 3px solid #4167ef; }
.nav-link:focus-visible { outline: 3px solid #4167ef; outline-offset: 2px; }
</style>
