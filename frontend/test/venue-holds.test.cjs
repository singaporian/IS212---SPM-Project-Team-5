const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parse}=require('@vue/compiler-sfc');
const {compile,createSSRApp}=require('vue');
const {renderToString}=require('@vue/server-renderer');
const descriptor=parse(fs.readFileSync(path.join(__dirname,'../src/views/VenueHoldsView.vue'),'utf8')).descriptor;
function instance(fetch,role='venue_staff'){
 const script=descriptor.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
 const options=new Function('fetch','authHeaders','getUser','BookingReview',script)(fetch,()=>({}),()=>({role}),{methods:{formatDate:v=>v,formatRange:(a,b)=>a+' – '+b}});
 const state=options.data();for(const [name,method] of Object.entries(options.methods))state[name]=method.bind(state);for(const [name,getter] of Object.entries(options.computed))Object.defineProperty(state,name,{get:()=>getter.call(state)});return state;
}
const booking={id:'request',event_title:'Pet Fair',venue_name:'Hall',start_time:'2099-03-01T10:00:00+08:00',end_time:'2099-03-01T11:00:00+08:00',setup_minutes:30,turnaround_minutes:30};
const hold=()=>({...booking,id:'hold',expiry_at:'2099-02-28T04:00:00Z',status:'active',actor_name:'Venue Staff',actions:[{action:'placed',actor_name:'Venue Staff',occurred_at:'2026-10-11T01:00:00Z'}]});
const render=state=>renderToString(createSSRApp({render:compile(descriptor.template.content),components:{RouterLink:{template:'<a><slot /></a>'}},data:()=>state}));
test('TC-US038-01/02 staff placement and coordinator read-only display have no old-scope controls',async()=>{
 for(const role of ['venue_staff','event_coordinator']){
  const state=instance(async()=>Response.json([hold()]),role);state.holds=[hold()];const html=await render(state);
  for(const text of ['Pet Fair','Hall','<strong>Active</strong>','2099-02-28T04:00:00Z','not confirmed bookings'])assert.ok(html.includes(text),text);
  assert.equal(html.includes('Place hold'),role==='venue_staff');for(const text of ['Extend hold','Release hold','confirmation workflow','including setup.'])assert.ok(!html.includes(text));
 }
});
test('TC-US038-01/02 expiry beyond booking start is accepted and sent in Singapore time',async()=>{
 const calls=[];const state=instance(async(url,options)=>{calls.push({url,options});return Response.json(url==='/api/bookings/pending'?[booking]:options.method?hold():[hold()]);});state.requests=[booking];state.bookingId='request';state.expiry='2099-03-02T12:00';await state.place();
 assert.deepEqual(JSON.parse(calls[0].options.body),{bookingId:'request',expiryAt:'2099-03-02T04:00:00.000Z'});assert.equal(state.success,'Tentative hold placed.');
});
test('TC-US038-02 invalid/nonfuture expiry prevents POST and retains input',async()=>{
 const state=instance(()=>{throw Error('Must not send')});state.requests=[booking];state.bookingId='request';
 for(const value of ['2000-01-01T12:00','']){state.expiry=value;await state.place();assert.ok(state.error);assert.equal(state.expiry,value);assert.equal(state.success,'');}
});
test('TC-US038-04/07 expired status does not present a confirmed booking',async()=>{
 const state=instance();state.holds=[{...hold(),expiry_at:'2000-01-01T00:00:00Z'}];state.selectedTab='expired';const html=await render(state);assert.ok(html.includes('<strong>Expired</strong>'));assert.ok(!html.includes('<strong>Confirmed</strong>'));
});
test('TC-US038-08 failed save preserves input and retry; no false success',async()=>{
 let fail=true;const state=instance(async(url,options)=>options.method&&fail?Response.json({error:'Unable to save'},{status:500}):Response.json(url==='/api/bookings/pending'?[booking]:options.method?hold():[hold()]));state.requests=[booking];state.bookingId='request';state.expiry='2099-02-28T12:00';await state.place();assert.equal(state.success,'');assert.equal(state.expiry,'2099-02-28T12:00');assert.equal(state.bookingId,'request');assert.equal(state.holds.length,0);fail=false;await state.place();assert.equal(state.success,'Tentative hold placed.');
});
test('TC-US038-08 committed save remains successful when refresh fails',async()=>{
 const state=instance(async(url,options)=>options.method?Response.json(hold()):Response.json({error:'Refresh failed'},{status:500}));await state.save('/api/venue-holds',{},'Tentative hold placed.');assert.equal(state.success,'Tentative hold placed.');assert.equal(state.error,'Refresh failed');
});
test('Technical loading and in-flight placement prevent duplicate actions',async()=>{
 let resolve,calls=0;const state=instance(async(url,options)=>{if(options.method){calls++;return new Promise(r=>resolve=r)}return Response.json([])});state.requests=[booking];state.bookingId='request';state.expiry='2099-02-28T12:00';const pending=state.place();assert.equal(state.saving,true);await state.place();assert.equal(calls,1);resolve(Response.json(hold()));await pending;assert.equal(state.saving,false);
 let finish;const loading=instance(()=>new Promise(r=>finish=r),'event_coordinator');const read=loading.load();assert.equal(loading.loading,true);finish(Response.json([]));await read;assert.equal(loading.loading,false);
});

test('TC-US038-04/06 open holds page processes newly detected expiry once through server',async()=>{
 let calls=0;const state=instance(async()=>{calls++;return Response.json([{...hold(),status:'expired'}])},'event_coordinator');
 state.holds=[{...hold(),expiry_at:'2000-01-01T00:00:00Z'}];await state.tick();assert.equal(calls,1);await state.tick();assert.equal(calls,1);
});


test('TC-US038-UI-01/02/03 Active default and Expired filter show only matching holds with counts',async()=>{
 const state=instance();state.holds=[hold(),{...hold(),id:'expired',event_title:'Expired workshop',status:'expired'},{...hold(),id:'legacy',event_title:'Legacy released',status:'released'}];
 assert.equal(state.selectedTab,'active');assert.deepEqual(state.visibleHolds.map(h=>h.id),['hold']);
 let html=await render(state);assert.ok(html.includes('Active (1)'));assert.ok(html.includes('Expired (1)'));assert.ok(html.includes('Pet Fair'));assert.ok(!html.includes('Expired workshop'));assert.ok(!html.includes('Legacy released'));
 state.selectedTab='expired';html=await render(state);assert.deepEqual(state.visibleHolds.map(h=>h.id),['expired']);assert.ok(html.includes('Expired workshop'));assert.ok(!html.includes('Pet Fair'));
});

test('TC-US038-UI-04 effective expiry moves a raw active hold at the exact deadline',async()=>{
 const state=instance();state.holds=[hold()];const deadline=Date.parse(hold().expiry_at);
 state.now=deadline-1;assert.equal(state.holdsByStatus.active.length,1);assert.equal(state.holdsByStatus.expired.length,0);
 state.now=deadline;assert.equal(state.holdsByStatus.active.length,0);assert.equal(state.holdsByStatus.expired.length,1);
 assert.equal(state.holds[0].status,'active');assert.equal(state.selectedTab,'active');
 assert.ok((await render(state)).includes('No active tentative holds to display.'));
});

test('TC-US038-UI-05/06 cards distinguish held slot, expiry, venue, author and state',async()=>{
 const state=instance();state.holds=[hold()];let html=await render(state);
 for(const text of ['Pet Fair','Venue','Hall','Held venue slot',booking.start_time,booking.end_time,'Hold expires',hold().expiry_at,'Placed by','Venue Staff','Status','<strong>Active</strong>','temporarily blocks'])assert.ok(html.includes(text),text);
 state.now=Date.parse(hold().expiry_at);state.selectedTab='expired';html=await render(state);
 assert.ok(html.includes('<strong>Expired</strong>'));assert.ok(html.includes('This hold no longer blocks the venue.'));
});

test('TC-US038-UI-07/08 dashboard offers staff a prominent holds link without unrelated role access',async()=>{
 const home=parse(fs.readFileSync(path.join(__dirname,'../src/views/HomePage.vue'),'utf8')).descriptor;
 const script=home.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
 for(const role of ['venue_staff','event_coordinator','event_organiser','attendee','safety_officer','technical_support_staff','event_coordinator_lead']){
  const options=new Function('authHeaders','clearSession','getUser',script)(()=>({}),()=>{},()=>({role,name:'Demo'}));
  const html=await renderToString(createSSRApp({...options,mounted:undefined,render:compile(home.template.content),components:{RouterLink:{props:['to'],template:'<a :href="to"><slot /></a>'}}}));
  assert.equal(html.includes('href="/venue/holds"'),['venue_staff','event_coordinator'].includes(role),role);
  if(role==='venue_staff')assert.match(html.replace(/<!--.*?-->/g,''),/<a[^>]*class="btn btn-primary w-100 mb-2"[^>]*>Tentative Venue Holds<\/a>/);
 }
});

test('TC-US038-UI-08 coordinator filters remain read-only and refresh preserves selected filter',async()=>{
 const state=instance(async()=>Response.json([hold()]),'event_coordinator');state.selectedTab='expired';await state.load();
 assert.equal(state.selectedTab,'expired');assert.ok(!(await render(state)).includes('Place hold'));
});
