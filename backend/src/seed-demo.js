const bcrypt = require('bcryptjs');
const db = require('./db');

const demoUsers = [
  ['Event Organiser', 'organiser@connectsphere.local', 'event_organiser'],
  ['Event Coordinator', 'coordinator@connectsphere.local', 'event_coordinator'],
  ['Event Coordinator Two', 'coordinator2@connectsphere.local', 'event_coordinator'],
  ['Event Coordinator Three', 'coordinator3@connectsphere.local', 'event_coordinator'],
  ['Event Coordinator Lead', 'coordinatorlead@connectsphere.local', 'event_coordinator_lead'],
  ['Venue Staff', 'venue@connectsphere.local', 'venue_staff'],
  ['Technical Support', 'tech@connectsphere.local', 'technical_support_staff'],
  ['Safety Officer', 'safety@connectsphere.local', 'safety_officer'],
  ['Attendee', 'attendee@connectsphere.local', 'attendee']
];

const demoVenues = [
  {
    name: 'Hotel Ballroom 1',
    location: 'Marina Bay Sands Hotel, Singapore',
    capacity: 100,
    facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps', 'accessible parking'],
    supportedLayouts: ['Theater', 'Classroom', 'Banquet', 'Boardroom'],
    unavailablePeriods: [
      { start: '2026-09-15T10:00:00+08:00', end: '2026-09-15T14:00:00+08:00', reason: 'Scheduled maintenance' },
      { start: '2026-10-12T09:00:00+08:00', end: '2026-10-12T12:00:00+08:00', reason: 'Fire safety inspection' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 2',
    location: 'Pan Pacific Hotel, Singapore',
    capacity: 50,
    facilities: ['modular stages', 'integrated sound system', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Banquet'],
    unavailablePeriods: [
      { start: '2026-09-18T18:00:00+08:00', end: '2026-09-18T21:00:00+08:00', reason: 'Private function' },
      { start: '2026-11-06T13:00:00+08:00', end: '2026-11-06T17:00:00+08:00', reason: 'Audio equipment servicing' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 3',
    location: 'Shangri-La Hotel, Singapore',
    capacity: 150,
    facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Classroom', 'Banquet'],
    unavailablePeriods: [
      { start: '2026-09-20T09:00:00+08:00', end: '2026-09-20T12:00:00+08:00', reason: 'AV system upgrade' },
      { start: '2026-12-03T10:00:00+08:00', end: '2026-12-03T15:00:00+08:00', reason: 'Floor maintenance' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 4',
    location: 'Raffles Hotel Singapore, Singapore',
    capacity: 200,
    facilities: ['acoustic partition walls', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Banquet', 'Boardroom'],
    unavailablePeriods: [
      { start: '2026-09-22T15:00:00+08:00', end: '2026-09-22T19:00:00+08:00', reason: 'Floor refurbishment' },
      { start: '2027-01-08T08:00:00+08:00', end: '2027-01-08T11:00:00+08:00', reason: 'Lighting system inspection' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 5',
    location: 'The Fullerton Hotel Singapore, Singapore',
    capacity: 100,
    facilities: ['modular stages', 'integrated sound system', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Classroom', 'Banquet'],
    unavailablePeriods: [
      { start: '2026-09-16T08:00:00+08:00', end: '2026-09-16T11:00:00+08:00', reason: 'Cleaning and inspection' },
      { start: '2026-10-27T16:00:00+08:00', end: '2026-10-27T20:00:00+08:00', reason: 'Private function' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 6',
    location: 'The Ritz-Carlton, Millenia Singapore, Singapore',
    capacity: 50,
    facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'projectors', 'projector screens'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Classroom', 'Boardroom'],
    unavailablePeriods: [
      { start: '2026-09-24T12:00:00+08:00', end: '2026-09-24T16:00:00+08:00', reason: 'Lighting maintenance' },
      { start: '2026-11-19T09:00:00+08:00', end: '2026-11-19T13:00:00+08:00', reason: 'Projector replacement' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 7',
    location: 'Conrad Singapore Orchard, Singapore',
    capacity: 150,
    facilities: ['modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Banquet'],
    unavailablePeriods: [
      { start: '2026-09-19T16:00:00+08:00', end: '2026-09-19T20:00:00+08:00', reason: 'Private function' },
      { start: '2026-12-18T14:00:00+08:00', end: '2026-12-18T18:00:00+08:00', reason: 'Annual maintenance' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 8',
    location: 'Fairmont Singapore, Singapore',
    capacity: 200,
    facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Classroom', 'Banquet', 'Boardroom'],
    unavailablePeriods: [
      { start: '2026-09-25T09:00:00+08:00', end: '2026-09-25T13:00:00+08:00', reason: 'Scheduled maintenance' },
      { start: '2027-01-22T10:00:00+08:00', end: '2027-01-22T14:00:00+08:00', reason: 'Air-conditioning maintenance' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 9',
    location: 'JW Marriott Hotel Singapore South Beach, Singapore',
    capacity: 100,
    facilities: ['acoustic partition walls', 'integrated sound system', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Classroom', 'Banquet'],
    unavailablePeriods: [
      { start: '2026-09-17T14:00:00+08:00', end: '2026-09-17T18:00:00+08:00', reason: 'Carpet replacement' },
      { start: '2026-12-09T08:00:00+08:00', end: '2026-12-09T11:00:00+08:00', reason: 'Electrical inspection' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 10',
    location: 'Parkroyal Collection Marina Bay, Singapore',
    capacity: 50,
    facilities: ['modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['Theater', 'Banquet', 'Boardroom'],
    unavailablePeriods: [
      { start: '2026-09-21T10:00:00+08:00', end: '2026-09-21T15:00:00+08:00', reason: 'Safety inspection' },
      { start: '2027-01-29T17:00:00+08:00', end: '2027-01-29T21:00:00+08:00', reason: 'Private function' }
    ],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  }
];

const operatingDays = [0, 1, 2, 3, 4, 5, 6];
const availableFrom = '2026-09-13';
const availableUntil = '2027-01-31';
const US023_PURPOSE = 'Demo event for US-023 equipment reservations';

async function ensureDemoEvent(title, expectedAttendance, organiserId, purpose = 'Demo booking for US-017') {
  const existing = await db.query(
    'SELECT id FROM events WHERE title = $1 ORDER BY created_at LIMIT 1',
    [title]
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE events
       SET organiser_id = $1, status = 'approved', event_type = 'Conference',
           expected_attendance = $2, purpose = $4
       WHERE id = $3`,
      [organiserId, expectedAttendance, existing.rows[0].id, purpose]
    );
    return existing.rows[0].id;
  }

  const result = await db.query(
    `INSERT INTO events (organiser_id, title, event_type, expected_attendance, purpose, status)
     VALUES ($1, $2, 'Conference', $3, $4, 'approved')
     RETURNING id`,
    [organiserId, title, expectedAttendance, purpose]
  );
  return result.rows[0].id;
}

async function seedDemoBookings() {
  const organiserResult = await db.query('SELECT id FROM users WHERE email = $1', ['organiser@connectsphere.local']);
  const coordinatorResult = await db.query('SELECT id FROM users WHERE email = $1', ['coordinator@connectsphere.local']);
  const venueResult = await db.query(
    'SELECT id, name FROM venues WHERE name = ANY($1::text[])',
    [['Hotel Ballroom 1', 'Hotel Ballroom 2']]
  );
  const venuesByName = new Map(venueResult.rows.map((venue) => [venue.name, venue.id]));
  if (!organiserResult.rows[0] || !coordinatorResult.rows[0] || !venuesByName.has('Hotel Ballroom 1') || !venuesByName.has('Hotel Ballroom 2')) {
    throw new Error('Unable to find demo users or venues required for US-017 bookings');
  }

  const organiserId = organiserResult.rows[0].id;
  const coordinatorId = coordinatorResult.rows[0].id;
  const bookingSpecs = [
    { title: 'US-017 Demo: Morning Conference', attendance: 80, venue: 'Hotel Ballroom 1', day: 3, start: '09:00', end: '11:00', setup: 30, turnaround: 45 },
    { title: 'US-017 Demo: Midday Workshop', attendance: 45, venue: 'Hotel Ballroom 1', day: 3, start: '11:30', end: '13:00', setup: 30, turnaround: 30 },
    { title: 'US-017 Demo: Evening Seminar', attendance: 30, venue: 'Hotel Ballroom 1', day: 3, start: '17:00', end: '18:00', setup: 30, turnaround: 30 },
    { title: 'US-017 Demo: Ballroom Two Reception', attendance: 35, venue: 'Hotel Ballroom 2', day: 5, start: '14:00', end: '16:00', setup: 30, turnaround: 30 },
    // US-023: overlaps the Morning Conference and the Midday Workshop, which do not overlap each other.
    { title: 'US-023 Demo: Product Launch', attendance: 60, venue: 'Hotel Ballroom 2', day: 3, start: '10:00', end: '12:00', setup: 30, turnaround: 30, purpose: US023_PURPOSE },
    // US-023: one event with two venue bookings, so it has two scheduled windows.
    { title: 'US-023 Demo: Two-Room Summit', attendance: 50, venue: 'Hotel Ballroom 1', day: 6, start: '09:00', end: '12:00', setup: 30, turnaround: 30, purpose: US023_PURPOSE },
    { title: 'US-023 Demo: Two-Room Summit', attendance: 50, venue: 'Hotel Ballroom 2', day: 6, start: '13:00', end: '17:00', setup: 30, turnaround: 30, purpose: US023_PURPOSE }
  ];

  const events = [];
  for (const spec of bookingSpecs) {
    events.push({
      ...spec,
      eventId: await ensureDemoEvent(spec.title, spec.attendance, organiserId, spec.purpose)
    });
  }

  await db.query('DELETE FROM bookings WHERE event_id = ANY($1::uuid[])', [events.map((event) => event.eventId)]);
  for (const event of events) {
    await db.query(
      `INSERT INTO bookings (
         event_id, venue_id, requested_by, start_time, end_time, status,
         setup_minutes, turnaround_minutes, decided_by, decided_at
       )
       VALUES (
         $1, $2, $3,
         (CURRENT_DATE + $4::int) + $5::time,
         (CURRENT_DATE + $4::int) + $6::time,
         'confirmed', $7, $8, $9, now()
       )`,
      [
        event.eventId,
        venuesByName.get(event.venue),
        coordinatorId,
        event.day,
        event.start,
        event.end,
        event.setup,
        event.turnaround,
        coordinatorId
      ]
    );
  }
}

// US-023: demo inventory plus reservations that fully commit the microphones during the Morning Conference.
const demoEquipment = [
  { name: 'Wireless Microphone', type: 'Audio', quantity: 4, specs: { 'Frequency range': '470-530 MHz' } },
  { name: 'Laser Projector', type: 'Video & Display', quantity: 2, specs: { Brightness: '7000 lumens' } },
  { name: 'LED Par Light', type: 'Lighting', quantity: 10, specs: {} }
];
const demoReservations = [
  { equipment: 'Wireless Microphone', event: 'US-017 Demo: Morning Conference', quantity: 4 },
  { equipment: 'Laser Projector', event: 'US-017 Demo: Morning Conference', quantity: 1 },
  { equipment: 'Laser Projector', event: 'US-017 Demo: Midday Workshop', quantity: 1 },
  { equipment: 'LED Par Light', event: 'US-017 Demo: Evening Seminar', quantity: 6 }
];

async function seedDemoEquipment() {
  const ids = new Map();
  for (const item of demoEquipment) {
    const existing = await db.query('SELECT id FROM equipment WHERE name = $1 ORDER BY created_at LIMIT 1', [item.name]);
    const result = existing.rows[0]
      ? await db.query(
        `UPDATE equipment SET equipment_type = $2, total_quantity = $3, status = 'available', specs = $4::jsonb
         WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, item.type, item.quantity, JSON.stringify(item.specs)])
      : await db.query(
        `INSERT INTO equipment (name, equipment_type, total_quantity, status, specs)
         VALUES ($1, $2, $3, 'available', $4::jsonb) RETURNING id`,
        [item.name, item.type, item.quantity, JSON.stringify(item.specs)]);
    ids.set(item.name, result.rows[0].id);
  }

  const technician = await db.query('SELECT id FROM users WHERE email = $1', ['tech@connectsphere.local']);
  await db.query('DELETE FROM equipment_reservations WHERE equipment_id = ANY($1::uuid[])', [[...ids.values()]]);
  for (const reservation of demoReservations) {
    await db.query(
      `INSERT INTO equipment_reservations (equipment_id, event_id, quantity, status, reserved_by)
       SELECT $1, id, $3, 'reserved', $4 FROM events WHERE title = $2 ORDER BY created_at LIMIT 1`,
      [ids.get(reservation.equipment), reservation.event, reservation.quantity, technician.rows[0]?.id || null]);
  }
}

async function run() {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  for (const [name, email, role] of demoUsers) {
    await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [name, email, passwordHash, role]
    );
  }
  console.log('Demo users seeded. Password for each account: Password123!');

  for (const venue of demoVenues) {
    const result = await db.query(
      `INSERT INTO venues (name, location, capacity, facilities, accessibility, supported_layouts, available_from, available_until)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::date, $8::date)
       ON CONFLICT (name) DO UPDATE SET
         location = EXCLUDED.location,
         capacity = EXCLUDED.capacity,
         facilities = EXCLUDED.facilities,
         accessibility = EXCLUDED.accessibility,
         supported_layouts = EXCLUDED.supported_layouts,
         available_from = EXCLUDED.available_from,
         available_until = EXCLUDED.available_until
       RETURNING id`,
      [
        venue.name,
        venue.location,
        venue.capacity,
        JSON.stringify(venue.facilities),
        JSON.stringify(venue.accessibility),
        JSON.stringify(venue.supportedLayouts),
        availableFrom,
        availableUntil
      ]
    );
    const venueId = result.rows[0].id;

    await db.query('DELETE FROM venue_operating_hours WHERE venue_id = $1', [venueId]);
    for (const dayOfWeek of operatingDays) {
      await db.query(
        `INSERT INTO venue_operating_hours (venue_id, day_of_week, opens_at, closes_at)
         VALUES ($1, $2, '08:00', '22:00')`,
        [venueId, dayOfWeek]
      );
    }

    await db.query('DELETE FROM venue_unavailabilities WHERE venue_id = $1', [venueId]);
    for (const period of venue.unavailablePeriods) {
      await db.query(
        `INSERT INTO venue_unavailabilities (venue_id, start_time, end_time, reason)
         VALUES ($1, $2::timestamptz, $3::timestamptz, $4)`,
        [venueId, period.start, period.end, period.reason]
      );
    }

    await db.query('DELETE FROM venue_images WHERE venue_id = $1', [venueId]);
    await db.query(
      `INSERT INTO venue_images (venue_id, image_url, alt_text, is_primary)
       VALUES ($1, $2, $3, true)`,
      [venueId, venue.imageUrl, `${venue.name} interior`]
    );
  }
  console.log('Demo venues seeded.');
  await seedDemoBookings();
  console.log('Demo confirmed bookings seeded.');
  await seedDemoEquipment();
  console.log('Demo equipment and reservations seeded.');
  await db.pool.end();
}

run().catch(async (error) => {
  console.error('Failed to seed demo users:', error);
  await db.pool.end();
  process.exit(1);
});
