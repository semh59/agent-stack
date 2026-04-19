import { loadAccounts, saveAccounts } from "../src/plugin/storage";

async function main() {
    const storage = await loadAccounts();
    if (!storage || storage.accounts.length === 0) {
        console.log("❌ Kayıtlı hesap bulunamadı.");
        return;
    }

    const indexToRemove = process.argv[2] ? parseInt(process.argv[2], 10) - 1 : -1;

    if (indexToRemove < 0 || indexToRemove >= storage.accounts.length) {
        console.log("📋 Mevcut hesaplar:");
        storage.accounts.forEach((acc, i) => {
            console.log(`   ${i + 1}. ${acc.email || "bilinmeyen"}`);
        });
        console.log("\nKullanım: npx tsx scripts/remove-account.ts [numara]");
        return;
    }

    const removed = storage.accounts[indexToRemove];
    if (!removed) return;

    const { deleteAccount } = await import("../src/plugin/storage");
    await deleteAccount(removed.refreshToken);

    console.log(`✅ Hesap kalıcı olarak silindi: ${removed.email || "bilinmeyen"}`);
}

main().catch(console.error);
