# Restoran POS v5 — Proje Anayasası

Bu dosya Claude Code tarafından her oturumda okunur. Projenin değişmez kurallarını tanımlar.

## Proje özeti (bir cümle)

Kendi restoranımda (25 masalı, paket servisli pide/lokanta) canlıda çalışan, v3'ün operasyonel kapsamını cloud + web + mobil (iOS/Android) mimariyle yeniden yazan POS'u; küçük/orta restoranların kendi kaydolup deneyip abone olduğu, **satılan bir ürüne** dönüştüren sistem.

## Ürün sınırı (kapsam kilidi) — ADR-046 (2026-11-15)

**Hedef:** v3'ün operasyonel kapsamı + cloud + web + mobil, kendi restoranımda sahada kanıtlanmış hâliyle, **küçük/orta restoranlara satılan bir ürün.** Müşteri kendi kaydolur, 15 gün ücretsiz dener, ödeme yoksa hesabı kilitlenir; destek uzaktan, ürün sahibinden. Şubesi olan müşteride her şube ayrı hesaptır. **Kendi restoranım ilk ve referans müşteridir — onun canlı iş akışı hiçbir yeni işin kurbanı olmaz.**

**Hedef değil:** rakiplerin (Adisyo vb.) özellik listesini kopyalamak / özellik yarışı, çok şubeli işletme yönetimi (şubeler arası rapor, merkezi menü), multi-region, **restoranın satışları için** e-Fatura/e-Arşiv veya yazarkasa entegrasyonu, QR menü, sadakat programı, combo/reçete yönetimi.

**Scope referansı:** (a) v3 kapsamı + (b) **ADR-046 K3 listesi** (satılan ürünün kapalı kalem listesi: kayıt, e-posta doğrulama, şifre sıfırlama, abonelik/deneme/kilit, tahsilat, platform yönetimi, veri yaşam döngüsü, sözleşme onayı, 2FA, müşteri ayar yüzeyleri, satış öncesi sağlamlık işleri) + (c) **PUSULA sırası** (`docs/roadmap-v51-coklu-sube.md`). Yemek platformu entegrasyonları hedefte ama sırası en sonda. "v5.0 MVP listesi" artık yalnız tarihsel referans.

Kapsam talebi geldiğinde dört soru, sırayla: **v3'te var mı? · K3 listesinde mi? · "Hedef değil"de mi? (evetse RED) · PUSULA'da sırası geldi mi?** v3'te de K3'te de yoksa → DUR: ya ADR-046'ya gerekçeli amendment ya backlog, ürün sahibine sorulur. K3'teki kalem de kodlanmadan önce **kendi tasarım ADR'sini** ister. "Sırası gelmedi" ≠ "kapsam dışı". Sessiz kapsam büyümesi yasak.

## Core directives (asla esnetme)

1. **Definition of Done olmadan hiçbir görev kapanmaz.** `docs/engineering/definition-of-done.md`'deki checklist tamamlanmadan "tamam" demek yasak.
2. **Mimari önce: ADR yazılmadan kod yazılmaz.** Yapısal karar → önce `.claude/memory/decisions.md` → sonra kod.
3. **HCI checklist'i her UI değişikliğinde zorunlu.** `docs/hci/pos-checklist.md`. `hci-reviewer` onayı olmadan merge yok.
4. **Kullanıcıya görünen tüm metinler Türkçe ve i18n-key üzerinden.** Hardcoded string yasak. `t('order.sendToKitchen')`.
5. **Ana context'i koru.** Araştırma gereken her şey için sub-agent kullan. Main context kod yazmak içindir.
6. **Kapsam kilidi.** v3'te ve ADR-046 K3 listesinde olmayan yeni "güzel olur" özelliği gelirse: önce ADR ile gerekçelendir veya backlog'a at.
7. **Cerrahi değişiklik.** Her değişen satır kullanıcının talebine doğrudan izlenebilir olmalı. Bitişik kodu "iyileştirme", ilgisiz refactor, stil düzeltmesi yasak. Kendi değişikliğinin ürettiği orphan (kullanılmayan import/fonksiyon) temizlenir; önceden var olan dead code sorulmadan silinmez — fark edilirse bildirilir.

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
| Mobil | React Native + Expo SDK 54 (**managed** — Expo Go + Metro LAN dev-loop; `ios/`/`android/` klasörü YOK, dev-client DEĞİL) | Garson için iOS + Android tek kod |
| Print Agent | Küçük Node.js servisi (restoran PC'sinde Windows hizmeti) | Cloud'dan print job çeker, ESC/POS basar (v3'teki StoreBridge'in yerini alır) |
| Realtime | Socket.IO | WebSocket + fallback |
| Auth | JWT (access + refresh), bcrypt password hash | Başta tek tenant, role: admin/cashier/waiter/kitchen |
| Validation | zod (schema + type inference) | Runtime + compile-time tip güvencesi |
| Host | Hetzner Cloud, Almanya (CX22 → CX32) | Ucuz, KVKK uyumlu |
| Monorepo | pnpm workspaces + Turborepo | Paylaşımlı paketler için |
| Test | Vitest (unit/integration), Playwright (E2E web); mobil E2E (Detox/Maestro) → v5.1, henüz kurulu değil | |

**Not:** Electron yok. Lokal SQLite yok. Sync engine yok. v3'ten gelen Electron/SQLite altyapısı yeniden yazılmaz — referans materyal olarak okunur, yeni mimariye göre temiz yazılır.

## Repo yapısı

```
restoran-pos-v5/
├── apps/
│   ├── api/              Cloud backend (Express)
│   ├── web/              Web UI (kasiyer, müdür, mutfak)
│   ├── mobile/           Garson uygulaması (RN + Expo, managed)
│   ├── print-agent/      Restoran PC'sinde çalışan yazıcı servisi
│   └── caller-bridge/    Caller ID köprüsü (.NET 8 Windows servisi, ADR-016)
├── packages/
│   ├── shared-types/     zod schemas, TS tipleri (her app import eder)
│   ├── shared-domain/    Pure domain fonksiyonları (sipariş hesabı, KDV, vs.)
│   └── db/               Kysely şema tipleri, repository'ler, migration'lar, withTenant
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

## v3 referans erişimi

- **v3 proje kodu:** `D:\dev\restoran-pos-v3\` (v5 dışında, kardeş konum)
- **Erişim READ-ONLY** — hiçbir dosya düzenlenmez, silinmez
- **v3'ten KOD SATIRI v5'e taşınmaz** (copy-paste yasağı v3 için de geçerli)
- v3'ten çıkarılan davranış/kural bilgisi `docs/v3-reference/` altına **kendi cümlelerinle** özet olarak yazılır
- v3 dosyasına referans verirken tam yol formatı: `D:\dev\restoran-pos-v3\server\routes\orders.js:42`
- **Röportaj sırası:** önce kullanıcıya davranışsal soru → gerekirse v3 koduna bakıp teyit → sonra yaz
- **Kod analizinin sınırı:** sadece kodda görünen problemleri bulur (type hatası, eski API, dead code, duplicated logic). Davranışsal / runtime / UX sorunları kod okumaz — bunları kullanıcı anlatmalı.
- **İki kaynağı karıştırma, ayrı etiketle:**
  - `Kodda tespit:` — grep / dosya okuma sonucu
  - `Kullanıcı gözlemi:` — kullanıcıdan gelen
  - `Doğrulanmamış:` — henüz teyit edilmemiş

## Asla yapmayacaklarımız

- **Asla**: kullanıcı verisini (sipariş, müşteri, ödeme) prod DB'de test amaçlı silmek
- **Asla**: migration'sız şema değişikliği deploy etmek
- **Asla**: Caller ID verisini KVKK onayı olmadan log'lamak
- **Asla**: ödeme tutarını float/double ile tutmak (integer minor unit — kuruş)
- **Asla**: `any` tipini bırakmak (TypeScript strict mode)
- **Asla**: "TODO: fix later" bırakıp merge etmek — ya şimdi çöz ya issue aç
- **Asla**: v3'ten kod kopyala-yapıştır. v3 referans materyaldir, kod değil

## v3'ten taşıma kuralı

v3 kodu (`D:\dev\restoran-pos-v3\`) **yalnız referans**. Aşağıdaki akış:
1. v3'te çalışan bir özelliği anla (kod + davranış)
2. v5'te mimari olarak nasıl olmalı, ADR yaz
3. v5'te TypeScript ile sıfırdan yaz
4. v3 testlerini (behavioral) v5'e port et

Copy-paste bulunursa PR reddedilir.
