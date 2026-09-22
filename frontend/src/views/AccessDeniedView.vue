<template>
  <section class="access-denied text-center py-5">
    <i class="bi bi-shield-lock display-4 text-warning"></i>
    <h1 class="h3 mt-3">Access restricted</h1>
    <p class="text-muted">Your role does not have permission to view {{ resourceLabel }}.</p>
    <router-link to="/" class="btn btn-accent">Return to Dashboard</router-link>
  </section>
</template>

<script>
export default {
  name: 'AccessDeniedView',
  computed: {
    resourceLabel() {
      return this.$route.query.resource || 'this page'
    }
  }
}
</script>
