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
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['theater', 'classroom', 'banquet', 'boardroom'],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 2',
    location: 'Pan Pacific Hotel, Singapore',
    capacity: 50,
    facilities: ['modular stages', 'integrated sound system', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['theater', 'banquet'],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  },
  {
    name: 'Hotel Ballroom 3',
    location: 'Shangri-La Hotel, Singapore',
    capacity: 150,
    facilities: ['acoustic partition walls', 'modular stages', 'integrated sound system', 'programmable smart lighting', 'projectors', 'projector screens', 'Wi-Fi'],
    accessibility: ['wheelchair ramps'],
    supportedLayouts: ['theater', 'classroom', 'banquet'],
    imageUrl: 'https://live.staticflickr.com/7411/16237273980_3f78d66bec_b.jpg'
  }
];

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
      `INSERT INTO venues (name, location, capacity, facilities, accessibility, supported_layouts)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       ON CONFLICT (name) DO UPDATE SET
         location = EXCLUDED.location,
         capacity = EXCLUDED.capacity,
         facilities = EXCLUDED.facilities,
         accessibility = EXCLUDED.accessibility,
         supported_layouts = EXCLUDED.supported_layouts
       RETURNING id`,
      [
        venue.name,
        venue.location,
        venue.capacity,
        JSON.stringify(venue.facilities),
        JSON.stringify(venue.accessibility),
        JSON.stringify(venue.supportedLayouts)
      ]
    );
    const venueId = result.rows[0].id;

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
