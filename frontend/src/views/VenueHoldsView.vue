<template>
 <main class="holds-page">
  <router-link to="/">Back to Dashboard</router-link>
  <h1 class="h3 mt-3">Tentative venue holds</h1>
  <p>Holds reserve an occupied slot until expiry. They are not confirmed bookings. Times are in Singapore time.</p>
  <button class="btn btn-outline-primary mb-3" :disabled="loading || saving" @click="load">Refresh holds</button>
  <p v-if="loading" role="status">Loading holds…</p>
  <p v-if="error" role="alert" class="alert alert-danger">{{ error }}</p>
  <p v-if="success" role="status" class="alert alert-success">{{ success }}</p>
  <form v-if="canManage" class="card p-3 mb-3" @submit.prevent="place">
   <h2 class="h5">Place a tentative hold</h2>
   <label for="hold-booking">Pending booking request</label>
   <select id="hold-booking" v-model="bookingId" class="form-select mb-2" :disabled="saving" required>
    <option value="">Choose a request</option>
    <option v-for="request in requests" :key="request.id" :value="request.id">{{ request.event_title }} — {{ request.venue_name }} — {{ formatRange(request.start_time,request.end_time) }}</option>
   </select>
   <label for="hold-expiry">Hold expires (Singapore time)</label>
   <input id="hold-expiry" type="datetime-local" step="60" v-model="expiry" class="form-control" :disabled="saving" required>
   <p class="small text-muted">Choose a future expiry date and time.</p>
   <button class="btn btn-primary align-self-start" :disabled="saving || loading">Place hold</button>
  </form>
  <div class="nav nav-pills gap-2 mb-3" aria-label="Hold status filters">
   <button v-for="tab in ['active', 'expired']" :key="tab" type="button" class="nav-link" :class="{ active: selectedTab === tab }" :aria-pressed="selectedTab === tab" aria-controls="hold-results" @click="selectedTab = tab">{{ tab === 'active' ? 'Active' : 'Expired' }} ({{ holdsByStatus[tab].length }})</button>
  </div>
  <section id="hold-results" :aria-label="selectedTab === 'active' ? 'Active holds' : 'Expired holds'">
  <p v-if="!loading && !visibleHolds.length">No {{ selectedTab }} tentative holds to display.</p>
  <article v-for="hold in visibleHolds" :key="hold.id" class="card p-3 mb-3">
   <h2 class="h5">{{ hold.event_title }}</h2>
   <dl>
    <dt>Venue</dt><dd>{{ hold.venue_name }}</dd>
    <dt>Status</dt><dd><strong>{{ status(hold) === 'active' ? 'Active' : 'Expired' }}</strong></dd>
    <dt>Held venue slot</dt><dd>{{ formatRange(hold.start_time,hold.end_time) }}</dd>
    <dt>Recorded setup / turnaround</dt><dd>{{ hold.setup_minutes }} / {{ hold.turnaround_minutes }} minutes</dd>
    <dt>Hold expires</dt><dd>{{ formatDate(hold.expiry_at) }}</dd>
    <dt>Placed by</dt><dd>{{ hold.actor_name || 'Not recorded' }} · {{ formatDate(hold.created_at) }}</dd>
   </dl>
   <p class="small text-muted mb-0">{{ status(hold) === 'active' ? 'This hold temporarily blocks the venue for the held slot until expiry.' : 'This hold no longer blocks the venue.' }}</p>
  </article>
  </section>
 </main>
</template>
<script>
import { authHeaders, getUser } from '../services/auth'
import BookingReview from '../components/BookingReview.vue'
export default {
 data() { return { holds: [], selectedTab: 'active', requests: [], bookingId: '', expiry: '', loading: false, saving: false, error: '', success: '', now: Date.now(), timer: null } },
 computed: {
  canManage() { return getUser()?.role === 'venue_staff' },
  holdsByStatus() { return { active: this.holds.filter(hold => this.status(hold) === 'active'), expired: this.holds.filter(hold => this.status(hold) === 'expired') } },
  visibleHolds() { return this.holdsByStatus[this.selectedTab] }
 },
 methods: {
  formatDate: BookingReview.methods.formatDate,
  formatRange: BookingReview.methods.formatRange,
  status(hold) { return hold.status === 'active' && new Date(hold.expiry_at).getTime() <= this.now ? 'expired' : hold.status },
  tick() {
   this.now=Date.now()
   // Process expiry on the server when an open holds page detects the deadline.
   if(!this.loading && !this.saving && this.holds.some(hold=>hold.status==='active' && this.status(hold)==='expired')) return this.load()
  },
  async request(url,options={}) {
   const response=await fetch(url,{...options,headers:{...authHeaders(),'Content-Type':'application/json'}})
   let data; try {data=await response.json()} catch {throw new Error('Unable to contact the server. Please retry.')}
   if(!response.ok) throw new Error(data.error || 'Unable to save hold. Please retry.')
   return data
  },
  async load() {
   this.loading=true; this.error=''
   try {
    const holds=await this.request('/api/venue-holds')
    const requests=this.canManage ? await this.request('/api/bookings/pending') : []
    this.holds=holds;this.requests=requests;this.now=Date.now()
   } catch(error) {this.error=error.message;this.holds=[]}
   finally {this.loading=false}
  },
  expiryValue(value) {
   const date=new Date(value ? value+':00+08:00' : NaN)
   if(!Number.isFinite(+date) || date.getTime()<=Date.now()) throw new Error('Expiry must be later than the current time.')
   return date.toISOString()
  },
  async place() {
   if(this.saving)return
   this.error='';this.success=''
   try {
    const booking=this.requests.find(b=>b.id===this.bookingId)
    if(!booking)throw new Error('Choose a pending booking request.')
    const expiryAt=this.expiryValue(this.expiry)
    await this.save('/api/venue-holds',{bookingId:this.bookingId,expiryAt},'Tentative hold placed.')
   } catch(error) {this.error=error.message}
  },
  async save(url,body,message) {
   this.saving=true;this.error='';this.success=''
   try {
    await this.request(url,{method:'POST',body:JSON.stringify(body)})
    this.success=message
    // A failed refresh cannot turn a successfully committed operation into a reported save failure.
    await this.load()
   } catch(error) {this.error=error.message}
   finally {this.saving=false}
  }
 },
 mounted(){this.load();this.timer=setInterval(()=>this.tick(),1000)},
 beforeUnmount(){clearInterval(this.timer)}
}
</script>
<style scoped>
.holds-page { max-width: 1100px; margin: auto; } dl { display:grid; grid-template-columns: minmax(10rem,1fr) 3fr; gap:.5rem 1rem; } dd {margin:0;overflow-wrap:anywhere;} @media(max-width:600px){dl{grid-template-columns:1fr;}dd{margin-bottom:.75rem;}}
</style>
