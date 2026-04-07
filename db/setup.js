const { createClient } = require('@supabase/supabase-js');

// Use JH_ prefixed vars to avoid Vercel integration override
const SUPABASE_URL = process.env.JH_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.JH_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function initDb() {
  console.log('Supabase URL:', SUPABASE_URL);
}

module.exports = { supabase, initDb };
