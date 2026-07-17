# Session 98 Kickoff — iOS pilota alındı + resync sağlamlaştırma (→ S99: Apple hesabı + ad-hoc build)

> **Giriş kapısı:** `docs/context-anchor.md` §2 → bu dosya.
> **iOS runbook:** `docs/ops/mobile-release.md` §11 · **ADR'ler:** ADR-031 Amendment 1 + ADR-026 Amendment 1 (decisions.md sonu)
> **Son güncelleme:** 2026-07-16 (Session 98 kapanış).

## Session 98 ne yaptı (ÖZET)

**🎯 iOS PİLOTA ALINDI + gerçek-iPhone'da uçtan uca canlı doğrulandı.** 2 PR (#382/#383 squash), main **`8b454e8`**; **prod DEĞİŞMEDİ** (`126434e`, head 047 — bu oturum tamamen mobil/doc).

1. **#382 — ADR-031 Amendment 1:** iOS garson uygulaması pilot kapsamına (iki-platform pilot). Dağıtım **EAS ad-hoc/internal** (Store/TestFlight değil; `eas device:create` UDID + doğrudan kurulum, Apple review yok, ≤100 cihaz). **Kod SIFIR** — `eas.json` 3 profil `distribution:"internal"` zaten iOS-ad-hoc-hazır; `bundleIdentifier com.restoranpos.garson` mevcut. + `mobile-release.md` §11 iOS runbook + kök `app.json` boş-stub silindi.
2. **Expo Go iOS canlı smoke ✓✓ (Amd1 DoD işaretli):** login/masalar/sipariş→mutfak/iOS↔web-iki-yön-realtime/çevrimdışı-bandı/arka-plan-resync. Expo Go SDK-54 uyumu sorunsuz. Lokal engeller: **pos_dev head 044→047 migrate edildi** (42703 idempotency_key; ders `feedback_local_dev_db_migration_drift`) + lokal admin şifresi seed'e resetlendi (`admin1234`).
3. **#383 — ADR-026 Amendment 1 (resync sağlamlaştırma, İlhan talebi):** K1 focus-refetch AÇIK · K2 board 45sn emniyet-poll (yalnız ön-plan) · K3 AppState→socket-dürtme · RefreshControl lokal-pull-state (takılı-spinner fix, İlhan screenshot) · **K6 hci-BLOCKER:** `isError`→`isLoadingError` (cache'li refetch hatası board/menü silmez). hci ×2-tur APPROVED. **Canlı-drill:** API-kes→kartlar durdu→API-aç→kendine geldi.
4. Chip +2: `task_af3194b4` (bayat RN skill) · `task_4ead6390` (bağlı-göstergesi + soğuk-başlangıç UX).

**DESEN:** branch-first + ADR-önce (2 amendment) + cerrahi + hci-gate (blocker→fix→re-approve) + kapsam-kilidi + CI-yeşil + squash-merge + **gerçek-cihaz canlı doğrulama** (mobilde test-runner yok — `test: echo ok` stub; regresyon kilidi = canlı-drill + typecheck/lint).

## ▶ Session 99 işleri

### 1. [USER] Apple Developer üyeliği — iOS'un tek kalan blokörü
- ~$99/yıl, **Individual** enrollment: <https://developer.apple.com/programs/enroll/> (Apple ID + 2FA şart; onay çoğunlukla <48 saat). Adım-adım: `mobile-release.md` §11.2. Claude hesap açamaz/ödeme giremez.

### 2. [USER+Claude] Üyelik gelince: ad-hoc build zinciri (runbook §11.3-11.8)
- `eas device:create` (her garson iPhone'u) → `eas build --platform ios --profile production` (ilk build'de EAS Apple-hesabına bağlanır, credentials'ı EAS üretir/saklar) → install-linki/QR ile kurulum → **prod smoke** (§11.8: §9 Android maddeleri + iOS'a özgü arka-plan-resync + çevrimdışı-bandı).
- **Aynı işe birleştir:** yeni **Android APK dalgası** (#383 resync-davranışını canlı garson-telefonuna taşır; aynı keystore, üstüne-kurulum).

### 3. [PLANLAMA] Pilot/cutover-günü — ADR-031 go/no-go (artık iki-platform)
- Kasiyer-kiosk + test-verisi temizliği + `order_no` 1'den + Adisyo-bırakma takvimi (S91 kickoff cutover-planı referans).

### 4. [KOD, opsiyonel]
- Chip'ler: `219e7c0a` dine-in-cancel-audit · `af3194b4` bayat-skill · `4ead6390` bağlantı-UX.
- v5.1-planlama (`docs/audit/low-nit-devir.md`) · 91 unused-exported-types.

## ▶ S98-DEVAMI'NDA EK BİTENLER (2026-07-17, aynı oturum — 6 PR #385-390, main `b8e3795`)

- **Cutover kararları kilitlendi (#386):** hedef 20-26 Tem · iOS-beklenir/iki-platform · kasa=dükkan-PC-Chrome-kiosk · temiz-başlangıç-EVET. Runbook güncel (#385) + **ön-hazırlık paketi (#390):** `cutover-test-temizligi.md` (tx-SQL) + `kasiyer-kiosk-kurulum.md`; **order_no sayacı GÜNLÜK → sequence-reset kalemi düştü.**
- **#387 ADR-024 Amd1** dine-in-cancel audit-paritesi (chip 219e7c0a ✓; security-APPROVED; **PROD-DALGASI BEKLİYOR**) · **#388 ADR-026 Amd2** bağlantı-noktası+soğuk-başlangıç-UX (chip 4ead6390 ✓; hci-×2-tur; K1a eşikli-durum-makinesi; exceptions.md ilk-giriş; **build-dalgası bekliyor**) · **#389** RN-skill gerçeklik-eşitleme (chip af3194b4 ✓).
- **APK hazır** (EAS `4d1b5e53`, #383-resync dahil; QR teslim edildi — kurulum [USER]). **Apple: ödeme yapıldı, "Enrollment Pending"** (aynı Apple-ID, başka-iPhone'dan; e-posta ≤48s; kendi-telefondaki "Enroll Now" = cache, İKİNCİ KAYIT BAŞLATMA).
- Araç-dersleri: eski-oturum chip'leri programatik dismiss edilemez (UI'dan düşür) · `expo start` tsconfig'i kirletir (commit-öncesi checkout) · hci-stall→SendMessage-dürtme yine işledi.

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 99)

```
Restoran POS v5 — Session 99. Önce oku: docs/context-anchor.md §2 + CLAUDE.md + .claude/plans/session-98-kickoff.md (+ MEMORY.md pointer'ları).

DURUM: Pilot kararları kilitli (20-26 Tem, iki-platform, kiosk, temiz-başlangıç — #386) + cutover-hazırlık-paketi hazır (#390: temizlik-SQL + kiosk-reçetesi). ADR-024-Amd1 audit-paritesi (#387) + ADR-026-Amd2 bağlantı-UX (#388) main'de ama PROD'A DEPLOY EDİLMEDİ (prod 126434e, head 047). Yeni APK hazır (EAS 4d1b5e53, QR'ım var, kurulmadı). Apple Developer: ödeme yapıldı, Enrollment Pending (e-posta bekleniyor). main b8e3795+.

BUGÜN başlamak istediğim: [SEÇ — örn. "Apple e-postası geldi, üyelik aktif → device:create + ad-hoc IPA + iPhone kurulum (runbook §11)" / "prod-dalgası: #387+#388 canlıya (migration yok) + APK garson-telefonuna + kiosk kurulumu" / "cutover gününü sabitle + runbook koş" / "v5.1 planlaması (low-nit-devir.md)"].

Desen: branch-first + ADR-önce(yapısal) + cerrahi + gate'ler (hci/kapsam/turkish-ux/security) + tam-suite(lokal pos_test, DATABASE_URL) + CI-yeşil + squash-merge. Mobilde test-runner yok → canlı-cihaz doğrulama şart. Türkçe yanıt.
```

## Notlar
- **Lokal stack:** PG detach-reçetesi + `pnpm migrate` head-kontrolü ŞART (`feedback_local_dev_db_migration_drift`); launch.json'da `api`(3001)/`metro`(8081)/`web`(5173) preview-config'leri hazır. Dev login: `garson@local.test`/`garson1234` · `admin@local.test`/`admin1234` (yalnız lokal seed).
- **Expo Go dev-loop iOS:** `expo start --lan` (launch.json `metro`) + QR (`segno` reçetesi) → `exp://<LAN-IP>:8081`; mobil login **e-posta** ister. Expo tsconfig'i kendiliğinden değiştirir — commit'ten önce `git checkout -- apps/mobile/tsconfig.json`.
- **NetInfo iOS:** ön-plan geçişinde kısa yanlış-"İnternet bağlantısı yok" bandı görülebilir (Google-probe transient) — pilot izleme notu; bizim API'yle ilgisi yok.
- **7 chip açık:** `9905a8eb` web-i18n · `c554652f` print-agent (Part-B-sonrası düşürülebilir) · `e452b4ef` caller-bridge (C12-A-01-sonrası düşürülebilir) · `20f0e0c9` eski-SplitPayment-i18n · `219e7c0a` dine-in-audit · `af3194b4` skill · `4ead6390` bağlantı-UX.
