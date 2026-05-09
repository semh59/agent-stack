import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// --- PHASE 0: CRITICAL ENV LOADING ---
// This must happen BEFORE any other imports that might evaluate constants.
try {
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    const secretMatch = envContent.match(/ALLOY_BRIDGE_SECRET=['"]?([^'"\n\r]+)['"]?/);
    if (secretMatch) process.env.ALLOY_BRIDGE_SECRET = secretMatch[1];
    
    const clientSecretMatch = envContent.match(/ALLOY_CLIENT_SECRET=['"]?([^'"\n\r]+)['"]?/);
    if (clientSecretMatch) process.env.ALLOY_CLIENT_SECRET = clientSecretMatch[1];

    const tokenMatch = envContent.match(/(?:ALLOY|SOVEREIGN)_GATEWAY_TOKEN=['"]?([^'"\n\r]+)['"]?/);
    if (tokenMatch && !process.env.ALLOY_GATEWAY_TOKEN) {
        process.env.ALLOY_GATEWAY_TOKEN = tokenMatch[1];
    }
  }
} catch { /* ignore */ }

import { GatewayServer } from '../src/gateway/server';
import crypto from 'node:crypto';

function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

async function main() {
  // ALLOY_GATEWAY_TOKEN is the current env var name; SOVEREIGN_GATEWAY_TOKEN
  // is retained as a deprecated fallback to avoid breaking existing deployments.
  let authToken = process.env.ALLOY_GATEWAY_TOKEN ?? process.env.SOVEREIGN_GATEWAY_TOKEN;

  if (!authToken) {
    console.warn('⚠️  ALLOY_GATEWAY_TOKEN is missing. Generating a temporary one for this session...');
    authToken = `alloy_tmp_${crypto.randomBytes(16).toString('hex')}`;
    console.log(`💡 To persist this, add to .env: ALLOY_GATEWAY_TOKEN='${authToken}'`);
  }

  const server = new GatewayServer({
    port: 51122,
    projectRoot,
    host: '127.0.0.1',
    authToken,
  });

  console.log('--- Alloy AI Gateway ---');
  console.log(`Auth token: ${maskToken(authToken)}`);
  console.log('Rotation hint: run `npm run gateway:token:rotate` periodically.');
  console.log('🖥️  Alloy Dashboard: http://127.0.0.1:51122/');
  await server.start();
}

main().catch(err => {
  console.error('Failed to start gateway:', err);
  process.exit(1);
});
