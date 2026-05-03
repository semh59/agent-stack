#!/usr/bin/env node
const BASE = 'http://127.0.0.1:51122';
const TOKEN = 'dev-local-token';

async function main() {
  // Test 1: Health endpoint
  console.log('=== Test 1: GET /api/health ===');
  try {
    const r1 = await fetch(`${BASE}/api/health`);
    console.log(`Status: ${r1.status}`);
    console.log(JSON.stringify(await r1.json(), null, 2));
  } catch (e) { console.error('Error:', e.message); }

  // Test 2: Metro Health (needs auth)
  console.log('\n=== Test 2: GET /api/metro/health ===');
  try {
    const r2 = await fetch(`${BASE}/api/metro/health`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log(`Status: ${r2.status}`);
    console.log(JSON.stringify(await r2.json(), null, 2));
  } catch (e) { console.error('Error:', e.message); }

  // Test 3: Metro Alerts
  console.log('\n=== Test 3: GET /api/metro/alerts ===');
  try {
    const r3 = await fetch(`${BASE}/api/metro/alerts`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log(`Status: ${r3.status}`);
    console.log(JSON.stringify(await r3.json(), null, 2));
  } catch (e) { console.error('Error:', e.message); }

  // Test 4: Metro Metrics
  console.log('\n=== Test 4: GET /api/metro/metrics ===');
  try {
    const r4 = await fetch(`${BASE}/api/metro/metrics`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log(`Status: ${r4.status}`);
    console.log(JSON.stringify(await r4.json(), null, 2));
  } catch (e) { console.error('Error:', e.message); }
}

main();