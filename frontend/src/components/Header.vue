<template>
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
    <div class="container">
      <a class="navbar-brand" href="#">ConnectSphere</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse" id="nav">
        <ul class="navbar-nav ms-auto">
          <li class="nav-item"><router-link class="nav-link" to="/">Dashboard</router-link></li>
          <li class="nav-item"><router-link class="nav-link" to="/events">Events</router-link></li>
          <li v-if="canViewVenues" class="nav-item"><router-link class="nav-link" to="/venues">Venues</router-link></li>
        </ul>
      </div>

      <!-- Profile / role avatar on the right -->
      <div class="profile-area d-flex align-items-center ms-3" @click="toggleMenu" tabindex="0" @keydown.enter="toggleMenu">
        <div class="avatar">{{ initials }}</div>
        <div class="profile-info d-none d-md-block ms-2 text-white">
            <div class="fw-bold small">{{ user.name }}</div>
          <div class="small text-light-50">{{ user.role }}</div>
        </div>

        <div class="menu" v-if="menuOpen" @click.stop>
          <a class="menu-item" href="#">Profile</a>
          <a class="menu-item" href="#">Switch Role</a>
          <div class="menu-sep"></div>
          <button class="menu-item text-danger" @click="logout">Logout</button>
        </div>
      </div>
    </div>
  </nav>
</template>

<script>
import { clearSession, getUser } from '../services/auth'

export default {
  name: 'Header',
  data() {
    return {
      menuOpen: false,
      user: getUser() || { name: 'Guest', role: 'Attendee' }
    }
  },
  computed: {
    canViewVenues() {
      return ['event_coordinator', 'venue_staff'].includes(this.user.role)
    },
    initials() {
      if (!this.user.name) return 'U'
      return this.user.name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()
    }
  },
  methods: {
    toggleMenu() {
      this.menuOpen = !this.menuOpen
    },
    logout() {
      clearSession()
      this.$router.push('/login')
    }
  }
}
</script>

<style scoped>
.navbar-brand { font-weight:700 }
.profile-area { position: relative; cursor: pointer }
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg,#6c63ff,#00c2ff);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.profile-info .text-light-50 { color: rgba(255,255,255,0.85) }
.menu {
  position: absolute;
  right: 0;
  top: 48px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.12);
  min-width: 160px;
  overflow: hidden;
  z-index: 2000;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 10px 14px;
  color: #333;
  text-decoration: none;
  background: white;
  border: 0;
  text-align: left;
  font: inherit;
}
.menu-item:hover { background: #f6f7fb }
.menu-sep { height: 1px; background: #eef0f6; margin: 6px 0 }
</style>
