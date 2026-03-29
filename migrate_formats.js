const { Client } = require("pg");

const client = new Client({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    console.log("Adding format and links to activities...");
    await client.query(`
      ALTER TABLE activities 
      ADD COLUMN IF NOT EXISTS format VARCHAR(50) DEFAULT 'Event',
      ADD COLUMN IF NOT EXISTS whatsapp_link TEXT,
      ADD COLUMN IF NOT EXISTS instagram_link TEXT,
      ADD COLUMN IF NOT EXISTS website_link TEXT;
    `);

    console.log("Creating poll tables...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_polls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        creator_id UUID REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS activity_poll_options (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id UUID REFERENCES activity_polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_poll_votes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id UUID REFERENCES activity_polls(id) ON DELETE CASCADE,
        option_id UUID REFERENCES activity_poll_options(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(poll_id, user_id)
      );
    `);
    
    console.log("Success! Database migrated.");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
