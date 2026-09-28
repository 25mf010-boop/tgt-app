const SUPABASE_URL = "https://dkhkwubcftbdgfxxssjr.supabase.co";
const SUPABASE_KEY = "sb_publishable_z6-DSpZcaUZ6SZx71x_VEQ__H4lVge9";

async function checkCols() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  console.log("Users table sample row:", data);
}

checkCols();
