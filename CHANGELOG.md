# Changelog

Bu dosya her önemli değişikliği tarih sırasıyla kaydeder. `/phase-done` ve `/new-adr` slash command'ları bu dosyayı otomatik günceller.

Format: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/).

Sürüm şeması: Phase 0 → 0.0.x, Phase 1 → 0.1.x, pilot → 0.9.x, prod → 1.0.0.

## [Unreleased]

### Session 10 (2026-04-24) — ADR-003 Bölüm 7-9 onaylandı

**Added:**
- ADR-003 Bölüm 7 (Snapshot İnvaryantı) — verbatim onay, Edit kilit
- ADR-003 Bölüm 8 (Soft vs Hard Delete) — verbatim onay, §8.4 ON DELETE RESTRICT gerekçesi + §8.5 default filter kuralı (tool-agnostik repository helper) eklendi
- ADR-003 Bölüm 9 (Enum Kullanımı) — verbatim onay, §9.1 enum listesi final (7 enum), §9.2.1 4 domain kararı (delivery, equal_split, payment_type değişmedi, print_job_status.cancelled), §9.3 forward-only 4 kural (ADD/REMOVE/REORDER/RENAME), §9.5 review gate (a/b/c)
- `CLAUDE.md` Core Directive #7 "Cerrahi değişiklik" (Karpathy CLAUDE.md §3 adapt)
- `docs/context-anchor.md` (yeni Claude.ai sohbetleri için yapıştırılabilir tutarlılık çapası)

**Changed:**
- ADR-003 §9.3 ADD VALUE örneği `order_status 'delivered'` → `order_type 'catering'` (delivery enum kararı sonrası tutarlılık)
- ADR-003 §9.5(b) db-migration-guard referansı somutlaştı (`.claude/agents/db-migration-guard.md` atıf + pre-commit hook ADR-001 bağı)
- ADR-003 §9.2.1 `order_type.delivery` maddesine v3→v5 geçiş notu eklendi

**Açık borç (yeni):**
- v3→v5 takeaway/delivery backfill ADR'si — Phase 5 geçiş planında yazılacak; `active-plan.md` Follow-up'ta kayıtlı

**Next:** ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) — Session 11

**Session commits:** `4289bde`, `0f31fce`, + Bölüm 9 onay commit'i (bu session)

### Session 8 (2026-04-22) — Görev 1 kapandı, ADR-003 sırada

**Added:**
- Charter v5.0 kapsam onaylandı (Phase 0 Görev #1 ✅, commit `72e00c5`)
- `docs/project-charter.md` → "Kapsam değişikliği nasıl belgelenir" paragrafı — erteleme / mimari / tasarım ADR ayrımı kuralı
- `docs/domain/personas.md` → terminoloji notu: yasal Z raporu (yazarkasa) vs POS günlük kapanışı ayrımı

**Changed:**
- Phase 3 roadmap ↔ MVP listesi tutarsızlıkları giderildi (iskonto v5.1'e ertelendi, raporlar MVP ile tam uyumlu)
- Personas.md "Z raporu" → "günlük kapanış raporu (POS)" (2 satır)
- İskonto placeholder'ları: `ADR-XXX` → `commit a6d746e` (erteleme kapsam kararı, tasarım ADR'si v5.1'de)
- `active-plan.md` Görev 1 ✅, ADR sırası netleştirildi (ADR-003 → ADR-001 → ADR-002)
- `scratchpad.md` Session 8 kapanış + Session 9 starter prompt eklendi

**Next:** ADR-003 DB Şema İlkeleri (Session 9) — `architect` + `db-migration-guard`

**Session commits:** `72e00c5`, `cdb3deb`

### Session 1 (2026-04-22)

**Added:**
- v3 reference infrastructure: `docs/v3-reference/modules.md` (Modül 1 Ayarlar + Modül 2 Auth/Login tam dolu, 15 modüllük sıra belirlendi)
- `CLAUDE.md` → yeni "v3 referans erişimi" bölümü (read-only, copy-paste yasak, kaynak etiketleme kuralları: Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- `.claude/skills/simple-first-ui/SKILL.md` — iskelet (detay Phase 0 sonunda dolacak)

**Changed:**
- `docs/hci/pos-checklist.md` — yeni "Basit UI & Sıfır Yapılandırma" bölümü (iki seviye ayarlar gate + zero-config gate + v3 Yazıcı Detayı anti-örneği)
- `CLAUDE.md` — v3 yol tutarlılığı (`d:/dev/restoran-pos-v3/` → `D:\dev\restoran-pos-v3\`)
- `.claude/plans/active-plan.md` — ADR İzleme bölümü (ADR-004 Print Agent Phase 1 notu), Session 2 açılış görevi, Görev 2 ilerleme durumu (2/15 modül)
- `.claude/memory/scratchpad.md` — ADR-002 açık kararlar + Session 1 kapanış özeti + v3 mimari sinyaller + Session 2 starter prompt

**Architectural signals (v3 kod araştırması sonrası):**
- Garson rolü v3'te yalnız `/tables` route — sipariş yönetimi masa detayı içinde entegre (v5 Modül 4 tasarımına sinyal)
- Rol matrisi v3'te tek merkezi yerde (`tD` nav array) — v5'te korunacak config-driven yaklaşım
- Backend route guard varlığı doğrulanamadı — v5'te kesinlik (her endpoint'te rol kontrolü), `pain-points.md` adayı
- Şifre reset v3'te admin-manuel-reset modeli kodlanmış — hibrit ADR-002 önerimizle uyumlu

**Session commits:** `b4d308b`, `25e395f`, `259b102`, `e2a86fb`

### Added
- Phase 0 bootstrap paketi (CLAUDE.md, sub-agent'lar, skill'ler, engineering docs)
- v4'ten taşınan altyapı: architect/implementer/qa/security/hci/turkish-ux/db-migration-guard sub-agent'ları
- v4'ten taşınan skill'ler: escpos-printer, caller-id-bridge, hci-pos-checklist, turkish-restaurant-domain, multi-tenant-postgres (MVP tek tenant notuyla), react-native-expo-setup, hetzner-deployment
- Engineering docs: code-style, definition-of-done, git-workflow, test-strategy
- Slash command'lar: `/new-adr`, `/phase-done`
- Hook'lar: ADR hatırlatması, commit format kontrolü, oturum açılış notu
- `docs/domain/personas.md` — 4 rol (admin, kasiyer, garson, mutfak) + yetki matrisi
- `docs/project-charter.md` — v5.0 MVP / v5.1 / v5.2+ / non-goals ayrımı
- Phase roadmap (5 phase, 23 hafta ≈ 5.5 ay)

### Changed
- **Kapsam revizyonu** (charter v2): v3'ün gerçek modül kapsamına göre charter yeniden yazıldı
- MVP dondurulmuş özellik listesi: auth + masa + menü + sipariş + mutfak + ödeme + Caller ID + Print Agent + temel raporlar + web + mobile + audit/yedek backend
- v5.1'e ertelendi: detaylı raporlar, stok, rezervasyon, müşteri CRM, audit/yedek/sürüm notları/mobil eşleştirme UI'leri
- Kalıcı non-goal olarak işaretlendi: çoklu şube (v5.2'de değerlendirilir), e-Fatura, yazarkasa, yemek platformları, QR menü, sadakat, combo
- StoreBridge → v5'te Print Agent olarak yeniden adlandırıldı (aynı iş, temiz mimari)
- Proje özeti: "30 masalı" → "25 masalı pide/lokanta" (v3 ekranlarından doğrulandı)

### Removed
- v4'ten: Electron bağımlılığı (desktop app → web UI)
- v4'ten: Lokal SQLite (cloud PostgreSQL tek DB)
- v4'ten: CRDT/sync engine ve ilgili skill'ler (`better-sqlite3-electron`, `sync-crdt-patterns`)
- v4'ten: electron-specialist, sync-engine-specialist sub-agent'ları
- v4'ten: 22+ v4 ADR'si (v5 kendi kararlarını yazacak)
- v4'ten: 5 journey, 5 persona, event-storming dokümanları (MVP kapsamına uygun değil)
- v4'ten: `sync-schemas` slash command'ı (tek DB, sync yok)

### Timeline
- 2026-04-22: İlk charter (kapsam yanlış, çok dar)
- 2026-04-22: Charter v2 — v3 ekran görüntüleri incelendi, kapsam v3 seviyesine güncellendi, MVP/v5.1 ayrımı yapıldı
- 2026-04-22: Session 1 — Modül 1 Ayarlar ve Modül 2 Auth/Login röportajları tamamlandı, v3 kodu araştırması ilk kez yapıldı, stratejik kararlar (yazıcı sıfırdan + basit UI prensibi) kaydedildi
