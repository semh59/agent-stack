import crypto from 'node:crypto';

type Mode = 'generate' | 'rotate';

function parseMode(input: string | undefined): Mode {
  if (input === 'rotate') return 'rotate';
  return 'generate';
}

function generateToken(): string {
  return `lojinext_${crypto.randomBytes(32).toString('base64url')}`;
}

function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function printUsage(): void {
  console.log('Usage: npx tsx scripts/gateway-token.ts [generate|rotate]');
}

function main(): void {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    printUsage();
    return;
  }

  const mode = parseMode(arg);
  const previous = process.env.LOJINEXT_GATEWAY_TOKEN ?? '';
  const next = generateToken();

  console.log(`Mode: ${mode}`);
  if (mode === 'rotate') {
    console.log(`Previous token: ${previous ? maskToken(previous) : 'not set'}`);
  }
  console.log(`New token: ${next}`);
  console.log(`Masked preview: ${maskToken(next)}`);
  console.log('');
  console.log('PowerShell:');
  console.log(`  $env:LOJINEXT_GATEWAY_TOKEN='${next}'`);
  console.log('Bash:');
  console.log(`  export LOJINEXT_GATEWAY_TOKEN='${next}'`);
}

main();
