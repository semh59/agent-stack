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
  let authToken = process.env.LOJINEXT_GATEWAY_TOKEN;

  if (!authToken) {
    try {
      const fs = await import('node:fs');
      const envPath = path.join(projectRoot, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/LOJINEXT_GATEWAY_TOKEN=['"]?([^'"\n\r]+)['"]?/);
        if (match) authToken = match[1];
      }
    } catch { /* ignore */ }
  }

  if (!authToken) {
    console.warn('⚠️  LOJINEXT_GATEWAY_TOKEN is missing. Generating a temporary one for this session...');
    authToken = `lojinext_tmp_${crypto.randomBytes(16).toString('hex')}`;
    console.log(`💡 To persist this, add to .env: LOJINEXT_GATEWAY_TOKEN='${authToken}'`);
  }

  const server = new GatewayServer({
    port: 51122,
    projectRoot,
    host: '127.0.0.1',
    authToken,
  });

  console.log('--- LojiNext Gateway API ---');
  console.log(`Auth token: ${maskToken(authToken)}`);
  console.log('Rotation hint: run `npm run gateway:token:rotate` periodically.');
  console.log('🖥️  LojiNext Dashboard: http://127.0.0.1:51122/');
  await server.start();
}

main().catch(err => {
  console.error('Failed to start gateway:', err);
  process.exit(1);
});
