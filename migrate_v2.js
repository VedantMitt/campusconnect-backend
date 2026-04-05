require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('--- MIGRATION V2 START ---');

    // 1. Activities: Add city
    await pool.query(`
      ALTER TABLE activities 
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'upcoming';
    `);
    console.log('Activities updated: added city, status');

    // 2. Rooms: Add is_private, show_in_search
    await pool.query(`
      ALTER TABLE rooms 
      ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS show_in_search BOOLEAN DEFAULT TRUE;
    `);
    console.log('Rooms updated: added is_private, show_in_search');

    // 3. Room Members: Add status
    await pool.query(`
      ALTER TABLE room_members 
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
    `);
    console.log('Room Members updated: added status');

    // 4. Users: Add is_external (for non-college emails)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE;
    `);
    console.log('Users updated: added is_external');

    console.log('--- MIGRATION V2 COMPLETE ---');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
