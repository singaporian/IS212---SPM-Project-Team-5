// Demo-only fixtures. No production validation or booking rules are changed here.
const { createHash } = require('node:crypto');
function singaporeDate(days, now = new Date()) {
  return new Date(+new Date(now) + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}
function demoId(key) {
  const hex = createHash('sha256').update('connectsphere-venue-demo-v1:' + key).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function scenarios(now = new Date()) {
  return [
    { key: 'active', title: 'US-038 Demo: Inclusivity Fair - Active Hold', venue: 'Demo Meeting Room', day: 2, expiryMinutes: 120 },
    { key: 'short', title: 'US-038 Demo: Short Expiry Workshop', venue: 'Demo Meeting Room', day: 3, expiryMinutes: 5 },
    { key: 'expired', title: 'US-038 Demo: Expired Hold Workshop', venue: 'Demo Meeting Room', day: 5, expiryMinutes: -60 },
    { key: 'approve', title: 'US-033 Demo: Approval Review', venue: 'Demo Event Hall', day: 7 },
    { key: 'reject', title: 'US-033 Demo: Rejection Review', venue: 'Demo Event Hall', day: 10 },
    { key: 'alternative', title: 'US-033 Demo: Alternative Review', venue: 'Demo Event Hall', day: 14 }
  ].map(spec => ({ ...spec, date: singaporeDate(spec.day, now),
    start: `${singaporeDate(spec.day, now)}T10:00:00+08:00`,
    end: `${singaporeDate(spec.day, now)}T11:00:00+08:00`,
    expiry: spec.expiryMinutes == null ? null : new Date(+new Date(now) + spec.expiryMinutes * 60000).toISOString(),
    eventId: demoId(spec.key + ':event'), bookingId: demoId(spec.key + ':booking'), holdId: demoId(spec.key + ':hold')
  }));
}
async function seedVenueScenarios(pool, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = (await client.query("SELECT id,email FROM users WHERE email IN ('organiser@connectsphere.local','coordinator@connectsphere.local','venue@connectsphere.local')")).rows;
    const user = email => users.find(u => u.email === email)?.id;
    const organiser = user('organiser@connectsphere.local'), coordinator = user('coordinator@connectsphere.local'), staff = user('venue@connectsphere.local');
    if (!organiser || !coordinator || !staff) throw new Error('Seed demo users before venue scenarios.');
    const venues = new Map();
    for (const [name, capacity] of [['Demo Meeting Room',60],['Demo Event Hall',400]]) {
      const row = (await client.query(`INSERT INTO venues (name,location,capacity,facilities,accessibility,supported_layouts,available_from,available_until)
        VALUES ($1,'Demo campus', $2, '["Projector","Wi-Fi"]','["wheelchair ramps"]','["Classroom","Theater"]',$3,$4)
        ON CONFLICT (name) DO UPDATE SET available_from=EXCLUDED.available_from,available_until=EXCLUDED.available_until RETURNING id`,
        [name,capacity,singaporeDate(0,now),singaporeDate(365,now)])).rows[0];
      venues.set(name,row.id);
      for (let day = 0; day < 7; day++) await client.query(`INSERT INTO venue_operating_hours (venue_id,day_of_week,opens_at,closes_at)
        VALUES ($1,$2,'08:00','22:00') ON CONFLICT (venue_id,day_of_week) DO UPDATE SET opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at`,[row.id,day]);
    }
    const specs = scenarios(now);
    for (const spec of specs) {
      const draft = { eventName:spec.title,startDate:spec.date,endDate:spec.date,startTime:'10:00',endTime:'11:00',expectedAttendance:'23',
        purpose:'Manual venue workflow demonstration',description:'Seed-managed demo; rerun seed-demo to reset.',venueRequirements:'Classroom',accessibilityNeeds:'Wheelchair access',equipmentRequirements:'Projector',registrationNeeds:'no' };
      await client.query(`INSERT INTO events (id,title,organiser_id,assigned_coordinator_id,status,preferred_start,preferred_end,expected_attendance,purpose,description,venue_layout_preference,accessibility_requirements,equipment_requirements,draft_data,submitted_at)
        VALUES ($1,$2,$3,$4,'approved',$5,$6,23,$7,$8,'Classroom','{"notes":"Wheelchair access"}','["Projector"]',$9,now())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,organiser_id=EXCLUDED.organiser_id,assigned_coordinator_id=EXCLUDED.assigned_coordinator_id,status='approved',
        preferred_start=EXCLUDED.preferred_start,preferred_end=EXCLUDED.preferred_end,expected_attendance=23,purpose=EXCLUDED.purpose,description=EXCLUDED.description,
        venue_layout_preference=EXCLUDED.venue_layout_preference,accessibility_requirements=EXCLUDED.accessibility_requirements,equipment_requirements=EXCLUDED.equipment_requirements,draft_data=EXCLUDED.draft_data,updated_at=now()`,
        [spec.eventId,spec.title,organiser,coordinator,spec.start,spec.end,draft.purpose,draft.description,JSON.stringify(draft)]);
      await client.query(`INSERT INTO bookings (id,event_id,venue_id,requested_by,start_time,end_time,status,setup_minutes,turnaround_minutes,required_capacity,venue_requirements)
        VALUES ($1,$2,$3,$4,$5,$6,'pending',30,30,23,'{"description":"Classroom with wheelchair access and projector"}')
        ON CONFLICT (id) DO UPDATE SET event_id=EXCLUDED.event_id,venue_id=EXCLUDED.venue_id,requested_by=EXCLUDED.requested_by,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,
        status='pending',setup_minutes=30,turnaround_minutes=30,required_capacity=23,venue_requirements=EXCLUDED.venue_requirements,
        decision_reason=NULL,decision_comment=NULL,alternative_start_time=NULL,alternative_end_time=NULL,decided_by=NULL,decided_at=NULL,conflict_warning=false,conflict_details='[]'`,
        [spec.bookingId,spec.eventId,venues.get(spec.venue),coordinator,spec.start,spec.end]);
      if (spec.expiry) {
        // Only our deterministic fixtures are reset. Other manually created holds are preserved.
        await client.query(`DELETE FROM notifications WHERE event_id=$1 AND message LIKE $2`,[spec.eventId,'%Hold: '+spec.holdId]);
        await client.query(`INSERT INTO venue_holds (id,booking_id,event_id,venue_id,start_time,end_time,setup_minutes,turnaround_minutes,status,expiry_at,created_by,updated_by,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,30,30,'active',$7,$8,$8,$9,$9)
          ON CONFLICT (id) DO UPDATE SET start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,setup_minutes=30,turnaround_minutes=30,status='active',expiry_at=EXCLUDED.expiry_at,
          expiry_notified_at=NULL,created_by=EXCLUDED.created_by,updated_by=EXCLUDED.updated_by,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`,
          [spec.holdId,spec.bookingId,spec.eventId,venues.get(spec.venue),spec.start,spec.end,spec.expiry,staff,new Date(+new Date(now)-2*3600000).toISOString()]);
      }
    }
    await client.query('COMMIT');
    return specs.map(s => ({event:s.title,venue:s.venue,start:s.start,end:s.end,expiry:s.expiry,coordinator:'coordinator@connectsphere.local',bookingStatus:'pending'}));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { singaporeDate, demoId, scenarios, seedVenueScenarios };
