require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('--- MIGRATION V2.1 START ---');

    // 5. Notifications: Add metadata for context
    await pool.query(`
      ALTER TABLE notifications 
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
    `);
    console.log('Notifications updated: added metadata');

    console.log('--- MIGRATION V2.1 COMPLETE ---');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
