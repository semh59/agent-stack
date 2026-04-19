const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = '.agent/workflows';

const WORKFLOWS = [
  { file: '1_gereksinim_analizi.md', name: 'Gereksinim Analizi' },
  { file: '2_mimari_tasarim.md', name: 'Mimari Tasarım' },
  { file: '3_veritabani_tasarimi.md', name: 'Veritabanı Tasarımı' },
  { file: '4_api_sozlesmesi.md', name: 'API Sözleşmesi' },
  { file: '5_hata_ayiklama_oturumu.md', name: 'Hata Ayıklama Oturumu' },
  { file: '6_test_stratejisi.md', name: 'Test Stratejisi' },
  { file: '7_guvenlik_denetimi.md', name: 'Güvenlik Denetimi' },
  { file: '8_frontend_gelistirme.md', name: 'Frontend Geliştirme' },
  { file: '9_performans_analizi.md', name: 'Performans Analizi' },
  { file: '10_deployment.md', name: 'Deployment' },
  { file: '11_kod_inceleme.md', name: 'Kod İnceleme' },
  { file: '12_dokumantasyon.md', name: 'Dokümantasyon' },
  { file: '13_self_healing.md', name: 'Self Healing Auto-fix' },
  { file: '14_proje_tamamlama.md', name: 'Proje Tamamlama' }
];

if (!fs.existsSync(WORKFLOWS_DIR)) {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

WORKFLOWS.forEach(w => {
  const content = `# Workflow: ${w.name}\n\nAntigravity v4 Sovereign Autonomy Protocol kapsamında bu aşamanın adımları aşağıdadır.\n\n## Adımlar\n1. Mevcut bağlamı (context) oku.\n2. ${w.name} için gerekli analizi tamamla.\n3. Çıktıyı belirlenen formatta (md/json) kaydet.\n4. Bir sonraki aşama için handoff notu bırak.`;
  fs.writeFileSync(path.join(WORKFLOWS_DIR, w.file), content);
  console.log(`Generated: ${w.file}`);
});
