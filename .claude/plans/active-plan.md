# Aktif Plan — Phase 0: Bootstrap & Foundation

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince tamamen yenilenir.

## Faz: 0 (Bootstrap & Foundation)

Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap" bölümü. Phase 0 sonunda Phase 1'e (Core Domain + Auth) geçilir.

## Hafta: 1 / 2 (Bootstrap)

### Hafta 1 hedefi (cümle)

Kod yazmadan önce proje iskeletini sağlam kurmak + v3'teki mevcut özelliklerin referans dokümantasyonunu çıkarmak. Hafta sonunda v3'ün her modülü için "v5'te nasıl yapılacak" notu, monorepo iskeleti, 3 ADR, CI yeşil ve hello endpoint ayakta olur.

### Görevler (sırayla)

#### 1. Proje anayasası doğrulaması
- **Durum**: ✅ **Tamamlandı (2026-04-22)**
- **Atanan**: İlhan
- **Çıktı**: `CLAUDE.md`, `docs/project-charter.md`, `docs/domain/personas.md` okundu, v5.0 MVP kapsam listesi onaylandı. Phase 3 roadmap + MVP listesi arası iskonto/rapor tutarsızlıkları giderildi, terminoloji (Z raporu → günlük kapanış) düzeltildi, "kapsam değişikliği belgeleme kuralı" eklendi.
- **DoD**: ✅ Commit `72e00c5` — `docs(charter): approve v5.0 scope + terminology consistency`

#### 2. v3 reference dokümantasyonu (kritik adım)
- **Durum**: ✅ **%100 (5/5 reference dosyası tamam)**
- **Atanan**: İlhan (v3 uzmanı) + Claude Code (dokümantasyon yardımı)
- **İlerleme**:
  - `modules.md` — ✅ 15/15 modül (1-11 tam + 12 Rezervasyon v5.1 + 13 Stok v5.2+ + 14 Audit MVP backend + 15 Yedek MVP)
  - `domain-rules.md` — ✅ 42 sinyalin domain kurallarına sentezi
  - `printer-notes.md` — ✅ ESC/POS + CP857 + 4 job tipi + routing + Caller ID
  - `data-model.md` — ✅ v5 şema iskeleti (tablolar, index'ler, enum'lar)
  - `pain-points.md` — ✅ 23 ağrı + v5 önlemleri
- **DoD**: 5 dosya dolu, İlhan onayı, Claude Code referans olarak okuyabiliyor

#### 3. ADR-001: Monorepo yapısı ve paket isimlendirme
- **Durum**: ✅ **Tamamlandı (2026-04-25)**
- **Yürütücü**: `architect` sub-agent (`/new-adr`)
- **Çıktı**: Karar: `apps/api`, `apps/web`, `apps/mobile`, `apps/print-agent` + `packages/shared-types`, `packages/shared-domain`, `packages/shared-ui`. pnpm workspaces + Turborepo. Package naming: `@restoran-pos/xxx`.
- **DoD**: ADR `decisions.md`'de, `pnpm install` temiz, workspace'ler linklenmiş

#### 4. ADR-002: Auth stratejisi
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `architect` + `security-reviewer` review
- **Çıktı**: JWT access + refresh, cookie vs header tercihi, refresh rotation, logout akışı, role matrix (admin/cashier/waiter/kitchen)
- **DoD**: ADR kabul, security review ✅

#### 5. ADR-003: DB şema ilkeleri
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `architect` + `db-migration-guard`
- **Çıktı**: id tipi (UUID v7 önerilir), timestamp tipi (TIMESTAMPTZ), `tenant_id` konvansiyonu, soft delete stratejisi, audit log tablosu şablonu, migration tool seçimi (drizzle-kit / kysely / node-pg-migrate arasında karar)
- **DoD**: ADR kabul, şablon tablo migration dosyası `apps/api/migrations/000_init.sql`

> **ADR sırası netleştirmesi (2026-04-22):** ADR numaraları sabit ama yazım sırası **ADR-003 → ADR-001 → ADR-002** olarak kararlaştırıldı. Gerekçe: monorepo yapısı migration tool kararına bağımlı (ADR-003 öncesi karar alınamaz), auth DB şemasına bağımlı (users/sessions tabloları ADR-003 konvansiyonlarını kullanır). Scratchpad'deki "Stratejik kararlar" bölümünde detaylı.

#### 6. CI pipeline (GitHub Actions)
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `implementer`
- **Çıktı**: `.github/workflows/ci.yml` — lint + typecheck + test + build her PR'da
- **DoD**: İlk PR'da CI yeşil

#### 7. Hetzner hesap + PostgreSQL hazırlığı
- **Durum**: ⏳ Beklemede
- **Atanan**: İlhan (hesap), `implementer` (docker-compose taslağı)
- **Çıktı**: Hetzner hesabı açık, CX22 server henüz kurulu değil (Phase 5'e kadar lokal yeter), PostgreSQL 17 docker-compose geliştirici makinesinde çalışıyor
- **DoD**: `docker compose up` → PostgreSQL 17 lokal ayakta, `pnpm --filter api migrate` bağlanıyor

#### 8. İlk "hello" endpoint
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `implementer`
- **Çıktı**: `apps/api` → `GET /health` → PostgreSQL bağlantısı doğrular + version döner. `apps/web` → basit ana sayfa, fetch /health, "Cloud bağlı" gösterir.
- **DoD**: `pnpm --filter api dev` + `pnpm --filter web dev` iki terminalde çalışıyor, tarayıcıda "Cloud bağlı" görünüyor, typecheck temiz

### Sıradaki görev

- **ADR-002 (Auth stratejisi)** — `/new-adr` ile `architect` + `security-reviewer` review. JWT access + refresh, cookie vs header, refresh rotation, logout akışı, role matrix.

### Session 19'da tamamlanan

- ✅ **`apps/api/migrations/000_init.sql` şablon migration** — 2026-04-25 commit `5d7d08d`. 478 satır: 4 rol, 5 helper fn, 6 enum, 14 tablo, 14 index, GRANT + DEFAULT PRIVILEGES, seed. §15.7.A sıralaması birebir.
- ✅ **ADR-003 Bölüm 16 Consequences + ADR-003 Accepted** — 2026-04-25. 13 pozitif + 10 negatif ödünleşim özeti. Durum `Draft → Accepted`.
- ✅ **ADR-003 Bölüm 15 Migration Stratejisi + mini-pass A1-A7** — 2026-04-25. 8 alt-bölüm, ~350 satır. Tool seçimi lock'landı (node-pg-migrate + kysely + kysely-codegen); alternatifleri reddedildi (drizzle-kit introspection-first + Prisma CONCURRENTLY yasak). Forward-only enforcement: `down` dosyası yazılmaz, hot-fix = N+1 forward migration. Drift detection 3 CI gate (INVALID index sorgusu, kysely-codegen diff, pgmigrations ordering). CONCURRENTLY parser-level grep (§14.1.B kapatma). Migrator-only DDL: 4 rol + 4 env (`DATABASE_URL`/`CRON_DATABASE_URL`/`MIGRATOR_DATABASE_URL`/`ADMIN_DATABASE_URL`) + GRANT şablonu + DBA console yasağı. 000_init.sql lock'lu sıralama (role → tenants → business → index → GRANT). **Paralel review:** db-migration-guard primary (0 BLOCKER + 4 CONCERN-A + 4 CONCERN-B + 9 GREEN) + security-reviewer secondary (0 BLOCKER + 3 CONCERN-A + 5 CONCERN-B + 9 GREEN). Mini-pass A1-A7: `--no-lock` kaldırdı (advisory lock default on); LAG SQL syntax hatası CTE ile düzeltildi; DEFAULT PRIVILEGES eklendi (yeni tablo otomatik kapsanır); dev-reset 4-guard (NODE_ENV + ALLOW_DEV_RESET + localhost-check + TTY confirm); `000_init.sql` role NOLOGIN + vault injection notu; cron_purger ALL TABLES antipattern yasak uyarısı; review-gate checklist güncellendi. 9 CONCERN-B follow-up'a kayıtlı.

### Session 18'de tamamlanan

- ✅ **ADR-003 Bölüm 14 Kritik Index'ler + mini-pass A1-A6** — 2026-04-25. 10 alt-bölüm, ~278 satır. Konvansiyonlar (§14.1): partial-suffix sözlüğü (`_active`/`_open`/`_pending`/`_uq`/`_idx`/`_pk`) + CONCURRENTLY zorunluluğu + INVALID index retry policy (`pg_index WHERE indisvalid = false` taraması, drop+retry) + migrator-only DDL kontratı (`app_admin` DDL yasağı) + INCLUDE üç-koşul gate (premature optimization yasağı). Tablo bazlı: §14.2 orders (`(tenant_id, store_date, order_no)` çift-rol unique scope + rapor leading; tek-aktif-masa partial `_open`; takeaway/delivery NULL davranışı + duplicate-prevention v5.1 forward-ref), §14.3 audit/call_logs bounded-log (`(tenant_id, created_at DESC)` leading + DESC backward scan ASC eşit maliyetli + sistem-actor NULL satırlar pattern + §12 4. index reddi explicit-lock), §14.4 order_no_counters PK muafiyeti, §14.5 soft-delete partial matrix (products/categories/customers `_active` + customer_phones yasak + snapshot tablolarda yasak), §14.6 payments+trigger ayrımı, §14.7 customer_phones tam UNIQUE drift koruma (4 katman: §6.2 + §8.3 + §14.5.A negative + §14.7 explicit + db-guard BLOCKER kuralı), §14.8 print_jobs forward-ref ADR-004, §14.9 RLS+index leftmost-prefix uyumu (`OR tenant_id IS NULL` yalnız audit_logs admin scope, diğerlerinde BLOCKER), §14.10 review-gate (db-guard 18 + security 9 madde). İkili review **paralel**: **db-migration-guard primary** (0 BLOCKER + 4 CONCERN-A + 2 CONCERN-B + 8 GREEN; mini-pass A1-A4 kapattı: INVALID retry policy, DESC ASC backward scan, partial-suffix sözlüğü, takeaway forward-ref) + **security-reviewer secondary** (0 BLOCKER + 2 CONCERN-A + 3 CONCERN-B + 6 GREEN; mini-pass A5-A6 kapattı: sistem-actor NULL satırlar index pattern, CONCURRENTLY migrator-only rol kontratı). Drift fix: `print_jobs_active_idx` → `print_jobs_pending_idx` (partial-suffix sözlüğü gereği). 5 follow-up kalemi (B1-B5) eklendi. §14 net impact: ~250 satır draft + ~28 satır mini-pass.

### Session 17'de tamamlanan

- ✅ **ADR-003 Bölüm 13 retention + cron + RLS hazırlığı** — 2026-04-25. 8 alt-bölüm, §13.8 review-gate 27 madde (Bölüm A db-guard 15 / Bölüm B security 12). Üç-sınıf retention taksonomisi (business-record sınırsız / bounded-log TTL'li / archive status-temelli). Birleşik cron `ttl-cleanup.ts` formal kontrat: schedule `0 30 3 * * *` Europe/Istanbul, batch `LIMIT 10000`, tenant-loop pattern, hata izolasyonu, retention overflow alarmı (`deleted_count == LIMIT` → Sentry warning). Lock id registry `4_201_xxx` namespace + `CRON_LOCK_IDS` const + ESLint `no-raw-advisory-lock` + db-guard grep gate üçlü savunma. **Üç → dört DB rolü** (`app_tenant` RLS-scoped + `cron_purger` BYPASSRLS ayrı `CRON_DATABASE_URL` + `migrator` BYPASSRLS + `app_admin` sistem-actor viewer); `app_admin` mini-pass A4 sonrası ortaya çıktı. Audit `findByTenant` (NULL hariç) vs `findSystemEvents` (admin-only) repository ayrımı → §12 metadata leak risk kapatıldı. SELECT policy bölünmesi (`tenant_select_audit` NULL hariç + `system_select_audit_admin` admin-only). `print_jobs` 7g success / 30g failed status-temelli archive (cron task ADR-004'e ertelendi). İkili review: **security ÖNCE** (0 BLOCKER + 4 CONCERN-A + 4 CONCERN-B + 9 GREEN; mini-pass A1-A4 kapattı: process boundary, advisory lock revoke, retention overflow alarm, metadata leak split) → **db-migration-guard SONRA** (0 BLOCKER + 3 CONCERN-A + 5 CONCERN-B + 8 GREEN; mini-pass A1-A3 kapattı: bootstrap order, tenant_id nullability, partition forward-ref). §13 net impact: ~310 satır draft + ~12 satır security mini-pass + ~8 satır db-guard mini-pass.

### Session 16'da tamamlanan

- ✅ **ADR-003 Bölüm 12 audit_logs + AuditSanitizer kontratı** — 2026-04-25. Karar A: ip_address kolonu YOK (KVKK Sinyal #40 korunur, v5.1 forensic ayrı ADR). Hibrit savunma: TS AuditSanitizer<T> recursive whitelist (primary, defense-in-depth) + DB CHECK constraint top-level deny-list 38 anahtar (İngilizce + Türkçe + PCI-DSS + KVKK kritikler) + `writeAudit()` tek giriş + bypass yasakları (DB trigger / migration seed / test fixture). Retention 2 yıl birleşik cron `ttl-cleanup.ts` (call_logs 30g + audit_logs 2y ayrı task), tenant-loop pattern (4. index eklenmedi, write amp 3x korundu). Cron self-audit `audit.purge` event v5-native. event_type TEXT + regex `^[a-z_]+\.[a-z_]+$` (esneklik). İkili review gate: **security ÖNCE** (2 BLOCKER + 5 CONCERN-A + 3 CONCERN-B + 7 GREEN; mini-pass M1-M5 kapattı) → **db-migration-guard SONRA** (0 BLOCKER + 3 CONCERN-A + 3 CONCERN-B + 15 GREEN; mini-pass M1-M3 kapattı). Checklist 17 → 20 madde + alt-madde 7a. §12 net impact: ~285 satır draft + ~28 satır security mini-pass + ~18 satır db-guard mini-pass.

### Session 15'te tamamlanan

- ✅ **ADR-003 Bölüm 11 db-migration-guard review gate + mini-pass A1-A3** — 2026-04-25. Review sonucu: 0 BLOCKER + 3 CONCERN-A + 3 CONCERN-B + 14 GREEN. Mini-pass A1 (madde-5 ek-index netliği), A2 (madde-7 "DB-side atomicity" ifade düzeltmesi), A3 (madde-8 payload bind netliği) tek pass'te uygulandı. CONCERN-B'ler follow-up listesine eklendi (B1 error taxonomy §11.10 madde-18, B2 v3 backfill order_no_counters seed, B3 parity stress harness Phase 0). 10.5 review pattern'iyle bire bir aynı disiplin.

### Session 14'te tamamlanan

- ✅ **ADR-003 Bölüm 11 draft** — 2026-04-25. `order_no` günlük unique sayaç: format INT (v3 paritesi), reset `store_date()` üzerinden (§4.3 + §5.2 verili), concurrency (A) counter tablosu + ON CONFLICT, IMMUTABLE çözümü (X′) `orders.store_date` reuse, cancel gap kabul, insert akışı (β) tek-CTE DB-otoritatif. §6.5 muafiyet inline COMMENT, §11.10 checklist 19 madde. Architect 4 turda gerçekleşti, mini-pass-style review-ready.

### Session 13'te tamamlanan

- ✅ **Mini-pass (CONCERN Bucket A+B)** — 2026-04-25 commit. C1 (`payment_items_block_comped_insert` trigger), C2 (composite FK + UNIQUE prefix + payments forward-ref), C3 (4 trigger rename, `<table>_<action>[_<when>]` formu), C4 (`propagate_full_comp` tenant filter). Detay: decisions.md §10.5.2.

### Follow-up (ADR-003 commit sonrası, ayrı adım)

- **docs/v3-reference/data-model.md drift düzeltmesi** — ADR-003 Bölüm 6.2 + 8.3 kararı `customer_phones` için **tam UNIQUE + hard delete** yönünde netleşti. `data-model.md` reference doc'unda `UNIQUE INDEX customer_phones_normalized ON customer_phones(tenant_id, normalized_phone)` satırına not eklenecek: "tam UNIQUE; anonimize'de hard delete (bkz. ADR-003 §6.2 + §8.3); partial `WHERE deleted_at IS NULL` yasak." Bu iş **ADR commit'iyle karıştırılmayacak** — ayrı PR + commit, güncelleme gerekçesi ADR-003 atıfı.
- **v3→v5 takeaway/delivery backfill ADR'si (Phase 5 geçiş planı)** — ADR-003 §9.2.1 kararıyla açıldı: v3'te `takeaway` tek akıştı, `delivery` ayrı enum değeri değildi (status/flag ile yönetiliyordu). v5'te `order_type` ayrıştı (`takeaway` vs `delivery`). v3'ten v5'e geçişte eski takeaway satırlarının hangi değerle backfill edileceği (sabit `takeaway` mi, flag bakarak `delivery` mi, hepsi `takeaway` + manuel migration mı) **ayrı bir backfill ADR'sinde** karara bağlanır. Phase 5 (v3→v5 geçiş) başında yazılır; ADR-003 bu borcu açık olarak kaydeder, karar almaz. **Aynı backfill ADR'sinde §11 `order_no_counters` seed kararı da yer alır** (Session 15 review B2): `INSERT INTO order_no_counters (tenant_id, business_date, last_no) SELECT tenant_id, store_date, MAX(order_no) FROM orders GROUP BY tenant_id, store_date;` — v3'ten gelen sıralı `order_no` değerlerinin son durumunu counter tablosuna seed eder.
- **v5.1 admin uncomp akışı ADR'si** — ADR-003 §10.5 B2 forward-reference. `block_comp_on_closed_order` trigger'ı kapalı siparişte ikram değişikliğini yasaklıyor; v5.1'de admin role'üne özel geri-alma akışı ayrı ADR ile açılır. MVP dışı.
- **v5.1 refund ADR** — §10.4.6 + §10.5.2 C7 forward-reference. `payments.amount_cents > 0` CHECK'i refund akışında gevşetilir veya `payment_kind='refund'` ayrı satır modeli tanımlanır. Negatif satır yasağı ilkesi korunacak.
- **Error taxonomy / API error contract ADR'si** — §10.5.2 C6 + §11.10 madde-18 forward-reference. DB `RAISE EXCEPTION` çıktılarının domain service wrapper'da Türkçe i18n-key'e çevrilmesi; ham mesaj UI'a sızdırılmaz. §11 için özel madde: `23505 unique_violation` yakalanır → `CONFLICT` error code'una map'lenir, retry mantığı service'te (3 deneme exponential backoff). §12 veya ayrı ADR.
- **ADR-002 sonrası §6.5 users notu güncellemesi** — §6.5 "users tenant-scoped mı global mı, ADR-002 kararına bağlı" cümlesi ADR-002 kabul sonrası netleşir.
- **§11 parity stress harness (Phase 0 implementer turu)** — §11.10 madde-19 forward-reference (Session 15 review B3). `(tenant_id, store_date, order_no)` üçlüsü için concurrency stress test §5.4 parity test altyapısına eklenir; counter `ON CONFLICT DO UPDATE` + UNIQUE INDEX ikinci hat savunmasının paralel insert altında doğru davrandığı doğrulanır. Migration script'i yazılırken implementer ekler; ADR borcu değil, kod borcu.
- **Migration tool kararı (Phase 0 implementer turu)** — §12 db-guard CONCERN-B1 (Session 16). drizzle-kit / kysely / node-pg-migrate üçlüsünden seçim; ADR-003 commit sonrası Phase 0 implementer turunun ilk işi, ADR-001 (monorepo) ile birlikte değerlendirilir. ADR borcu değil, ADR-001 içinde karar.
- **PITR / backup stratejisi ADR'si veya `docs/ops/backup-strategy.md`** — §12 db-guard CONCERN-B2 (Session 16). audit_logs hot table (peak 10-20 INSERT/sn) + 2 yıl retention; logical dump vs PITR seçimi. Phase 5 hazırlığı, fakat audit retention §12 onayıyla şimdiden kararı bekleyen alan. Ayrı ops ADR veya doc, ADR-003 dışı.
- **Cron lock id registry konvansiyonu** — §12 db-guard CONCERN-B3 (Session 16). `pg_try_advisory_lock` namespace çakışma riski; audit + call_logs + gelecekteki cron'lar için lock id tablosu. `docs/engineering/cron-conventions.md` (henüz yok) — Phase 0 implementer turunda ttl-cleanup.ts ile birlikte yazılır. ADR borcu değil, kod borcu.
- **KVKK DSAR (Data Subject Access Request) akış ADR'si (v5.1)** — §12 security CONCERN-B1 (Session 16). Müşteri "benim hakkımda audit_logs'ta ne var?" sorusu / silme talebi süreci; `actor_user_id` veya `entity_id` üzerinden filtre/redaksiyon akışı. Audit viewer UI v5.1 ile birlikte tasarlanır.
- **KVKK veri haritası belgesi `docs/compliance/kvkk-data-mapping.md`** — §12 security CONCERN-B2 (Session 16). phone son-4 hane orantılılık gerekçesi (KVKK Kurulu rehber referansları), user_agent saklama gerekçesi, v5.1 forensic IP ayrı ADR referansı. Denetim sorularına hazır cevap. Yeni doc, ADR değil.
- **§14.6 payments `payment_scope` filter index ölçümü** — §14 db-guard CONCERN-B1 (Session 18). Split + partial scope filter sorgu pattern'i için EXPLAIN ölçümü `docs/engineering/index-tuning.md` Phase 1'de yazılır; ölçüm sonrası index gerekirse mini-pass ADR. ADR borcu değil, ölçüm borcu.
- **§14.5.B snapshot rapor index'leri DROP threshold** — §14 db-guard CONCERN-B2 (Session 18). `order_items_tenant_product_idx` + `order_items_tenant_category_idx` Phase 1 ölçümünde p95 INSERT > 5ms olursa `IF EXISTS` migration ile DROP; threshold + ölçüm metodolojisi `docs/engineering/index-tuning.md`'da. ADR borcu değil, ölçüm borcu.
- **§14.3.C `call_logs` DSAR composite index** — §14 security CONCERN-B3 (Session 18). v5.1 KVKK DSAR ADR'si tetikleyicisi: `(tenant_id, normalized_phone, created_at DESC)` müşteri-bazlı arama geçmişi sorgusu için. KVKK DSAR ADR (yukarıdaki §12 follow-up'ı) kapsamına §14.3.C atfı eklenir; DSAR ADR yazıldığında bu index kararı orada karara bağlanır.
- **§14.7 customer_phones recycle test cross-tenant matrisi** — §14 security CONCERN-B4 (Session 18). §6.3 cross-tenant test stratejisine explicit case: müşteri A hard-delete → telefon yeni müşteri B'ye atanır → caller-ID lookup history doğru cevaplıyor mu (recycle drift testi). §11 parity stress harness follow-up'ına dahil edilir; Phase 0 implementer turunda yazılır. ADR borcu değil, kod borcu.
- **§14 index naming bilgi sızıntısı** — §14 security CONCERN-B5 (Session 18). Index adında `customer_phones_tenant_normalized_uq` formu schema introspection ile bilgi sızıntısı düşünüldü; risk düşük (auth gate sonrası introspection için zaten yetki gerek), MVP'de no-op. v5.2 RLS ADR'sinde tekrar değerlendirilir.
- **§15.5 grep regex eksik pattern (§15 db-guard B1, Session 19)** — `ALTER TABLE ... ADD CONSTRAINT PRIMARY KEY` ve `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY NOT VALID + VALIDATE CONSTRAINT` pattern'leri §15.5 CONCURRENTLY grep'ine dahil değil. FK NOT VALID pattern lock-free olduğu için özel kural; PK lock alır. §15.5 mini-pass ADR'sinde netleştirilir (Phase 0 sonu).
- **§15.4.B CI bağlantısı (§15 db-guard B2, Session 19)** — kysely-codegen diff step'i için CI ortamında PG disposable instance kurulumu (service container / testcontainers) ADR-001 forward-ref; §15.4.B "test DB'sine migrate" adımı ADR-001 yazılırken somutlaşır.
- **§15.3.B ek güvence: migrator DELETE revoke (§15 db-guard B3, Session 19)** — `node-pg-migrate down` package.json'da yok ama operatör global install'dan çağırabilir. Ek güvence: `pgmigrations` tablosunda `migrator` rolünün DELETE yetkisi REVOKE edilirse down runner satır silemez. ADR-001 deploy checklist'ine eklenecek.
- **§15.6.C migrator credential zero-downtime rotation (§15 db-guard B4, Session 19)** — "her deploy sonrası rotate" pratikte günde N rotate olabilir; eski + yeni credential 1 deploy pencere overlap pattern ADR-001 deploy pipeline'ına kayıt.
- **§15 kysely-codegen repo private notu (§15 security B1, Session 19)** — `packages/db/schema/generated.ts` şema topolojisini git history'de açar; repo private olduğu sürece risk düşük. README/CONTRIBUTING'e "repo private kalmalı, generated.ts şema içerir" notu eklenecek (implementer turu).
- **§15 CI log masking (§15 security B2, Session 19)** — `MIGRATOR_DATABASE_URL` CI runner log'larına echo edilmemeli; GitHub Actions `::add-mask::` direktifi ADR-001 CI workflow yazılırken eklenir.
- **§15.6.C migrator haftalık rotation policy (§15 security B3, Session 19)** — "her deploy sonrası rotate" yerine haftalık + on-demand (compromise) policy önerildi; ADR-001 deploy pipeline scope'unda karara bağlanır.
- **§15 app_admin pgaudit / log_statement (§15 security B4, Session 19)** — `app_admin` SELECT-only ama DBA sorgu denetim izi yok; PostgreSQL `pgaudit` extension veya `log_statement = 'all'` app_admin rolü için açılması KVKK erişim denetimi için değerlendirilir. ADR-005 monitoring/observability bölümüne veya ayrı ops doc'a.

### Phase 0 exit kriterleri

Hafta 2 sonunda:
- [ ] Görevler 1-8 hepsi ✅
- [ ] 3 ADR (001, 002, 003) kabul edildi
- [ ] v3-reference klasörü dolu (5 dosya)
- [ ] Monorepo çalışıyor, CI yeşil
- [ ] Hello endpoint + web sayfası ayakta
- [ ] Phase 1 planı yazıldı (bu dosya Phase 1 için yenilenir)

### Phase 1'e geçiş şartı

Phase 0 exit kriterleri tamamen ✅ olmadan Phase 1'e girilmez. Disiplin projenin kaderi için kritik — v4'ün iptaline sebep bu disiplin yoksunluğuydu.

---

## ADR İzleme

Phase 0'da yazılacaklar: ADR-001 (Monorepo), ADR-002 (Auth), ADR-003 (DB şema ilkeleri).

**ADR-004 "Print Agent Mimarisi" — Phase 1 başında yazılacak** (`architect` sub-agent).
Karar: Cloud API → print job queue → Print Agent (Windows servisi) → ESC/POS.
Template cloud'da render edilir, byte stream olarak Agent'a gider.
Ön not: v3 StoreBridge ölü, kodundan taşıma yok — yalnızca domain notları (`printer-notes.md`, `pain-points.md`) referans alınır.

## Notlar

- **Claude Code kullanım disiplini**: Her yeni görev başında aktif plan okunur, her görev sonunda plan güncellenir. `/phase-done` slash command'ı DoD kontrolü yapar.
- **Multi-araç yasak**: v3'te claude.ai + cursor + codex + claude code paralel kullanıldı, kod dağıldı. v5'te **sadece Claude Code**. Acil düzeltmeler için istisna yapılabilir ama CHANGELOG'a yazılır.
- **v3 kod copy-paste yasak**: v3 yalnız referans. Davranış/kural taşınır, kod satırı taşınmaz.
- **v3-reference klasörü kritik**: Phase 0 görev 2 atlanırsa Phase 1-4'te sürekli "v3'te bu nasıl çalışıyordu?" sorusuyla tıkanırız. O yüzden önce v3'ü kağıda dökeceğiz.
