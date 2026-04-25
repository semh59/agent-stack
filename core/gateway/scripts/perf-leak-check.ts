import { IntentEngine } from '../src/orchestration/intent-engine';

async function runPerfLeakCheck() {
  console.log("📈 AGENT V4 PERFORMANCE & LEAK CHECK (perf-leak-check.ts)");
  const engine = new IntentEngine();
  engine.enableTransformer();
  
  const iterations = 20;
  const prompt = "can you help me with this and double check everything for any potential issues?";
  
  console.log(`\nStarting ${iterations} iterations of Transformer deep-dive...`);
  console.log("Iteration | RSS (MB) | Heap Used (MB) | Time (ms)");
  console.log("----------|----------|----------------|----------");

  for (let i = 1; i <= iterations; i++) {
    const start = Date.now();
    await engine.analyze(prompt);
    const end = Date.now();
    
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(2);
    
    // Log every 5 iterations to avoid clutter
    if (i === 1 || i % 5 === 0) {
      console.log(`${i.toString().padEnd(9)} | ${rss.padEnd(8)} | ${heapUsed.padEnd(14)} | ${end - start}`);
    }
    
    // Optional: GC hint if run with --expose-gc
    if (global.gc) {
      // global.gc();
    }
  }

  console.log("\n🏁 LEAK CHECK COMPLETE!");
  console.log("Check if RSS or Heap Used grows linearly over time without stabilizing.");
}

runPerfLeakCheck().catch(err => {
  console.error("❌ LEAK CHECK FAILED:", err);
  process.exit(1);
});
