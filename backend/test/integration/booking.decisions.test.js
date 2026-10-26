const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');
test('US-033 decisions integrate with current database state and Coordinator receipts', async t => {
 const client = await db.pool.connect(), originalQuery = db.query, originalPool = db.pool;
 let server;
 try {
  await client.query('BEGIN');
  for (const table of ['users','venues','events','bookings','venue_unavailabilities','notifications','venue_holds','technical_support_requirements','operational_safety_checks']) await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
  db.query = (sql,params) => client.query(sql,params);
  db.pool = { connect: async () => ({ query: (sql,params) => client.query(({BEGIN:'SAVEPOINT decision',COMMIT:'RELEASE SAVEPOINT decision',ROLLBACK:'ROLLBACK TO SAVEPOINT decision'})[sql] || sql,params), release() {} }) };
  const staff=randomUUID(), coordinator=randomUUID(), venue=randomUUID(), event=randomUUID();
  for(const [id,role] of [[staff,'venue_staff'],[coordinator,'event_coordinator']]) await client.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)',[id,role,id+'@test.local']);
  await client.query("INSERT INTO venues(id,name,capacity) VALUES($1,'Decision hall',100)",[venue]);
  await client.query("INSERT INTO events(id,title,status,assigned_coordinator_id) VALUES($1,'Decision event','submitted',$2)",[event,coordinator]);
  async function make(status='pending',start='2099-03-01T10:00:00+08:00',end='2099-03-01T11:00:00+08:00',setup=0,turnaround=0) {
   const id=randomUUID(); await client.query('INSERT INTO bookings(id,event_id,venue_id,requested_by,status,start_time,end_time,setup_minutes,turnaround_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,event,venue,coordinator,status,start,end,setup,turnaround]);return id;
  }
  server=require('../../src/index').listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const token=(role,id)=>jwt.sign({sub:id,role},process.env.JWT_SECRET || 'local-development-secret-change-me');
  async function call(id,body,role='venue_staff',user=staff) {
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/${id}/decision`,{method:'PATCH',headers:{Authorization:'Bearer '+token(role,user),'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};
  }
  async function api(path,method='GET',body,role='venue_staff',user=staff) {
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:'Bearer '+token(role,user),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
  }
  async function row(id) { return (await client.query('SELECT * FROM bookings WHERE id=$1',[id])).rows[0]; }
  async function isolated(name,fn) { await t.test(name,async()=>{await client.query('SAVEPOINT scenario');try{await fn()}finally{await client.query('ROLLBACK TO SAVEPOINT scenario')}}); }
  await isolated('TC-US033-01/10/12 available approval preserves ID/event and is visible to Coordinator',async()=>{
   const id=await make(); const r=await call(id,{decision:'approved'});assert.equal(r.status,200);assert.equal(r.body.id,id);assert.equal(r.body.status,'approved');assert.equal(r.body.decided_by,staff);assert.ok(r.body.decided_at);
   assert.equal((await client.query('SELECT status FROM events WHERE id=$1',[event])).rows[0].status,'submitted');
   assert.equal((await client.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n,1);
   const receipt=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/mine`,{headers:{Authorization:'Bearer '+token('event_coordinator',coordinator)}});assert.ok((await receipt.json()).some(b=>b.id===id && b.status==='approved'));
   const reviewed=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/reviewed`,{headers:{Authorization:'Bearer '+token('venue_staff',staff)}});assert.ok((await reviewed.json()).some(b=>b.id===id));
   assert.equal((await call(id,{decision:'rejected'})).status,409);assert.equal((await row(id)).status,'approved');
  });
  await isolated('TC-US033-02/03/10 reason and alternative/comment persist in Coordinator receipt',async()=>{
   for(const body of [{decision:'rejected',reason:'Maintenance',comment:'Please reschedule'},{decision:'alternative_suggested',alternativeStartTime:'2099-03-02T10:03:00+08:00',alternativeEndTime:'2099-03-02T11:07:00+08:00',comment:'Later day'}]) {
    const id=await make(); const r=await call(id,body);assert.equal(r.status,200);assert.equal(r.body.decision_comment,body.comment);assert.equal(r.body.decision_reason,body.reason||null);if(body.alternativeStartTime)assert.equal(r.body.alternative_start_time,'2099-03-02T02:03:00.000Z');
    const receipt=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/mine`,{headers:{Authorization:'Bearer '+token('event_coordinator',coordinator)}});const result=(await receipt.json()).find(b=>b.id===id);assert.equal(result.decision_comment,body.comment);assert.equal(result.alternative_end_time,r.body.alternative_end_time);
   }
  });
  await isolated('TC-US033-04/13 newly recorded approved/confirmed reservation blocks approval',async()=>{
   const id=await make();
   const initial=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/${id}/review`,{headers:{Authorization:'Bearer '+token('venue_staff',staff)}});assert.deepEqual((await initial.json()).conflicts,[]);
   for(const status of ['approved','confirmed']) {const other=await make(status);assert.equal((await call(id,{decision:'approved'})).status,409);assert.equal((await row(id)).status,'pending');await client.query('DELETE FROM bookings WHERE id=$1',[other]);}
  });
  await isolated('TC-US033-05 recorded unavailable period blocks approval',async()=>{
   const id=await make();await client.query("INSERT INTO venue_unavailabilities(venue_id,start_time,end_time,reason) VALUES($1,'2099-03-01T10:30:00+08:00','2099-03-01T12:00:00+08:00','Maintenance')",[venue]);assert.equal((await call(id,{decision:'approved'})).status,409);assert.equal((await row(id)).status,'pending');
  });
  await isolated('TC-US033-06 setup/turnaround-only overlap blocks approval',async()=>{
   const id=await make('pending','2099-03-01T11:15:00+08:00','2099-03-01T12:00:00+08:00',30);
   const other=await make('confirmed');assert.equal((await call(id,{decision:'approved'})).status,409);
   await client.query('UPDATE bookings SET setup_minutes=0 WHERE id=$1',[id]);await client.query('UPDATE bookings SET turnaround_minutes=30 WHERE id=$1',[other]);assert.equal((await call(id,{decision:'approved'})).status,409);
  });
  await isolated('TC-US033-11 notification failure rolls back decision; retry succeeds',async()=>{
   const id=await make();await client.query('ALTER TABLE notifications ADD CONSTRAINT fail_save CHECK (false)');const before=await row(id);const notificationsBefore=(await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n;assert.equal((await call(id,{decision:'rejected',reason:'Unavailable'})).status,500);assert.deepEqual(await row(id),before);assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,notificationsBefore);await client.query('ALTER TABLE notifications DROP CONSTRAINT fail_save');assert.equal((await call(id,{decision:'rejected',reason:'Unavailable'})).status,200);
  });
  await isolated('TC-US033-07/13/14 new active hold reuses shared conflict check and blocks stale approval',async()=>{
   const id=await make();
   const initial=await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/${id}/review`,{headers:{Authorization:'Bearer '+token('venue_staff',staff)}});assert.deepEqual((await initial.json()).conflicts,[]);
   // Event times do not overlap; the hold's turnaround extends into this request.
   const other=await make('pending','2099-03-01T09:00:00+08:00','2099-03-01T09:45:00+08:00',0,30);
   await client.query(`INSERT INTO venue_holds(booking_id,event_id,venue_id,start_time,end_time,setup_minutes,turnaround_minutes,expiry_at,created_by,updated_by)
    SELECT id,event_id,venue_id,start_time,end_time,setup_minutes,turnaround_minutes,clock_timestamp()+interval '1 hour',$2,$2 FROM bookings WHERE id=$1`,[other,staff]);
   const shared=await require('../../src/holdAvailability').holdConflicts(db,await row(id));
   const r=await call(id,{decision:'approved'});assert.equal(r.status,409);assert.deepEqual(r.body.conflicts,JSON.parse(JSON.stringify(shared)));assert.equal(shared[0].type,'hold');assert.equal((await row(id)).status,'pending');
   assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,0);
  });
  await isolated('TC-US033-08/09 expired hold does not block another request or become confirmed',async()=>{
   const id=await make(), other=await make();
   await client.query(`INSERT INTO venue_holds(booking_id,event_id,venue_id,start_time,end_time,expiry_at,created_by,updated_by)
    SELECT id,event_id,venue_id,start_time,end_time,clock_timestamp(),$2,$2 FROM bookings WHERE id=$1`,[other,staff]);
   const heldSnapshot=(await client.query('SELECT setup_minutes,turnaround_minutes FROM venue_holds')).rows[0];
   assert.equal((await api('/venues/'+venue+'/setup-turnaround','PUT',{setupMinutes:90,turnaroundMinutes:90})).status,200);
   assert.deepEqual((await client.query('SELECT setup_minutes,turnaround_minutes FROM venue_holds')).rows[0],heldSnapshot);
   const r=await call(id,{decision:'approved'});assert.equal(r.status,200);assert.equal((await row(other)).status,'pending');
   const hold=(await client.query('SELECT * FROM venue_holds')).rows[0];assert.equal(require('../../src/holdAvailability').effectiveHoldStatus(hold),'expired');
   assert.equal((await client.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n,2);
  });
  for (const kind of ['setup','turnaround']) await isolated(`[IT-09/10/11] venue ${kind} defaults are recorded at creation, survive updates, and block approval`,async()=>{
   const configure=values=>api('/venues/'+venue+'/setup-turnaround','PUT',values);
   assert.equal((await configure({setupMinutes:kind==='setup'?30:0,turnaroundMinutes:kind==='turnaround'?30:0})).status,200);
   async function request(day,overrides={}) {
    const r=await api('/bookings/requests','POST',{eventId:event,venueId:venue,startTime:`2099-03-${day}T10:00:00+08:00`,endTime:`2099-03-${day}T11:00:00+08:00`,...overrides},'event_coordinator',coordinator);
    assert.equal(r.status,201,JSON.stringify(r.body));return r.body;
   }
   const original=await request('01');
   assert.equal(original.setup_minutes,kind==='setup'?30:0);assert.equal(original.turnaround_minutes,kind==='turnaround'?30:0);
   const snapshot=await row(original.id);
   assert.equal((await configure({setupMinutes:0,turnaroundMinutes:0})).status,200);
   const fresh=await request('02');assert.equal(fresh.setup_minutes,0);assert.equal(fresh.turnaround_minutes,0);
   assert.equal((await configure({setupMinutes:90,turnaroundMinutes:90})).status,200);
   const override=await request('03',{setupMinutes:5,turnaroundMinutes:7});assert.equal(override.setup_minutes,5);assert.equal(override.turnaround_minutes,7);
   assert.deepEqual(await row(original.id),snapshot,'configuration does not rewrite existing request');
   const conflict=kind==='setup'?await make('confirmed','2099-03-01T09:00:00+08:00','2099-03-01T09:45:00+08:00'):await make('confirmed','2099-03-01T11:20:00+08:00','2099-03-01T12:00:00+08:00');
   const review=await api('/bookings/'+original.id+'/review');assert.equal(review.status,200);assert.equal(review.body.conflicts[0].type,'booking');
   assert.equal(review.body.occupied.start,kind==='setup'?'2099-03-01T01:30:00.000Z':'2099-03-01T02:00:00.000Z');
   assert.equal(review.body.occupied.end,kind==='turnaround'?'2099-03-01T03:30:00.000Z':'2099-03-01T03:00:00.000Z');
   assert.equal((await call(original.id,{decision:'approved'})).status,409);assert.deepEqual(await row(original.id),snapshot);assert.equal((await row(conflict)).status,'confirmed','existing booking is retained');
   // New, otherwise-clear request remains governed by its saved zero buffers, not current 90-minute defaults.
   assert.equal((await call(fresh.id,{decision:'approved'})).status,200);
  });
  await isolated('[IT-14] stale review cannot bypass newly recorded venue unavailability',async()=>{
   const id=await make();assert.deepEqual((await api('/bookings/'+id+'/review')).body.conflicts,[]);
   await client.query("INSERT INTO venue_unavailabilities(venue_id,start_time,end_time,reason) VALUES($1,'2099-03-01T10:30:00+08:00','2099-03-01T12:00:00+08:00','New maintenance')",[venue]);
   assert.equal((await call(id,{decision:'approved'})).status,409);assert.equal((await row(id)).status,'pending');
  });
  await isolated('[IT-04 boundary] exact occupied touching is allowed and pending requests do not reserve',async()=>{
   const id=await make();await make('confirmed','2099-03-01T11:00:00+08:00','2099-03-01T12:00:00+08:00');await make('pending');
   assert.equal((await call(id,{decision:'approved'})).status,200);
  });
  await isolated('Preserve main readiness promotion when venue and technical arrangements are ready',async()=>{
   await client.query("UPDATE events SET status='planning' WHERE id=$1",[event]);
   await client.query("INSERT INTO technical_support_requirements(event_id,status) VALUES($1,'confirmed')",[event]);
   const id=await make();assert.equal((await call(id,{decision:'approved'})).status,200);
   assert.equal((await client.query('SELECT status FROM events WHERE id=$1',[event])).rows[0].status,'confirmed');
  });
  await isolated('US-033 rejects unauthorised decisions and invalid alternatives',async()=>{
   const id=await make();assert.equal((await call(id,{decision:'approved'},'event_coordinator',coordinator)).status,403);assert.equal((await call(id,{decision:'alternative_suggested',alternativeStartTime:'bad',alternativeEndTime:'bad'})).status,400);assert.equal((await row(id)).status,'pending');
  });
 } finally {if(server)await new Promise(resolve=>server.close(resolve));db.query=originalQuery;db.pool=originalPool;await client.query('ROLLBACK');client.release();await originalPool.end();}
});
