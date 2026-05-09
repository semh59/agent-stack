import { ALLOY_CLIENT_SECRET } from './src/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';

console.log("--- PROBE START ---");
console.log("Current Process ID:", process.pid);
console.log("process.env.ALLOY_CLIENT_SECRET:", process.env.ALLOY_CLIENT_SECRET ? "PRESENT (length " + process.env.ALLOY_CLIENT_SECRET.length + ")" : "MISSING");
console.log("Module ALLOY_CLIENT_SECRET:", ALLOY_CLIENT_SECRET ? "PRESENT (length " + ALLOY_CLIENT_SECRET.length + ")" : "MISSING");

const envPath = path.resolve('./.env');
console.log("Checking .env at:", envPath);
if (fs.existsSync(envPath)) {
    console.log(".env exists. Reading contents...");
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/ALLOY_CLIENT_SECRET=([^\r\n]+)/);
    console.log("Regex match in .env:", match ? "FOUND" : "NOT FOUND");
} else {
    console.log(".env NOT FOUND at this path.");
}
console.log("--- PROBE END ---");
