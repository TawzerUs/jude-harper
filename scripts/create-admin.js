// Usage: node scripts/create-admin.js email@example.com yourpassword "Your Name"
require('dotenv').config();
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.JH_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.JH_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] || 'Admin';

  if (!email || !password) {
    console.log('Usage: node scripts/create-admin.js email password [name]');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase.from('jh_admin_users').upsert({
    email,
    password_hash: hash,
    name,
    role: 'admin'
  }, { onConflict: 'email' }).select().single();

  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log(`Admin user created: ${data.email} (${data.name})`);
  }
}

main();
