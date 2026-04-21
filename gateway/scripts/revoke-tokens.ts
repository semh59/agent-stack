/**
 * Revoke Tokens — Tüm yerel token depolarını temizler.
 * Gateway (TokenStore) + Plugin (AccountManager) depolarını tek seferde siler.
 * Kullanım: npx tsx scripts/revoke-tokens.ts
 */

import { TokenStore } from "../src/gateway/token-store";
import { clearAccounts, getStoragePath } from "../src/plugin/storage";
import { existsSync } from "node:fs";

async function main() {
  console.log("\n🔐 Alloy AI Token Temizleme (Tam)");
  console.log("─".repeat(45));

  let cleared = 0;

  // 1. Gateway Token Store (~/.config/agent/alloy-tokens.json)
  console.log("\n📁 Gateway Token Store:");
  try {
    const store = new TokenStore();
    const count = store.getAccountCount();
    if (count > 0) {
      store.clear();
      console.log(`   ✅ ${count} hesap temizlendi.`);
      cleared += count;
    } else {
      console.log("   ℹ️  Boş — temizlenecek bir şey yok.");
    }
  } catch (err) {
    console.error("   ❌ Hata:", err instanceof Error ? err.message : String(err));
  }

  // 2. Plugin Account Store (~/.config/opencode/alloy-accounts.json)
  console.log("\n📁 Plugin Account Store:");
  try {
    const pluginPath = getStoragePath();
    if (existsSync(pluginPath)) {
      await clearAccounts();
      console.log(`   ✅ Plugin hesapları temizlendi (${pluginPath}).`);
      cleared++;
    } else {
      console.log("   ℹ️  Boş — hesap dosyası bulunamadı.");
    }
  } catch (err) {
    console.error("   ❌ Hata:", err instanceof Error ? err.message : String(err));
  }

  // Sonuç
  console.log("\n" + "─".repeat(45));
  if (cleared > 0) {
    console.log("✅ Tüm yerel tokenlar başarıyla silindi.");
  } else {
    console.log("ℹ️  Temizlenecek kayıt bulunamadı.");
  }
  console.log("ℹ️  Tekrar giriş yapmak için: npm run agent:start\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
