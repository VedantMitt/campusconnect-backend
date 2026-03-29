// Check existing storage buckets
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkBuckets() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.log("Error listing buckets:", error.message);
  } else {
    console.log("Existing buckets:", JSON.stringify(data, null, 2));
  }
  process.exit(0);
}

checkBuckets();
