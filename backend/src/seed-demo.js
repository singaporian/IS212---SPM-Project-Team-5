const bcrypt = require('bcryptjs');
const db = require('./db');

const demoUsers = [
  ['Event Organiser', 'organiser@connectsphere.local', 'event_organiser'],
  ['Event Coordinator', 'coordinator@connectsphere.local', 'event_coordinator'],
  ['Venue Staff', 'venue@connectsphere.local', 'venue_staff'],
  ['Technical Support', 'tech@connectsphere.local', 'technical_support_staff'],
  ['Attendee', 'attendee@connectsphere.local', 'attendee']
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
  await db.pool.end();
}

run().catch(async (error) => {
  console.error('Failed to seed demo users:', error);
  await db.pool.end();
  process.exit(1);
});
