# Restoran POS v5 — Proje Anayasası

Bu dosya Claude Code tarafından her oturumda okunur. Projenin değişmez kurallarını tanımlar.

## Proje özeti (bir cümle)

Kendi restoranımda (25 masalı, paket servisli pide/lokanta) çalışan v3 POS'un tüm operasyonel kapsamını koruyup, cloud backend + web + mobil (iOS/Android) mimarisiyle yeniden yazan sistem.

## Ürün sınırı (kapsam kilidi)

**Hedef:** v3'ün kapsamını koru + cloud + mobil. Başta 1 tenant (kendi restoranım), ileride 2-3 işletme daha.

**Hedef değil:** Adisyo'ya rakip olmak, 5-20 şubeli zincirler, multi-region, e-Fatura/yazarkasa, yemek platformu entegrasyonları, QR menü, sadakat programı, combo/reçete yönetimi.

**Scope referansı:** v3 ekranları. v3'te olmayan bir özellik v5'e otomatik eklenmez. v3'te olan bir modülün UI'sini v5.1'e ertelemek kabul — `docs/project-charter.md` MVP/v5.1 ayrımı net.

Kapsam büyümesi talebi geldiğinde: "v3'te vardı mı?" + "v5.0 MVP listesinde mi?" sorularının cevabı hayırsa → yeni ADR ile açıkça gerekçelendirilir veya v5.1+ backlog'a gider. Sessiz kapsam büyümesi yasak.

## Core directives (asla esnetme)

1. **Definition of Done olmadan hiçbir görev kapanmaz.** `docs/engineering/definition-of-done.md`'deki checklist tamamlanmadan "tamam" demek yasak.
2. **Mimari önce: ADR yazılmadan kod yazılmaz.** Yapısal karar → önce `.claude/memory/decisions.md` → sonra kod.
3. **HCI checklist'i her UI değişikliğinde zorunlu.** `docs/hci/pos-checklist.md`. `hci-reviewer` onayı olmadan merge yok.
4. **Kullanıcıya görünen tüm metinler Türkçe ve i18n-key üzerinden.** Hardcoded string yasak. `t('order.sendToKitchen')`.
5. **Ana context'i koru.** Araştırma gereken her şey için sub-agent kullan. Main context kod yazmak içindir.
6. **Kapsam kilidi.** Yeni "güzel olur" özelliği gelirse: önce ADR ile gerekçelendir veya v5.1 backlog'una at.

## Proje dili

- **Kod içi**: İngilizce (değişken, fonksiyon, yorum, commit)
- **Kullanıcıya görünen her şey**: Türkçe (UI, hata, log, yazıcı çıktısı)
- **Domain terminolojisi**: `docs/domain/glossary.md` tek kaynak. "Order" değil "sipariş", "bill" değil "adisyon", "table" değil "masa".

## Teknoloji stack'i (lock)

| Katman | Seçim | Neden |
|---|---|---|
| Cloud API | Node.js 22 + Express 5 + TypeScript strict | Tek dil ekosistemi |
| Cloud DB | PostgreSQL 17 | `tenant_id` kolonlu (multi-tenant'a hazır, ama MVP tek tenant) |
| Web uygulaması | React 18 + Vite + TypeScript + Tailwind | Tarayıcıdan açılır, kasiyer/müdür/mutfak kullanır |
| Mobil | React Native + Expo SDK 53+ (Dev Client) | Garson için iOS + Android tek kod |
| Print Agent | Küçük Node.js servisi (restoran PC'sinde Windows hizmeti) | Cloud'dan print job çeker, ESC/POS basar (v3'teki StoreBridge'in yerini alır) |
| Realtime | Socket.IO | WebSocket + fallback |
| Auth | JWT (access + refresh), bcrypt password hash | Başta tek tenant, role: admin/cashier/waiter/kitchen |
| Validation | zod (schema + type inference) | Runtime + compile-time tip güvencesi |
| Host | Hetzner Cloud, Almanya (CX22 → CX32) | Ucuz, KVKK uyumlu |
| Monorepo | pnpm workspaces + Turborepo | Paylaşımlı paketler için |
| Test | Vitest (unit/integration), Playwright (E2E web), Detox (mobile) | |

**Not:** Electron yok. Lokal SQLite yok. Sync engine yok. v3'ten gelen Electron/SQLite altyapısı yeniden yazılmaz — referans materyal olarak okunur, yeni mimariye göre temiz yazılır.

## Repo yapısı

```
restoran-pos-v5/
├── apps/
│   ├── api/              Cloud backend (Express)
│   ├── web/              Web UI (kasiyer, müdür, mutfak)
│   ├── mobile/           Garson uygulaması (RN + Expo)
│   └── print-agent/      Restoran PC'sinde çalışan yazıcı servisi
├── packages/
│   ├── shared-types/     zod schemas, TS tipleri (her app import eder)
│   ├── shared-domain/    Pure domain fonksiyonları (sipariş hesabı, KDV, vs.)
│   └── shared-ui/        Paylaşılan React component'leri (web + mobile bazı)
├── docs/
├── .claude/
└── ...
```

## Nasıl çalışırız

- **Yeni feature**: `architect` sub-agent ADR yazar → `implementer` kod yazar → `qa-engineer` test yazar → `hci-reviewer` UI denetler → merge
- **Araştırma**: daima sub-agent. "use a subagent to investigate X"
- **UI değişikliği**: `hci-reviewer` + `turkish-ux-reviewer` onayı zorunlu
- **DB şema değişikliği**: `db-migration-guard` migration script'i yazmadan merge yok
- **Auth/payment/PII dokunan değişiklik**: `security-reviewer` zorunlu
- **Plan Mode (Shift+Tab)**: Birden fazla dosyayı etkileyen her değişiklikte zorunlu

## Routing (Claude Code oturum başında okur)

- Aktif sprint planı: `.claude/plans/active-plan.md`
- Mimari karar kaydı (ADR): `.claude/memory/decisions.md`
- Türkçe terminoloji: `.claude/memory/turkish-glossary.md`
- Çalışma notları: `.claude/memory/scratchpad.md`
- Proje anayasası (tek sayfa): `docs/project-charter.md`

## Standartlar

@import docs/engineering/code-style.md
@import docs/engineering/test-strategy.md
@import docs/engineering/git-workflow.md
@import docs/engineering/definition-of-done.md
@import docs/hci/pos-checklist.md

## Compact davranışı

Auto-compaction sırasında SIRF şunları koru:
- Aktif görev planı ve Definition of Done durumu
- Son 5 commit ve gerekçeleri
- Çözülmemiş hata mesajları
- Açık TODO'lar
- Değiştirilmiş dosyaların tam listesi

Terk et: başarılı exploration attempt'leri, cache'den okunan dosya içerikleri, geçici debug log'ları.

## Asla yapmayacaklarımız

- **Asla**: kullanıcı verisini (sipariş, müşteri, ödeme) prod DB'de test amaçlı silmek
- **Asla**: migration'sız şema değişikliği deploy etmek
- **Asla**: Caller ID verisini KVKK onayı olmadan log'lamak
- **Asla**: ödeme tutarını float/double ile tutmak (integer minor unit — kuruş)
- **Asla**: `any` tipini bırakmak (TypeScript strict mode)
- **Asla**: "TODO: fix later" bırakıp merge etmek — ya şimdi çöz ya issue aç
- **Asla**: v3'ten kod kopyala-yapıştır. v3 referans materyaldir, kod değil

## v3'ten taşıma kuralı

v3 kodu (`d:/dev/restoran-pos-v3/`) **yalnız referans**. Aşağıdaki akış:
1. v3'te çalışan bir özelliği anla (kod + davranış)
2. v5'te mimari olarak nasıl olmalı, ADR yaz
3. v5'te TypeScript ile sıfırdan yaz
4. v3 testlerini (behavioral) v5'e port et

Copy-paste bulunursa PR reddedilir.
