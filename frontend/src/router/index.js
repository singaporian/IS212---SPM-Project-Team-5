import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../views/HomePage.vue'
import NewEventRequestView from '../views/NewEventRequestView.vue'
import DraftsView from '../views/DraftsView.vue'
import LoginView from '../views/LoginView.vue'
import VenueSearchView from '../views/VenueSearchView.vue'
import CoordinatorRequestsView from '../views/CoordinatorRequestsView.vue'
import AddEquipmentView from '../views/AddEquipmentView.vue'
import BookingRequestView from '../views/BookingRequestView.vue'
import PendingBookingRequestsView from '../views/PendingBookingRequestsView.vue'
import EventsView from '../views/EventsView.vue'
import AccessDeniedView from '../views/AccessDeniedView.vue'
import { getUser, isAuthenticated } from '../services/auth'
import BookingRequestsView from '../views/BookingRequestsView.vue'
import SupportRequirementsView from '../views/SupportRequirementsView.vue'
import TechnicalSupportRequirementsView from '../views/TechnicalSupportRequirementsView.vue'
import TechnicalSupportRequestsView from '../views/TechnicalSupportRequestsView.vue'

const routes = [
  { path: '/requests/drafts', name: 'event-drafts', component: DraftsView, meta: { requiresAuth: true, roles: ['event_organiser'] } },
  { path: '/requests/drafts/:id', name: 'edit-event-draft', component: NewEventRequestView, meta: { requiresAuth: true, roles: ['event_organiser'] } },
  { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
  { path: '/', name: 'home', component: HomePage, meta: { requiresAuth: true } },
  { path: '/events', name: 'events', component: EventsView, meta: { requiresAuth: true } },
  { path: '/access-denied', name: 'access-denied', component: AccessDeniedView, meta: { requiresAuth: true } },
  { path: '/venues', name: 'venue-search', component: VenueSearchView, meta: { requiresAuth: true, roles: ['event_coordinator', 'venue_staff'], resource: 'the venue workspace' } },
  { path: '/coordinator/requests', name: 'coordinator-requests', component: CoordinatorRequestsView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/requests/new', name: 'new-event-request', component: NewEventRequestView, meta: { requiresAuth: true, roles: ['event_organiser'] } },
  { path: '/equipment/new', name: 'add-equipment', component: AddEquipmentView, meta: { requiresAuth: true, roles: ['technical_support_staff'] } },
  { path: '/bookings/new', name: 'new-booking-request', component: BookingRequestView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/bookings', name: 'booking-requests', component: BookingRequestsView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/bookings/pending', name: 'pending-booking-requests', component: PendingBookingRequestsView, meta: { requiresAuth: true, roles: ['venue_staff'] } },
  { path: '/technical-support/requirements', name: 'support-requirements', component: SupportRequirementsView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/technical-support/requests', name: 'support-requests', component: TechnicalSupportRequestsView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/technical-support/queue', name: 'technical-support-queue', component: TechnicalSupportRequirementsView, meta: { requiresAuth: true, roles: ['technical_support_staff'] } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) return { name: 'login' }
  if (to.meta.guestOnly && isAuthenticated()) return { name: 'home' }
  if (to.meta.roles && !to.meta.roles.includes(getUser()?.role)) return { name: 'access-denied', query: { resource: to.meta.resource || to.path } }
  return true
})

export default router