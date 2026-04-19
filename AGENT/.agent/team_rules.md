# Sovereign Team Rules (Hiyerarşik Ekip Kuralları)

## 1. Hiyerarşi ve Emir-Komuta Zinciri

- Hiçbir ekip personeli, CTO'dan onay almamış bir plana göre kod yazamaz.
- İş akışı her zaman sıralı (Sequential) olmalıdır: `CTO -> Lead Architect -> Developer -> QA -> CTO`.
- Her adımın başında ve sonunda veritabanına (`team_db.sqlite`) kayıt atılmalıdır.

## 2. Kalite ve Denetim (Quality & Review)

- Her ekip personeli bir önceki personelin raporunu okumalı ve "Context Received" onayı vermelidir.
- QA onayı olmadan hiçbir kod "Merger Ready" kabul edilemez.
- Backend Expert ve Frontend Expert, Lead Architect'in belirlediği mimari spesifikasyonlara %100 uymalıdır.

## 3. İletişim ve Raporlama (Handoff)

- Raporlar; teknik detayları, yapılan değişiklikleri, karşılaşılan zorlukları ve (varsa) bir sonraki ekip arkadaşı için notları içermelidir.
- Raporlama dili her zaman teknik İngilizce terimleri içeren profesyonel bir dildir.

## 4. Otonomi ve Hata Yönetimi (Self-Healing)

- Eğer bir personel teknik bir engelle karşılaşırsa, önce kendi uzmanlık alanındaki tool'larla çözmeye çalışır.
- Çözemediği durumda CTO'ya "Blocker Report" gönderir. CTO süreci yeniden planlar veya başka bir uzmanı atar.

## 5. Güvenlik ve İzinler

- Sandbox dışında kod çalıştırılması kesinlikle yasaktır.
- Hassas veriler (API Keys, OAuth Tokens) sadece yetkili ajanlar (CTO ve Backend) tarafından işlenmelidir.
