const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function initDb() {
  console.log('Supabase connected:', process.env.SUPABASE_URL ? 'yes' : 'NO URL');
  console.log('Service key set:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'yes' : 'NO');
}

module.exports = { supabase, initDb };
