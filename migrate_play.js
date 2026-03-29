const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    // ═══════════════════════════════════════════════
    // DM ROULETTE TABLES
    // ═══════════════════════════════════════════════

    // 1. Roulette pools
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dm_roulette_pools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(100) DEFAULT 'DM Roulette',
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'paired', 'expired')),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created dm_roulette_pools table');

    // 2. Roulette entries (people who joined a pool)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dm_roulette_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pool_id UUID NOT NULL REFERENCES dm_roulette_pools(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gender VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female', 'non-binary', 'prefer-not-to-say')),
        preferred_gender VARCHAR(20) NOT NULL CHECK (preferred_gender IN ('male', 'female', 'non-binary', 'any')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(pool_id, user_id)
      )
    `);
    console.log('✅ Created dm_roulette_entries table');

    // 3. Roulette pairs (result of spinning)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dm_roulette_pairs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pool_id UUID NOT NULL REFERENCES dm_roulette_pools(id) ON DELETE CASCADE,
        user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        initiator_id UUID REFERENCES users(id),
        expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created dm_roulette_pairs table');

    // ═══════════════════════════════════════════════
    // SECRET CRUSH TABLE
    // ═══════════════════════════════════════════════

    await pool.query(`
      CREATE TABLE IF NOT EXISTS secret_crushes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        crusher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        crush_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_matched BOOLEAN DEFAULT false,
        matched_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(crusher_id, crush_id)
      )
    `);
    console.log('✅ Created secret_crushes table');

    // ═══════════════════════════════════════════════
    // GUESS THE LIE TABLES
    // ═══════════════════════════════════════════════

    // 1. Game parties (lobbies)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gtl_games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(100) NOT NULL DEFAULT 'Guess the Lie',
        visibility VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
        status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created gtl_games table');

    // 2. Game members (for private games, need approval)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gtl_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES gtl_games(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(game_id, user_id)
      )
    `);
    console.log('✅ Created gtl_members table');

    // 3. Rounds (each person takes a turn submitting 3 statements)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gtl_rounds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES gtl_games(id) ON DELETE CASCADE,
        presenter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        statement1 TEXT NOT NULL,
        statement2 TEXT NOT NULL,
        statement3 TEXT NOT NULL,
        lie_index INT NOT NULL CHECK (lie_index IN (1, 2, 3)),
        status VARCHAR(20) DEFAULT 'voting' CHECK (status IN ('voting', 'revealed')),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created gtl_rounds table');

    // 4. Votes on rounds
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gtl_votes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id UUID NOT NULL REFERENCES gtl_rounds(id) ON DELETE CASCADE,
        voter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        guessed_index INT NOT NULL CHECK (guessed_index IN (1, 2, 3)),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(round_id, voter_id)
      )
    `);
    console.log('✅ Created gtl_votes table');

    console.log('\n🎮 All Play migrations completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    pool.end();
  }
})();
