const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  connectionString: 'postgresql://postgres.katxvhfxjisnruytqgto:X8IAM9013%40cool@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  let out = '';
  try {
    const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'activities' ORDER BY ordinal_position`);
    out += 'ACTIVITIES:\n' + cols.rows.map(r => r.column_name + ':' + r.data_type).join('\n') + '\n\n';
    
    const members = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'activity_members' ORDER BY ordinal_position`);
    out += 'ACTIVITY_MEMBERS:\n' + members.rows.map(r => r.column_name + ':' + r.data_type).join('\n') + '\n\n';

    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    out += 'TABLES:\n' + tables.rows.map(r => r.table_name).join('\n') + '\n\n';

    const subs = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'submissions' ORDER BY ordinal_position`);
    out += 'SUBMISSIONS:\n' + subs.rows.map(r => r.column_name + ':' + r.data_type).join('\n') + '\n\n';

    const users = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position`);
    out += 'USERS:\n' + users.rows.map(r => r.column_name + ':' + r.data_type).join('\n') + '\n\n';
  } catch (err) {
    out += 'ERROR: ' + err.message;
  } finally {
    fs.writeFileSync('schema.md', out, 'utf8');
    pool.end();
  }
})();
