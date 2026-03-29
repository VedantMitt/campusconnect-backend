const { Client } = require("pg");

const client = new Client({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    console.log("Adding social_links JSONB column...");
    await client.query(`
      ALTER TABLE activities 
      ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '[]'::jsonb;
    `);
    console.log("Success! Database migrated.");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
