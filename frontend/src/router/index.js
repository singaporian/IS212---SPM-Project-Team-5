import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../views/HomePage.vue'
import NewEventRequestView from '../views/NewEventRequestView.vue'
import LoginView from '../views/LoginView.vue'
import { isAuthenticated } from '../services/auth'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
  { path: '/', name: 'home', component: HomePage, meta: { requiresAuth: true } },
  { path: '/requests/new', name: 'new-event-request', component: NewEventRequestView, meta: { requiresAuth: true } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) return { name: 'login' }
  if (to.meta.guestOnly && isAuthenticated()) return { name: 'home' }
  return true
})

export default router