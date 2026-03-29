const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    // 1. Create gigs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gigs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Created gigs table');

    // 2. Create gig_applications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gig_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gig_id UUID NOT NULL REFERENCES gigs(id) ON DELETE CASCADE,
        applicant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(gig_id, applicant_id)
      )
    `);
    console.log('Created gig_applications table');

    console.log('\nAll gig migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    pool.end();
  }
})();
