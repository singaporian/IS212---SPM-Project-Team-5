<template>
  <main>
    <nav class="small mb-3" aria-label="Breadcrumb"><router-link to="/bookings/pending">Back to requests</router-link><span v-if="review"> / {{ review.request.event_title }}</span></nav>
    <header class="case-header">
      <p class="eyebrow">VENUE REQUEST REVIEW</p>
      <h1>{{ review?.request.event_title || 'Review venue booking request' }}</h1>
      <template v-if="review"><p>{{ review.venue.name }} <span class="badge bg-light text-dark">{{ statusLabel(review.request.status) }}</span></p><p class="small text-muted">Coordinator: {{ review.request.coordinator_name || 'Not recorded' }}<span v-if="review.request.coordinator_email"> ({{ review.request.coordinator_email }})</span></p><p v-if="review.request.created_at" class="small text-muted">Submitted {{ formatDate(review.request.created_at) }}</p></template>
    </header>
    <div class="case-layout">
      <div class="card review-card"><BookingReview :key="String($route.params.id)" :booking-id="String($route.params.id)" full-page @loading="onLoading" @loaded="onLoaded" /></div>
    </div>
  </main>
</template>
<script>
import BookingReview from '../components/BookingReview.vue'
export default {
  name: 'VenueBookingReviewView', components: { BookingReview },
  data() { return { review: null } },
  watch: { '$route.params.id'() { this.review = null } },
  methods: {
    formatDate: BookingReview.methods.formatDate,
    statusLabel: BookingReview.methods.statusLabel,
    onLoading() { this.review = null },
    onLoaded(data) { this.review = data }
  }
}
</script>
<style scoped>
.case-header { margin-bottom:1.5rem; } h1 { font-size:1.8rem; }
.eyebrow { font-size:.75rem; letter-spacing:.1em; color:#64748b; font-weight:700; }
.review-card { padding:1.5rem; }
@media(max-width:600px) { .review-card { padding:1rem; } }
</style>
