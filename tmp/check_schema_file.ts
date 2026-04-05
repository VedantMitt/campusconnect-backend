import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'dm_roulette_pools'
    `);
    fs.writeFileSync("tmp/schema_out.txt", JSON.stringify(res.rows, null, 2));
    console.log("Written to tmp/schema_out.txt");

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkSchema();
