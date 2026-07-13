# Session 94 Kickoff — Fix Fazı FAZ 3-4 + İptal Fişi Planı

> **Giriş kapısı:** `docs/context-anchor.md` §2 → `docs/audit/00-summary.md` (denetim sentezi, tek kaynak) → bu dosya.
> **Audit+fix durumu:** `.claude/memory/project_deep_audit_series.md` · **İptal fişi:** `.claude/memory/project_iptal_fisi_plan.md`
> **Son güncelleme:** 2026-07-13 (Session 93 kapanış — deploy sonrası).

## Session 93 nerede bıraktı (ÖZET)

**Derin denetim serisi 0-13 ✅ + FİX FAZ 1 & 2 ✅ + 🎯 PROD DEPLOY ✅.** prod code **`6f3d2e3`**, migrations head **046**.

- **Denetim (0-13):** 238 bulgu, 4 para-BLOCKER + cross-cutting; `00-summary.md` main'de. Detay-raporlar (#329-341) açık-draft **arşiv** (findings-kırmızı, merge-edilmez; seri tam bitince kapat).
- **Fix FAZ 1 (4 BLOCKER):** #343 MONEY-01+DB-TX-01 (recalc iptal-kalem + FOR UPDATE) · #344 DB-TX-05 (ödeme idempotency-yarışı ON CONFLICT) · #345 M10-A-01 (**ADR-013 Amd1 + Migration 045** sipariş-idempotency; web+mobil attempt-sabit key).
- **Fix FAZ 2 (cross-cutting):** #346 response-PII · #347 store-date tz · #348 CSV-injection · #349 realtime-emit (**ADR-010 Amd**) · #350 permissions (**ADR-034 Accepted, B2+3×KORU**; rbac-parity CI drift-guard).
- **Deploy (2026-07-13):** pg-backup → `ALTER DEFAULT PRIVILEGES FOR ROLE migrator` → Migration **045+046** → REVOKE-kontrat `f/f` ✓ → web build → pm2 restart → health/web/socket ✓. **Deploy ön-kontrolü grant-dersini yakaladı** (default-ACL yalnız postgres → migrator-yaratımı yeni tablo app_tenant-grant'sız): **Migration 046** (#352, order_item_batches GRANT) + sistemik defACL ağı; `deploy.md §6` as-built güncellendi.
- **Merge dersleri (hafızada):** orders.ts 3-yol çakışma elle-birleştirme · **stale shared-types dist → her fix-merge'de `pnpm --filter shared-types build` ŞART** (idempotency testleri sahte-409) · decisions.md çok-ADR marker-numarayla-koru.

## ▶ Session 94 işleri

### 1. [USER] — Deploy kuyruğu (KOD gerektirmez)
- **Yeni APK** (`docs/ops/mobile-release.md`): build + garson telefonuna sideload. Acele yok — **eski APK legacy keysiz yolda çalışıyor** (kırılma yok); yeni APK'ya dek yalnız mobil idempotency-koruması pasif (web korumalı).
- **Fonksiyonel para-smoke** (gerçek UI, 2 dk): masa aç → 2 kalem → 1 iptal → yeni kalem → **toplam doğru mu** (MONEY-01) · Kaydet'e çift-tık → **kalem tek mi** (idempotency) · test adisyonunu normal kapat.

### 2. [KOD] FAZ 2 kuyruğu — index migration (**047**; 045/046 canlıda)
- **DB-TX-04 + R7-AGG-PERF-01 + R6-TBL-01** tek migration: `order_items(order_id, tenant_id)` + `orders`/`order_items` rapor-destek `(tenant_id, created_at)` kompozit. Yük harness boş-DB'de gizledi, gerçek hacimde ısırır. **⚠️ canlı-veri var → ADR-031 K12 CONCURRENTLY gate** (go-live sonrası ilk index migration'ı). db-migration-guard zorunlu; yeni-tablo yok → grant sorunu yok ama emin ol.
- **R7-DOS-01** (aynı PR): `/reports` rate-limit yok.

### 3. [KOD] FAZ 3 — app-HIGH (00-summary §3; ADR-gerektirmeyen doğrudan-fix)
- **web:** i18n 38-site hardcoded (para-yolu UI; hci+turkish-ux+i18n gate) · fetch-guard hata≠boş-durum · "Yazdır" no-op · Hızlı Öde >1000₺ onaysız.
- **mobil:** netinfo/onlineManager yok (offline) · socket reconnect resync yok (sessiz bayat) · print pending-kilidi. **⚠️ mobil değişiklik = yeni APK gerekir.**
- **print-agent:** config BOM boot-loop · main() hata-yakalama+graceful · installer key SecureString · backoff.
- **caller-bridge:** StartAsync try/catch (StopHost sessiz-ölüm) · USB-kopma health · **interop ampirik smoke [USER-donanım]** (cid.dll cdecl/BStr).

### 4. [KOD] FAZ 4 — kalite (00-summary §6)
vitest/coverage-v8 hizala (nicel taban) · dead-code sil (~8 web dosya+37 export, onaya tabi) · eslint flat-config kural-key çakışması · R7-TZ-12/13 (daily-close pencere + order_no_counters — tasarım-tz kuyruğu) · LOW/NIT.

### 5. [KOD, FAZ 3-4 SONRASI] İptal fişi planı
`project_iptal_fisi_plan.md`: iptal fişleri fiziksel bassın (bugün hiç basmıyor). **Röportaj-önce** (v3'te nasıldı?) → scope-check → **ADR-004 Amd** (yeni `cancel` job-kind + 3 iptal-noktası hook) → **print-once idempotency ailesiyle (Blok 8+11) birlikte** ele al. ADR-033 K8 "void'de fiş yeniden basılmaz" ile çelişme (o void→reopen'dı, iptal-bildirim ayrı).

---

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 94)

```
Restoran POS v5 — Session 94. Önce oku: docs/context-anchor.md §2 + .claude/memory/project_deep_audit_series.md + CLAUDE.md + .claude/plans/session-94-kickoff.md.

DURUM: denetim serisi 0-13 ✅ + fix FAZ 1-2 ✅ + PROD DEPLOY ✅ (prod `6f3d2e3`, migrations head 046; 4 para-BLOCKER + 5 cross-cutting HIGH canlı). Kalan [USER]: yeni APK + para-smoke. Kalan [KOD]: FAZ 2 index(047) → FAZ 3 app-HIGH → FAZ 4 kalite → iptal-fişi planı.

BUGÜN başlamak istediğim: [SEÇ — örn. "FAZ 2 index migration 047" / "FAZ 3 web i18n 38-site" / "iptal fişi röportajı"].

Desen: branch-first + ADR-önce (yapısal olan) + cerrahi diff + kanıtlı regresyon testi + tam-suite (pos_test) + gate'ler (UI→hci/turkish-ux/i18n; DB→db-migration-guard). Merge dersleri: her fix-merge'de shared-types build; canlı-veri index migration'ında CONCURRENTLY gate (ADR-031 K12). Türkçe yanıt.
```

## Notlar
- **pos_test** lokal DB head **046** (bugün fresh drop+recreate+migrate ile yenilendi), şifre postgres — canlı testler YALNIZ burada; drop+recreate reçetesi: `psql -d postgres -c "DROP DATABASE ... WITH (FORCE)"` ayrı + `CREATE` ayrı + `npx node-pg-migrate up`. Postgres molada düşerse [[feedback_native_postgres_detached_start]].
- Audit draft #329-341 arşiv; her fix ilgili raporun HIGH'ını kapatır ama findings-testleri ayrı branch'te (fix'ler kendi odaklı testini taşır).
- prod deploy reçetesi `docs/ops/deploy.md` (§6 grant/migrator as-built güncel).
