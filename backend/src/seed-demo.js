const bcrypt = require('bcryptjs');
const db = require('./db');

const demoUsers = [
  ['Event Organiser', 'organiser@connectsphere.local', 'event_organiser'],
  ['Event Coordinator', 'coordinator@connectsphere.local', 'event_coordinator'],
  ['Venue Staff', 'venue@connectsphere.local', 'venue_staff'],
  ['Technical Support', 'tech@connectsphere.local', 'technical_support_staff'],
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
  await db.pool.end();
}

run().catch(async (error) => {
  console.error('Failed to seed demo users:', error);
  await db.pool.end();
  process.exit(1);
});
