import "dotenv/config";
import pool from "../src/db";

async function checkUsers() {
  try {
    const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'`);
    console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkUsers();
