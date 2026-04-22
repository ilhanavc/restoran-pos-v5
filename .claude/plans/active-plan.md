# Aktif Plan — Phase 0: Bootstrap & Foundation

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince tamamen yenilenir.

## Faz: 0 (Bootstrap & Foundation)

Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap" bölümü. Phase 0 sonunda Phase 1'e (Core Domain + Auth) geçilir.

## Hafta: 1 / 2 (Bootstrap)

### Hafta 1 hedefi (cümle)

Kod yazmadan önce proje iskeletini sağlam kurmak + v3'teki mevcut özelliklerin referans dokümantasyonunu çıkarmak. Hafta sonunda v3'ün her modülü için "v5'te nasıl yapılacak" notu, monorepo iskeleti, 3 ADR, CI yeşil ve hello endpoint ayakta olur.

### Görevler (sırayla)

#### 1. Proje anayasası doğrulaması
- **Durum**: ⏳ İlhan doğrulaması bekliyor
- **Atanan**: İlhan
- **Çıktı**: `CLAUDE.md`, `docs/project-charter.md`, `docs/domain/personas.md` okundu, v5.0 MVP kapsam listesi onaylandı
- **DoD**: Commit: `docs(charter): approve v5.0 scope`

#### 2. v3 reference dokümantasyonu (kritik adım)
- **Durum**: 🔄 %67 (10/15 modül)
- **Atanan**: İlhan (v3 uzmanı) + Claude Code (dokümantasyon yardımı)
- **İlerleme**:
  - `modules.md` — **10/15 modül tamam** (1. Ayarlar, 2. Auth/Login, 3. Menü, 4. Masa, 5. Müşteri, 6. Caller ID, 7. Sipariş, 8. KDS, 9. Yazıcı, 10. Ödeme). Kalan: Raporlar, Rezervasyon, Stok, Audit Log, Yedek
  - `domain-rules.md` — ⏳ boş
  - `printer-notes.md` — ⏳ boş
  - `data-model.md` — ⏳ boş
  - `pain-points.md` — ⏳ boş (v3 bulguları mimari sinyal #3 bu dosyaya gidecek)
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

### Sıradaki oturum (Session 2) açılış görevi

- **Modül 3 — Menü** röportajı (v3 reference görev 2 devam)
- v3 dizini erişimi aktif: `D:\dev\restoran-pos-v3\` — read-only, copy-paste yasak
- Standart 4 soru (A/B/C/D), üçlü v5 tasnifi, bağımlılıklar tablo formatında
- Oturum açılışı için `scratchpad.md` → "Session 2 starter prompt" bölümünü kullan

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
