import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../views/HomePage.vue'
import NewEventRequestView from '../views/NewEventRequestView.vue'

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/requests/new', name: 'new-event-request', component: NewEventRequestView }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router