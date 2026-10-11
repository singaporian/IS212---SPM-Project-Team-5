const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { reviewConflicts } = require('./bookingReview');
const { holdConflicts, processHoldExpiries } = require('./holdAvailability');
const router = express.Router();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = (status,message) => Object.assign(new Error(message),{status});
function validateExpiry(value, now) {
 if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw fail(400,'Enter a valid expiry date and time.');
 const expiry = new Date(value);
 if (!Number.isFinite(+expiry)) throw fail(400,'Enter a valid expiry date and time.');
 if (expiry <= new Date(now)) throw fail(400,'Expiry must be later than the current time.');
 return expiry.toISOString();
}
router.use(auth.authenticate);
router.get('/',auth.requireRoles('venue_staff','event_coordinator'),async(req,res)=>{
 try {
 await processHoldExpiries(db, req.auth.role === 'event_coordinator' ? { coordinatorId: req.auth.sub } : {});
 const result=await db.query(`SELECT h.*, CASE WHEN h.status = 'active' AND h.expiry_at <= clock_timestamp() THEN 'expired' ELSE h.status END AS effective_status, e.title AS event_title, v.name AS venue_name,
 u.name AS actor_name FROM venue_holds h JOIN events e ON e.id=h.event_id JOIN venues v ON v.id=h.venue_id LEFT JOIN users u ON u.id=h.created_by
 WHERE ($1::text = 'venue_staff' OR e.assigned_coordinator_id=$2) ORDER BY h.created_at DESC,h.id`,[req.auth.role,req.auth.sub]);
 res.set('Cache-Control','no-store').json(result.rows.map(h=>({...h,status:h.effective_status})));
 } catch {res.status(500).json({error:'Unable to load tentative holds. Please retry.'});}
});
router.post('/',auth.requireRoles('venue_staff'),async(req,res)=>{
 if(!uuid(req.body.bookingId)) return res.status(400).json({error:'Choose a valid pending booking request.'});
 await place(req,res);
});
async function place(req,res) {
 let client;
 try {
 client=await db.pool.connect(); await client.query('BEGIN');
 // Serialize with booking/unavailability writers and other holds, including overlap phantoms.
 await client.query('LOCK TABLE bookings, venue_unavailabilities, venue_holds IN SHARE ROW EXCLUSIVE MODE');
 const time=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;

 const booking=(await client.query(`SELECT b.* FROM bookings b JOIN events e ON e.id=b.event_id JOIN venues v ON v.id=b.venue_id
 WHERE b.id=$1 AND b.status='pending'`,[req.body.bookingId])).rows[0];
 if(!booking) throw fail(404,'Pending booking request not found.');
 const expiry=validateExpiry(req.body.expiryAt,time);
 const bookings=await client.query('SELECT * FROM bookings WHERE venue_id=$1',[booking.venue_id]);
 const unavailable=await client.query('SELECT * FROM venue_unavailabilities WHERE venue_id=$1',[booking.venue_id]);
 if(reviewConflicts(booking,bookings.rows,unavailable.rows).length || (await holdConflicts(client,booking)).length) throw fail(409,'The occupied slot is unavailable. Refresh and choose another slot.');
 const hold=(await client.query(`INSERT INTO venue_holds (booking_id,event_id,venue_id,start_time,end_time,setup_minutes,turnaround_minutes,expiry_at,created_by,updated_by)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,[booking.id,booking.event_id,booking.venue_id,booking.start_time,booking.end_time,booking.setup_minutes??0,booking.turnaround_minutes??0,expiry,req.auth.sub])).rows[0];
 await client.query('COMMIT');res.status(201).json(hold);
 } catch(error) {if(client) await client.query('ROLLBACK');res.status(error.status||500).json({error:error.status?error.message:'Unable to save tentative hold. Your input is retained; please retry.'});}
 finally {if(client)client.release();}
}
module.exports={router,validateExpiry};
