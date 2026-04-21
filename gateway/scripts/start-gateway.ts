import { GatewayServer } from '../src/gateway/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

async function main() {
  // ALLOY_GATEWAY_TOKEN is the current env var name; ALLOY_GATEWAY_TOKEN
  // is retained as a deprecated fallback to avoid breaking existing deployments.
  let authToken = process.env.ALLOY_GATEWAY_TOKEN ?? process.env.ALLOY_GATEWAY_TOKEN;

  if (!authToken) {
    try {
      const fs = await import('node:fs');
      const envPath = path.join(projectRoot, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/(?:SOVEREIGN|SOVEREIGN)_GATEWAY_TOKEN=['"]?([^'"\n\r]+)['"]?/);
        if (match) authToken = match[1];
      }
    } catch { /* ignore */ }
  }

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
