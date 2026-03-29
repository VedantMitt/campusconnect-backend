require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const hostId = userRes.rows[0].id;
    console.log("Found Host ID:", hostId);

    const result = await pool.query(
      `INSERT INTO rooms (name, type, host_id, media_url) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      ['Test Room', 'VIDEO', hostId, '']
    );
    console.log("Success:", result.rows[0]);
  } catch (err) {
    console.error("Postgres Error:", err.message);
  } finally {
    pool.end();
  }
}

run();
