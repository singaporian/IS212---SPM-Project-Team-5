const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const jwt=require('jsonwebtoken');
const db=require('../src/db');
const {validateExpiry}=require('../src/venueHolds');
const {holdConflicts,effectiveHoldStatus,processHoldExpiries}=require('../src/holdAvailability');
const slot={start_time:'2099-03-01T10:00:00+08:00',end_time:'2099-03-01T11:00:00+08:00',setup_minutes:30,turnaround_minutes:30};
test('TC-US038-02 technical expiry validation: future timestamp, no booking-start restriction',()=>{
 const now='2099-03-01T08:00:00+08:00';
 for(const expiry of [now,'2099-03-01T07:59:00+08:00','bad','2099-03-01T09:00:00']) assert.throws(()=>validateExpiry(expiry,now));
 assert.equal(validateExpiry('2099-03-01T12:00:00+08:00',now),'2099-03-01T04:00:00.000Z');
 assert.equal(effectiveHoldStatus({status:'active',expiry_at:now},new Date(now)),'expired');
});
test('US-038 isolated PostgreSQL API integration',async t=>{
 const originalPool=db.pool,originalQuery=db.query,schema='test_holds_'+randomUUID().replace(/-/g,'');
 let pool,server;
 const tables=['users','events','venues','bookings','venue_holds','notifications','venue_unavailabilities','venue_operating_hours','venue_images'];
 try {
  await originalPool.query(`CREATE SCHEMA ${schema}`);
  for(const table of tables) await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  pool=new Pool({...originalPool.options,password:originalPool.options.password,connectionTimeoutMillis:3000,options:`-c search_path=${schema},public`});db.pool=pool;db.query=(sql,args)=>pool.query(sql,args);
  server=require('../src/index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const staff=randomUUID(),coordinator=randomUUID(),other=randomUUID();
  const token=(role='venue_staff',sub=staff)=>jwt.sign({role,sub},process.env.JWT_SECRET||'local-development-secret-change-me');
  async function call(path,method='GET',body,bearer=token()) {const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,body:data};}
  let booking,event,venue;
  async function fixture(){
   await pool.query('TRUNCATE '+tables.join(','));
   for(const [id,role] of [[staff,'venue_staff'],[coordinator,'event_coordinator'],[other,'event_coordinator']])await pool.query('INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,$2)',[id,role,id+'@test.local']);
   event=randomUUID();venue=randomUUID();booking=randomUUID();
   await pool.query("INSERT INTO events (id,title,status,assigned_coordinator_id) VALUES ($1,'Held event','planning',$2)",[event,coordinator]);
   await pool.query("INSERT INTO venues (id,name,capacity,available_from,available_until) VALUES ($1,'Hold Hall',100,'2099-01-01','2099-12-31')",[venue]);
   await pool.query("INSERT INTO venue_operating_hours (venue_id,day_of_week,opens_at,closes_at) SELECT $1,d,'00:00','23:59' FROM generate_series(0,6) d",[venue]);
   await pool.query("INSERT INTO bookings (id,event_id,venue_id,status,start_time,end_time,setup_minutes,turnaround_minutes) VALUES ($1,$2,$3,'pending',$4,$5,30,30)",[booking,event,venue,slot.start_time,slot.end_time]);
  }
  const place=(expiryAt='2099-02-28T12:00:00+08:00')=>call('/venue-holds','POST',{bookingId:booking,expiryAt});
  const count=async table=>Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count);
  await t.test('TC-US038-01/02 place persists expiry beyond booking start; no placement notification',async()=>{
   await fixture();const result=await place('2099-03-02T12:00:00+08:00');assert.equal(result.status,201,JSON.stringify(result.body));
   assert.equal(result.body.booking_id,booking);assert.equal(result.body.created_by,staff);assert.equal(result.body.expiry_at,'2099-03-02T04:00:00.000Z');
   assert.equal(await count('bookings'),1);assert.equal(await count('notifications'),0);
   assert.equal((await call('/venue-holds')).body[0].status,'active');
  });
  await t.test('Technical authorization: staff place; only assigned coordinator views; old action APIs absent',async()=>{
   await fixture();const hold=(await place()).body;
   assert.equal((await call('/venue-holds','GET',null,token('event_coordinator',coordinator))).body.length,1);
   assert.equal((await call('/venue-holds','GET',null,token('event_coordinator',other))).body.length,0);
   for(const role of ['event_organiser','attendee','technical_support_staff','safety_officer'])assert.equal((await call('/venue-holds','GET',null,token(role))).status,403);
   for(const role of ['event_coordinator','event_coordinator_lead','event_organiser','attendee'])assert.equal((await call('/venue-holds','POST',{},token(role))).status,403);
   for(const action of ['extend','release','confirm'])assert.equal((await call('/venue-holds/'+hold.id+'/'+action,'POST',{})).status,404);
  });
  await t.test('TC-US038-02 invalid expiry is rejected without persistence',async()=>{
   await fixture();for(const expiry of ['2000-01-01T00:00:00Z','bad',''])assert.equal((await place(expiry)).status,400);
   assert.equal((await call('/venue-holds','POST',{bookingId:randomUUID(),expiryAt:'2099-02-28T12:00:00Z'})).status,404);
   assert.equal((await call('/venue-holds','POST',{bookingId:'bad'})).status,400);
   assert.equal(await count('venue_holds'),0);assert.equal(await count('notifications'),0);
  });
  await t.test('TC-US038-03 active hold blocks search, review and approval with buffers',async()=>{
   await fixture();await place();
   assert.equal((await call('/venues?date=2099-03-01&startTime=10:00&endTime=11:00&setupMinutes=0&turnaroundMinutes=0')).body.length,0);
   assert.equal((await call('/bookings/'+booking+'/review')).body.conflicts[0].type,'hold');
   assert.equal((await call('/bookings/'+booking+'/review?summary=1')).body.hold_conflicts,1);
   assert.equal((await call('/bookings/'+booking+'/decision','PATCH',{decision:'approved'})).status,409);
   assert.equal((await pool.query('SELECT status FROM bookings')).rows[0].status,'pending');assert.equal(await count('notifications'),0);
   assert.equal((await holdConflicts(db,{venue_id:venue,start_time:'2099-03-01T11:29:00+08:00',end_time:'2099-03-01T12:00:00+08:00'})).length,1);
   assert.equal((await holdConflicts(db,{venue_id:venue,start_time:'2099-03-01T11:30:00+08:00',end_time:'2099-03-01T12:00:00+08:00'})).length,0);
  });
  await t.test('TC-US038-04/05/07 expiry stops blocking, never confirms and frees venue for another request',async()=>{
   await fixture();await place();await pool.query('UPDATE venue_holds SET expiry_at=clock_timestamp()');
   assert.equal((await call('/venue-holds')).body[0].status,'expired');
   assert.equal((await holdConflicts(db,{...slot,venue_id:venue})).length,0);
   assert.equal((await call('/venues?date=2099-03-01&startTime=10:00&endTime=11:00&setupMinutes=0&turnaroundMinutes=0')).body.length,1);
   assert.equal((await pool.query('SELECT status FROM bookings')).rows[0].status,'pending');
   assert.equal((await place()).status,201);
  });
  await t.test('TC-US038-06 notification retrieval processes expiry for current assigned coordinator exactly once',async()=>{
   await fixture();await place();await pool.query('UPDATE venue_holds SET expiry_at=clock_timestamp()');
   await pool.query('UPDATE events SET assigned_coordinator_id=$1',[other]);
   const old=await call('/notifications','GET',null,token('event_coordinator',coordinator));assert.equal(old.body.length,0);
   const current=await call('/notifications','GET',null,token('event_coordinator',other));assert.equal(current.status,200);assert.equal(current.body.length,1);assert.match(current.body[0].message,/hold expired/);assert.equal(current.body[0].event_id,event);
   await Promise.all([processHoldExpiries(db),processHoldExpiries(db),call('/venue-holds')]);
   assert.equal(await count('notifications'),1);assert.ok((await pool.query('SELECT expiry_notified_at FROM venue_holds')).rows[0].expiry_notified_at);
  });
  await t.test('TC-US038-06 simultaneous first expiry detection creates one notification',async()=>{
   await fixture();await place();await pool.query('UPDATE venue_holds SET expiry_at=clock_timestamp()');
   await Promise.all([processHoldExpiries(db),processHoldExpiries(db),processHoldExpiries(db)]);
   assert.equal(await count('notifications'),1);
  });
  await t.test('TC-US038-06 no early notification; unassigned expiry can notify after assignment; resolved historical holds ignored',async()=>{
   await fixture();await place();await processHoldExpiries(db);assert.equal(await count('notifications'),0);
   await pool.query('UPDATE events SET assigned_coordinator_id=NULL');await pool.query('UPDATE venue_holds SET expiry_at=clock_timestamp()');
   await processHoldExpiries(db);assert.equal(await count('notifications'),0);assert.equal((await pool.query('SELECT expiry_notified_at FROM venue_holds')).rows[0].expiry_notified_at,null);
   await pool.query('UPDATE events SET assigned_coordinator_id=$1',[coordinator]);await processHoldExpiries(db);assert.equal(await count('notifications'),1);
   await fixture();await place();await pool.query("UPDATE venue_holds SET status='released',expiry_at=clock_timestamp()");await processHoldExpiries(db);assert.equal(await count('notifications'),0);
  });
  await t.test('TC-US038-06/08 failed expiry notification rolls back marker and retries exactly once',async()=>{
   await fixture();await place();await pool.query('UPDATE venue_holds SET expiry_at=clock_timestamp()');
   await pool.query('ALTER TABLE notifications ADD CONSTRAINT force_failure CHECK (false)');
   await assert.rejects(processHoldExpiries(db));assert.equal(await count('notifications'),0);assert.equal((await pool.query('SELECT expiry_notified_at FROM venue_holds')).rows[0].expiry_notified_at,null);
   await pool.query('ALTER TABLE notifications DROP CONSTRAINT force_failure');await processHoldExpiries(db);await processHoldExpiries(db);assert.equal(await count('notifications'),1);
  });
  await t.test('TC-US038-08 failed placement has no partial result and retry succeeds',async()=>{
   await fixture();await pool.query('ALTER TABLE venue_holds ADD CONSTRAINT force_failure CHECK (false)');
   const result=await place();assert.equal(result.status,500);assert.equal(await count('venue_holds'),0);assert.equal(await count('notifications'),0);assert.equal(await count('bookings'),1);
   await pool.query('ALTER TABLE venue_holds DROP CONSTRAINT force_failure');assert.equal((await place()).status,201);
  });
  await t.test('Technical concurrency: competing placements and approval serialize safely',async()=>{
   await fixture();const holds=await Promise.all([place(),place()]);assert.deepEqual(holds.map(r=>r.status).sort(),[201,409]);assert.equal(await count('venue_holds'),1);
   await fixture();const outcomes=await Promise.all([place(),call('/bookings/'+booking+'/decision','PATCH',{decision:'approved'})]);
   assert.ok((outcomes[0].status===201 && outcomes[1].status===409)||(outcomes[0].status===404 && outcomes[1].status===200),JSON.stringify(outcomes));
  });
  await t.test('Technical placement rejects existing reservation and recorded unavailability',async()=>{
   for(const status of ['confirmed','approved']) {
    await fixture();await pool.query("INSERT INTO bookings (event_id,venue_id,status,start_time,end_time,setup_minutes,turnaround_minutes) VALUES ($1,$2,$3,$4,$5,0,0)",[event,venue,status,slot.start_time,slot.end_time]);assert.equal((await place()).status,409);
   }
   await fixture();await pool.query("INSERT INTO venue_unavailabilities (venue_id,start_time,end_time,reason) VALUES ($1,'2099-03-01T09:40:00+08:00','2099-03-01T09:50:00+08:00','Setup obstruction')",[venue]);assert.equal((await place()).status,409);
  });
 } finally {
  db.pool=originalPool;db.query=originalQuery;if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await originalPool.end();
 }
});
