import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Probe is in core/gateway/
const projectRoot = __dirname; 

async function probe() {
  console.log("--- DYNAMIC PROBE START ---");
  
  // 1. Load env
  const envPath = path.join(projectRoot, '.env');
  console.log("Probing .env at:", envPath);
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const secretMatch = envContent.match(/ALLOY_CLIENT_SECRET=['"]?([^'"\n\r]+)['"]?/);
    if (secretMatch) {
      process.env.ALLOY_CLIENT_SECRET = secretMatch[1];
      console.log("Setting process.env.ALLOY_CLIENT_SECRET in probe script.");
    } else {
      console.log("ALLOY_CLIENT_SECRET NOT FOUND in .env via regex.");
    }
  } else {
    console.log(".env NOT FOUND at", envPath);
  }

  // 2. Dynamic import
  const { ALLOY_CLIENT_SECRET } = await import('./src/constants.js');
  
  console.log("process.env.ALLOY_CLIENT_SECRET:", process.env.ALLOY_CLIENT_SECRET ? "PRESENT (len=" + process.env.ALLOY_CLIENT_SECRET.length + ")" : "MISSING");
  console.log("Module ALLOY_CLIENT_SECRET:", ALLOY_CLIENT_SECRET ? "PRESENT (len=" + ALLOY_CLIENT_SECRET.length + ")" : "MISSING");
  console.log("--- DYNAMIC PROBE END ---");
}

probe();
