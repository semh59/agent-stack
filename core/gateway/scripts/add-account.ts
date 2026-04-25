#!/usr/bin/env node
/**
 * Add Account — OAuth ile yeni Google hesabı ekler.
 *
 * Tarayıcıda Google giriş yapılır, token alınır ve
 * Plugin deposuna (~/.config/Alloy/alloy-accounts.json) kaydedilir.
 *
 * Kullanım:
 *   npx tsx scripts/add-account.ts
 *   npm run agent:add
 */

import { AuthServer } from "../src/gateway/auth-server";
import { launchOAuthBrowser } from "../src/gateway/browser-launcher";
import { GoogleGeminiProvider } from "../src/gateway/google-provider";
import { loadAccounts, saveAccounts, type AccountStorageV3, type AccountMetadataV3 } from "../src/plugin/storage";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   ➕  Hesap Ekle — Google OAuth                      ║
║   ─────────────────────────────────────────────      ║
║   Tarayıcıda Google hesabı seçin, otomatik eklenir.  ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);

  // 1. Mevcut hesapları göster
  const existing = await loadAccounts();
  const existingCount = existing?.accounts?.length ?? 0;
  if (existingCount > 0) {
    console.log(`📋 Mevcut hesaplar (${existingCount}):`);
    for (const acc of existing!.accounts) {
      const status = acc.enabled !== false ? "✅" : "❌";
      console.log(`   ${status} ${acc.email || "bilinmeyen"} (eklendi: ${new Date(acc.addedAt || 0).toLocaleDateString("tr-TR")})`);
    }
    console.log("");
  } else {
    console.log("📋 Henüz kayıtlı hesap yok.\n");
  }

  // 2. OAuth başlat
  console.log("🔐 OAuth akışı başlatılıyor...\n");

  const authInfo = await launchOAuthBrowser();

  const authServer = new AuthServer({
     port: 51121,
     timeoutMs: 300_000, // 5 dakika
     expectedState: authInfo.authorization.state,
     adapter: new GoogleGeminiProvider(),
   });

  const authResult = await authServer.start();

  if (!authResult.success || !authResult.token) {
    console.error(`\n❌ Giriş başarısız: ${authResult.error}`);
    console.log("   Tekrar denemek için: npm run agent:add\n");
    process.exit(1);
  }

  const { token } = authResult;
  console.log(`\n✅ Google hesabı doğrulandı: ${token.email || "bilinmeyen"}`);

  // 3. Yineleme kontrolü
  if (existing?.accounts) {
    const duplicate = existing.accounts.find(
      (acc) => acc.email && acc.email === token.email
    );
    if (duplicate) {
      console.log(`⚠️  Bu hesap (${token.email}) zaten kayıtlı. Refresh token güncelleniyor...`);
      duplicate.refreshToken = token.refreshToken;
      duplicate.lastUsed = Date.now();
      duplicate.enabled = true;
      await saveAccounts(existing);
      console.log("✅ Hesap güncellendi.\n");
      printSummary(existing);
      return;
    }
  }

  // 4. Yeni hesabı Plugin deposuna ekle
  const newAccount: AccountMetadataV3 = {
    email: token.email,
    refreshToken: token.refreshToken,
    projectId: token.projectId || undefined,
    addedAt: Date.now(),
    lastUsed: 0,
    enabled: true,
    rateLimitResetTimes: {},
  };

  const storage: AccountStorageV3 = existing ?? {
    version: 3,
    accounts: [],
    activeIndex: 0,
  };

  storage.accounts.push(newAccount);
  await saveAccounts(storage);

  console.log("✅ Hesap başarıyla eklendi!\n");
  printSummary(storage);
}

function printSummary(storage: AccountStorageV3) {
  console.log("═".repeat(50));
  console.log(`📊 Toplam Hesap Sayısı: ${storage.accounts.length}`);
  console.log("─".repeat(50));
  for (let i = 0; i < storage.accounts.length; i++) {
    const acc = storage.accounts[i]!;
    const status = acc.enabled !== false ? "✅" : "❌";
    const active = i === (storage.activeIndex ?? 0) ? " ← aktif" : "";
    console.log(`   ${i + 1}. ${status} ${acc.email || "bilinmeyen"}${active}`);
  }
  console.log("═".repeat(50));
  console.log("\nℹ️  Pipeline başlatmak için: npm run agent:start");
  console.log("ℹ️  Başka hesap eklemek için: npm run agent:add\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
