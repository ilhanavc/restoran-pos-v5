# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## 2026-07-07 — ADR-016 Amendment 2 (Accepted, Session 85) — Caller Bridge pilot açık kalemler

ADR-016 §12 Amd 2 yazıldı. Bridge kararı zaten .NET 8 + kod shipped (`apps/caller-bridge/`); amendment pilot cutover + donanım kilidi getirdi. USER/OPS doğrulaması gereken kalemler:

**✅ ÇÖZÜLDÜ (Session 86) — bu bölüm kapandı; aşağıdaki 7 madde tarihsel referans, artık aksiyon DEĞİL:**
- **#1 Donanım cinsi →** USB-HID ✅ teyitli (kullanıcı, cihaz USB-bağlı).
- **#2 X-Tenant-Id kontrat kırığı →** #291 (config `TenantId`→header + guard + regression test).
- **#3 Token →** prod `BRIDGE_TOKEN` ZATEN set + **canlı pos-api'de yüklü** (S86 salt-okunur doğrulandı: 64-char REAL, `/root/pos-secrets.env`'de). Bridge `appsettings.BridgeToken`'a **aynı değer** konur. Ayrı token/min-yetki v5.1.
- **#4 Polly retry →** #291 doğrulandı (`Program.cs` `AddPolicyHandler` bağlı, 1s/2s/4s).
- **#5 Route mount →** #291 (`app.use('/bridge/caller-id')` `app.ts:180` + Nginx `/api` strip → `ApiBaseUrl=…/api` ŞART).
- **#6 Bayat SKILL.md →** #291 (v5 .NET8 gerçeğine yeniden yazıldı).
- **#7 doc-code drift →** active-plan/anchor/kickoff güncellendi (S86).
- **➕ #294 (yeni bulgu):** cihaz P/Invoke UYDURMAYDI (`cidOpen/cidIsRing/...`) → gerçek `SetEvents` callback rewrite (ADR-016 §12 Amd3). Derleme-doğru ama **donanım-DOĞRULANMAMIŞ** (ilk fiziksel çağrı gerçek test).
- **KALAN = yalnız donanım smoke:** `docs/ops/caller-bridge-kurulum-smoke.md` (cid.dll→`cidshow_x64\` + install + kendini ara). SetEvents patlarsa `node-hid` fallback (ayrı amendment).

1. **[USER — go/no-go kapısı] Donanım cinsi.** Restoranda fiilen USB-HID CIDShow C812A mı, yoksa RJ11 seri-modem mi var? Seri çıkarsa `cid.dll` yolu geçersiz → ayrı amendment + `SerialPort`/AT parse `ICallerIdDevice` gerekir (A2.2). Pilot bu teyit olmadan başlamaz.
2. **[BUG — implementer A5-fix] Sessiz kontrat kırığı:** shipped .NET `BridgeApiClient` yalnız `X-Bridge-Token` gönderiyor, ama API `bridgeCallerIdRouter` `requireTenantHeader()` ile `X-Tenant-Id` UUID ZORUNLU kılıyor → canlıda her POST 400. Fix spec ADR-016 §12 "İmplementer için net spec"te (6 dosya). Davranış değil kontrat düzeltmesi.
3. **[USER/OPS] Token paylaşımı:** bridge ve Print Agent aynı `BRIDGE_TOKEN` env'ini mi paylaşır (MVP kabul) yoksa ayrı mı (v5.1 minimum-yetki)? Prod'da hangi env set edilecek.
4. **[implementer teyit] Polly retry** README'de iddia (1s/2s/4s) ama `Program.cs` okunmadı — `AddPolicyHandler` bağlı değilse ekle, bağlıysa README doğru.
5. **[implementer teyit] Route mount:** API `/bridge/...` mü `/api/bridge/...` mı mount ediyor + Nginx `/api` strip etkisi → bridge `ApiBaseUrl` doğru path'e gitmeli (A2.6).
6. **[doc-hygiene chip]** `.claude/skills/caller-id-bridge/SKILL.md` BAYAT (clipboard-PS + Electron `apps/desktop` + yanlış endpoint). Bu amendment + `apps/caller-bridge/README.md` tek doğru kaynak. Skill güncellenmeli/bayat-işaretlenmeli.
7. **[doc-code drift]** `active-plan.md` A5/P5-4 "Caller Bridge ⏳ .NET8 blocker değil" → gerçekte kod var, kalan = A5-fix + pilot cutover. Güncelle.

## 2026-06-27 — ADR-024 Accepted (Audit Coverage Gap) — açık sorular / takip

ADR-024 + brief (`.claude/plans/adr-024-audit-coverage-brief.md`) yazıldı. comp/void/dine-in-close audit MVP'ye eklendi (ADR-003 §10.5/§12.6 borcu). Yöntem: tx-variant sibling metot. İmplement sonrası takip:

1. **dine-in `cancelOrder` audit'siz** — ADR-024 scope DIŞI bırakıldı (yalnız comp/void/close). `order.cancelled` event takeaway'de var ama dine-in `PATCH /:id {status:'cancelled'}` → `repo.cancelOrder` yolunda yok. Ayrı borç; Session 71 değerlendir (ADR-024 amendment veya ayrı küçük PR).
2. **comp_reason hâlâ yok** — `order_item.comped` audit'i `amount_cents + actorUserId` kanıtlar ama ikram GEREKÇESİNİ değil. v5.1'de `order_items.comp_reason` kolonu + UI gelince whitelist'e ekle (ADR-015 §A3.7 madde 2).
3. **anomaly raporu okuma tarafı değişmedi** — `reports/anomalies` hâlâ `is_comped=true` DB-direkt okuyor; ADR-024 yalnız YAZMA (audit event üretimi) tarafını kapattı. v5.1 Amendment 4'te rapor sorgusunu audit'e bağla → `actorUserId`/`occurredAt` gerçek değer (ADR-015 §A3.7 madde 1+5).
4. **Mod B `order.paid` payment_type='mixed'** — Mod B çoklu-ödeme close'unda tek payment_type yok, literal `'mixed'` yazıldı. İlhan: rapor/forensic için bu yeterli mi yoksa payment breakdown gerekli mi (v5.1)?

## 2026-06-27 — Açık soru: `payOrder` vs `/payments *_close` invariant birleştirme (ADR-014 §12 follow-up)

İki kapanış yolu aynı iş kuralını (kapanışta tutar doğrulaması) **farklı** uyguluyor:
- `orders.payOrder` (`packages/db/src/repositories/orders.ts:759`): `paidTotal < total_cents` (GROSS, comp dalı YOK, yalnız underpaid reddi, overpay sessiz geçer).
- `/payments *_close` (ADR-014 §12, bu session): `canCloseOrder` — `payableCents` (comp düşülmüş) + `isFullyComped` dalı + tam eşitlik (underpaid+overpaid reddi).

`§12` cerrahi sınır gereği `payOrder`'a dokunmadı. Açık soru: `payOrder` da `canCloseOrder`'a göç etmeli mi? Comped order'da `payOrder` GROSS karşılaştırması yanlış sonuç verebilir (payable < total iken kapatamaz). Ayrı teknik-borç ADR'si veya ADR-014 ileri amendment adayı. **İlhan kararı gerekir** — şimdilik backlog.

## 2026-05-12 — ADR-015 Amendment 2 (Proposed) — Açık sorular

Architect tarafından `decisions.md` ADR-015 Amendment 2 + `sprint-15-pr-1-brief.md` üretildi. İlhan'a kullanıcı kararı gereken noktalar:

1. **`range='custom'` semantiği**: explicit (`range='custom'` zorunlu + from/to zorunlu) mü, implicit (`from/to` verilirse otomatik custom, Amendment 1 davranışı) mu?
   - Architect önerisi: **explicit** (yeni davranış, daha açık API; Amendment 1'in implicit override davranışını siler).
2. **`getRangeWindow` eski export**: PR-1'de tamamen kaldır mı, deprecated bırak mı?
   - Architect önerisi: **kaldır** (3 detail endpoint tek tüketici, hepsi göç ediyor).
3. **CSV format window field konumu**: header satırında mı, ayrı meta satırda mı?
   - Doğrulama: mevcut detail endpoint CSV pattern'ini kontrol et, onu takip et.
4. **`AverageBillResponseSchema`** ve diğer 5 KPI response schema'sına `windowStart`/`windowEnd` eklemek breaking mi? Sprint 14 PR-5e cleanup sonrası UI tüketicisi nerede?
   - Doğrulama gerekli: `grep -r "AverageBillResponse" apps/web/src/`.
5. **PR boyutu**: 14 dosya tek PR mı, 2 PR'a bölünsün mü (1a: helper + detail migration, 1b: KPI range desteği)?
   - Architect önerisi: **tek PR** (cerrahi atomik değişim, bölmek mantıksız).

## 2026-05-11 — ADR-011 Amendment: PageHeader component (Proposed) — Implementer brief

### Audit özet (12 sayfa, 3 pattern)

- **Pattern A** (canonical): `KdsPage` (line 73-78), `ReportsPage` (line 26-30)
- **Pattern B** (`text-[22px] font-extrabold` + `pl-[74px]` grid sarmal + `var(--v3-text-primary)` inline style): `SettingsPage` 111, `TablesListPage` 104, `CustomersPage` 268, `CustomerDetailPage` 252, `MenuDefinitionsPage` 141, `ProductEditorPage` 424, `UsersPage` 142, `DiningAreasPage` 128, `AttributeGroupsPage` 105, `AdminPlaceholderPage` 25
- **Pattern C** (`text-2xl font-extrabold text-foreground`): `DashboardPage` 67

### DoD checklist (implementer'a)

**Kod:**
- [ ] `apps/web/src/components/layout/PageHeader.tsx` mevcut (architect oluşturdu)
- [ ] 12 sayfa migrate edildi (her birinde mevcut header bloğu silinip `<PageHeader title=... [icon=...] [actions=...] [subtitle=...] />` ile değiştirildi):
  - [ ] `KdsPage` — `ChefHat` icon (default slate-700 renk kabul), refresh btn `actions`
  - [ ] `SettingsPage`, `DashboardPage`, `TablesListPage` — icon/actions/subtitle yok
  - [ ] `CustomersPage`, `MenuDefinitionsPage`, `ProductEditorPage`, `UsersPage`, `DiningAreasPage`, `AttributeGroupsPage` — actions = ilgili "Yeni X" / "Kaydet" btn
  - [ ] `CustomerDetailPage` — geri-ok btn header **dışına** taşınır (icon slot LucideIcon, ReactNode değil)
  - [ ] `ReportsPage` — subtitle = `t('reports.subtitle')`, icon = `BarChart3` (opsiyonel)

**Kapsam dışı (DOKUNMA):**
- `LoginPage.tsx` — AuthLayout, yorum ekle
- `OrderScreenPage.tsx` — multi-pane; `<h1>` YOKSA yeni header EKLEME
- `AdminPlaceholderPage.tsx` — kullanıcıya sor: aktif mi? Aktif değilse silinir (ayrı PR)

**i18n:**
- [ ] Yeni i18n key YOK (mevcut `*.title`/`*.subtitle` kullanılır)
- [ ] Hardcoded TR string yok

**CI gate (yeni script `apps/web/scripts/lint-headers.sh` veya `package.json` `lint:headers`):**
- [ ] `grep -rn '<h1 ' apps/web/src/features/ | grep -v LoginPage | grep -v OrderProductDetailModal` → 0 match
- [ ] `grep -rn 'text-2xl\|text-\[22px\]\|font-extrabold' apps/web/src/features/*/[A-Z]*Page.tsx apps/web/src/features/*/*/[A-Z]*Page.tsx` → 0 match
- [ ] `grep -rn "color: 'var(--v3-text-primary)'" apps/web/src/features/*/[A-Z]*Page.tsx` → 0 match

**Review:**
- [ ] `hci-reviewer` onayı (Pattern A uniform)
- [ ] `turkish-ux-reviewer` onayı (subtitle çevirileri)
- [ ] Görsel: `pnpm dev`, 12 sayfa, hamburger btn ile h1 hizalama tutarlı (pl-16 = 64px)

**Test:**
- [ ] Playwright E2E PASS (Sprint 9 + 9b — header değişimi data-testid kırmıyor)
- [ ] Opsiyonel: `PageHeader.test.tsx` smoke

**Commit/PR:**
- [ ] Branch: `feature/adr-011-pageheader-amendment`
- [ ] Commit: `feat(ui): standart <PageHeader> component (ADR-011 amendment 2026-05-11)`
- [ ] PR body: amendment link + migration tablosu + grep output

### Açık sorular (architect → implementer/kullanıcı)

1. `AdminPlaceholderPage.tsx` router.tsx'te aktif mi? (Sprint 8d sonrası kalıntı olabilir)
2. `OrderScreenPage.tsx` mevcut layout'ta `<h1>` var mı? (Yoksa yeni header eklenmez — scope-creep yasak)
3. Icon renk override: KdsPage `text-orange-600` mevcut → PageHeader default `text-slate-700`. Architect kararı: bu amendment'ta `iconClassName` prop AÇMA, KdsPage default rengi kabul etsin. v5.1'de gerek olursa amendment ile genişletilir.

## Session 58 — Sprint 14 Plan (2026-05-11)

**Branch:** `chore/sprint-14-adr-prep` (main HEAD `cfca350`)
**Hedef:** Charter Phase 3 madde 5 (raporlar) MVP listesi 8/10 → 10/10 + CSV export.
**ADR'lar:** ADR-015 Amendment 1 (Proposed) + ADR-021 (Draft) — bu task'ta yazıldı; ilhan onayı sonrası architect Accepted.

### Süre tahmini

~2–2.5 hafta, 4 PR. (Orijinal plan 5 PR; PR-1 atlandı — aşağıdaki "Audit bulgusu" bölümü.)
Branch-first workflow zorunlu (memory dersi: feedback_branch_before_commit).

### Audit bulgusu — PR-1 ATLANDI (2026-05-11, post-merge keşif)

`apps/api/src/__tests__/reports.test.ts` incelendi (433 satır):
- **12 test mevcut** (8 endpoint functional + 2 RBAC waiter 403 + 1 multi-tenant izolasyon + 1 auth 401)
- **8/8 ADR-015 endpoint test edilmiş** — today-revenue, hourly-revenue, top-selling, payment-distribution, recent-orders, closed-orders, order-count, average-bill
- `describe.skipIf(DB_URL === undefined)` doğru DB guard pattern (skipped değil, CI'da postgres service ile çalışır)
- **Sprint 11 borcu Session 54 PR #106 (commit b97797f) ile zaten kapanmış**

Architect ön-iş audit raporu yanlış alarm vermiş. Sprint 14 fiili sıra **PR-2'den başlar** (renumber yok, kayıt için orijinal numaralar korundu).

### PR breakdown

| PR | Adı | İçerik | Süre | Bağımlılık | Sub-agent akışı |
|---|---|---|---|---|---|
| ~~PR-1~~ | ~~reports.test borç kapanışı~~ | **ATLANDI (2026-05-11):** Sprint 11'de kapanmış (Session 54 PR #106). Doğrulama: 12 test mevcut, 8/8 endpoint coverage. Audit yanlış alarmıydı. | — | — | — |
| PR-2 | ADR-015 Amendment 1 — 3 yeni endpoint | `category-sales` + `anomalies` + `user-performance` endpoint + zod schema + integration test. Migration: muhtemelen yok (mevcut indeksler yetebilir; verify gerek). | 4-5 gün | PR-1 | architect (Accepted geç) → implementer → qa-engineer |
| PR-3 | Daily-close + Snapshot (X/Z) | `daily-close` + `snapshot` endpoint + shared schema (`DailyCloseSchema`) + test. Real-time hesap, snapshot table yok. | 3-4 gün | PR-2 | implementer → qa-engineer |
| PR-4 | ADR-021 CSV export | Tüm 13 rapor endpoint'ine `?format=csv` desteği + `csv-stream.ts` + `pii-mask.ts` shared-domain + audit log + 100k row cap + test (ASCII + Türkçe karakter + PII mask + audit row). Yeni error code `REPORT_TOO_LARGE` (ADR-006 §5). | 5-6 gün | PR-3 | architect (Accepted geç) → security-reviewer (PII gate) → implementer → qa-engineer |
| PR-5 | Web UI — `/raporlar` ekranı | Yeni route + sol menü item + tablo/grafik component'leri + indir butonu (CSV) + range filtre + 13 hook bağlama. v3 `RaporScreen.jsx` davranışsal referans (kod taşıma yok). | 5-7 gün | PR-4 | architect (UI flow review) → implementer → hci-reviewer (gate) → turkish-ux-reviewer → qa-engineer (Playwright E2E S6 senaryosu) |

### Her PR için DoD checklist (özet)

- [ ] Branch açık, main'e direkt commit yok
- [ ] Test PASS lokal + CI (DB_URL secret set)
- [ ] zod schema roundtrip test
- [ ] i18n key TR (UI varsa)
- [ ] Audit log entry (PR-4 için zorunlu)
- [ ] PII mask test (PR-4 için zorunlu)
- [ ] hci-reviewer onayı (PR-5)
- [ ] turkish-ux-reviewer onayı (PR-5)
- [ ] No-op merge tuzağı kontrol (memory: feedback_chained_pr_squash_no_op) — A merge sonrası B/C rebase + force-push
- [ ] PR numara çakışması kontrol (memory: feedback_pr_merge_collision_avoidance) — açık PR migration NNN_*.sql
- [ ] Commit mesajı conventional + ADR ref (örn `feat(reports): category-sales endpoint (ADR-015 §A1.1)`)

### Kritik notlar / risk

- **Sprint 11 borç ✅ DOĞRULANDI (2026-05-11)**: reports.test 12 test mevcut + 8/8 endpoint coverage. Audit yanlış alarmıydı, PR-1 atlandı (yukarıdaki bulgu bloğu). Sprint 14 fiili sıra PR-2'den başlar.
- **ADR-015 Amendment 1 ✅ Accepted (2026-05-11, PR #129)**: kullanıcı onay verdi, decisions.md L6917 statüsü güncellendi.
- **ADR-021 ✅ Accepted (2026-05-11, PR #129)**: kullanıcı 5 açık sorunun hepsine kabul verdi, decisions.md L8010 statüsü güncellendi.
- **PII mask kütüphanesi**: PR-4'te shared-domain'e ekleniyor — JSON response'ta da reuse için hazır kalıyor (gelecek role-based mask).
- **Migration footprint**: Amendment 1 ve ADR-021 yeni tablo gerektirmiyor (audit_logs mevcut); ama indeks audit (Karar A1 açık DB ihtiyaçları) PR-2 başında yapılacak.

### Architect karar özeti (5 + 5 = 10 açık soru)

ADR-015 Amendment 1 (5):
1. Range param: ✅ enum `today`/`week`/`month` + opsiyonel `from`/`to` override.
2. Daily-close idempotency: ✅ real-time hesap (snapshot table v5.1).
3. User-performance role: ✅ opsiyonel (yoksa tüm roller).
4. Anomalies kapsamı: ✅ 3 tip MVP (cancel + void + comp); refund v5.1.
5. Snapshot şekli: ✅ daily-close ile shared schema.

ADR-021 (5):
1. Endpoint pattern: ✅ query param `?format=csv` (ayrı `/export` reddedildi).
2. Delimiter: ✅ `;` (TR Excel default); `,` v5.1 opsiyon.
3. PII mask alanları: ✅ telefon `5XX***1234`, isim `Ahmet K***`, adres mahalle düzeyi.
4. Audit log şeması: ✅ mevcut `audit_logs` (ADR-003 §12) — yeni migration yok.
5. Format versioning: ✅ filename suffix v2 (header row non-breaking add); `?version=` v5.1.

---

## Session 58 — Phase 3 Sprint Seçim Audit (2026-05-11)

### Bağlam

Phase 2 ✅ MÜHÜRLENDİ (2026-05-10, Sprint 9b kapanışı). Phase 3 KDS Sprint 12 ✅ KAPANDI (Session 56). main HEAD `f66046f`, açık PR 0, 342 test PASS. Charter Phase 3 kalan kalemleri için sıradaki sprint seçimi gerekiyor — 3 paralel Explore audit yapıldı.

### Bulgu 1 — ADR-014 §10 Mod B "Masayı Kapat" durumu

**KOD HAZIR, SADECE TEST EKSİK** — bu yarım kapatılmış borç değil, test örtüsü açığı.

- ✅ Endpoint: `PATCH /orders/:id { status: 'paid' }` — `apps/api/src/routes/orders.ts:965-1003` (auth + `OrderUpdateSchema` + `repo.payOrder()` + `PAYMENT_INSUFFICIENT_FOR_CLOSE` 400)
- ✅ Validation: `SUM(payments.amount_cents) >= orders.total_cents` (decisions.md §6343)
- ✅ Web UI: `apps/web/src/features/payment/components/QuickPaymentModal.tsx` — `isFullyPaid` toggle + mor "Masayı Kapat" butonu (satır 191-197) + `useCloseOrderAsPaid()` + i18n error mapping
- ❌ E2E test: yok (S1-S6 + S9b kapsamında değildi)
- ❌ Unit/integration test: yok (`payOrder()` repo metodu için)

**ADR-014 §10 ile %100 hizalı.** Eksik: ~1 PR (E2E senaryo + unit test) — 2-3 gün.

### Bulgu 2 — Reports state (Charter Phase 3 madde 5)

**8 ENDPOINT VAR / 10 MVP MADDESİNDEN 5'İ KISMEN, 5'İ TAMAMEN EKSİK + TEST 0.**

ADR-015 (Anasayfa Rapor Endpoint'leri) Accepted — şu 8 endpoint mevcut:
`/reports/kpi/today-revenue`, `/reports/hourly-revenue`, `/reports/top-selling`, `/reports/payment-distribution`, `/reports/recent-orders`, `/reports/closed-orders`, `/reports/kpi/order-count`, `/reports/kpi/average-bill`. Frontend: `apps/web/src/features/dashboard/api/reports.ts` (8 React Query hook + 60s polling).

Charter MVP listesi karşılaştırma:

| # | Charter maddesi | Durum | Açıklama |
|---|---|---|---|
| 1 | Günlük kapanış (Z) | 🟡 Kısmi | KPI ciro var, gerçek kapanış (Z-Report semantiği) yok |
| 2 | X raporu (ara kapanış) | ❌ | Snapshot endpoint yok |
| 3 | Ürün satış | ✅ | top-selling |
| 4 | Kategori | ❌ | Endpoint yok |
| 5 | Saatlik ciro | ✅ | hourly-revenue (24 bucket, TZ-aware) |
| 6 | Ödeme kırılımı | ✅ | payment-distribution |
| 7 | Masa/Paket | 🟡 Kısmi | recent/closed-orders var, dine_in vs takeaway breakdown yok |
| 8 | Anomali (iptal/iade/comp) | ❌ | Endpoint yok |
| 9 | Kullanıcı performans | ❌ | order.waiter_id mevcut ama rapor yok |
| 10 | CSV export | ❌ | Hiçbir rapor için |

**Sprint 11 test borcu açık:** `apps/api/test/reports.test.ts` `describe.skip` (commit b97797f notu: "12 test geri açıldı" Sprint 11 mesajıyla — fakat audit raporu test sayısı 0 söylüyor; **doğrulama gerek**).

**Tahmini:** 4-5 PR + 2.5-3 hafta. ADR durumu aşağıda.

### Bulgu 3 — Print Agent state (Charter Phase 3 madde 4)

**TAMAMEN BOŞ.** ADR-004 Accepted (2026-04-25, commit 8fb7e1b) — kararlar kilitli, ama tek satır production kod yok.

- `apps/print-agent/src/index.ts` = 12 byte (`export {}`)
- `apps/print-agent/package.json` 405 byte (Node 22.11, dev deps only — `@types/node` + `typescript`)
- API endpoint'leri: yok (`/print/*` route hiç yok)
- DB migrations: yok (`print_jobs`, `agents`, `printers` tabloları yok)
- Shared types: yok (`PrintJob`, `KitchenTicket` schema'ları yok)
- Mutfak ticket payload üretimi: yok (KDS sadece display, ESC/POS dönüşümü yok)
- ESC/POS, CP857, MSI, nssm, WiX: hiçbiri yok

**Tahmini:** 7-8 PR + 6-8 hafta (ADR-004 §kararları implementer'a dağıtılır, MSI build CI/lokal kararı + CP857 test stratejisi açık).

### ADR Durumu

- **Sıradaki ADR numarası:** **ADR-021** (son ADR-020 KDS Accepted 2026-05-08).
- **Mod B için yeni ADR gerek?** ❌ — ADR-014 §10 yeterli. Sadece test PR.
- **Reports için yeni ADR gerek?** ⚠️ Karar — yeni endpoint'ler için **ADR-015 amendment** yeterli (kategori, anomali, kullanıcı performans, X/Z aynı pattern: per-file route, RBAC, tenant-scoped). **CSV export için ADR-021 önerilir** (filename, retention, PII filtering, format versioning).
- **Print Agent için yeni ADR gerek?** ❌ ADR-004 yeterli. Implementasyon detayları (MSI CI build vs lokal artifact, CP857 test stratejisi) Sprint 13 başında architect briefing'inde netleşir — ADR-004 §amendment ile değil scratchpad/decisions notuyla.

### Sprint sıralama önerisi (REVİZE)

| # | Sprint | Süre | Niye | ADR |
|---|---|---|---|---|
| **13** | **Mod B test örtüsü kapanışı** | ~2-3 gün, 1 PR | Phase 2 mührü "açık borç yok" ise bu test eksiği gedik. Hızlı kazanç. Phase 3 tam temiz girişi. | yok |
| **14** | **Reports tamamlama + Sprint 11 test borcu** | ~2.5-3 hafta, 4-5 PR | MVP'ye en yakın (50% var, momentum). reports.test.ts borç ödeme + 4 yeni endpoint + CSV + UI. | ADR-015 amendment + ADR-021 (CSV) |
| **15** | **Print Agent (Charter Phase 3 madde 4)** | ~6-8 hafta, 7-8 PR | Büyük + yeni domain. Temiz kafayla, ayrı odakla. Reports MVP yeşil olduğunda mock printer mimarisinden gerçeğe geçiş netleşir. | ADR-004 (mevcut) yeterli |

**Alternatif sıra (kullanıcı tercihi):** Print Agent "ana eksik" hissiyle Sprint 14 ile değiştirilebilir, ama momentum + MVP-yakınlık metriği Reports'u önde tutuyor.

### Sırada — kullanıcı kararı

- Sprint 13 Mod B test PR ile başlamayı öneriyorum (2-3 gün, küçük, temiz).
- Onay gelirse: yeni branch `test/sprint-13-mod-b-coverage`, qa-engineer briefi (Mod B 3 case: tam ödenmiş → kapat success, kısmi → 400, masa boşaldı UI doğrulama).
- Bu audit branch'i (`chore/phase-3-audit-2026-05-11`) scratchpad değişikliği commit + PR ile main'e döner.

---

## Session 55 — Sprint 9 (2026-05-08)

### Tamamlananlar

- **ADR-019 Accepted** — E2E Smoke Suite Stratejisi (Chromium-only, worker 1, kysely direct seed, storageState, preview proxy reuse §3.1)
- **ADR-019 §1 amendment 2** — S2/S4/S5 scope-aligned (S2 bölge sync, S4 hard-delete, S5 timezone) + **Sprint 9 / 9b ayrımı** (bu sayı amendment)
- **PR #108** (`feat/sprint-9-playwright-e2e`) — Görev 37 altyapı + S1 senaryosu
  - Playwright config (Chromium-only)
  - apps/web/e2e/: global-setup, fixtures (seed + auth.setup), helpers, S1 spec, README
  - .github/workflows/e2e.yml (postgres:17 service reuse)
  - eslint.config.js e2e/** override
  - vite.config.ts preview proxy
- **CI evolusyon** (4 fix zinciri, her biri bir önceki katmanı açtı):
  - `b0e7a7a` Build workspace packages (shared-types/domain/db) — fresh CI checkout dist eksik
  - `083e080` globalSetup string path (require.resolve ESM uyumsuz)
  - `5d21346` vite.config preview.proxy (server.proxy dev-only, vite preview proxy etmiyor)
  - `bbbe945` S5 spec ADR §1 saf scope (defensive testler kaldırıldı)
- **Sprint 9b ertelendi** — S2-S5 spec dosyaları silindi (commit XXXXXXX). qa-engineer locator'ları lokal UI keşfi olmadan yazmıştı; gerçek DOM'da `getByRole(/Yeni|Ekle/)` `#tenant-name` toBeDisabled self-delete locator'lar 30s timeout

### S1 PASS, S2-S5 ertelendi — neden

- **S1 (login UI)** tüm 4 CI koşumunda PASS → Vite SPA fallback + preview proxy + auth flow + storageState altyapısı doğrulandı
- S2-S5 fail nedeni: locator'lar gerçek DOM ile uyuşmuyor (qa-engineer sandbox'tan kör yazmış)
- ADR-019 §1 amendment 2: S2-S5 → Sprint 9b (lokal `pos_e2e` DB + Playwright UI mode + Inspector ile locator çıkarma şart)

### State (Session 55 sonu — Sprint 9 KAPANDI)

- main HEAD: `ec0f3ff` (PR #108 squash merged)
- Açık PR: 0 (chore/session-55-close henüz açılmadı, kapanış PR'ı)
- Sprint 9: ✅ KAPANDI (altyapı + S1 yeşil, CI Playwright Smoke 1m44s + ci 1m4s)
- Sprint 9b: backlog (S2-S5 — qa-engineer lokal UI keşfi sonrası yeni PR)
- ADR-002 §10 username UNIQUE: ✅ KAPANDI — Migration 033 `033_users_username_unique.sql` (2026-05-08, decisions.md §10.11)
- Phase 3 KDS: backlog (Plan C — ADR-019 sonrası)
- Worktree disposal: `D:\restoran-pos-v5\.claude\worktrees\determined-bhabha-194e2a` orphan (branch silinemedi worktree çakışması; manuel cleanup ileride)

### Önemli dersler

1. **Subagent UI testi körlemesine yazamaz**: qa-engineer sadece dosya isimlerinden + page tsx özeti ile spec yazınca locator'lar gerçek DOM'la uyuşmuyor. Çözüm: lokal Playwright UI mode + Inspector ile locator inspect, sonra spec yaz.
2. **Vite preview proxy server.proxy ≠ preview.proxy**: Dev mode'da `server.proxy`, preview mode'da `preview.proxy`. İki ayrı config bloğu. E2E için preview kullanılırsa preview.proxy şart.
3. **fresh CI checkout workspace packages dist eksik**: `pnpm install` lockfile'a göre paketleri kurar ama workspace paketlerinin TS build'lerini yapmaz. Web build'den önce shared-types + shared-domain + db build şart.
4. **`require.resolve` ESM mode'da yok**: apps/web `"type": "module"` → playwright.config.ts'de `require.resolve('./...')` ReferenceError. Playwright 1.30+ globalSetup string path destekler.
5. **Lokal e2e DB ayrımı (ADR-019 §3.1)**: `pos_e2e` ayrı DB. `pos_dev` truncate edilirse dev verisi gider; seed.ts üçlü guard (NODE_ENV, CI, DB ismi pattern).

## Session 54 KAPANDI (2026-05-07)

### Tamamlananlar (5 PR main'e merged)

- **PR #105** (`3a1ab25`): Migration 027 idempotent guard + 028 store_date::SMALLINT cast (gizli POST /orders 500 bug fix) + vitest pool=threads + fileParallelism=false + bölge-içi masa etiketi
- **PR #102** (`9792d3df`, **squash-onto-main**): paket sipariş + sidebar fix + müşteri atama + ADR-017 + ADR-018; DTO'ya `tableId/orderNo/waiterUserId`, `createTakeawayOrder` repo'ya `waiterUserId` (ADR-008 §4.1 ABAC), GET takeaway authorize'a kitchen
- **PR #103** (`6c2dd00`, cherry-pick): hard delete + snapshot pattern (Migration 030→032 renumber)
- **PR #104** (`ebd3db5`, cherry-pick 2 commit): paid-only raporlar
- **PR #106** (`b97797f`): Sprint 11 borç kapanışı — reports.test 12 test geri açıldı, ADR-009 hard-delete amendment

### Test sonucu

329/329 PASS, 24 dosya, **0 skipped** — Sprint 11 borç tamam kapatıldı.

### Migration zinciri (ana repo state)

027 idempotent → 028 store_date_cast → 031 takeaway_stage → 032 orders_table_snapshot.

### Memory'e eklenen

- `feedback_pr_merge_collision_avoidance.md` — açık PR'lar dururken bug-fix migration NNN_*.sql çakışması; FIFO sıralama.

### Cleanup

- 6 geçici worktree git registry'sinden kaldırıldı (jovial-dirac, sharp-liskov, takeaway-rebase, hard-delete-rebase, reports-rebase, vigorous-raman, determined-mestorf)
- 50+ eski local branch silindi (sadece `main`)
- Ana repo `D:\restoran-pos-v5` main HEAD `b97797f`

### State (Session 55 başlangıcı)

- Açık PR: **0**
- Local branch: sadece `main`
- API: http://localhost:3001 (PID 15776)
- Web: http://localhost:5173 (PID 2312)
- Dev DB pos_dev: 027/028/031/032 sync

### Sıradaki açık işler

1. **Phase 3** başlangıcı — KDS UI + kitchen routing (ADR-014 §9 backend zaten hazır)
2. **Sprint 9** — Playwright E2E (charter Phase 2 exit kriteri)
3. **ADR-002 §10** — ✅ KAPANDI 2026-05-08 (Migration 033 `033_users_username_unique.sql`)
4. Disk üzerinde kilitli worktree dizinleri (Windows file lock; git registry temiz, manuel disk cleanup ileride)

### Önemli dersler (bu seans)

1. **PR squash sırasında migration numara çakışması:** Açık PR'larla aynı numaralı yeni migration eklemek zincirli rebase tetikler. Kontrol komutu: `gh pr list --state open --json files`. FIFO sıralama tercih.
2. **Squash-onto-main > 22 commit interactive rebase:** ADR-018 unification + revert deseni — interactive rebase 22/10 conflict zinciri saatlik. Squash-onto-main net etki tek commit, conflict tek seferde.
3. **PowerShell `Start-Process -WindowStyle Hidden` Claude Code permission sandbox bloğu:** Kullanıcıya prompt gözükmüyor, otomatik reject. **Bash nohup pattern** tercih.
4. **Bash `exit 0` ≠ child öldü:** Background bash kabuk exit ettiğinde nohup'la spawn edilen child alive kalır. Doğrulama: port + log + `Get-CimInstance` (memory'de yazılı, bu seansta tekrar kanıtlandı).
