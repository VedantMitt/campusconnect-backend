require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT id, media_url, type FROM rooms');
  console.log(res.rows);
  await client.end();
}

run().catch(console.error);
