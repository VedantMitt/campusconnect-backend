require("dotenv").config();
const { Client } = require("pg");

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function setupStorage() {
  try {
    await client.connect();

    // Create the 'uploads' bucket in the storage.buckets table
    await client.query(`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('uploads', 'uploads', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    
    // Create RLS policy: allow public reading (SELECT)
    await client.query(`
      CREATE POLICY "Public Access" 
      ON storage.objects FOR SELECT 
      USING ( bucket_id = 'uploads' );
    `).catch(err => {
      if (!err.message.includes('already exists')) console.error("Select Policy error:", err.message);
    });

    // Create RLS policy: allow public inserts (INSERT)
    await client.query(`
      CREATE POLICY "Public Uploads" 
      ON storage.objects FOR INSERT 
      WITH CHECK ( bucket_id = 'uploads' );
    `).catch(err => {
      if (!err.message.includes('already exists')) console.error("Insert Policy error:", err.message);
    });

    // Create RLS policy: allow public updates (UPDATE)
    await client.query(`
      CREATE POLICY "Public Updates" 
      ON storage.objects FOR UPDATE 
      USING ( bucket_id = 'uploads' );
    `).catch(err => {
      if (!err.message.includes('already exists')) console.error("Update Policy error:", err.message);
    });
    
    // Create RLS policy: allow public deletes (DELETE)
    await client.query(`
      CREATE POLICY "Public Deletes" 
      ON storage.objects FOR DELETE 
      USING ( bucket_id = 'uploads' );
    `).catch(err => {
      if (!err.message.includes('already exists')) console.error("Delete Policy error:", err.message);
    });

    console.log("Bucket 'uploads' and public policies configured successfully!");
    
  } catch (err) {
    console.error("Failed to setup storage:", err);
  } finally {
    await client.end();
  }
}

setupStorage();
