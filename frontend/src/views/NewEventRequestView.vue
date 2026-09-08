<template>
  <div>
    <router-link to="/" class="d-inline-block mb-3 small">&laquo; Back to Dashboard</router-link>
    <EventRequestForm />
  </div>
</template>

<script>
import EventRequestForm from '../components/EventRequestForm.vue'

export default {
  name: 'NewEventRequestView',
  components: { EventRequestForm }
}
</script>