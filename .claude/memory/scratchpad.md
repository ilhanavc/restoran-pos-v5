# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## Açık sorular

<!-- Çözüm bekleyen teknik/ürün soruları -->

- [ ] Proje adı kesinleşsin mi? (şimdilik `restoran-pos-v5`)
- [ ] İlk pilot restoran (kendi restoranım) için hangi özellik set'i MVP'de olmalı? v3 referans alınacak ama kapsam küçültülecek
- [ ] Print Agent Windows Service mi olacak, yoksa sistem tray'inde çalışan basit bir uygulama mı?

## Yapılacaklar notları

<!-- Atlanmaması gereken küçük şeyler -->

- v3 repo'sunu okuma-sadece mount et, copy-paste riskini azalt
- v3'ten değerli parçaların listesi: hangisi mimari referans, hangisi davranış referansı, hangisi test senaryosu
- Hetzner hesap kurulumu Phase 1'e girmeden yapılmalı

## ADR-002 açık kararlar

<!-- ADR-002 (Auth stratejisi) yazılırken bu kararlar şartname olarak taşınacak -->

- **Şifre sıfırlama stratejisi (hibrit):**
  - v5.0 MVP: admin reset (Ayarlar → Kullanıcı Yönetimi'nden elle)
  - v5.0 backend: email token endpoint yazılır ama UI'da gösterilmez (ready-but-disabled)
  - v5.1: feature flag ile aktif edilir

## Phase 0 sonunda taşınacaklar

<!-- Bu liste Phase 0 kapanışında decisions.md'ye veya ilgili docs'a taşınır -->

- ADR-001: Monorepo yapısı ve paket isimlendirme
- ADR-002: Auth stratejisi (JWT access + refresh, cookie mi header mı)
- ADR-003: DB şema ilkeleri (`tenant_id` konvansiyonu, id tipi, timestamp tipi)
- ADR-004: Print Agent mimari (cloud pull mı push mı, queue, retry)
- ADR-005: Web UI state management (TanStack Query + Zustand mı, başka mı)
