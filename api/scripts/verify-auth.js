const fetch = require('node-fetch'); // Or native fetch in Node 18+

async function verify() {
  const baseUrl = 'http://localhost:3000';
  console.log('Verifying Auth API at ' + baseUrl);

  // 1. Login
  console.log('\n--- 1. Login (Success) ---');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantName: 'Oilfield Tubular Services',
      email: 'admin@oilfield-tubular-services.com',
      password: 'password123'
    })
  });

  if (!loginRes.ok) {
    console.error('Login failed:', loginRes.status, await loginRes.text());
    process.exit(1);
  }

  const loginData = await loginRes.json();
  console.log('Login successful!');
  console.log('Access Token:', loginData.accessToken ? 'Present' : 'Missing');
  console.log('Refresh Token:', loginData.refreshToken ? 'Present' : 'Missing');

  if (!loginData.accessToken) process.exit(1);

  // 2. Protected Route (Success)
  console.log('\n--- 2. Protected Route (Success) ---');
  const meRes = await fetch(`${baseUrl}/auth/me`, {
    headers: { 'Authorization': `Bearer ${loginData.accessToken}` }
  });

  if (!meRes.ok) {
    console.error('Me failed:', meRes.status, await meRes.text());
    process.exit(1);
  }
  const meData = await meRes.json();
  console.log('Me valid:', meData.email);

  // 3. Protected Route (Fail)
  console.log('\n--- 3. Protected Route (Fail) ---');
  const failRes = await fetch(`${baseUrl}/auth/me`);
  if (failRes.status === 401) {
    console.log('Got 401 as expected.');
  } else {
    console.error('Expected 401, got:', failRes.status);
    process.exit(1);
  }

  // 4. Verification completed
  console.log('\n✅ Verification PASSED');
}

verify().catch(console.error);
