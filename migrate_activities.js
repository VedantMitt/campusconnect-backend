const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    // 1. Add max_participants to activities
    await pool.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_participants INTEGER`);
    console.log('Added max_participants to activities');

    // 2. Create activity_rsvps table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_rsvps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'not_going')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(activity_id, user_id)
      )
    `);
    console.log('Created activity_rsvps table');

    // 3. Create activity_comments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Created activity_comments table');

    // 4. Create activity_invites table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        inviter_id UUID NOT NULL,
        invitee_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(activity_id, inviter_id, invitee_id)
      )
    `);
    console.log('Created activity_invites table');

    // 5. Add view_count to activities for analytics
    await pool.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`);
    console.log('Added view_count to activities');

    console.log('\nAll migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    pool.end();
  }
})();
