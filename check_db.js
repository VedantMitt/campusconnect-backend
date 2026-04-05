require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notifications'");
    console.log('Notifications Columns:', res.rows.map(r => r.column_name));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
