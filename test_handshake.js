const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

function resolveBridgeSecret() {
  if (process.env.AI_STACK_BRIDGE_SECRET) {
    return process.env.AI_STACK_BRIDGE_SECRET;
  }
  try {
    const secretPath = path.join(os.homedir(), ".ai-stack-mcp", ".bridge_secret");
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, "utf-8").trim();
    }
  } catch (e) {
    console.error("Read error:", e.message);
  }
  return "";
}

const secret = resolveBridgeSecret();
console.log("[TS-Mock] Resolved Ephemeral Secret:", secret ? secret.slice(0,8) + "..." : "NONE");

if (!secret) {
    console.error("FAILED to resolve secret. Test aborted.");
    process.exit(1);
}

const req = http.request({
    hostname: "127.0.0.1",
    port: 9100,
    path: "/optimize",
    method: "OPTIONS",
    headers: {
        "X-Bridge-Secret": secret,
        "Origin": "http://127.0.0.1:3000"
    }
}, (res) => {
    console.log(`[TS-Mock] Preflight CORS check: HTTP ${res.statusCode}`);
    if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("SUCCESS! Bridge handshake validated.");
    } else {
        console.log("FAILED.");
        process.exit(1);
    }
});

req.on("error", (e) => {
    console.error("Connection failed:", e.message);
});

req.end();
