#!/usr/bin/env node
/**
 * Monorepo dev runner — boots the Python bridge and the Node gateway in one
 * process group, pipes labelled logs to stdout, and handles Ctrl-C cleanly.
 *
 *   npm run dev
 *
 * Env:
 *   GATEWAY_PORT       (default 3000)
 *   BRIDGE_PORT        (default 9100)
 *   SKIP_BRIDGE=1      run only the gateway
 *   SKIP_GATEWAY=1     run only the bridge
 *   PYTHON_BIN         override (default "python3" on unix, "python" on win)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const GATEWAY_PORT = process.env.GATEWAY_PORT || "3000";
const BRIDGE_PORT = process.env.BRIDGE_PORT || "9100";
const PY = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

const children = [];
let terminating = false;

function prefix(name, color) {
  const codes = { green: 32, cyan: 36, yellow: 33, magenta: 35, red: 31 };
  const c = codes[color] ?? 0;
  return `\x1b[${c}m[${name}]\x1b[0m`;
}

function pipeWithPrefix(stream, tag, color) {
  stream.setEncoding("utf8");
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      process.stdout.write(`${prefix(tag, color)} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buf.length > 0) process.stdout.write(`${prefix(tag, color)} ${buf}\n`);
  });
}

function launch(tag, color, cmd, args, opts) {
  console.log(`${prefix(tag, color)} starting: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: false,
  });
  children.push({ tag, child });
  pipeWithPrefix(child.stdout, tag, color);
  pipeWithPrefix(child.stderr, tag, color);
  child.on("exit", (code, signal) => {
    if (terminating) return;
    console.log(`${prefix(tag, color)} exited (code=${code} signal=${signal})`);
    shutdown(code ?? 1);
  });
}

function shutdown(code) {
  if (terminating) return;
  terminating = true;
  for (const { tag, child } of children) {
    if (child.exitCode === null) {
      console.log(`${prefix(tag, "yellow")} stopping...`);
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---- Bridge ----
if (process.env.SKIP_BRIDGE !== "1") {
  const bridgeDir = path.join(root, "bridge");
  if (!existsSync(path.join(bridgeDir, "bridge.py"))) {
    console.error(`[dev] bridge.py not found at ${bridgeDir}`);
    process.exit(1);
  }
  launch("bridge", "cyan", PY, ["bridge.py", "--port", BRIDGE_PORT, "--host", "127.0.0.1"], {
    cwd: bridgeDir,
    env: { PYTHONPATH: bridgeDir },
  });
}

// ---- Gateway ----
if (process.env.SKIP_GATEWAY !== "1") {
  const agentDir = path.join(root, "gateway");
  if (!existsSync(path.join(agentDir, "package.json"))) {
    console.error(`[dev] gateway/package.json not found`);
    process.exit(1);
  }
  launch("gateway", "green", "npx", ["tsx", "src/main.ts"], {
    cwd: agentDir,
    env: {
      ALLOY_GATEWAY_PORT: GATEWAY_PORT,
      ALLOY_GATEWAY_HOST: "127.0.0.1",
      AI_STACK_BRIDGE_HOST: "127.0.0.1",
      AI_STACK_BRIDGE_PORT: BRIDGE_PORT,
      ALLOY_GATEWAY_TOKEN: process.env.ALLOY_GATEWAY_TOKEN || process.env.ALLOY_GATEWAY_TOKEN || "dev-local-token",
      ALLOY_GATEWAY_TOKEN: process.env.ALLOY_GATEWAY_TOKEN || process.env.ALLOY_GATEWAY_TOKEN || "dev-local-token",
      AI_STACK_BRIDGE_SECRET: process.env.AI_STACK_BRIDGE_SECRET || "dev-local-bridge-secret",
    },
  });
}
