<template>
  <section class="auth-shell">
    <div class="auth-panel">
      <div class="auth-mark"><i class="bi bi-globe2"></i></div>
      <p class="eyebrow">ConnectSphere access</p>
      <h1>{{ registering ? 'Create your account' : 'Welcome back' }}</h1>
      <p class="text-muted">{{ registering ? 'Attendee accounts can be created here.' : 'Sign in to continue to your workspace.' }}</p>

      <form @submit.prevent="submit">
        <label v-if="registering" class="form-label">Full name<input v-model="name" class="form-control" required /></label>
        <label class="form-label">Email<input v-model="email" class="form-control" type="email" required /></label>
        <label class="form-label">Password<input v-model="password" class="form-control" type="password" minlength="8" required /></label>
        <div v-if="error" class="alert alert-danger py-2">{{ error }}</div>
        <button class="btn btn-accent w-100" :disabled="loading">
          {{ loading ? 'Please wait...' : (registering ? 'Create account' : 'Sign in') }}
        </button>
      </form>

      <button class="auth-toggle" @click="registering = !registering">
        {{ registering ? 'Already have an account? Sign in' : 'New here? Create an attendee account' }}
      </button>

      <details class="demo-login mt-4">
        <summary>Development demo accounts</summary>
        <p class="small text-muted mt-2 mb-0">Use any demo email with password <strong>Password123!</strong>.</p>
        <p class="small text-muted mb-0">organiser@connectsphere.local, coordinator@connectsphere.local, venue@connectsphere.local, tech@connectsphere.local, attendee@connectsphere.local</p>
      </details>
    </div>
  </section>
</template>

<script>
import { login, register } from '../services/auth'

export default {
  name: 'LoginView',
  data() {
    return { registering: false, name: '', email: '', password: '', error: '', loading: false }
  },
  methods: {
    async submit() {
      this.loading = true
      this.error = ''
      try {
        if (this.registering) await register(this.name, this.email, this.password)
        else await login(this.email, this.password)
        this.$router.push('/')
      } catch (error) {
        this.error = error.message
      } finally {
        this.loading = false
      }
    }
  }
}
</script>
