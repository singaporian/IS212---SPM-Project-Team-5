const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path');
const {parse}=require('@vue/compiler-sfc'),{compile,createSSRApp}=require('vue'),{renderToString}=require('@vue/server-renderer');
const descriptor=parse(fs.readFileSync(path.join(__dirname,'../src/views/VenueBookingReviewView.vue'),'utf8')).descriptor;
function instance(fetch) {
 const script=descriptor.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
 const options=new Function('fetch','authHeaders','BookingReview',script)(fetch,()=>({}),{methods:{formatRange:()=> '10:00 AM–11:00 AM',formatDate:v=>v,statusLabel:v=>v}});
 const state={...options.data(),$route:{params:{id:'booking'},query:{}},review:{request:{id:'booking',status:'pending',event_title:'Test Event'},venue:{name:'Test Hall'},conflicts:[]}};
 for(const [key,method] of Object.entries(options.methods))state[key]=method.bind(state);
 return state;
}
async function render(state) {const app=createSSRApp({render:compile(descriptor.template.content),data:()=>state});app.config.globalProperties.$route=state.$route;app.component('router-link',{template:'<a><slot /></a>'});app.component('BookingReview',{template:'<section>Review details</section>'});return renderToString(app);}
test('TC-US033-01/02/03 controls, optional reason, alternative inputs and confirmation',async()=>{
 const state=instance();let html=await render(state);for(const text of ['Approve Request','Reject Request','Suggest Alternative','Review details'])assert.ok(html.includes(text));
 state.openDecision('rejected');html=await render(state);assert.ok(html.includes('Reason (optional)'));assert.ok(html.includes('Additional comments'));
 state.openDecision('alternative_suggested');html=await render(state);assert.ok(html.includes('Alternative start'));assert.ok(html.includes('Alternative end'));assert.ok(html.includes('Confirm Alternative'));
});
test('TC-US033-11 error preserves decision entries and retry saves once',async()=>{
 const calls=[];let fail=true;const state=instance(async(url,options)=>{calls.push({url,options});if(options.method==='PATCH')return fail?Response.json({error:'Unable to save'},{status:500}):Response.json({status:'rejected',decision_reason:'Maintenance'});throw new Error('receipt unavailable');});
 state.openDecision('rejected');state.reason='Maintenance';state.comment='Keep details';await state.submitDecision();assert.equal(state.success,'');assert.equal(state.reason,'Maintenance');assert.equal(state.comment,'Keep details');assert.equal(state.review.request.status,'pending');assert.ok(state.decisionError);
 fail=false;await state.submitDecision();assert.equal(state.review.request.status,'rejected');assert.equal(state.success,'Decision saved successfully.');assert.equal(calls.filter(c=>c.options.method==='PATCH').length,2);assert.ok((await render(state)).includes('View reviewed requests'));
});
test('TC-US033-04/13 approval conflict shows server error without false success',async()=>{
 const state=instance(async()=>Response.json({error:'The venue is unavailable.'},{status:409}));state.openDecision('approved');state.comment='Keep this';await state.submitDecision();assert.equal(state.review.request.status,'pending');assert.equal(state.comment,'Keep this');assert.equal(state.success,'');assert.match(state.decisionError,/unavailable/);
});
test('TC-US033-03 alternative sends Singapore timestamps and preserves comment',async()=>{
 let sent;const state=instance(async(url,options)=>{if(options.method==='PATCH'){sent=JSON.parse(options.body);return Response.json({status:'alternative_suggested'});}throw new Error('offline');});state.openDecision('alternative_suggested');state.alternativeStartTime='2026-10-16T10:03';state.alternativeEndTime='2026-10-16T11:07';state.comment='Later slot';await state.submitDecision();assert.equal(sent.alternativeStartTime,'2026-10-16T10:03+08:00');assert.equal(sent.comment,'Later slot');assert.ok(state.success);
});


test('TC-US033-07 active hold warning is visible and blocked approval retains entries',async()=>{
 const state=instance(async()=>Response.json({error:'The venue is unavailable for this occupied interval.',conflicts:[{type:'hold'}]},{status:409}));
 state.review.conflicts=[{type:'hold'}];state.openDecision('approved');state.comment='Retain comment';
 assert.ok((await render(state)).includes('Active tentative hold'));
 await state.submitDecision();assert.equal(state.review.request.status,'pending');assert.equal(state.comment,'Retain comment');assert.equal(state.success,'');assert.ok(state.decisionError);
});


test('[FE-06] failed alternative save retains both dates and comment; retry succeeds once',async()=>{
 let fail=true,calls=0;const state=instance(async(url,options)=>{
  if(options.method==='PATCH'){calls++;return fail?Response.json({error:'Retry'},{status:500}):Response.json({status:'alternative_suggested'});}
  throw Error('refresh unavailable');
 });
 state.openDecision('alternative_suggested');state.alternativeStartTime='2099-03-02T10:03';state.alternativeEndTime='2099-03-02T11:07';state.comment='Keep arrangement';
 await state.submitDecision();assert.equal(state.success,'');assert.equal(state.review.request.status,'pending');
 assert.equal(state.alternativeStartTime,'2099-03-02T10:03');assert.equal(state.alternativeEndTime,'2099-03-02T11:07');assert.equal(state.comment,'Keep arrangement');
 fail=false;await state.submitDecision();assert.equal(state.review.request.status,'alternative_suggested');assert.equal(state.success,'Decision saved successfully.');assert.equal(calls,2);
});

test('[FE-07] non-pending reviewed detail shows decision author/time without mutation controls',async()=>{
 const state=instance();Object.assign(state.review.request,{status:'approved',decision_author:'Venue Staff One',decided_at:'2099-03-01T02:00:00Z'});
 const html=await render(state);for(const text of ['Venue Staff One','2099-03-01T02:00:00Z','View reviewed requests'])assert.ok(html.includes(text));
 for(const text of ['Approve Request','Reject Request','Suggest Alternative'])assert.ok(!html.includes(text));
});

test('[FE-08] Coordinator renders decision reason, alternative and comment from retrieved records',async()=>{
 const page=parse(fs.readFileSync(path.join(__dirname,'../src/views/BookingRequestsView.vue'),'utf8')).descriptor;
 const script=page.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
 const data={id:'booking',event_id:'event',event_title:'Decision event',venue_name:'Hall',status:'alternative_suggested',decision_reason:'Different slot',decision_comment:'Use later time',alternative_start_time:'2099-03-02T02:03:00Z',alternative_end_time:'2099-03-02T03:07:00Z'};
 const options=new Function('fetch','authHeaders','clearSession',script)(async()=>Response.json([data]),()=>({}),()=>{});
 const state={...options.data(),$route:{query:{}},$router:{push(){}}};for(const [key,method] of Object.entries(options.methods))state[key]=method.bind(state);
 for(const [key,get] of Object.entries(options.computed))Object.defineProperty(state,key,{get:()=>get.call(state)});
 await state.loadRequests();state.toggleDetails('booking');
 const app=createSSRApp({render:compile(page.template.content),data:()=>state});app.component('router-link',{template:'<a><slot /></a>'});
 const html=await renderToString(app);for(const text of ['Different slot','Use later time','Suggested alternative'])assert.ok(html.includes(text));
});
