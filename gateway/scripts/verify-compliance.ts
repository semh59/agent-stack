import { createLogger, printAlloyConsole } from "../src/plugin/logger";

// Mock environment for console logging
process.env.OPENCODE_ALLOY_CONSOLE_LOG = "1";

console.log("--- PII MASKING TEST START ---");

const log = createLogger("compliance-test");

const testCases = [
  "User email: john.doe@example.com is sensitive.",
  "Contact: semih@alloy.com",
  "TCKN: 12345678901 (potential sızıntı)",
  "Another phone: 5551234567",
  "Safe message without PII."
];

testCases.forEach(msg => {
  console.log(`\nOriginal: ${msg}`);
  log.info(msg);
});

console.log("\n--- Testing Extra Data Masking ---");
log.error("Failed for user", { email: "admin@alloy.com", id: "12345678901" });

console.log("\n--- Testing Global Console Print ---");
printAlloyConsole("warn", "System alert for user@domain.org");

console.log("\n--- PII MASKING TEST END ---");
