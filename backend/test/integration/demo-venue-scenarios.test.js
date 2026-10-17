const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const db = require('../../src/db');
const { scenarios, singaporeDate, seedVenueScenarios } = require('../../src/demoVenueScenarios');
const { holdConflicts } = require('../../src/holdAvailability');
test('demo dates follow Singapore day across year rollover and preserve fixture identities', () => {
  const now = new Date('2026-12-31T16:30:00Z');
  assert.equal(singaporeDate(0, now), '2027-01-01');
  const first = scenarios(now), next = scenarios(new Date(+now + 86400000));
  assert.equal(first[0].date, '2027-01-03');
  assert.deepEqual(first.map(s=>s.eventId), next.map(s=>s.eventId));
  assert.ok(first.every(s=>new Date(s.start)>now && new Date(s.end)>new Date(s.start)));
  assert.ok(new Date(first.find(s=>s.key==='active').expiry)>now);
  assert.ok(new Date(first.find(s=>s.key==='expired').expiry)<now);
});
test('demo seed is idempotent, coherent, and leaves unrelated records alone', async () => {
  const schema='test_demo_'+randomUUID().replace(/-/g,''); let pool;
  try {
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users','events','venues','bookings','venue_holds','notifications','venue_operating_hours']) await db.pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    pool=new Pool({...db.pool.options,password:db.pool.options.password,options:`-c search_path=${schema},public`});
    for (const [email,role] of [['organiser@connectsphere.local','event_organiser'],['coordinator@connectsphere.local','event_coordinator'],['venue@connectsphere.local','venue_staff']]) await pool.query('INSERT INTO users(name,email,role) VALUES($1,$1,$2)',[email,role]);
    await pool.query("INSERT INTO events(title,status) VALUES('Manual record','draft')");
    const now=new Date();await seedVenueScenarios(pool,now);
    const before=(await pool.query('SELECT id FROM bookings ORDER BY id')).rows;
    await seedVenueScenarios(pool,now);
    assert.deepEqual((await pool.query('SELECT id FROM bookings ORDER BY id')).rows,before);
    assert.equal(before.length,6);assert.equal((await pool.query('SELECT count(*)::int AS n FROM venue_holds')).rows[0].n,3);
    assert.equal((await pool.query("SELECT status FROM events WHERE title='Manual record'")).rows[0].status,'draft');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings b JOIN events e ON e.id=b.event_id WHERE b.start_time<>e.preferred_start OR b.end_time<>e.preferred_end OR e.assigned_coordinator_id IS NULL')).rows[0].n,0);
    for(const spec of scenarios(now)) {
      const booking=(await pool.query('SELECT * FROM bookings WHERE id=$1',[spec.bookingId])).rows[0];
      assert.equal(booking.status,'pending');assert.equal((await holdConflicts(pool,booking)).length,['active','short'].includes(spec.key)?1:0);
    }
  } finally {if(pool)await pool.end();await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.pool.end();}
});
