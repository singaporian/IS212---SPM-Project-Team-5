<template>
  <div class="app-root">
    <Header />
    <main class="container py-5">
      <router-view />
      <footer class="footer text-center mt-5">
        <div class="container">
          <div>ConnectSphere — IS212 Team 5</div>
        </div>
      </footer>
    </main>
  </div>
</template>

<script>
import Header from './components/Header.vue'

export default {
  name: 'App',
  components: { Header }
}
</script>

<style scoped>
.app-root { background: linear-gradient(180deg,#f8fafc,#ffffff); min-height:100vh }
</style>