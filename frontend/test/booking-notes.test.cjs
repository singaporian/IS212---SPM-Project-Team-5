const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const descriptor = parse(fs.readFileSync(path.join(__dirname,'../src/components/BookingNotes.vue'),'utf8')).descriptor;
const user = { id:'staff-one',name:'Staff One',role:'venue_staff' };
const first = { id:'note-one',booking_id:'booking',note_text:'First handling note',created_by:user.id,author_name:'Staff One',created_at:'2099-03-01T02:00:00Z',updated_at:'2099-03-01T02:00:00Z' };
const second = { ...first,id:'note-two',note_text:'Second handling note',created_by:'staff-two',author_name:'Staff Two',created_at:'2099-03-01T02:01:00Z' };

function instance(request, person=user) {
  const script = descriptor.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
  const options = new Function('getUser','bookingNotesRequest',script)(()=>person,request);
  const state = { ...options.data(),bookingId:'booking' };
  for(const [name,method] of Object.entries(options.methods)) state[name]=method.bind(state);
  for(const [name,get] of Object.entries(options.computed)) Object.defineProperty(state,name,{get:()=>get.call(state)});
  return state;
}
const render = state => renderToString(createSSRApp({ render:compile(descriptor.template.content),data:()=>state }));

test('[FE-01/02] staff sees API notes in chronological order with author/time and own controls only',async()=>{
  const state=instance(async()=>[first,second]);await state.load();const html=await render(state);
  for(const text of ['Internal Venue Staff notes','Staff One','Staff Two','10:00 AM','10:01 AM','First handling note','Second handling note']) assert.ok(html.includes(text),text);
  assert.ok(html.indexOf(first.note_text)<html.indexOf(second.note_text));
  assert.equal((html.match(/>Edit<\/button>/g)||[]).length,1);assert.equal((html.match(/>Delete<\/button>/g)||[]).length,1);
  assert.equal(state.isOwn(first),true);assert.equal(state.isOwn(second),false);
});

test('[FE-03] add note uses real request helper and server-generated metadata',async()=>{
  let sent;const state=instance(async(id,options)=>{sent={id,options};return first});state.newText=first.note_text;
  await state.add();assert.deepEqual(sent,{id:'booking',options:{method:'POST',noteText:first.note_text}});
  assert.equal(state.notes[0].created_at,first.created_at);assert.equal(state.notes[0].author_name,'Staff One');assert.equal(state.newText,'');assert.equal(state.success,'Note added.');
});

test('[FE-04] creator edits without changing author, original timestamp or list position',async()=>{
  const state=instance(async()=>({...first,note_text:'Updated text',updated_at:'2099-03-01T03:00:00Z'}));state.notes=[first,second];state.startEdit(first);state.editText='Updated text';
  await state.saveEdit();assert.equal(state.notes[0].note_text,'Updated text');assert.equal(state.notes[0].author_name,'Staff One');assert.equal(state.notes[0].created_at,first.created_at);assert.equal(state.notes[1].id,second.id);assert.equal(state.editingId,'');
});

test('[FE-05] creator confirms deletion and only that note disappears',async()=>{
  let sent;const state=instance(async(id,options)=>{sent=options;return null});state.notes=[first,second];state.deletingId=first.id;
  assert.ok((await render(state)).includes('Delete this note?'));await state.remove(first);
  assert.deepEqual(sent,{method:'DELETE',noteId:first.id});assert.deepEqual(state.notes,[second]);assert.equal(state.deletingId,'');assert.equal(state.success,'Note deleted.');
});

test('[FE-06] failed add/edit/delete retain input and existing notes; retry succeeds',async()=>{
  let failing=true;const state=instance(async()=>{if(failing)throw Error('Please retry');return first});state.notes=[first,second];state.newText='Retain input';
  await state.add();assert.equal(state.success,'');assert.equal(state.newText,'Retain input');assert.deepEqual(state.notes,[first,second]);
  state.startEdit(first);state.editText='Retain edited text';await state.saveEdit();assert.equal(state.editText,'Retain edited text');assert.equal(state.editingId,first.id);assert.deepEqual(state.notes,[first,second]);
  state.deletingId=first.id;await state.remove(first);assert.equal(state.deletingId,first.id);assert.deepEqual(state.notes,[first,second]);assert.equal(state.success,'');
  failing=false;await state.remove(first);assert.deepEqual(state.notes,[second]);assert.equal(state.success,'Note deleted.');
});

test('[FE-07] other roles neither render internal notes nor fetch them',async()=>{
  for(const role of ['event_organiser','event_coordinator','attendee','event_coordinator_lead','technical_support_staff','safety_officer']) {
    const state=instance(()=>{throw Error('Must not fetch')},{...user,role});state.notes=[first];await state.load();
    const html=await render(state);assert.ok(!html.includes(first.note_text));assert.ok(!html.includes('Internal Venue Staff notes'));
  }
});

test('[FE-08] empty input prevents requests and in-flight save prevents duplicate notes',async()=>{
  let calls=0,finish;const state=instance(()=>{calls++;return new Promise(resolve=>finish=resolve)});
  state.newText=' \t ';await state.add();assert.equal(calls,0);assert.ok(state.error);
  state.newText='Real note';const pending=state.add();assert.equal(state.saving,true);await state.add();assert.equal(calls,1);finish(first);await pending;assert.equal(state.notes.length,1);assert.equal(state.saving,false);
});

test('[FE-09] calendar mounts notes only in expanded confirmed-booking details',async()=>{
  const page=parse(fs.readFileSync(path.join(__dirname,'../src/views/VenueBookingsCalendarView.vue'),'utf8')).descriptor;
  const script=page.script.content.replace(/import .*\r?\n/g,'').replace('export default','return');
  const options=new Function('authHeaders','clearSession','BookingNotes',script)(()=>({}),()=>{},{});
  for(const status of ['confirmed','approved','pending']) {
    const booking={id:'booking',event_title:'Calendar event',venue_id:'venue',venue_name:'Hall',status,start_time:'2099-03-01T02:00:00Z',end_time:'2099-03-01T03:00:00Z'};
    const app=createSSRApp({...options,mounted:undefined,render:compile(page.template.content),data:()=>({...options.data(),bookings:[booking],selectedBookingId:'booking'}),components:{RouterLink:{template:'<a><slot /></a>'},BookingNotes:{template:'<section>Notes mounted</section>'}}});
    assert.equal((await renderToString(app)).includes('Notes mounted'),status==='confirmed',status);
  }
});

test('[FE-10] notes API helper uses authentication, encodes IDs, handles errors and empty delete response',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/services/bookingNotes.js'),'utf8').replace(/import .*\r?\n/g,'').replace('export async function','async function');
  let sent;
  const request=new Function('fetch','authHeaders',source+'\nreturn bookingNotesRequest;')(async(url,options)=>{sent={url,options};return new Response(null,{status:204})},()=>({Authorization:'Bearer test'}));
  assert.equal(await request('booking/id',{method:'DELETE',noteId:'note/id'}),null);assert.equal(sent.url,'/api/bookings/booking%2Fid/notes/note%2Fid');assert.equal(sent.options.headers.Authorization,'Bearer test');
  const failure=new Function('fetch','authHeaders',source+'\nreturn bookingNotesRequest;')(async()=>Response.json({error:'Forbidden'},{status:403}),()=>({}));
  await assert.rejects(failure('booking'),/Forbidden/);
});
