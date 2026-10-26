const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

test('US-018 internal booking notes with real PostgreSQL and authorization', async t => {
  const originalPool = db.pool, originalQuery = db.query;
  const schema = 'test_notes_' + randomUUID().replace(/-/g, '');
  let pool, server;
  const staff = randomUUID(), other = randomUUID(), coordinator = randomUUID(), organiser = randomUUID();
  const venue = randomUUID(), event = randomUUID(), booking = randomUUID();
  try {
    await originalPool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users','venues','events','bookings','booking_notes','technical_support_requirements','operational_safety_checks']) {
      await originalPool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    // LIKE does not copy foreign keys. Recreate the note relationships so cascade is genuinely tested.
    await originalPool.query(`ALTER TABLE ${schema}.booking_notes ADD FOREIGN KEY (booking_id) REFERENCES ${schema}.bookings(id) ON DELETE CASCADE`);
    await originalPool.query(`ALTER TABLE ${schema}.booking_notes ADD FOREIGN KEY (created_by) REFERENCES ${schema}.users(id)`);
    pool = new Pool({ ...originalPool.options, password: originalPool.options.password, options: `-c search_path=${schema},public` });
    db.pool = pool; db.query = (sql, args) => pool.query(sql, args);
    for (const [id, role] of [[staff,'venue_staff'],[other,'venue_staff'],[coordinator,'event_coordinator'],[organiser,'event_organiser']]) {
      await pool.query('INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,$2)', [id,role,id+'@test.local']);
    }
    await pool.query("INSERT INTO venues(id,name,capacity) VALUES($1,'Note Hall',100)", [venue]);
    await pool.query("INSERT INTO events(id,title,status,organiser_id,assigned_coordinator_id) VALUES($1,'Internal note event','confirmed',$2,$3)", [event,organiser,coordinator]);
    await pool.query("INSERT INTO bookings(id,event_id,venue_id,requested_by,status,start_time,end_time) VALUES($1,$2,$3,$4,'confirmed','2099-03-01T10:00:00+08:00','2099-03-01T11:00:00+08:00')", [booking,event,venue,coordinator]);
    server = require('../../src/index').listen(0,'127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    const token = (role,user) => jwt.sign({role,sub:user},process.env.JWT_SECRET || 'local-development-secret-change-me');
    async function call(path, method='GET', body, role='venue_staff', user=staff) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method, headers: { Authorization: 'Bearer '+token(role,user), 'Content-Type':'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status:r.status, body:r.status===204?null:await r.json() };
    }
    const path = '/bookings/'+booking+'/notes';
    const noteRow = async id => (await pool.query('SELECT * FROM booking_notes WHERE id=$1',[id])).rows[0];
    const count = async () => (await pool.query('SELECT count(*)::int AS n FROM booking_notes')).rows[0].n;
    let first, second;
    await t.test('[IT-01/02/03] staff adds note with trusted author/time; forged metadata ignored', async () => {
      const before = Date.now();
      const r = await call(path,'POST',{noteText:'Keep wheelchair ramp clear.',created_by:other,created_at:'2000-01-01'});
      assert.equal(r.status,201,JSON.stringify(r.body)); first=r.body;
      assert.equal(first.created_by,staff);assert.equal(first.booking_id,booking);
      assert.ok(Date.parse(first.created_at)>=before-1000);assert.ok(Date.parse(first.created_at)<=Date.now()+1000);
      assert.equal((await noteRow(first.id)).note_text,'Keep wheelchair ramp clear.');
    });
    await t.test('[IT-04/05] another Venue Staff sees notes oldest first, irrespective of edit timestamp', async () => {
      second=(await call(path,'POST',{noteText:'Second handling note.'},'venue_staff',other)).body;
      // Make chronology deterministic, independently of creation speed and UUID ordering.
      await pool.query("UPDATE booking_notes SET created_at='2099-01-01T00:00:00Z',updated_at='2099-02-01T00:00:00Z' WHERE id=$1",[first.id]);
      await pool.query("UPDATE booking_notes SET created_at='2099-01-02T00:00:00Z' WHERE id=$1",[second.id]);
      const r=await call(path,'GET',undefined,'venue_staff',other);assert.equal(r.status,200);
      assert.deepEqual(r.body.map(n=>n.id),[first.id,second.id]);assert.equal(r.body[0].author_name,'venue_staff');
    });
    await t.test('[IT-06/07/08] non-Venue-Staff roles cannot read or mutate internal notes',async()=>{
      for(const role of ['event_coordinator','event_organiser','attendee','event_coordinator_lead','technical_support_staff','safety_officer']) {
        for(const [suffix,method,body] of [['','GET'],['','POST',{noteText:'Forbidden'}],['/'+first.id,'PATCH',{noteText:'Forbidden'}],['/'+first.id,'DELETE']]) {
          assert.equal((await call(path+suffix,method,body,role,coordinator)).status,403,role+' '+method);
        }
      }
      assert.equal(await count(),2);
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`);assert.equal(r.status,401);
      const receipt=await call('/bookings/mine','GET',undefined,'event_coordinator',coordinator);
      assert.equal(receipt.status,200);assert.ok(!JSON.stringify(receipt.body).includes('Keep wheelchair ramp clear.'));
      assert.ok(!JSON.stringify(receipt.body).includes('note_text'));
    });
    await t.test('[IT-09/10] creator edits text; another staff cannot; original author/time retained',async()=>{
      const before=await noteRow(first.id);
      assert.equal((await call(path+'/'+first.id,'PATCH',{noteText:'Tampered'},'venue_staff',other)).status,403);
      assert.deepEqual(await noteRow(first.id),before);
      const r=await call(path+'/'+first.id,'PATCH',{noteText:'Updated handling note.',created_by:other});assert.equal(r.status,200);
      const after=await noteRow(first.id);assert.equal(after.created_by,staff);assert.deepEqual(after.created_at,before.created_at);
      assert.equal(after.note_text,'Updated handling note.');assert.notDeepEqual(after.updated_at,before.updated_at);
      assert.deepEqual((await call(path)).body.map(n=>n.id),[first.id,second.id]);
    });
    await t.test('[IT-13/14] non-confirmed bookings reject all note operations without changing data',async()=>{
      for(const status of ['pending','approved','rejected','alternative_suggested','cancelled']) {
        await pool.query('UPDATE bookings SET status=$1 WHERE id=$2',[status,booking]);
        for(const [suffix,method,body] of [['','GET'],['','POST',{noteText:'No'}],['/'+first.id,'PATCH',{noteText:'No'}],['/'+first.id,'DELETE']]) {
          assert.equal((await call(path+suffix,method,body)).status,409,status+' '+method);
        }
      }
      await pool.query("UPDATE bookings SET status='confirmed' WHERE id=$1",[booking]);assert.equal(await count(),2);
    });
    await t.test('[IT-15] missing venue/bookings and malformed or mismatched IDs cannot access notes',async()=>{
      assert.equal((await call('/bookings/bad/notes')).status,400);
      assert.equal((await call('/bookings/'+randomUUID()+'/notes')).status,404);
      assert.equal((await call(path+'/bad','PATCH',{noteText:'No'})).status,400);
      assert.equal((await call(path+'/'+randomUUID(),'DELETE')).status,404);
      await pool.query('UPDATE bookings SET venue_id=NULL WHERE id=$1',[booking]);
      assert.equal((await call(path)).status,404);assert.equal((await call(path,'POST',{noteText:'No'})).status,404);
      await pool.query('UPDATE bookings SET venue_id=$1 WHERE id=$2',[venue,booking]);
      // No per-venue assignments exist: role-wide Venue Staff scope is retained, not invented here.
    });
    await t.test('[IT-16] invalid input and database failures leave no partial record; retry succeeds',async()=>{
      const before=await count();
      for(const value of [undefined,'',' \t ',42,'a'.repeat(10001)]) assert.equal((await call(path,'POST',{noteText:value})).status,400);
      assert.equal(await count(),before);
      await pool.query("ALTER TABLE booking_notes ADD CONSTRAINT force_failure CHECK (note_text <> 'Simulate failure')");
      assert.equal((await call(path,'POST',{noteText:'Simulate failure'})).status,500);assert.equal(await count(),before);
      const original=await noteRow(first.id);
      assert.equal((await call(path+'/'+first.id,'PATCH',{noteText:'Simulate failure'})).status,500);assert.deepEqual(await noteRow(first.id),original);
      await pool.query('ALTER TABLE booking_notes DROP CONSTRAINT force_failure');
      assert.equal((await call(path,'POST',{noteText:'Simulate failure'})).status,201);
    });
    await t.test('[IT-11/12] only creator deletes their note; other notes remain',async()=>{
      const before=await noteRow(second.id);
      assert.equal((await call(path+'/'+first.id,'DELETE',undefined,'venue_staff',other)).status,403);
      assert.equal((await call(path+'/'+first.id,'DELETE')).status,204);assert.equal(await noteRow(first.id),undefined);
      assert.deepEqual(await noteRow(second.id),before);
      assert.equal((await call(path+'/'+first.id,'DELETE')).status,404);
    });
    await t.test('Deleting a booking cascades only its internal notes',async()=>{
      await pool.query('DELETE FROM bookings WHERE id=$1',[booking]);assert.equal(await count(),0);
    });
  } finally {
    db.pool=originalPool;db.query=originalQuery;
    if(server) await new Promise(resolve=>server.close(resolve));
    if(pool) await pool.end();
    await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await originalPool.end();
  }
});
