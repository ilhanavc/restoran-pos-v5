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
- **Durum**: ⏳ Beklemede
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

- **ADR-003 Bölüm 11 öncesi mini-pass (CONCERN Bucket A+B)** — Session 13 ilk işi.
  - C1: `BEFORE INSERT ON payment_items` trigger — `order_items.is_comped=true` olan kalemi payment_items'a eklemeyi DB seviyesinde yasakla (domain-only enforcement §10.2 "DB defansif" ilkesine aykırıydı).
  - C2: `payment_items` UNIQUE konvansiyonu — ya §6.2 prefix ilkesine istisna notu, ya da `UNIQUE (tenant_id, order_item_id)` formuna çevir.
  - C3: Tüm trigger naming'i tek forma çek (`<table>_<action>[_<when>]`).
  - C4: `propagate_full_comp` UPDATE clause'una `AND tenant_id = NEW.tenant_id` ekle (§6.3.1 defense-in-depth).
  - DoD: Ayrı commit; dört değişiklik decisions.md'ye yazılır, db-migration-guard'a kısa re-review.
- **Ardından: ADR-003 Bölüm 11 (order_no günlük unique)** — `architect` sub-agent draft.

### Follow-up (ADR-003 commit sonrası, ayrı adım)

- **docs/v3-reference/data-model.md drift düzeltmesi** — ADR-003 Bölüm 6.2 + 8.3 kararı `customer_phones` için **tam UNIQUE + hard delete** yönünde netleşti. `data-model.md` reference doc'unda `UNIQUE INDEX customer_phones_normalized ON customer_phones(tenant_id, normalized_phone)` satırına not eklenecek: "tam UNIQUE; anonimize'de hard delete (bkz. ADR-003 §6.2 + §8.3); partial `WHERE deleted_at IS NULL` yasak." Bu iş **ADR commit'iyle karıştırılmayacak** — ayrı PR + commit, güncelleme gerekçesi ADR-003 atıfı.
- **v3→v5 takeaway/delivery backfill ADR'si (Phase 5 geçiş planı)** — ADR-003 §9.2.1 kararıyla açıldı: v3'te `takeaway` tek akıştı, `delivery` ayrı enum değeri değildi (status/flag ile yönetiliyordu). v5'te `order_type` ayrıştı (`takeaway` vs `delivery`). v3'ten v5'e geçişte eski takeaway satırlarının hangi değerle backfill edileceği (sabit `takeaway` mi, flag bakarak `delivery` mi, hepsi `takeaway` + manuel migration mı) **ayrı bir backfill ADR'sinde** karara bağlanır. Phase 5 (v3→v5 geçiş) başında yazılır; ADR-003 bu borcu açık olarak kaydeder, karar almaz.
- **v5.1 admin uncomp akışı ADR'si** — ADR-003 §10.5 B2 forward-reference. `block_comp_on_closed_order` trigger'ı kapalı siparişte ikram değişikliğini yasaklıyor; v5.1'de admin role'üne özel geri-alma akışı ayrı ADR ile açılır. MVP dışı.
- **v5.1 refund ADR** — §10.4.6 + §10.5.2 C7 forward-reference. `payments.amount_cents > 0` CHECK'i refund akışında gevşetilir veya `payment_kind='refund'` ayrı satır modeli tanımlanır. Negatif satır yasağı ilkesi korunacak.
- **Error taxonomy / API error contract ADR'si** — §10.5.2 C6 forward-reference. DB `RAISE EXCEPTION` çıktılarının domain service wrapper'da Türkçe i18n-key'e çevrilmesi; ham mesaj UI'a sızdırılmaz. §12 veya ayrı ADR.
- **ADR-002 sonrası §6.5 users notu güncellemesi** — §6.5 "users tenant-scoped mı global mı, ADR-002 kararına bağlı" cümlesi ADR-002 kabul sonrası netleşir.

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
