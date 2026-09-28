const SUPABASE_URL = "https://dkhkwubcftbdgfxxssjr.supabase.co";
const SUPABASE_KEY = "sb_publishable_z6-DSpZcaUZ6SZx71x_VEQ__H4lVge9";

async function testCreateUser() {
  const testId = "test_user_999";
  
  // 1. Try inserting with signup_date: null (Will fail with 23502 error)
  const resNull = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([{ id: testId, password: 'pass', signup_date: null }])
  });
  const dataNull = await resNull.json();
  console.log("Insert with signup_date null result:", dataNull);

  // 2. Try inserting without signup_date field
  const resGood = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([{ id: testId, password: 'pass' }])
  });
  const dataGood = await resGood.json();
  console.log("Insert without signup_date result:", dataGood);

  // Clean up test user
  await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${testId}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
}

testCreateUser();
