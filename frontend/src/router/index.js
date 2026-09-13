import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../views/HomePage.vue'
import NewEventRequestView from '../views/NewEventRequestView.vue'
import LoginView from '../views/LoginView.vue'
import VenueSearchView from '../views/VenueSearchView.vue'
import CoordinatorRequestsView from '../views/CoordinatorRequestsView.vue'
import { getUser, isAuthenticated } from '../services/auth'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
  { path: '/', name: 'home', component: HomePage, meta: { requiresAuth: true } },
  { path: '/venues', name: 'venue-search', component: VenueSearchView, meta: { requiresAuth: true, roles: ['event_coordinator', 'venue_staff'] } },
  { path: '/coordinator/requests', name: 'coordinator-requests', component: CoordinatorRequestsView, meta: { requiresAuth: true, roles: ['event_coordinator'] } },
  { path: '/requests/new', name: 'new-event-request', component: NewEventRequestView, meta: { requiresAuth: true, roles: ['event_organiser'] } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) return { name: 'login' }
  if (to.meta.guestOnly && isAuthenticated()) return { name: 'home' }
  if (to.meta.roles && !to.meta.roles.includes(getUser()?.role)) return { name: 'home' }
  return true
})

export default router