# Session 99 Kickoff — prod-dalgası + mobil porsiyon/özellik + görsel-tazeleme + menü-zenginleştirme + kategori-atama-UI (→ S100: Apple hesabı + iOS/APK dalgası + cutover)

> **Giriş kapısı:** `docs/context-anchor.md` §2 → bu dosya.
> **ADR'ler:** ADR-026 Amd3 + Amd4/K8 · ADR-012 F3d · ADR-024 Amd1 · ADR-026 Amd2 (decisions.md).
> **Son güncelleme:** 2026-07-18 (Session 99 kapanış).

## Session 99 ne yaptı (ÖZET)

**4 PR (#392-395), main+prod `e6a998b` (head 047 sabit, migration YOK). Web ×2 prod-deploy; mobil kod EAS-dalgası bekliyor.**

1. **Prod-dalgası:** S98'de merge'li #387 (ADR-024 Amd1 dine-in-cancel audit-paritesi) + #388 (ADR-026 Amd2 bağlantı-UX) → prod'a indi (`1532268`; migration yok). **#387 canlı davranışsal smoke DB-kanıtlı** (Chrome-prod: masa-kartı iptal → `order.cancelled {auto:false}` audit).
2. **🍎 Apple:** kimlik-doğrulama belgeleri **gönderildi** (Apple manuel identity-verification; onay ≤1-2 iş günü bekleniyor).
3. **📱 APK `ebf43e53`** garson telefonuna kuruldu (yeşil-nokta canlı) + **kiosk kuruldu** + cutover **24-26 Tem**'e daraltıldı (#392).
4. **#393 — ADR-026 Amd3 (mobil porsiyon+özellik+not):** `LineDetailSheet` + cart 5-tuple + tam-payload. hci ×2-tur (3 BLOCKER yamalı) + İlhan iOS-Expo-Go canlı smoke + DB kanıt. **EAS-dalgası bekliyor.**
5. **#394 — ADR-026 Amd4+K8 (görsel tazeleme mobil+web):** tema token + **pastel kategoriler** (İlhan Adisyo-ref revize; tek-accent→pastel, K8 kayıtlı) + eşit-grid + krem-zemin + iOS safe-area + web CategoryTabs pastel. hci ×5-tur (pastel min 9.45:1). **Web prod'da**; mobil EAS-dalgası bekliyor.
6. **🎯 Menü zenginleştirme:** İlhan Adisyo'ya girdi, Claude read-only çekti (⚠️ near-delete kazası dersi). 12 pide Tam→Adisyo + **Bir buçuk (1.5×)** + **YUMURTA→PİDELER kategorisi** (effective-resolver UNION kod-teyitli) + Kaşarlı-lahmacun 170→180. **prod'da canlı.**
7. **#395 — ADR-012 F3d (kategori-atama UI):** kategori 3-nokta → "Özellik ata" → `CategoryAttributeModal` (orphan endpoint UI'ya bağlandı). hci ×2-tur + turkish-ux + i18n + kapsam. **Web prod'da.**

**DESEN:** branch-first + ADR-önce (3 amendment + 1 F-plan-notu) + cerrahi + gate'ler (hci ×N-tur / turkish-ux / i18n / kapsam) + typecheck/lint + CI-yeşil + squash-merge + web-prod-deploy (migration yok → shared-types+web build, pm2-yok). Mobil test-runner yok → canlı-cihaz + kod-teyit.

## ▶ Session 100 işleri

### 1. [USER] Apple onayı → iOS zinciri + taze APK (TEK DALGA)
- Apple "Welcome to the Apple Developer Program" e-postası gelince: `eas device:create` (garson iPhone UDID) → `eas build --platform ios --profile production` (ad-hoc IPA) → kurulum → prod smoke (runbook `mobile-release.md` §11).
- **AYNI DALGADA taze Android APK** (Amd3 porsiyon/özellik + Amd4 pastel-görsel mobile taşınır; şu anki APK `ebf43e53` bunları İÇERMEZ). Garson cihazında yeni-build sonrası **Ayarlar→ürün-sütunu** kontrol (Amd4 K5 persist-3 korunur).

### 2. [USER] Canlı smoke (kasa)
- Pide satırı → Tam/Bir buçuk + YUMURTA özelliği görünüyor mu.
- Kategori 3-nokta → "Özellik ata" → grup ekle/sil (ör. Izgara'ya "az pişmiş").

### 3. [PLANLAMA] Cutover günü — 24-26 Tem (Apple'a bağlı)
- ADR-031 go/no-go (iki-platform). `cutover-gunu-runbook.md` koş: test-verisi temizliği (`cutover-test-temizligi.md`) + order_no-1'den + Adisyo-bırakma.

### 4. [KOD, opsiyonel]
- Chip'ler (eski-oturum: web-i18n / print-agent / caller-bridge / SplitPayment-i18n — çoğu içerik-kapandı, UI'dan düşürülebilir).
- v5.1 (`docs/audit/low-nit-devir.md`) · 91 unused-types.
- turkish-ux notu: kategori-modal boş-durum ("Önce Özellikler'den tanımla")'ya `/tanimlamalar/ozellikler` link (küçük UX).

## Notlar
- **Prod deploy (web-only, migration yok):** `git push prod` → sunucuda pull + `pnpm install --frozen-lockfile` + **shared-types build** + `pnpm --filter web build` (statik, pm2-restart YOK). Doğrulama: health + web 200. (S99'da ×2 uygulandı.)
- **Lokal stack:** PG detach-reçetesi + `pnpm migrate` head-kontrolü ([[feedback_local_dev_db_migration_drift]]); launch.json `api`(3001)/`metro`(8081)/`web`(5173). Dev login: `garson@local.test`/`garson1234` · `admin@local.test`/`admin1234`.
- **Adisyo veri-çekme dersi:** canlı third-party sistemde read-only çıkarım YAP ama **detay/düzenleme formu AÇMA** (silme/güncelle butonları bitişik, popup layout kaydırır → near-delete kazası oldu, İptal'le kurtarıldı). Liste/get_page_text + JS-input-oku güvenli; tercih: Excel-export.
- **effective attribute resolver:** `findEffectiveForProduct` (packages/db productAttributeGroups.ts) product+category `UNION` DISTINCT-ON-id (product kazanır) → kategori-atama tüm ürünlere yansır. Web+mobil aynı endpoint.

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 100)

```
Restoran POS v5 — Session 100. Önce oku: docs/context-anchor.md §2 + CLAUDE.md + .claude/plans/session-99-kickoff.md (+ MEMORY.md pointer'ları).

DURUM: main+prod `e6a998b` (head 047, migration yok). S99'da CANLI/PROD'DA: #387 audit-paritesi + menü-zenginleştirme (12 pide Bir buçuk 1.5× + YUMURTA→PİDELER kategorisi + Adisyo-fiyatları) + web görsel-tazeleme pastel-kategoriler (#394) + kategori-atama-UI 3-nokta (#395 ADR-012 F3d). MOBİL KOD HAZIR ama cihazda YOK: Amd3 (porsiyon/özellik/not #393) + Amd4 (pastel görsel #394) → sonraki EAS dalgasını bekliyor. Apple Developer: kimlik-belgeleri gönderildi, onay bekleniyor.

BUGÜN başlamak istediğim: [SEÇ — örn. "Apple onayı geldi → eas device:create + ad-hoc IPA + iPhone kurulum + AYNI DALGADA taze APK (Amd3+Amd4 mobile) (runbook §11)" / "cutover gününü sabitle (24-26 Tem) + runbook koş" / "canlı-smoke: kasada pide porsiyon/özellik + kategori-atama" / "v5.1 planlaması / chip temizliği"].

Desen: branch-first + ADR-önce(yapısal) + cerrahi + gate'ler (hci/kapsam/turkish-ux/i18n) + tam-suite(lokal pos_test, DATABASE_URL) + CI-yeşil + squash-merge + web-prod-deploy(migration-yok: shared-types+web build). Mobilde test-runner yok → canlı-cihaz doğrulama şart. Türkçe yanıt.
```
