# Session 94 Kickoff — Fix Fazı FAZ 3-4 + Merge/Deploy

> **Giriş kapısı:** `docs/context-anchor.md` §2 → `docs/audit/00-summary.md` (denetim sentezi, tek kaynak) → bu dosya.
> **Audit+fix durumu:** `.claude/memory/project_deep_audit_series.md` (hangi blok/faz bitti, BLOCKER'lar, kalibrasyon).
> **Son güncelleme:** 2026-07-13 (Session 93 kapanış).

## Session 93 nerede bıraktı

**Derin denetim serisi 0-13 UÇTAN UCA ✅** (14 draft PR #327-342; `00-summary.md` = tek giriş) **+ FİX FAZI FAZ 1 & FAZ 2 (index hariç) ✅** (8 fix PR #343-350). **Hiçbir fix henüz merge/deploy edilmedi — prod code `27926ca` sabit.**

### 8 fix PR — merge sırası (bağımlılık + migration numara güvenliği)
Sırayla merge et (ardışık dosya-komşuluğu + migration sırası):
1. **#343** `fix/faz1-money-blockers` — MONEY-01 + DB-TX-01 (recalc iptal-kalem filtresi + order-row FOR UPDATE). `packages/db/orders.ts`.
2. **#344** `fix/faz1-payment-idempotency-race` — DB-TX-05 (ödeme idempotency-yarışı `ON CONFLICT DO NOTHING`; severity BLOCKER→HIGH kalibre). `payments.ts`.
3. **#345** `fix/faz1-order-idempotency` — M10-A-01 (**ADR-013 Amendment 1 + Migration 045**: orders.idempotency_key + order_item_batches; replay'de KDS/emit/audit bastırma; web+mobil attempt-sabit key). **db-migration-guard ENGEL-YOK.** ⚠️ **Deploy sırası:** pg-backup → Migration 045 (deploy.md §6 migrator-sahiplik) → `pm2 restart pos-api` → web build → **yeni APK sideload** (eski APK bu arada legacy keysiz yolda güvenle çalışır).
4. **#346** `fix/faz2-response-pii` — mapPgError satır-değeri süzme (KVKK; kolon-adı taşır, değer asla). `packages/db/errors.ts`.
5. **#347** `fix/faz2-store-date-tz` — R7-TZ-11 (todayStoreDate tenant-tz; gece-yarısı yanlış-gün). `store-date.ts` + orders route.
6. **#348** `fix/faz2-csv-injection` — R7-CSV-01 (csvEscape apostrof-prefix). `csv-stream.ts`.
7. **#349** `fix/faz2-realtime-emit` — **ADR-010 Amendment** (emit tek-path + şema qty→quantity + safeEmit fire-and-forget + eslint tek-selector). Tel değişmez → **API-only deploy** (migration yok, web/mobil redeploy yok). Merge = ADR Accepted.
8. **#350** `fix/faz2-permissions-parity` — **ADR-034 Accepted** (matris route-gerçeğine hizala + rbac-parity CI testi; ROUTE DAVRANIŞI SIFIR DEĞİŞİKLİK). Merge = ADR anchor kalıcı.

**Not:** #349/#350 ADR metinlerini decisions.md'ye taşır; merge'de "Proposed→Accepted" satırını güncelle (küçük). Tüm PR'lar: tam api suite yeşil (703-749 aralığı, her biri kendi baseline'ında) + kanıtlı regresyon kilidi (stash-kanıtı / deterministik yarış / parite drift-guard).

### Devam eden İlhan-kararı notları (bilgi)
- **Kasiyer sipariş iptali:** PR-8 parite testi 4. drift'i buldu — matris "cashier orders.cancel=true" diyordu, route kasıtlı admin-only (`orders.ts:817`). Matris gerçeğe hizalandı (davranış değişmedi). Kasiyerin sipariş iptal edebilmesi İSTENİRSE ayrı route-kararı (yeni mini-ADR).

## ▶ Session 94 işleri

### 1. [USER] 8 fix PR'ını gözden geçir + merge + deploy (öncelik)
Yukarıdaki sırayla. #345 migration'lı (deploy reçetesi PR gövdesinde). Merge sonrası: FAZ 2 index migration'ı 046 numarasını güvenle alabilir.

### 2. FAZ 2 kuyruğu — index migration (046) [#345 merge SONRASI]
- **DB-TX-04 + R7-AGG-PERF-01 + R6-TBL-01** (tek migration): `order_items(order_id, tenant_id)` index + `orders`/`order_items` rapor-destek `(tenant_id, created_at)` kompozit. Yük harness boş-DB'de gizledi, gerçek hacimde ısırır. db-migration-guard zorunlu; canlı-orders index-build lock kısa (~yüzlerce satır).
- **R7-DOS-01** (aynı PR'a eklenebilir): `/reports` rate-limit yok — cashier 90g export'u limitsiz tekrarlar.

### 3. FAZ 3 — app-HIGH (00-summary §3, ADR-gerektirmeyen doğrudan-fix'ler)
- **web (Blok 9):** i18n 38-site hardcoded (para-yolu UI; hci+turkish-ux+i18n gate) · fetch-guard hata≠boş-durum maskesi · "Yazdır" no-op · Hızlı Öde >1000₺ onaysız.
- **mobil (Blok 10):** netinfo/onlineManager yok (offline algılama) · socket reconnect resync yok (sessiz bayat veri) · print pending-kilidi.
- **print-agent (Blok 11):** config BOM boot-loop (config.ts strip + installer #Requires -Version 7) · main() hata-yakalama+graceful · installer key SecureString · backoff.
- **caller-bridge (Blok 12):** StartAsync try/catch (StopHost sessiz-ölüm) · USB-kopma health · **interop ampirik smoke [USER-donanım]** (cid.dll cdecl/BStr — codepage-scan emsali).

### 4. FAZ 4 — kalite (00-summary §6)
vitest/coverage-v8 major-hizalama (nicel taban açılır) · dead-code silme (~8 web dosya + 37 export, knip listesi — onaya tabi) · eslint flat-config kural-key çakışması (realtime PR'ında not edildi) · R7-TZ-12/13 (daily-close pencere + order_no_counters ayrışması — tasarım-gerektiren tz kuyruğu) · LOW/NIT süpürme.

## Notlar
- **pos_test** lokal DB (head **045** artık — M10-A-01 migration'ı uygulandı) şifre postgres — canlı testler YALNIZ burada. Postgres molada düşerse [[feedback_native_postgres_detached_start]] (pg_ctl Start-Process detach + poll).
- Fix PR'ları kasıtlı-kırmızı audit findings testlerini (audit branch'lerinde) yeşile çevirir — ama fix'ler kendi odaklı regresyon testlerini taşır (audit findings ayrı draft PR'larda kalır).
- Her fix cerrahi + ADR-önce (yapısal olanlar) + tam-suite + kanıtlı regresyon — DoD tam.
