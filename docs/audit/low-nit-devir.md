# FAZ 4 LOW/NIT kapanışı — devir kaydı (Session 96, 2026-07-15)

> Derin-denetim fix planının son FAZ 4 kalemi (`00-summary.md` §7 madde 17).
> Envanter: 12 arşiv blok-raporu (draft PR #329-341) tarandı — **~55 LOW + ~15 NIT'in HİÇBİRİ "MVP-fix" etiketli değil** (tüm MVP-fix'ler HIGH/MEDIUM'du ve FAZ 1-4'te kapandı). Kapsam kilidi gereği v5.1-etiketli işler şimdi kodlanmaz; bu dosya resmî devirdir.

## Bu kapanışta FİX'LENENLER (3 kalem — `chore/faz4-low-nit-sweep`)

1. **eslint flat-config kural-key ezmesi (GERÇEK BUG):** `apps/api/src/**` hem para-float bloğuna hem ADR-010 emit bloğuna giriyordu; flat-config aynı kural-key'i (`no-restricted-syntax`) MERGE ETMEZ, sonraki blok ezer → api/src'de `Number('1.5')` float-literal yasağı sessizce devre dışıydı (kanıt: proof-dosyası lint'ten geçti). Fix: selector'lar tek `FLOAT_SYNTAX_SELECTORS` const'ına + iki blokta spread. `parseFloat` ayrı `no-restricted-globals` ile zaten yakalanıyordu; kaçan yalnız Number-float idi. Ezik dönemde gerçek ihlal sızmamış (tam lint 8/8 temiz).
2. **"Unused eslint-disable" ×6 (Blok 0 NIT):** kaynak kodda DEĞİL — `coverage/` üretilen HTML-rapor asset'lerindeymiş (S95 coverage koşumu artığı; lint ignores'unda coverage yoktu). Fix: `**/coverage/**` ignore. Kod dosyalarında ölü direktif yok.
3. **GET /orders `storeDate` Date-binding sertleştirmesi (S96 gate-notu, ADR-015 Amd5 K10 deseni):** `OrderListFilters.storeDate` Date→`YYYY-MM-DD` string + `::date` cast; route takvim-dışı tarihte 400 (K9 paritesi). JS-Date bağlaması süreç-TZ-bağımlıydı.

## v5.1-BACKLOG'a DEVİR (rapor-etiketli; blok · ID · kısa ad)

**Blok 1:** SD-M-11 MAX_SAFE hassasiyet (kabul) · SD-M-12 `multiplyMoney(-0)` · SD-M-13 `formatOrderNo(1e21)` · SD-M-15 order.ts dup-aritmetik · SD-P-04 sanitize \n\t · SD-S-12 array shared-ref · SD-S-15 hardcoded reason · SD-P-06/SD-S-16 (NIT, tasarım)
**Blok 2:** SD-T-A-07 storeDate regex takvim-doğrulamaz (route-level 400 guard'ları Amd5 K9 ile eklendi — zod-refine v5.1) · SD-T-A-08 z.coerce hex/sci + .max yok · SD-T-B-04 raw-phone event (tasarım) · SD-T-B-06 .strict yok (info) · SD-T-B-07/B-08 (NIT) · SD-T-C-08 response-parse (ADR-gerekli)
**Blok 3:** DB-ROB-02 LIKE escape · DB-ROB-03 limit/offset clamp · DB-TX-07 yarışta messageKey · DB-TX-08 createCustomer N+1 · DB-TX-09 (NIT) · DB-MIG-04 generated.ts drift · DB-MIG-NIT1/NIT2 · DB-SEC-03 refresh-scope (tasarım) · DB-SEC-04/05 (INFO)
**Blok 4:** API-AUTH-03 password .max · API-AUTH-05 RTR grace (info) · API-AUTH-06 doc-drift · API-AZ-08/09 env default'ları · API-AZ-12 (NIT) /health pg_version · API-AZ-13 (NIT) global-404 · API-AZ-14 dup-authorize · API-CORE-05/06
**Blok 5:** PAY-06 replay-guard detayı · PAY-07 per-order ABAC (ADR-027 bilinçli)
**Blok 6:** R6-PRD-01 priceDelta ±cap · R6-PRD-02 replaceVariants id-collision · R6-PJ-01 errorText .max · R6-CALL-02 redact raw-phone · R6-CUST-02 PATCH no-op · R6-CUST-03/04 (NIT) · R6-ATTR-03 (FK savunuyor)
**Blok 7:** R7-CSV-02 share_pct ondalık · R7-ROB-01 csv-stream adı (kabul)
**Blok 8:** P8-QUAL-01 line() dedupe · P8-TPL-03 ghost "( )"
**Blok 9:** W9-SEC-05 Nginx CSP · W9-SEC-06/07 sourcemap/console · W9-SEC-08 caller tam-numara (kabul) · W9-HCI-LOW ailesi (kabul) · `docs/hci/exceptions.md` doc-debt
**Blok 10:** M10-SEC-03 dev-IP `__DEV__` · M10-SEC-04 FLAG_SECURE · M10-SEC-05 deep-link · M10-HCI-09/10/11 · M10-QUAL-01 bayat JSDoc
**Blok 11:** P11-B-09 `$PrinterName` escape · P11-SEC-05 nssm log-rotation · P11-SEC-06 register timing (info) · P11-A-07 (info)
**Blok 12:** C12-C-01 dotnet-format · C12-C-07 nint→SafeHandle · C12-HYG-01 dev-token hijyeni · C12-A-03 StopAsync yarışı · C12-C-04 flaky Task.Delay

## Zaten kapanmış aile-kuyrukları (yeniden iş açılmaz)

W9-I18N-02/03 + M10-I18N-01 (i18n ailesi #359 + chip'ler) · W9-TR-02/M10-TR-02 (terim aileleri) · W9-QUAL-01/SD-M-14/SD-S-17/SD-T-A-09+C-07/API-AUTH-02/P11-B-06 (dead-code #367/#368 süpürmesi + knip-taze çıktısında yoklar) · API-AZ-10 (#354 rate-limit) · R7-CSV-03/04 (R7-TZ ailesi #347/#369) · P11-SEC-05-komşuları (#360 config ailesi) · C12-A-03-komşusu (#362 StartAsync) · R6-ATTR-TEST (rapor içinde kapalı).

> Devir sahibi: v5.1 planlaması. Bu liste `00-summary.md` §7 madde 17'nin kapanış kanıtıdır; yeniden önceliklendirme v5.1 kickoff'unda yapılır.
