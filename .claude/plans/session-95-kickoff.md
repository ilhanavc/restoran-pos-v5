# Session 95 Kickoff — FAZ 3 app-HIGH TAM + FAZ 4 coverage (kapanış)

> **Giriş kapısı:** `docs/context-anchor.md` §2 → `docs/audit/00-summary.md` (denetim sentezi) → bu dosya.
> **Audit+fix durumu:** `.claude/memory/project_deep_audit_series.md` (+ MEMORY.md pointer) · **İptal fişi:** `.claude/memory/project_iptal_fisi_plan.md`
> **Son güncelleme:** 2026-07-14 (Session 95 kapanış).

## Session 95 nerede bıraktı (ÖZET)

**🎯 FAZ 3 app-HIGH kod-kısmı TAMAMEN KAPANDI + FAZ 4 ilk-kalem (coverage) ✅.** 5 PR (#359-363), main **`b6e7fb7`**, **prod `6f3d2e3` DEĞİŞMEDİ** (deploy YOK — S94+S95 fix'leri main'de, prod'a gitmedi).

- **#359 W9-I18N-01 (web):** 38 hardcoded string / 13 dosya → i18n-key. `Payer.label` kaldırıldı→`no`'dan türetilir (reducer saf); guard 7/7 (fix'siz-kırmızı→yeşil); W9-I18N-02 (`phoneExists`→`PHONE_ALREADY_EXISTS`) birlikte. Chip `task_9905a8eb` (AdisyonPanel İkram/Tam + Sidebar saat-a11y pre-existing).
- **#360 W11 (print-agent) 4-HIGH:** config-BOM (agent `.replace(/^﻿/)` + installer `Set-Content→[System.IO.File]::WriteAllText` **PS5.1 no-BOM ampirik**) · main-crash-guard (`lifecycle.ts` SIGTERM/unhandledRejection + boot try/catch + `main().catch`) · installer-key (`-ApiKey`→`-SetApiKey` Read-Host SecureString) · backoff (`computeBackoff` 1→3→9→15s + `pollOnce` outcome). 45/45. Gate 2-MEDIUM (401-hot-loop + README-drift) düzeltildi. **`reportResult` DOKUNULMADI** (print-once idempotency ayrı ADR). Chip `task_c554652f`.
- **#361 W10 (mobil) 2-HIGH:** `socket.on('connect')`-resync · netinfo+`onlineManager`/`focusManager`+`OfflineBanner`; **mutation `networkMode:'always'`=idempotency #345 korundu** (query yalnız offline-aware). Gate-HIGH (banner `absolute`→flex header-örtme + `isInternetReachable`) düzeltildi. **YENİ APK GEREKİR.**
- **#362 W12 (caller-bridge) 2-HIGH kod:** `StartAsync`-guard + `HostOptions.Ignore`=sessiz-ölüm-kapat · `OnSignal` No-op→signal-log (observability). 13/13. Gate-HIGH (OnSignal native-callback try/catch) düzeltildi. **C12-A-01 cid.dll cdecl/BStr donanım-teyit = [USER] ilk-çağrı smoke, pilot-öncesi.** Chip `task_e452b4ef`.
- **#363 FAZ 4 coverage-v8 hizalama (Blok 0 #1):** api+db `vitest 2.1.9→^3.1.0` + `@vitest/coverage-v8` paket-yerel + coverage-config; `ctx.getRootProject` çökme kapandı (`test:coverage` çalışıyor). Prod-src-sıfır; lock −463; vitest GHSA dev-only yan-fayda.

**DESEN teyit (değişmez):** her PR branch-first + fix'siz-kırmızı regresyon (stash/git-stash kanıtı) + **ultracode-Workflow-gate** (4 gerçek gate-bulgu ana-context'te doğrulandı-yamalandı: 401-hot-loop, README-drift, banner-örtme, OnSignal-native-crash) + CI-yeşil + squash-merge. `pool:'threads'`/`fileParallelism` (S53d) vitest-3.x'te korundu.

## ▶ Session 96 işleri

### 1. [KOD] FAZ 4 kalan kalite (00-summary §6)
- **dead-code sil** (knip: ~8 web dosya `EmptyState/ErrorState/card/TableStatusDot/AdminPlaceholder/PhaseLockedEmpty/TakeawayCartPanel/useCart` + `version.ts` + 37 export). **CLAUDE.md cerrahi: silme onaya-tabi** → knip taze-koş + liste sun + kullanıcı onayı.
- **R7-TZ-12/13** — rapor gün-sınırı İstanbul-tz (daily-close pencere + `order_no_counters`). En yüksek iş-değeri (ciro-raporu doğruluk) ama **tasarım-tz → ADR-olası**, karmaşık.
- **LOW/NIT süpürme + eslint flat-config kural-key çakışması.**

### 2. [KOD, FAZ 4 SONRASI] İptal fişi planı
`project_iptal_fisi_plan.md`: iptal fişleri fiziksel bassın. **Röportaj-önce** (v3'te nasıldı?) → scope-check → **ADR-004 Amd** + **print-once idempotency ailesiyle (P8-ENQ-09 + P11-A-01/A-02) birlikte** ele al. ADR-033 K8 "void'de fiş yeniden basılmaz" ile çelişme kontrol.

### 3. [USER] deploy kuyruğu (KOD gerektirmez — birikti)
- **Web prod-deploy:** S94 (#354-357) + S95 (#359) aynı dalga. `deploy.md`; **index-047 canlı-veride → ADR-031 K12 CONCURRENTLY teyit** (go-live sonrası ilk index migration). shared-types dist build ŞART.
- **Yeni APK** (#361 mobil + #345 idempotency) + garson telefonuna sideload. Eski-APK legacy-uyumlu.
- **print-agent + caller-bridge yeni exe** publish+install (cutover/dükkan-PC).
- **C12-A-01 caller-bridge donanım-smoke** (gerçek C812A ilk-çağrı, cdecl/BStr; pilot-öncesi zorunlu).
- **Para-smoke** (iptal+ekle→toplam / Kaydet-çift-tık→tek-kalem).

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 96)

```
Restoran POS v5 — Session 96. Önce oku: docs/context-anchor.md §2 + .claude/memory/project_deep_audit_series.md (+ MEMORY.md pointer) + CLAUDE.md + .claude/plans/session-95-kickoff.md.

DURUM: denetim 0-13 ✅ + fix FAZ 1-2 ✅ (prod `6f3d2e3`, head 046) + FAZ 3 app-HIGH kod-kısmı TAM (S95: web-i18n #359 · print-agent #360 · mobil #361 · caller-bridge #362) + FAZ 4 coverage ✅ (#363). main `b6e7fb7`, PROD'A S94+S95 DEPLOY YOK.
KALAN [KOD]: FAZ 4 dead-code(onaya-tabi)/R7-TZ-12-13(tasarım-tz,ADR-olası)/LOW-NIT-eslint → iptal-fişi(ADR-004-Amd,röportaj-önce). KALAN [USER]: S94+S95-web prod-deploy(index-047 CONCURRENTLY) + yeni-APK + C12-A-01-donanım-smoke + para-smoke.

BUGÜN başlamak istediğim: [SEÇ — örn. "FAZ 4 dead-code (knip liste)" / "R7-TZ rapor gün-sınırı" / "iptal fişi röportajı" / "S94+S95 fix'leri prod'a deploy"].

Desen: branch-first + ADR-önce(yapısal) + cerrahi + fix'siz-kırmızı regresyon + tam-suite(lokal pos_test) + ultracode-Workflow-gate(bulguları ana-context'te doğrula) + CI-yeşil. Merge dersleri: her fix-merge'de shared-types build; canlı-veri index CONCURRENTLY(ADR-031 K12); yeni-tablo GRANT(deploy.md §6). Türkçe yanıt.
```

## Notlar
- **pos_test** lokal DB head **046**, şifre postgres; DATABASE_URL yoksa integration skipIf. Coverage tam-sayı için DATABASE_URL ile koş.
- Audit draft #329-341 arşiv (findings-kırmızı, merge-edilmez).
- **4 chip açık (S95):** `task_9905a8eb` web-i18n-komşu · `task_c554652f` print-agent-robustness · `task_e452b4ef` caller-bridge-Blok12-kalan+C12-A-01 · (+`task_20f0e0c9` eski SplitPaymentModal-i18n muhtemelen #359'da superseded).
