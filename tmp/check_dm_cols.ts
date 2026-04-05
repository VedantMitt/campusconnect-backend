import "dotenv/config";
import pool from "../src/db";

async function checkSchema() {
  try {
    const res = await pool.query("SELECT * FROM dm_roulette_pools LIMIT 0");
    console.log("COLUMNS:", res.fields.map(f => f.name));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
