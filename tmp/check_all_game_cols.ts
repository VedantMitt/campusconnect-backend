import "dotenv/config";
import pool from "../src/db";

async function checkSchema() {
  try {
    const tables = ['dm_roulette_pools', 'dm_roulette_entries', 'dm_roulette_pairs', 'gtl_games', 'gtl_members'];
    for (const table of tables) {
      console.log(`\n--- ${table} ---`);
      const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`);
      console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
