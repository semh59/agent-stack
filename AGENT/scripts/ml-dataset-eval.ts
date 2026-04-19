import { IntentEngine } from '../src/orchestration/intent-engine';

async function runMlEvaluation() {
  console.log("🤖 AGENT V4 ML INTENT EVALUATION (ml-dataset-eval.ts)");
  const engine = new IntentEngine();
  engine.enableTransformer(); // Enabled: Transformer boost

  const dataset: { prompt: string; expected: string }[] = [
    // --- Backend (20) ---
    { prompt: "Add a new field to the user database", expected: "backend" },
    { prompt: "Optimize the PostgreSQL SELECT query for the reports page", expected: "backend" },
    { prompt: "Fix the NullPointerException in the AuthService.java", expected: "backend" },
    { prompt: "Create a REST API endpoint for file uploads", expected: "backend" },
    { prompt: "Setup Redis caching for the sessions", expected: "backend" },
    { prompt: "Write a SQL migration for the products table", expected: "backend" },
    { prompt: "Implement OAuth2 flow in the backend", expected: "backend" },
    { prompt: "Debug why the API returns 500 error", expected: "backend" },
    { prompt: "Add pagination to the orders list endpoint", expected: "backend" },
    { prompt: "Handle the payload validation in the controller", expected: "backend" },
    { prompt: "db optimization for slow writes", expected: "backend" },
    { prompt: "refactor the service layer", expected: "backend" },
    { prompt: "fix memory leak in nodejs process", expected: "backend" },
    { prompt: "add a new microservice for notifications", expected: "backend" },
    { prompt: "configure the connection pool", expected: "backend" },
    { prompt: "implement a rate limiter on the api", expected: "backend" },
    { prompt: "sync the state with the external db", expected: "backend" },
    { prompt: "backend logic for login not working", expected: "backend" },
    { prompt: "create a cron job to cleanup logs", expected: "backend" },
    { prompt: "database schema update for address field", expected: "backend" },

    // --- Frontend (20) ---
    { prompt: "Change the primary color of the login button", expected: "frontend" },
    { prompt: "Fix the responsive layout on mobile devices", expected: "frontend" },
    { prompt: "Implement a new React component for the dashboard", expected: "frontend" },
    { prompt: "Add a loading spinner to the data grid", expected: "frontend" },
    { prompt: "Connect the frontend form to the API", expected: "frontend" },
    { prompt: "Fix the z-index issue on the modal", expected: "frontend" },
    { prompt: "Optimize the bundle size of the main application", expected: "frontend" },
    { prompt: "Use Redux for global state management", expected: "frontend" },
    { prompt: "Implement a dark mode toggle", expected: "frontend" },
    { prompt: "Add accessibility labels to the icons", expected: "frontend" },
    { prompt: "sayfa yapısı bozuk", expected: "frontend" },
    { prompt: "css styles are not applying", expected: "frontend" },
    { prompt: "react hook dependency issue", expected: "frontend" },
    { prompt: "make the header sticky", expected: "frontend" },
    { prompt: "frontend validation for email field", expected: "frontend" },
    { prompt: "ui layout is broken on safari", expected: "frontend" },
    { prompt: "center the div horizontally and vertically", expected: "frontend" },
    { prompt: "add animation to the cards", expected: "frontend" },
    { prompt: "use tailwind for the new page", expected: "frontend" },
    { prompt: "fix the dropdown menu positioning", expected: "frontend" },

    // --- QA (20) ---
    { prompt: "Write unit tests for the encryption module", expected: "qa" },
    { prompt: "Run the full regression test suite", expected: "qa" },
    { prompt: "Identify why the coverage dropped by 10%", expected: "qa" },
    { prompt: "Setup Playwright for end-to-end testing", expected: "qa" },
    { prompt: "Fix a flaky test in the CI pipeline", expected: "qa" },
    { prompt: "Check if the bug is reproducible in staging", expected: "qa" },
    { prompt: "Perform a smoke test for the latest release", expected: "qa" },
    { prompt: "Analyze the code quality for the core engine", expected: "qa" },
    { prompt: "mock the api response for testing", expected: "qa" },
    { prompt: "vitest run failed on windows", expected: "qa" },
    { prompt: "test case for boundary conditions", expected: "qa" },
    { prompt: "qa report for phase 4", expected: "qa" },
    { prompt: "automate the UI verification", expected: "qa" },
    { prompt: "fix the bug in the test setup", expected: "qa" },
    { prompt: "check for edge cases in the user flow", expected: "qa" },
    { prompt: "verify the migration success in the test env", expected: "qa" },
    { prompt: "lint errors are blocking the build", expected: "qa" },
    { prompt: "run static analysis on the code", expected: "qa" },
    { prompt: "fuzz test the input parser", expected: "qa" },
    { prompt: "test the error handling with mock data", expected: "qa" },

    // --- DevOps (20) ---
    { prompt: "Deploy the latest version to production", expected: "devops" },
    { prompt: "Configure a new Docker container for the app", expected: "devops" },
    { prompt: "Setup a CI/CD pipeline on GitHub Actions", expected: "devops" },
    { prompt: "Scale the server to handle 10k users", expected: "devops" },
    { prompt: "Check the logs on the AWS CloudWatch", expected: "devops" },
    { prompt: "Increase the disk space of the DB server", expected: "devops" },
    { prompt: "Fix the 504 Gateway Timeout error on Nginx", expected: "devops" },
    { prompt: "Update the kubernetes manifest files", expected: "devops" },
    { prompt: "release tag v1.4.6", expected: "devops" },
    { prompt: "provision a new instance on digitalocean", expected: "devops" },
    { prompt: "setup terraform for infra as code", expected: "devops" },
    { prompt: "backup the production database", expected: "devops" },
    { prompt: "optimize the docker image size", expected: "devops" },
    { prompt: "configure ssl certificates for the domain", expected: "devops" },
    { prompt: "devops task: rotate the server secrets", expected: "devops" },
    { prompt: "check the uptime of the api", expected: "devops" },
    { prompt: "monitor the cpu usage of the worker nodes", expected: "devops" },
    { prompt: "setup a staging environment", expected: "devops" },
    { prompt: "configure high availability for the service", expected: "devops" },
    { prompt: "rotate the load balancer ip", expected: "devops" },

    // --- Security (10) ---
    { prompt: "Perform a security audit on the auth module", expected: "security" },
    { prompt: "Check for SQL injection vulnerabilities in the search", expected: "security" },
    { prompt: "Is the encryption used (AES-GCM) secure enough?", expected: "security" },
    { prompt: "Audit the server for open ports", expected: "security" },
    { prompt: "Fix a Cross-Site Scripting (XSS) vulnerability", expected: "security" },
    { prompt: "security exploit found in the legacy parser", expected: "security" },
    { prompt: "pentest the login endpoint", expected: "security" },
    { prompt: "is there a way to bypass the sandbox?", expected: "security" },
    { prompt: "verify the integrity of the encrypted payload", expected: "security" },
    { prompt: "check for weak passwords in the db", expected: "security" },

    // --- Lead Architect (10) ---
    { prompt: "Explain the overall system architecture", expected: "lead_architect" },
    { prompt: "Design a new plugin system for the agent", expected: "lead_architect" },
    { prompt: "How should we structure the orchestration layer?", expected: "lead_architect" },
    { prompt: "Propose a tech stack for the new dashboard", expected: "lead_architect" },
    { prompt: "Review the system design for scalability", expected: "lead_architect" },
    { prompt: "lead architect: design a high level flow", expected: "lead_architect" },
    { prompt: "draw a diagram for the data lifecycle", expected: "lead_architect" },
    { prompt: "define the coding standards for the project", expected: "lead_architect" },
    { prompt: "modularize the core engine", expected: "lead_architect" },
    { prompt: "refactor the whole project structure", expected: "lead_architect" },
  ];

  let correct = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const labels = ['backend', 'frontend', 'qa', 'devops', 'security', 'lead_architect'];
  
  labels.forEach(l => {
    confusion[l] = {};
    labels.forEach(m => {
      confusion[l]![m] = 0;
    });
  });

  const startTime = Date.now();
  for (const item of dataset) {
    const result = await engine.analyze(item.prompt);
    if (result.specialist === item.expected) {
      correct++;
    }
    const exp = item.expected;
    const got = result.specialist;
    if (confusion[exp]) {
      confusion[exp]![got] = (confusion[exp]![got] || 0) + 1;
    }
  }
  const endTime = Date.now();

  const total = dataset.length;
  const accuracy = (correct / total) * 100;
  
  console.log(`\n📊  RESULT: ${correct}/${total} Corectly Classified`);
  console.log(`🎯  ACCURACY: ${accuracy.toFixed(2)}%`);
  console.log(`⏱️  TOTAL TIME: ${endTime - startTime}ms (Avg: ${((endTime - startTime) / total).toFixed(2)}ms/prompt)`);

  console.log("\n🌀 CONFUSION MATRIX:");
  console.log("Exp \\ Got | " + labels.map(l => l.substring(0, 4).padEnd(5)).join(" | "));
  labels.forEach(exp => {
    let row = exp.substring(0, 4).padEnd(8) + " | ";
    labels.forEach(got => {
      const val = confusion[exp] ? (confusion[exp]![got] || 0) : 0;
      row += val.toString().padEnd(5) + " | ";
    });
    console.log(row);
  });

  if (accuracy < 90) {
    console.warn("\n⚠️  Accuracy is below 90% threshold. Consider improving training data.");
  } else {
    console.log("\n✅ Accuracy meets high-performance target.");
  }
}

runMlEvaluation().catch(err => {
  console.error("❌ EVALUATION FAILED:", err);
  process.exit(1);
});
