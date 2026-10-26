<template>
  <div>
    <RequestNavigation />
    <router-link v-if="mode === 'edit'" :to="{ name: 'submitted-event-request', params: { id: $route.params.id } }" class="d-inline-block mb-3 small">&larr; Back to request</router-link>
    <router-link v-else to="/requests/drafts" class="d-inline-block mb-3 small">&larr; All drafts</router-link>
    <EventRequestForm ref="form" :mode="mode" />
  </div>
</template>

<script>
import RequestNavigation from '../components/RequestNavigation.vue'
import EventRequestForm from '../components/EventRequestForm.vue'

export default {
  name: 'NewEventRequestView',
  components: { EventRequestForm, RequestNavigation },
  props: { mode: { type: String, default: 'draft' } }, // US-031: 'edit' for a Submitted or returned request
  beforeRouteLeave() {
    const form = this.$refs.form
    if (!form || form.submitted) return true
    if (form.saving || form.submitting) return false
    const baseline = form.savedForm || JSON.stringify(form.$options.data.call(form).form)
    if (JSON.stringify(form.form) === baseline) return true
    return window.confirm('You have unsaved changes. Leave this draft without saving?')
  }
}
</script>