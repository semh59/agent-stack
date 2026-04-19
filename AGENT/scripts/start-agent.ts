#!/usr/bin/env node
/**
 * Agent Start — CLI Entry Point
 *
 * Google Antigravity OAuth ile giriş yapıp agent sistemini başlatan CLI scripti.
 *
 * Kullanım:
 *   npx tsx scripts/start-agent.ts                          # Normal başlatma
 *   npx tsx scripts/start-agent.ts --auth-only              # Sadece auth (agent başlatma)
 *   npx tsx scripts/start-agent.ts --model gemini-3-pro     # Model belirle
 *   npx tsx scripts/start-agent.ts --autonomy full          # Tam otonom mod
 */

import { startGateway, type HandoffResult } from "../src/gateway/gateway";
import { SequentialPipeline, PlanMode } from "../src/orchestration/sequential-pipeline";
import path from "node:path";
import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  checkOAuthCallbackPortAvailability,
} from "../src/gateway/oauth-port";

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  authOnly: boolean;
  model: string;
  autonomy: "full" | "supervised";
  port: number;
  projectId?: string;
  task: string;
  planMode: PlanMode;
  skipAgents: string[];
  startFrom: number;
  generateSkills: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    authOnly: false,
    model: "google/antigravity-claude-sonnet-4-5",
    autonomy: "supervised",
    port: DEFAULT_OAUTH_CALLBACK_PORT,
    task: "Analyze the current project and suggest improvements.",
    planMode: "full",
    skipAgents: [],
    startFrom: 1,
    generateSkills: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--auth-only":
        result.authOnly = true;
        break;
      case "--model":
        result.model = args[++i] || result.model;
        break;
      case "--autonomy":
        result.autonomy = (args[++i] as "full" | "supervised") || result.autonomy;
        break;
      case "--port":
        result.port = parseInt(args[++i] || String(DEFAULT_OAUTH_CALLBACK_PORT), 10);
        break;
      case "--project":
        result.projectId = args[++i];
        break;
      case "--task":
        result.task = args[++i] || result.task;
        break;
      case "--plan-mode":
        result.planMode = (args[++i] as PlanMode) || result.planMode;
        break;
      case "--skip":
        result.skipAgents = (args[++i] || "").split(",").filter(Boolean);
        break;
      case "--start-from":
        result.startFrom = parseInt(args[++i] || "1", 10);
        break;
      case "--no-skills":
        result.generateSkills = false;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
🚀 Agent Auth Gateway — CLI

Kullanım:
  npx tsx scripts/start-agent.ts [seçenekler]

Seçenekler:
  --auth-only           Sadece OAuth giriş yap (agent başlatma)
  --model <model>       Varsayılan AI model (varsayılan: google/gemini-1.5-flash)
                        Seçenekler: google/gemini-1.5-pro, google/gemini-1.5-flash,
                        google/claude-3-opus-latest, google/claude-3-5-sonnet-latest
  --autonomy <seviye>   Otonom seviye: full | supervised (varsayılan: supervised)
  --port <port>         OAuth callback port (varsayılan: ${DEFAULT_OAUTH_CALLBACK_PORT})
  --project <id>        Google Cloud project ID (opsiyonel)
  --task <mesaj>        Agent fleet için ana görev (varsayılan: Analyze...)
  --plan-mode <mod>     Pipeline modu: full | management_only | dev_only | quality_only
  --skip <roller>       Atlanacak agent rolleri (virgülle ayrılmış)
  --start-from <n>      Hangi sıradaki agent'tan başlanacağı (1-18)
  --no-skills           Pipeline sonrası otomatik skill üretimini kapat
  --help, -h            Bu yardım mesajını göster

Örnekler:
  npx tsx scripts/start-agent.ts
  npx tsx scripts/start-agent.ts --auth-only
  npx tsx scripts/start-agent.ts --model claude-opus-4-6-thinking --autonomy full
  npm run agent:start
  npm run agent:auth
  `);
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

/**
 * Agent otonom çalışma döngüsü.
 * Bu fonksiyon agent sisteminin devralma noktasıdır.
 * Burada SequentialPipeline, TerminalExecutor veya özel agent mantığı çalıştırılabilir.
 */
async function agentLoop(result: HandoffResult): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  🤖 Agent Sistemi Aktif — Tam Otonom Mod           ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  Hesap:  ${(result.token.email || "bilinmiyor").padEnd(41)}║`);
  console.log(`║  Proje:  ${(result.token.projectId || "otomatik").padEnd(41)}║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Çıkmak için: Ctrl+C                               ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  // AntigravityClient hazır — buradan agent sistemi devralabilir
  const { client } = result;

  // Örnek: Basit bir API testi yaparak bağlantıyı doğrula
  console.log("[Agent] Bağlantı kontrolü yapılıyor...");

  try {
    // Gemini API'ye basit bir ping (modeller listesi)
    const testUrl = "https://generativelanguage.googleapis.com/v1beta/models";
    const response = await client.fetch(testUrl);

    if (response.ok) {
      console.log("[Agent] ✅ Antigravity API bağlantısı başarılı!");
    } else {
      console.log(`[Agent] ⚠️  API yanıtı: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    // İlk bağlantı testi başarısız olabilir — bu critical değil
    console.log(`[Agent] ℹ️  API testi: ${error instanceof Error ? error.message : "bağlantı bekleniyor"}`);
  }

  console.log("\n[Agent] 🔁 Otonom döngü aktif — komut bekleniyor...");
  console.log("[Agent]    Bu noktadan sonra agent sistemi tam otonom çalışır.");
  console.log("[Agent]    SequentialPipeline veya özel agent mantığı buraya bağlanmalı.\n");

  // Sonsuz bekleme — agent döngüsü dışarıdan yönetilecek
  // Gerçek implementasyonda buraya SequentialPipeline veya REPL bağlanır
  const pipeline = new SequentialPipeline(process.cwd(), client);

  // Get CLI args passed through global (simulated for now or accessed if possible)
  // Since main() calls startGateway which calls agentLoop, we need to pass args.
  // I'll modify startGateway to pass config/args or just re-parse here.
  const args = parseArgs();

  // Resolve skills directory — check common locations
  const possibleSkillsDirs = [
    path.join(process.cwd(), '.agent', 'skills'),
    path.join(process.cwd(), 'incele', '.agent', 'skills'),
  ];

  let resolvedSkillsDir: string | undefined;
  for (const dir of possibleSkillsDirs) {
    try {
      const { statSync } = await import('node:fs');
      if (statSync(dir).isDirectory()) {
        resolvedSkillsDir = dir;
        break;
      }
    } catch { /* not found, try next */ }
  }

  if (resolvedSkillsDir) {
    console.log(`[Agent] Skills dizini bulundu: ${resolvedSkillsDir}`);
  } else {
    console.log('[Agent] ⚠️  Skills dizini bulunamadı — agentlar ham prompt ile çalışacak.');
  }

  console.log(`[Agent] Pipeline başlatılıyor... Mod: ${args.planMode}, Görev: "${args.task}"`);

  try {
    const pipelineResult = await pipeline.start(args.task, {
      modelOverride: args.model,
      planMode: args.planMode,
      skipAgents: args.skipAgents,
      startFromOrder: args.startFrom,
      generateSkills: args.generateSkills,
      skillsDir: resolvedSkillsDir,
      onAgentStart: (agent) => {
        console.log(`\n[Agent] 🚀 ${agent.role.toUpperCase()} çalışmaya başladı...`);
      },
      onAgentComplete: (agent, output) => {
        console.log(`[Agent] ✅ ${agent.role.toUpperCase()} tamamlandı. Çıktı(lar): ${agent.outputFiles.join(', ')}`);
      },
      onError: (agent, error) => {
        console.error(`[Agent] ❌ ${agent.role.toUpperCase()} hatası: ${error.message}`);
      }
    });

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  📊 Pipeline Tamamlandı                             ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  Durum:     ${pipelineResult.status.padEnd(41)}║`);
    console.log(`║  Tamamlanan: ${String(pipelineResult.completedCount).padEnd(41)}║`);
    console.log(`║  Atlanan:    ${String(pipelineResult.skippedCount).padEnd(41)}║`);
    console.log(`║  Hatalı:     ${String(pipelineResult.failedCount).padEnd(41)}║`);
    console.log(`║  Süre:      ${(Math.round(pipelineResult.totalDurationMs / 1000) + "s").padEnd(41)}║`);
    console.log("╚══════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error(`[Agent] Fatal Pipeline Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  await new Promise<void>((resolve) => {
    // Graceful shutdown
    const shutdown = () => {
      console.log("\n[Agent] 🛑 Agent sistemi kapatılıyor...");
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const portCheck = await checkOAuthCallbackPortAvailability(args.port);
  if (!portCheck.available) {
    const detail = portCheck.message ? ` (${portCheck.message})` : "";
    throw new Error(
      `OAUTH_CALLBACK_PORT_IN_USE: Port ${args.port} is busy${detail}. Stop the existing process and retry.`,
    );
  }

  try {
    const result = await startGateway({
      authOnly: args.authOnly,
      defaultModel: args.model,
      autonomyLevel: args.autonomy,
      port: args.port,
      projectId: args.projectId,
      onAgentLoop: args.authOnly ? undefined : agentLoop,
    });

    if (result) {
      console.log("\n✅ Gateway tamamlandı.");
    }
  } catch (error) {
    console.error(
      "\n❌ Gateway hatası:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
