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
          <li class="nav-item"><router-link class="nav-link" :to="user.role === 'attendee' ? '/attendee/calendar' : '/events'">Events</router-link></li>
          <li v-if="canViewVenues" class="nav-item"><router-link class="nav-link" to="/venues">Venues</router-link></li>
        </ul>
      </div>

      <!-- Profile / role avatar on the right -->
      <div class="header-actions d-flex align-items-center ms-3">
        <div class="notification-area me-3" @click.stop="toggleNotifications" tabindex="0" @keydown.enter="toggleNotifications">
          <button class="notification-button" type="button" aria-label="Notifications">
            <i class="bi bi-bell"></i>
            <span v-if="unreadCount" class="notification-count">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
          </button>
          <div v-if="notificationsOpen" class="notification-menu" @click.stop>
            <div class="notification-heading">Notifications</div>
            <div v-if="notificationsError" class="notification-empty text-danger">{{ notificationsError }}</div>
            <div v-else-if="!notifications.length" class="notification-empty">No notifications yet.</div>
            <button v-for="notification in notifications" :key="notification.id" class="notification-item" :class="{ unread: !notification.read }" type="button" @click="markRead(notification)">
              <span>{{ notification.message }}</span>
              <small>{{ formatNotificationDate(notification.created_at) }}</small>
            </button>
          </div>
        </div>

      <div class="profile-area d-flex align-items-center" @click.stop="toggleMenu" tabindex="0" @keydown.enter="toggleMenu">
        <div class="avatar">{{ initials }}</div>
        <div class="profile-info d-none d-md-block ms-2 text-white">
            <div class="fw-bold small">{{ user.name }}</div>
          <div class="small text-light-50">{{ user.role }}</div>
        </div>

        <div class="menu" v-if="menuOpen" @click.stop>
          <button class="menu-item" type="button" @click.stop="profileOpen = true; menuOpen = false">Profile</button>
          <div class="menu-sep"></div>
          <button class="menu-item text-danger" @click="logout">Logout</button>
        </div>
      </div>
      </div>
    </div>
  </nav>
    <div v-if="profileOpen" class="profile-overlay" @click="profileOpen = false">
      <section class="profile-dialog" role="dialog" aria-modal="true" aria-label="Profile" @click.stop>
        <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Profile</h2><button class="btn-close" aria-label="Close profile" @click="profileOpen = false"></button></div>
        <dl class="mb-0"><dt>Name</dt><dd>{{ user.name }}</dd><dt>Email</dt><dd>{{ user.email || 'Not available' }}</dd><dt>Role</dt><dd>{{ user.role }}</dd></dl>
      </section>
    </div>
</template>

<script>
import { authHeaders, clearSession, getUser } from '../services/auth'

export default {
  name: 'Header',
  data() {
    return {
      menuOpen: false,
      profileOpen: false,
      notificationsOpen: false,
      notifications: [],
      notificationsError: '',
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
    },
    unreadCount() {
      return this.notifications.filter(notification => !notification.read).length
    }
  },
  methods: {
    toggleMenu() {
      this.menuOpen = !this.menuOpen
      this.notificationsOpen = false
    },
    toggleNotifications() {
      this.notificationsOpen = !this.notificationsOpen
      this.menuOpen = false
      if (this.notificationsOpen) this.loadNotifications()
    },
    async loadNotifications() {
      this.notificationsError = ''
      try {
        const response = await fetch('/api/notifications', { headers: authHeaders() })
        if (response.status === 401) { clearSession(); this.$router.push('/login'); return }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load notifications')
        this.notifications = data
      } catch (error) {
        this.notificationsError = error.message
      }
    },
    async markRead(notification) {
      if (!notification.read) {
        await fetch(`/api/notifications/${notification.id}/read`, { method: 'PATCH', headers: authHeaders() })
        notification.read = true
      }
      const target = this.notificationTarget(notification)
      if (target) {
        this.notificationsOpen = false
        this.$router.push(target)
      }
    },
    notificationTarget(notification) {
      const message = notification.message || ''
      if (this.user.role === 'venue_staff' && message.toLowerCase().includes('venue booking request')) {
        const bookingId = message.match(/Booking ID:\s*([0-9a-f-]{36})/i)?.[1]
        return bookingId ? `/bookings/pending/${bookingId}` : `/bookings/pending?eventId=${encodeURIComponent(notification.event_id)}`
      }
      if (this.user.role === 'event_coordinator' && message.startsWith('Venue booking request')) return '/bookings'
      if (this.user.role === 'event_coordinator' && message.startsWith('Venue ')) return '/bookings/affected'
      if (this.user.role === 'event_coordinator' && message.startsWith('Operational Safety Check') && message.includes('(technical changes)')) return `/technical-support/requirements?eventId=${encodeURIComponent(notification.event_id)}`
      if (this.user.role === 'event_coordinator' && message.startsWith('Operational Safety Check') && message.includes('(venue changes)')) return `/bookings?eventId=${encodeURIComponent(notification.event_id)}`
      if (this.user.role === 'event_coordinator' && message.startsWith('Operational Safety Check')) return `/coordinator/requests?eventId=${encodeURIComponent(notification.event_id)}`
      if (this.user.role === 'event_coordinator' && message.startsWith('Event request') && /(re)?assigned to you/.test(message)) return '/coordinator/requests'
      if (this.user.role === 'safety_officer' && message.startsWith('Event ') && message.includes('Operational Safety Check')) return '/safety/checks'
      if (this.user.role === 'technical_support_staff' && message.startsWith('Technical support requirements updated')) return '/technical-support/queue'
      if (this.user.role === 'technical_support_staff' && message.startsWith('Equipment "') && message.includes('flagged for reconsideration')) return '/equipment/reserve'
      if (this.user.role === 'technical_support_staff' && message.startsWith('Equipment "')) return '/equipment'
      if (this.user.role === 'technical_support_staff' && message.includes('has been cancelled')) return '/equipment/reserve'
      if (this.user.role === 'technical_support_staff' && message.includes('important change was requested')) return '/equipment/reserve'
      return null
    },
    formatNotificationDate(value) {
      return value ? new Date(value).toLocaleString() : ''
    },
    logout() {
      clearSession()
      this.$router.push('/login')
    },
    handleDocumentClick() {
      this.notificationsOpen = false
      this.menuOpen = false
    }
  }
  ,mounted() {
    document.addEventListener('click', this.handleDocumentClick)
    this.loadNotifications()
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleDocumentClick)
  }
}
</script>

<style scoped>
.navbar-brand { font-weight:700 }
.profile-area { position: relative; cursor: pointer }
.header-actions { position: relative }
.notification-area { position: relative; cursor: pointer }
.notification-button { position: relative; border: 0; background: transparent; color: white; font-size: 1.2rem; padding: .35rem; }
.notification-count { position: absolute; top: -2px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 10px; background: #ff5c77; color: white; font-size: .65rem; line-height: 17px; text-align: center; }
.notification-menu { position: absolute; right: 0; top: 42px; width: 310px; max-height: 360px; overflow-y: auto; background: white; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.14); z-index: 2100; }
.notification-heading { padding: 12px 14px; border-bottom: 1px solid #eef0f6; color: #263238; font-weight: 700; }
.notification-empty { padding: 16px 14px; color: #6c757d; font-size: .85rem; }
.notification-item { display: block; width: 100%; border: 0; border-bottom: 1px solid #f0f2f6; background: white; padding: 11px 14px; color: #343a40; text-align: left; font: inherit; }
.notification-item:hover, .notification-item.unread { background: #f4f7ff; }
.notification-item span, .notification-item small { display: block; }
.notification-item small { margin-top: 4px; color: #6c757d; font-size: .72rem; }
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
.profile-overlay { position: fixed; inset: 0; z-index: 2500; display: grid; place-items: center; padding: 1rem; background: rgba(15, 23, 42, .35); }
.profile-dialog { width: min(100%, 380px); padding: 1.25rem; border-radius: .75rem; background: white; box-shadow: 0 12px 36px rgba(15, 23, 42, .2); }
.profile-dialog dt { color: #64748b; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.profile-dialog dd { margin: .15rem 0 .85rem; color: #1e293b; }
</style>
