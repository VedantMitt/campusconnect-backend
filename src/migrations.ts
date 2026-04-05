import pool from "./db";

export const runMigrations = async () => {
  console.log("🚀 Starting database migrations...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);


    // --- 0. Core Tables Initialization ---
    // Ensure activities exists before rooms/submissions
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        date TIMESTAMP NOT NULL,
        location TEXT NOT NULL,
        description TEXT,
        banner TEXT,
        mode TEXT,
        host_id UUID REFERENCES users(id) ON DELETE CASCADE,
        max_participants INTEGER,
        join_deadline TIMESTAMP,
        submission_deadline TIMESTAMP,
        allow_submissions BOOLEAN DEFAULT TRUE,
        format TEXT DEFAULT 'Event',
        social_links JSONB DEFAULT '[]',
        price DECIMAL DEFAULT 0,
        is_free BOOLEAN DEFAULT TRUE,
        is_official BOOLEAN DEFAULT FALSE,
        hosted_by_name TEXT,
        college_name TEXT,
        society_name TEXT,
        view_count INTEGER DEFAULT 0,
        deleted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_members (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(activity_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS activity_rsvps (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL, -- going, interested
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(activity_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(activity_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(submission_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS activity_comments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_invites (
        id SERIAL PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        inviter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        invitee_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(activity_id, inviter_id, invitee_id)
      );
    `);
    console.log("✅ Activities and Social tables verified");

    // 1. Moderation Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id SERIAL PRIMARY KEY,
        blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(blocker_id, blocked_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reported_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Moderation tables verified");

    // 2. Friends Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id1 UUID REFERENCES users(id) ON DELETE CASCADE,
        user_id2 UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id1, user_id2)
      );
    `);
    console.log("✅ Friends table verified");

    // 3. Notifications Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );
    `);
    await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
    console.log("✅ Notifications table verified");

    // 4. Rooms & Room Members
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        host_id UUID REFERENCES users(id) ON DELETE CASCADE,
        media_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        visibility VARCHAR(20) DEFAULT 'public',
        searchable BOOLEAN DEFAULT TRUE,
        queue JSONB DEFAULT '[]',
        roles JSONB DEFAULT '{}',
        activity_id UUID UNIQUE REFERENCES activities(id) ON DELETE CASCADE
      );
    `);
    
    await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public'`);
    await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS searchable BOOLEAN DEFAULT TRUE`);
    await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS queue JSONB DEFAULT '[]'`);
    await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS roles JSONB DEFAULT '{}'`);
    await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS activity_id UUID UNIQUE REFERENCES activities(id) ON DELETE CASCADE`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'approved',
        is_done BOOLEAN DEFAULT FALSE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, user_id)
      );
    `);
    await client.query(`ALTER TABLE room_members ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT FALSE`);

    // CLEANUP: Delete rooms with 0 approved members
    const cleanup = await client.query(`
      DELETE FROM rooms
      WHERE id NOT IN (SELECT room_id FROM room_members WHERE status = 'approved')
    `);
    if (cleanup.rowCount && cleanup.rowCount > 0) {
      console.log(`🧹 Cleaned up ${cleanup.rowCount} empty rooms.`);
    }
    console.log("✅ Rooms table verified");

    // 5. User Privacy
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_invisible BOOLEAN DEFAULT FALSE`);
    console.log("✅ User privacy columns verified");
  
    // 6. Activity Announcements & Moderators
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_announcements (
        id SERIAL PRIMARY KEY,
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS activity_moderators (
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (activity_id, user_id)
      );
    `);
    console.log("✅ Activity Social tables verified");

    await client.query("COMMIT");
    console.log("✨ All migrations completed successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Database migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
};

