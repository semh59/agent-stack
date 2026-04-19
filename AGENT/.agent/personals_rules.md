# Sovereign Autonomy Rules (V1.0)

Bu kurallar Super Agent ve alt ajanlar için mutlak yasaları tanımlar.

## 1. Task Lifecycle

- Her görev bir `task.md` ile başlar.
- Görevler atomik (bölünemez) parçalara ayrılır.
- Her adım tamamlandığında `[x]` ile işaretlenir.

## 2. Delegation & Review

- Hiçbir ajan kendi başına final kararı veremez.
- Backend değişikliği yapıldığında Architect gözden geçirir (Agent Review tool).
- Kritik kod blokları QA ajanı tarafından test edilmeden merge edilemez.

## 3. Self-Healing Protocol

- Terminal hatası (error 1) alındığında ajan durmaz.
- Hatayı "Recovery Matrix" ile eşleştirir ve otomatik düzeltme (fix) önerir.
- Üst üste 3 denemede başarısız olursa kullanıcıya eskalasyon yapar.

## 4. Resource Usage

- Token kullanımı ve API kotaları sürekli izlenir.
- Gereksiz büyük dosya okumalarından (head/tail kullanımı tercih edilir) kaçınılır.
