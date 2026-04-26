import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

// We'll use a specific port for testing to avoid conflicts
const TEST_BRIDGE_PORT = 9199;
const BRIDGE_SECRET = "test-secret-12345";

describe("Integrated API Flow (Gateway <-> Bridge)", () => {
  let bridgeProcess: ChildProcess;
  const bridgePath = path.resolve("../../core/bridge/stub_bridge.py");
  const pythonExe = process.platform === "win32" 
    ? path.resolve("../../.venv/Scripts/python.exe") 
    : path.resolve("../../.venv/bin/python");

  beforeAll(async () => {
    console.log(`[Test] Starting Bridge on port ${TEST_BRIDGE_PORT}...`);
    
    // Ensure data directory exists
    const dataDir = path.resolve(".tmp_test_data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    bridgeProcess = spawn(pythonExe, [bridgePath, "--port", TEST_BRIDGE_PORT.toString()], {
      env: {
        ...process.env,
        ALLOY_BRIDGE_SECRET: BRIDGE_SECRET,
        ALLOY_DATA_DIR: dataDir,
        APP_ENV: "development",
      },
      stdio: "pipe",
    });

    bridgeProcess.stdout?.on("data", (data) => console.log(`[Bridge STDOUT] ${data}`));
    bridgeProcess.stderr?.on("data", (data) => console.error(`[Bridge STDERR] ${data}`));

    // Wait for bridge to be healthy
    let attempts = 0;
    while (attempts < 20) {
      try {
        const res = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/health`);
        if (res.ok) {
          console.log("[Test] Bridge is healthy!");
          return;
        }
      } catch (e) {
        // Wait and retry
      }
      attempts++;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Bridge failed to start in time");
  }, 30000);

  afterAll(async () => {
    if (bridgeProcess) {
      console.log("[Test] Stopping Bridge...");
      bridgeProcess.kill();
    }
    // Cleanup temp data
    const dataDir = path.resolve(".tmp_test_data");
    if (fs.existsSync(dataDir)) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch (e) {
        console.warn("[Test] Failed to cleanup data dir:", e);
      }
    }
  });

  it("should respond to health check without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ai-stack-optimization-bridge");
  });

  it("should reject unauthorized optimize requests", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/optimize`, {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("should optimize a prompt via PipelineOptimizer", async () => {
    const { PipelineOptimizer } = await import("../gateway/pipeline-optimizer");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const optimizer = new PipelineOptimizer({
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      bridgeHost: "127.0.0.1",
      bridgePort: TEST_BRIDGE_PORT,
      enableOptimization: true,
    });

    // Mock the secret env var that resolveBridgeSecret uses
    process.env.ALLOY_BRIDGE_SECRET = BRIDGE_SECRET;

    const agent = AGENTS.find(a => a.role === "ceo")!;
    const result = await optimizer.optimize(agent, "Hello, this is a test prompt that should be optimized.");

    expect(result.optimizedPrompt).toBeDefined();
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(optimizer.getStats().bridgeAvailable).toBe(true);
  });

  it("should index and search documents (RAG flow)", async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-Bridge-Secret": BRIDGE_SECRET,
    };

    // Index
    const indexRes = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/index`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: "Alloy is a premium agentic platform built in 2026.",
        path: "docs/intro.md",
      }),
    });
    expect(indexRes.status).toBe(200);

    // Search
    const searchRes = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: "What is Alloy?",
        limit: 1,
      }),
    });
    expect(searchRes.status).toBe(200);
    const results = (await searchRes.json() as any).results;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Alloy");
  });

  it("should report cache stats correctly", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_BRIDGE_PORT}/cache-stats`, {
      headers: { "X-Bridge-Secret": BRIDGE_SECRET },
    });
    expect(res.status).toBe(200);
    const stats = await res.json() as any;
    expect(stats).toHaveProperty("exact");
    expect(stats).toHaveProperty("semantic");
  });
});
