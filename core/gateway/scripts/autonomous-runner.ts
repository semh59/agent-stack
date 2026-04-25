import { IntentEngine, PipelineType } from "../src/orchestration/intent-engine";
import { SequentialPipeline, PlanMode } from "../src/orchestration/sequential-pipeline";
import { AccountManager } from "../src/plugin/accounts";
import { AlloyGatewayClient } from "../src/orchestration/gateway-client";
import { loadConfig } from "../src/plugin/config/loader";
import { AGENTS } from "../src/orchestration/agents";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const prompt = process.argv[2] || "Masaüstünde 'timer' adında bir klasör oluştur (C:\\Users\\semih\\Desktop\\timer) ve içine modern bir geri sayım sayacı web uygulaması hazırla. HİÇBİR ONAY BEKLEMEDEN OTONOM TAMAMLA.";
    console.log(`[AutonomousRunner] Initializing Alloy AI v4 with prompt: "${prompt}"`);

    const projectRoot = path.resolve(__dirname, "..");
    
    // 1. Load context
    const config = loadConfig(projectRoot);
    const accountManager = await AccountManager.loadFromDisk();
    
    // Use real auth from the first available account
    const accounts = accountManager.getAccounts();
    const primaryAccount = accounts[0];

    const getAuth = async () => {
        if (!primaryAccount) {
            throw new Error("No accounts found. Run `agent:add` or `Alloy auth login`.");
        }
        return accountManager.toAuthDetails(primaryAccount);
    };
    
    const client = new AlloyGatewayClient(
        accountManager,
        config,
        "alloy",
        getAuth
    );

    const engine = new IntentEngine();
    const pipeline = new SequentialPipeline(projectRoot, client);

    // 2. Analyze intent
    console.log("[AutonomousRunner] Analyzing intent...");
    const intent = await engine.analyze(prompt);
    console.log(`[AutonomousRunner] Intent detected: ${intent.pipeline} | Specialist: ${intent.specialist} (Confidence: ${intent.confidence})`);

    // 3. Skip all agents except frontend (Order 8)
    const skipAgents = AGENTS
        .filter(a => a.order !== 8)
        .map(a => a.role);

    // 4. Run Pipeline
    console.log(`[AutonomousRunner] Starting targeted pipeline for Order 8 only...`);
    
    try {
        const result = await pipeline.start(prompt, {
            planMode: PlanMode.DEV_ONLY,
            skipAgents,
            force: true,
            startFromOrder: 8,
            modelOverride: "google/alloy-claude-opus-4-6-thinking",
            autoVerify: false, // Minimize calls
            generateSkills: false
        });

        console.log(`\n[AutonomousRunner] Pipeline finished with status: ${result.status}`);
        
        // The project's pipeline has success/fail state.
        // The files should be in the Desktop directory as prompted.
    } catch (err) {
        console.error("[AutonomousRunner] Pipeline failed:", err);
    }
}

main().catch(err => {
    console.error("[AutonomousRunner] Fatal error:", err);
    process.exit(1);
});
