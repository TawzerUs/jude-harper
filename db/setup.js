const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function initDb() {
  console.log('Supabase connected:', process.env.SUPABASE_URL ? 'yes' : 'NO URL');
}

module.exports = { supabase, initDb };
