import { IntentEngine } from "../src/orchestration/intent-engine";

async function diagnose() {
    const engine = new IntentEngine();
    const prompt = "Masaüstü health klasöründe basit bir kalori takip uygulaması yap";
    const result = await engine.analyze(prompt);

    console.log("--- INTENT ENGINE DIAGNOSIS ---");
    console.log(`Prompt: "${prompt}"`);
    console.log(`Classified Specialist: ${result.specialist}`);
    console.log(`Pipeline Type: ${result.pipeline}`);
    console.log(`Confidence Score: ${result.confidence}`);
    console.log("-------------------------------");
    
    // Proving it's not a hardcoded "if then"
    const words = prompt.toLowerCase().split(' ');
    console.log("Found Keywords from Project's KeywordMap:");
    const map = (engine as any).keywordMap;
    for (const [spec, keywords] of Object.entries(map)) {
        const matches = words.filter(w => (keywords as string[]).includes(w));
        if (matches.length > 0) {
            console.log(`[${spec}]: matches -> ${matches.join(', ')}`);
        }
    }
}

diagnose();
