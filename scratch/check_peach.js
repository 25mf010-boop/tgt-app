const SUPABASE_URL = "https://dkhkwubcftbdgfxxssjr.supabase.co";
const SUPABASE_KEY = "sb_publishable_z6-DSpZcaUZ6SZx71x_VEQ__H4lVge9";

async function testSupabase() {
  const resUsers = await fetch(`${SUPABASE_URL}/rest/v1/users?id=ilike.peach`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const users = await resUsers.json();
  console.log("Supabase users for peach:", users);

  const resPhases = await fetch(`${SUPABASE_URL}/rest/v1/user_phases?user_id=ilike.peach`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const phases = await resPhases.json();
  console.log("Supabase user_phases for peach:", phases);
}

testSupabase();
