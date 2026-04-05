import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/campusconnect"
});

pool.query("SELECT id, name, media_url, queue FROM rooms ORDER BY created_at DESC LIMIT 1").then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
});
