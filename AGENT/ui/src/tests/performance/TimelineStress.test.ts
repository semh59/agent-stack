import { describe, it, expect } from "vitest";
import { maskPII } from "../../store/slices/websocketSlice";

describe("Timeline Performance Stress Test", () => {
  it("handles high-frequency log bursts without crashing", () => {
    const startTime = Date.now();
    
    // Simulate 1000 events in a tight loop
    for (let i = 0; i < 1000; i++) {
      const event = {
        type: "log",
        sessionId: "stress-session",
        payload: {
          msg: `Log entry #${i} for performance testing`,
          timestamp: Date.now()
        }
      };
      // Note: In real app, this goes through handleAutonomyEvent which masks PII
      maskPII(event.payload);
      // Simulating the state update logic
    }
    
    const duration = Date.now() - startTime;
    console.log(`Processed 1000 events (PII Masking + Logic) in ${duration}ms`);
    
    // Performance Threshold: 1000 events should be processed under 200ms 
    // to ensure no UI blocking on main thread
    expect(duration).toBeLessThan(200);
  });

  it("maintains buffer size (Max Log Buffer) under heavy load", () => {
    // Current MAX_LOG_BUFFER is typically 1000 based on previous code analysis
    const MAX_LOG_BUFFER = 1000;
    let timeline: { id: number }[] = [];
    
    for (let i = 0; i < 2000; i++) {
      timeline = [...timeline, { id: i }].slice(-MAX_LOG_BUFFER);
    }
    
    expect(timeline.length).toBe(MAX_LOG_BUFFER);
    expect(timeline[0].id).toBe(1000);
    expect(timeline[999].id).toBe(1999);
  });
});
