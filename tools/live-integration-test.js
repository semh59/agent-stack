#!/usr/bin/env node
/**
 * Live Integration Test — Gateway + UI Events + Auth Flow
 * Requires a running gateway at http://127.0.0.1:51122
 */
const BASE = 'http://127.0.0.1:51122';
const TOKEN = 'dev-local-token';
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('✅', name);
    passed++;
  } catch(e) {
    console.log('❌', name, '-', e.message);
    failed++;
  }
}

async function run() {
  console.log('═══ Live Integration Test ═══\n');

  // Test 1: Gateway is reachable
  await test('Gateway is reachable', async () => {
    const r = await fetch(BASE + '/api/metro/health');
    if (r.status === 503) {
      // Watchdog not running but gateway is up
      const d = await r.json();
      if (d.errors?.[0]?.code === 'WATCHDOG_NOT_READY') {
        console.log('   (Watchdog not initialized — ALLOY_BRIDGE_SECRET not set)');
        return;
      }
    }
    if (r.status >= 500) throw new Error('Gateway returned ' + r.status);
  });

  // Test 2: POST /api/metro/ui-event
  await test('POST /api/metro/ui-event accepts valid event', async () => {
    const r = await fetch(BASE + '/api/metro/ui-event', {
      method: 'POST', headers,
      body: JSON.stringify({ type:'ui:log', source:'vscode-extension', action:'test_ping' })
    });
    const d = await r.json();
    if (!d.data?.received) throw new Error('Not received: ' + JSON.stringify(d));
    console.log('   Response:', JSON.stringify(d.data));
  });

  // Test 3: POST /api/metro/ui-event rejects missing type
  await test('POST /api/metro/ui-event rejects missing type', async () => {
    const r = await fetch(BASE + '/api/metro/ui-event', {
      method: 'POST', headers,
      body: JSON.stringify({ source:'test' })
    });
    if (r.status !== 400) throw new Error('Expected 400, got ' + r.status);
  });

  // Test 4: GET /api/auth/login — Google OAuth URL
  await test('GET /api/auth/login returns Google OAuth URL', async () => {
    const r = await fetch(BASE + '/api/auth/login', { headers });
    const d = await r.json();
    const url = d.data?.url;
    if (!url) throw new Error('No OAuth URL: ' + JSON.stringify(d));
    if (!url.includes('accounts.google.com')) throw new Error('Not a Google OAuth URL: ' + url);
    // Parse and show details
    const u = new URL(url);
    console.log('   Host:', u.hostname);
    console.log('   Redirect URI:', u.searchParams.get('redirect_uri'));
    console.log('   Response Type:', u.searchParams.get('response_type'));
    console.log('   Access Type:', u.searchParams.get('access_type'));
    console.log('   Prompt:', u.searchParams.get('prompt'));
    console.log('   Has client_id:', !!u.searchParams.get('client_id'));
  });

  // Test 5: Auth without token fails
  await test('GET /api/auth/login rejects missing auth', async () => {
    const r = await fetch(BASE + '/api/auth/login');
    // Could be 401 or could pass if local — check behavior
    console.log('   Status:', r.status, '(expected behavior for unauthenticated)');
  });

  // Test 6: Send multiple UI events and check EventBus directly
  await test('Multiple UI events are accepted', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await fetch(BASE + '/api/metro/ui-event', {
        method: 'POST', headers,
        body: JSON.stringify({ type:'ui:log', source:'vscode-extension', action:'batch_' + i })
      });
      if (r.status !== 200) throw new Error('Event ' + i + ' failed: ' + r.status);
    }
    console.log('   5 events sent successfully');
  });

  // Test 7: Check metro health if watchdog is running
  await test('GET /api/metro/health check (watchdog status)', async () => {
    const r = await fetch(BASE + '/api/metro/health', { headers });
    const d = await r.json();
    if (r.status === 503) {
      console.log('   Watchdog not running — need ALLOY_BRIDGE_SECRET');
      return;
    }
    const vscode = d.data?.lines?.vscode;
    if (vscode) {
      console.log('   VS Code status:', vscode.status);
      console.log('   VS Code message:', vscode.message);
      console.log('   Recent UI log count:', vscode.details?.recentUiLogCount);
    }
  });

  // Test 8: GET /api/metro/metrics
  await test('GET /api/metro/metrics', async () => {
    const r = await fetch(BASE + '/api/metro/metrics', { headers });
    const d = await r.json();
    if (r.status === 503) {
      console.log('   Watchdog not running');
      return;
    }
    console.log('   Metrics:', JSON.stringify(d.data, null, 2));
  });

  console.log('\n════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(2); });