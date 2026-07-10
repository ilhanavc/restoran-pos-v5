# Blok 0 — Baseline & Envanter

> Derin denetim serisi (deep-audit-master-prompt.md) ilk adımı. **Salt-ölçüm** — kod değiştirilmedi, prod'a dokunulmadı.
> **Tarih:** 2026-07-10 · **Commit:** `f3e71ab` (main) · **Model:** Fable 5 (envanter/tarama) + Opus 4.8 (sentez).
> Yöntem: 4 paralel hat (A typecheck/lint/build · B test+coverage · C dep/dead-code · D kod-sağlık envanteri).

---

## 1. Suite durumu (Hat A + B)

| Komut | Sonuç | Süre | Not |
|---|---|---|---|
| `pnpm typecheck` (turbo, tüm workspace) | ✅ EXIT 0 | 99s | 0 hata |
| `pnpm lint` | ✅ EXIT 0 | 2s (cache) | 0 error, **3 warning** (ön-mevcut, aşağıda) |
| `pnpm build` | ✅ EXIT 0 | 38s | web chunk-size uyarısı (ön-mevcut, bilinen) |
| `pnpm test` (turbo, `pos_test`) | ✅ EXIT 0 | 325s | **1110 test / 70 dosya PASS** |

**Test kırılımı (hepsi yeşil):** api 701 (45 dosya) · shared-domain 233 (15) · shared-types 126 (2) · print-agent 39 (5) · db 11 (3).

**Lint uyarıları (3, hepsi "Unused eslint-disable directive"):**
- `apps/api/src/middleware/bridge-token.ts:18` — `no-namespace` (artık gereksiz)
- `apps/api/src/middleware/print-agent-auth.ts:29` — `no-namespace`
- `apps/api/src/routes/print-jobs.ts:498` — `no-await-in-loop`
→ **NIT/DEAD.** ESLint kuralı artık tetiklenmediği için disable direktifi ölmüş. Tek satırlık temizlik (Blok 4/6 kapsamı; sorulmadan silinmez).

---

## 2. Coverage tabanı (Hat B)

| Paket | Hedef | Stmts | Branch | Funcs | Durum |
|---|---|---:|---:|---:|---|
| shared-domain | %85 | **97.19** | 93.47 | 92.98 | ✅ hedef üstü |
| shared-types | — | 46.64 | 9.09 | 5.0 | 🟡 düşük (çoğu saf tip/şema — çalıştırılan kod az; branch %9 = refinement'lar test edilmiyor) |
| print-agent | %75 | 48.32 | 84.11 | 85.0 | 🟡 stmt düşük ama branch/func yüksek (index.ts servis-döngüsü ölçülemiyor) |
| **api** | %70 | ⛔ **ÖLÇÜLEMEDİ** | | | **TEST-ARACI BUG** (aşağı) |
| **db** | — | ⛔ **ÖLÇÜLEMEDİ** | | | **TEST-ARACI BUG** |
| web | %60 | ⛔ ölçülemedi | | | Playwright/vitest çakışması: `test.use() ... not expected here` |
| mobile | %60 | ⛔ 0 | | | **Hiç test dosyası yok** |

### 🔴 [MEDIUM][TEST] Coverage aracı api+db'de kırık — v8 sürüm uyumsuzluğu
- **Kanıt:** `COV-API`/`COV-DB` → `TypeError: ctx.getRootProject is not a function`; log: `Loaded vitest@2.1.9 and @vitest/coverage-v8@3.2.4`.
- **Senaryo:** Kök `@vitest/coverage-v8@3.2.4` ile paket-yerel `vitest@2.1.9` major-sürüm uyuşmuyor → coverage provider API'si çağrıldığında çöküyor. **Testlerin kendisi geçiyor** (325s yeşil); yalnız `--coverage` bayrağı patlıyor.
- **Etki:** İki en kritik katmanın (api para-yolu, db tenant-izolasyonu) coverage tabanı ölçülemiyor → denetimin nicel hedefi kör. Blok 1/3/5'te coverage kapısı uygulanamaz.
- **Öneri:** `vitest` + `@vitest/coverage-v8`'i eşit majora hizala (ikisi de 2.1.x ya da ikisi de 3.x). Additive/tooling düzeltmesi — prod kodu değişmez; ama versiyon bump risk taşır (Blok 13 dep-hizalama ile birlikte).
- **Etiket:** MVP-fix (denetim ilerlemesini bloke ediyor)

---

## 3. Kod-sağlık metrikleri (Hat D envanter ajanı)

**Tip disiplini — dikkat çekici temiz:**
| Metrik | Prod | Test | Not |
|---|---:|---:|---|
| `: any` / `as any` (gerçek) | **0** | 2 | Prod'daki 2 regex-eşleşme yorum satırı (false-pos). Test 2 = `products.test.ts` eslint-disable ile bilinçli. |
| `as unknown as` | 12 | 19 | Prod listesi §3.1'de |
| `@ts-ignore` | 0 | 0 | |
| `@ts-expect-error` | 0 | 1 | `menu.test.ts:35` |
| `eslint-disable` | 5 | | no-namespace ×2, no-await-in-loop ×1 (prod) + no-explicit-any ×2 (test) |

**TODO/FIXME/HACK/XXX — 3 gerçek TODO, FIXME/HACK 0:**
- `apps/api/src/routes/caller-id/index.ts:179` — "Socket.IO emit placeholder TODO" (⚠️ S86'da emit eklendi → **muhtemel bayat yorum**, Blok 6'da doğrula)
- `apps/web/src/features/caller-id/IncomingCallProvider.tsx:23` — route fallback `/dashboard` TODO
- `apps/web/src/features/customers/CustomerDetailPage.tsx:44` — "Son siparişler PR-9'da bağlanacak" TODO
- XXX 1 = false-pos (`pii-mask.ts:13` maske-format dokümanı)

**console.* (prod 28):** print-agent 20 (servis stdout→nssm log, tasarımsal) · db seed 6 (araç) · shared-domain 1 (DI default, meşru) · web 1 (ErrorBoundary, meşru) · **api 0**. → gerçek sorun yok; print-agent'ta yapılandırılmış logger Blok 11 değerlendirmesi.

**Türkçe hardcoded string (t() dışı, kaba):** web ≈87 satır · mobile 5 (+19 mock veri). Yoğunlaşma: `AdisyonPanel` 12 · `OrderScreenPage` 12 · `SplitPaymentModal` 11 — **para/adisyon UI'ları**. → CLAUDE.md kural-4 ihlalleri; Blok 9 i18n-key-checker detaylandıracak. (Açık chip `task_20f0e0c9` SplitPaymentModal'ı zaten kapsıyor.)

### 3.1 — `as unknown as` prod envanteri (12)
- `packages/db/src/repositories/orders.ts:1036` — `storeDateRow.d as unknown as Date`
- `apps/api/src/routes/caller-id/index.ts:106` · `customers/index.ts:189,214` — `req.query as unknown as {…}` (zod çıkarımı yerine el-cast; **3 route**)
- `apps/api/src/routes/reports/closed-orders.ts:132` · `recent-orders.ts:90` — tarih kolonu cast
- `apps/web` — `LucideIcons as unknown as Record<…>` **4 dosyada kopya** (CategoryListItem/IconPicker/ReorderCategoriesModal/CategoryTabs) + `OrderScreenPage.tsx:341`
- `apps/api/scripts/import-v3-customers.ts:545` — script (kysely executor)
→ Çoğu benign; `req.query` cast'i (§Blok 6) ve Lucide duplikasyonu (§Blok 9) not düşüldü.

---

## 4. Envanter (Hat D)

| Katman | Kaynak | Test | Kaynak LOC | Test LOC | Not |
|---|---:|---:|---:|---:|---|
| shared-domain | 22 | 15 | 1 573 | 1 418 | en yüksek coverage |
| shared-types | 18 | 2 | 2 814 | 349 | |
| db (src) | 23 | 3 | 6 486 | 360 | +**42 migration** (.sql) |
| api | 70 | 45 | 16 155 | 22 269 | test-ağır (test LOC > kaynak) |
| web | 136 | 12 | 24 161 | 1 592 | **12 test = hepsi e2e; birim test 0** |
| mobile | 45 | **0** | 6 659 | 0 | **hiç test yok** |
| print-agent | 7 | 5 | 1 263 | 886 | |
| caller-bridge | 10 | 3 | 550 | 196 | .NET |
| **Toplam** | **331** | **85** | **59 661** | **27 070** | |

**En büyük 3 dosya (hepsi para/sipariş yolu):** `apps/api/src/routes/orders.ts` 1 973 · `packages/db/src/repositories/orders.ts` 1 665 · `apps/web/.../SplitPaymentModal.tsx` 1 197 LOC.

---

## 5. Bağımlılık sağlığı (Hat C)

**`pnpm audit` (EXIT 1 — açık var):** 1 **critical** + çok sayıda **high**. Runtime'ı ilgilendirenler (triyaj Blok 13):
| Paket | Sürüm | Advisory | Runtime etkisi (ön-değerlendirme) |
|---|---|---|---|
| `vitest`/`@vitest/ui` | 2.1.9 | critical: UI server arbitrary file read | **Dev-only** (CI/test); prod'a çıkmaz → düşük |
| `kysely` | ^0.27.0 (api/db/web ×3) | high: JSON-path SQL injection ×2, MySQL injection | **PG kullanıyoruz + JSON-path sorgu deseni var mı? Blok 3'te doğrula** — yoksa etki yok |
| `axios` | ^1.15.2 (web) | high: ReDoS + Proxy-Auth credential leak ×2 | Web→API same-origin; proxy yok → orta/düşük |
| `react-router-dom` | ^7.14.2 (web) | high: DoS via unbounded path | orta |
| `xlsx` | ^0.18.5 (web) | high: prototype-pollution + ReDoS | **Müşteri Excel import'unda kullanılıyor; npm'de fix YOK (yalnız CDN sürümü)** → Blok 9/13 karar: girdi güveni + alternatif |
| `form-data`, `glob`, `vite` | | high (çeşitli) | çoğu transitive/dev |

**`pnpm outdated -r`:** ~98 paket güncel değil (major sıçramalar dahil — React 18→19, vb.). Detay Blok 13.

**`depcheck`:** api → `pino-pretty` (kullanılmıyor gibi) · web → `autoprefixer`/`postcss`/`tailwindcss` (**muhtemel false-pos** — PostCSS config üzerinden kullanılıyor, Blok 9 doğrula) · print-agent → temiz.

---

## 6. Ölü kod & yapı (Hat C)

**`madge --circular` (363 dosya):** ✅ **Dairesel bağımlılık YOK.**

**`knip`:** 10 kullanılmayan dosya · **37** kullanılmayan export · **57** kullanılmayan export-tip · 2 duplike export · 2 unlisted dep.
Kullanılmayan dosyalar (10): `apps/web/src/components/{EmptyState,ErrorState,ui/card}.tsx`, `features/admin/AdminPlaceholderPage.tsx`, `dashboard/components/PhaseLockedEmpty.tsx`, `orders/components/TakeawayCartPanel.tsx`, `orders/useCart.ts`, `tables/components/TableStatusDot.tsx`, `apps/print-agent/src/version.ts`, `apps/mobile/babel.config.js` (⚠️ Expo runtime kullanır → **false-pos**).
→ **DEAD envanteri.** CLAUDE.md cerrahi kuralı: önceden var olan dead-code **sorulmadan silinmez**. Blok 9/13'te per-dosya doğrulama + silme önerisi (kullanıcı onayıyla).

---

## 7. 🚩 EN KIRMIZI 5 SİNYAL (sonraki blokların önceliklendirme tabanı)

1. **Coverage aracı api+db'de kırık** (§2) — en kritik iki katmanın nicel taban ölçümü yok; `vitest`/`coverage-v8` major uyumsuzluğu. Blok 1/3/5 coverage kapısını uygulayabilmek için önce bu düzeltilmeli. **[MEDIUM/TEST, MVP-fix]**
2. **Mobile 0 test + web birim-test 0** (§4) — 30 820 LOC istemci kodu (garson mobil + web UI) otomatik birim testsiz; yalnız 7 Playwright senaryosu. Para-yolu UI'ları (SplitPaymentModal 1197 LOC) test kapsamı dışında. **[HIGH/TEST]**
3. **Bağımlılık açıkları — xlsx + kysely + react-router** (§5) — özellikle `xlsx` (npm-fix yok, müşteri import'unda canlı) ve `kysely` JSON-path injection (PG deseni Blok 3'te doğrulanacak). **[triyaj: potansiyel HIGH/SEC]**
4. **Para/sipariş mantığı en dev 3 dosyada yoğunlaşmış** (§4) — orders.ts route 1973 + repo 1665 + SplitPaymentModal 1197. En yüksek karmaşıklık = en yüksek para-hatası riski; Blok 5 (payments) burada derinleşmeli. **[Blok 5 odağı]**
5. **i18n hardcoded metinler para-yolu UI'larında** (§3) — ~87 web satırı, yoğunlaşma AdisyonPanel/OrderScreenPage/SplitPaymentModal. CLAUDE.md kural-4 ihlali. **[MEDIUM/QUAL, Blok 9]**

---

## 8. Genel değerlendirme

Zemin **sağlam ve yeşil**: typecheck/lint/build/1110 test hepsi geçiyor, tip disiplini örnek düzeyde temiz (prod `any` 0, `@ts-ignore` 0, dairesel bağ 0). Baseline borç haritası üç eksende toplanıyor: **(a) test asimetrisi** (backend test-ağır, frontend/mobil test-fakir), **(b) bağımlılık açıkları** (triyaj bekliyor), **(c) i18n + coverage-aracı** tooling borçları. Hiçbiri "yeşil zemin"i bozmuyor — denetim güvenli bir tabandan başlıyor.

**Sonraki:** Blok 1 (shared-domain — para/vergi/encoding matematiği). Master plan sırası: 0 → 1 → … → 13. Her blok ayrı sohbette, ilgili bloğu yapıştırarak.
