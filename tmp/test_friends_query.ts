import "dotenv/config";
import pool from "../src/db";

async function testFriendsQuery() {
  try {
    // We'll test with a query that mimics the current friends query but without a specific user ID filter first
    // to see if it even executes.
    const res = await pool.query(`
      SELECT 
        u.id, 
        u.name, 
        u.username, 
        u.is_invisible,
        (
          SELECT json_agg(json_build_object('id', r.id, 'name', r.name))
          FROM rooms r
          JOIN room_members rm ON rm.room_id = r.id
          WHERE rm.user_id = u.id AND rm.status = 'approved'
        ) as active_rooms
      FROM users u
      LIMIT 5
    `);
    console.log("Query Result:", JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("SQL Error in test query:", err);
    process.exit(1);
  }
}

testFriendsQuery();
