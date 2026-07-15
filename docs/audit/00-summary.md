# Derin Denetim Serisi — Final Sentez (Blok 0-13)

> **Tarih:** 2026-07-11/12 (2 oturum, S92-S93) · **Model:** Fable 5 + Opus 4.8 · **Base:** `a40b28a` (main, prod `27926ca`).
> **Kapsam:** v5'in her katmanı (shared-domain/types, db, api-core/orders/payments/routes/reports, print-pipeline, web, mobile, print-agent, caller-bridge) + cross-cutting sweep + yük harness.
> **Yöntem:** blok başına 3-5 paralel sub-agent hat + ana-context kaynak-doğrulama & severity kalibrasyonu + additive kasıtlı-kırmızı test + draft PR. **Prod kod DEĞİŞMEDİ; hiçbir fix yapılmadı** (rapor-önce disiplini). Her blok: `docs/audit/NN-*.md` + `apps/*/audit/*` testleri + PR #327-341.
> **Bu doküman = tek giriş kapısı.** Fix'ler buradan onaya çıkar (ADR-önce + cerrahi + DoD).

---

## 0. Genel hüküm

**v5 çekirdeği üretim-sağlam: para=integer kuruş invariantı uçtan uca tutuyor, multi-tenant izolasyon her katmanda sağlam, native-interop (print + caller) gerçek, KVKK PII disiplini güçlü, `any`=0, secret sızıntısı yok. Denetim 238 bulgu çıkardı; 4 gerçek BLOCKER'ın tamamı 2 dar alanda toplanıyor (sipariş-kalem recalc/kilit + ödeme idempotency-race + client idempotency-key eksikliği) ve hepsi para-bütünlüğü ailesinde.** Kalan risk sistemik değil, noktasal — hedefli bir fix sprint'iyle kapanır.

**Rakamlar:** 12 kod bloğu · **238 konsolide bulgu** · **4 BLOCKER · ~67 HIGH (aile-birleşiminde ~18 iş kalemi) · ~60 MEDIUM · ~55 LOW · ~15 NIT.** 13 draft PR, main değişmedi.

---

## 1. BLOCKER'lar (4) — hepsi para-bütünlüğü, prod CANLI, DEPLOY YOK

| # | ID | Blok | Kök neden | Etki | Fix |
|---|---|---|---|---|---|
| 1 | **MONEY-01** | 5 | `orders.ts insertItemsAndRecalc` recalc'ı iptal-kalemi dışlamıyor (mergeInto dışlıyor — asimetri) | Kalem iptal + yeni kalem → iptal tutarı **dirilir, müşteri fazla öder** | recalc'a `status!='cancelled'` |
| 2 | **DB-TX-01** | 3+5 | `addItems`/`updateItemTx` sipariş satırını kilitlemiyor | İptal edilmiş siparişe kalem eklenebilir (cancel race) → cancelled ama total>0 | order SELECT'e `.forUpdate()` |
| 3 | **DB-TX-05** | 3 | Ödeme idempotency-race recovery'si **aborted-transaction** yüzünden hiç çalışmıyor | Eşzamanlı çift-ödeme denemesinde recovery path patlar (unique constraint çift-tahsilatı önler AMA replay yanıtı hata döner) | savepoint/ayrı-tx ile recovery izole |
| 4 | **M10-A-01** | 10+web | `POST /orders`(+`/items`) idempotency-key'siz + client "Tekrar Dene" aynı cart'ı yeniden gönderir + 15sn timeout belirsizliği | Zayıf WiFi'da **kalem duplikasyonu** (2× fiş + şişmiş adisyon) | ADR-014 §4 deseni: backend replay-guard + web&mobil client key |

**Fix kümeleme:** #1+#2 **tek dosyada** (`insertItemsAndRecalc` — `status!='cancelled'` + `.forUpdate()`, tek PR). #3 ayrı (payments-tx recovery izolasyonu). #4 **üç parça** (api replay-guard + web client-key + mobil client-key, ADR-014 §4 şablonu hazır). **Önce ADR/mini-ADR** (idempotency kontratı + recalc invariantı yazılı), sonra cerrahi.

**Not (kalibrasyon):** Blok 8 P8-ENQ-09 + Blok 11 P11-A-01/A-02 "çift-basma" ve Blok 12 C12-B-01/03 "çağrı-kaybı" sub-agent'larca BLOCKER işaretlendi; ana-context **HIGH/MEDIUM'a kalibre etti** — kağıt/operasyonel etki (para değil) + best-effort tasarım-kabul (caller `drop-oldest`). Gerekçeler ilgili raporlarda. Kullanıcı bunları BLOCKER saymak isterse print-once idempotency ailesi (#aşağıda) yükselir.

---

## 2. HIGH temaları — cross-cutting aileler (tek merkezi fix, çok blokta tekrar)

Bu aileler **birden çok blokta aynı kökle** çıktı; tek fix hepsini kapatır:

1. **response-PII sızıntısı** (`packages/db/errors.ts` + `apps/api/errors.ts` unique/check dalı ham PG detail'i → email/telefon response'a): DB-SEC-01 → API-CORE-01 → R6-CORE-01 (3 blok). Web+mobil RENDER ETMİYOR (iyi) ama backend sızdırıyor. **Tek merkezi fix** (detail'i client'a koyma, logla). MVP-fix.
2. **realtime emit bypass** (kitchen.* 4 site zod-helper atlıyor, şema-uyumsuz `qty≠quantity`): SD-T-B-01 → API-RT-01 → ORD-RT-01. **ADR-gerekli** (emit kontratı tek helper'dan).
3. **permissions matrisi ölü** (`shared-types/permissions.ts` apps/api'de hiç tüketilmiyor, route'lar rol hardcode → drift): SD-T-B-02 → API-AZ-01 → R7-AZ-01. **ADR-gerekli** (matrisi bağla ya da sil).
4. **tz/store-date UTC** (Blok 7 R7-TZ ailesi — rapor sınırları UTC, İstanbul store-date kayması): reports gün-sınırı yanlış hesaplayabilir. **Tek yardımcı** (store-date IANA-aware). MVP-fix. → **KAPANDI:** R7-TZ-11 ✅ (#347 store-date helper) · R7-TZ-12/13 ✅ (ADR-015 Amd5, S96: Z-penceresi `store_date` tek-kaynak + order_no sayacı tx-içi SQL).
5. **reports/order_items index eksik** (DB-TX-04 + R7-AGG-PERF-01 + R6-TBL-01): tek migration; yük harness boş-DB'de gizledi ama gerçek hacimde ısırır. MVP-fix (migration).
6. **CSV formula-injection** (R7-CSV-01 — export'ta `=`/`+`/`@` prefix): tek sanitize. MVP-fix.
7. **print-once idempotency** (Blok 8 P8-ENQ-09 + Blok 11 P11-A-01/A-02): enqueue-dedup + ack-belirsizliği + kısmi-yazım → retry çift-fiş. **ADR-004 §A3.4 yeniden-değerlendir** (prod-canlı). Kağıt-etkili HIGH.

## 3. HIGH — blok-özel (aile-dışı)

- **Blok 1 (shared-domain, 20 HIGH):** SD-P-01/02 fiş NFD+akıllı-tırnak sessiz-bozulma (tek satır) · SD-S-01/13 `raw_phone` deny-katmanlarında yok + TS↔DB drift · SD-M-01..07 dormant para/policy katmanı (bağla-ya-sil, ADR).
- **Blok 2 (shared-types, 7 HIGH):** şema-wire drift aileleri (Blok 5/9/10 mutation-shape ile ilişkili).
- **Blok 5 (7 HIGH):** overpay/merged-terminal guard (PAY-02/03, MONEY-02) para-yolu sertleştirme.
- **Blok 7 (7 HIGH):** tz ailesi (yukarıda) + agregasyon-doğruluk.
- **Blok 9 (web, 4 HIGH):** hata≠boş-durum maskesi (fetch-guard) · "Yazdır" no-op · i18n **38-site hardcoded** (para-yolu UI) · Hızlı Öde >1000₺ onaysız.
- **Blok 10 (mobil, 2 HIGH):** RN netinfo/onlineManager yok (offline algılanmıyor) · socket reconnect resync yok (sessiz bayat veri).
- **Blok 11 (print-agent, 5 HIGH):** config BOM boot-loop · main() hata-yakalama+graceful yok · installer key→history/nssm plaintext · backoff yok (hot-loop) · [çift-basma yukarıda].
- **Blok 12 (caller-bridge, 3 HIGH):** interop dış-kontrat **donanım-doğrulanmamış** (cdecl/BStr — ampirik smoke gerek) · USB-kopma kalıcı sağır · StartAsync try/catch dışı → StopHost sessiz-ölüm.

## 4. Cross-cutting sweep sonuçları (Blok 13-A) — güçlü pozitifler

| Kontrol | Sonuç |
|---|---|
| **Multi-tenant izolasyon** | ✅ TEMİZ — para-mutasyonları (`repo.voidPayment/createTx(trx, tenantId)`) + KVKK purge (`ttl-cleanup` per-tenant) + ~120 repo fn tenant-scope'lu; Blok 3+6 7/7 IDOR; regresyon yok |
| **Para = integer kuruş** | ✅ TEMİZ — float storage YOK; `Number(SUM(_cents))`=aggregate-parse, `/100).toFixed(2)`=display; UI+reports+print katmanlarında da doğrulandı |
| **Secret sızıntısı** | ✅ TEMİZ — `.env` tracked değil, git-geçmişinde `.env/.pem/.key` yok, 0 hardcoded canlı secret, yalnız `.example` template + `_setup-secrets.yml` (GH Secrets referansı) |
| **`any`/`@ts-ignore`** | ✅ prod'da **0** (2 eşleşme yorum-satırı false-pos) |
| **Dairesel bağ (madge)** | ✅ apps/api 173 dosya, **0 circular** |
| **Dead code (knip)** | 🟡 11 kullanılmayan dosya (~8 gerçek: web `EmptyState/ErrorState/card/TableStatusDot/AdminPlaceholder/PhaseLockedEmpty/TakeawayCartPanel/useCart` + `version.ts`) + 37 export (çoğu test/script/public-API). **Silme-önerisi listesi** — CLAUDE.md cerrahi: sorulmadan silinmez |
| **Log/PII hijyeni** | ✅ prod `console.*` yalnız print-agent(20, PII-siz) + web ErrorBoundary(1) + db/seed; müşteri PII log-yolunda yok |
| **Kapsam-kilidi** | ✅ 4 audit branch (#338-341) **yalnız-additive** (git diff: prod src dokunulmadı); rapor önerilerinde kapsam-dışı özellik yok |

## 5. Yük/stres (Blok 13-B) — `13-load.md`
Concurrency/pool/rate-limit **sağlam, geniş marjlı** (read p95=84ms; pool conc=80'de zarif kuyruk, 0 hata; loginLimiter bimodal doğrulandı). **⚠️ Ana sınır:** `pos_test` boş (2 sipariş) → query-performansı ölçülemedi; index bulguları (§2.5) gerçek hacimde ısırır. `void→reopen concurrency` senaryosu (DB-TX-05'in yüzeyi) koşulmadı → fix-sonrası regresyon testi.

## 6. Kapak metrikleri (Blok 0 baseline → hedef)

| Metrik | Baseline (Blok 0) | Hedef |
|---|---|---|
| Test | 1110 test / 70 dosya PASS | + BLOCKER regresyon testleri (idempotency, recalc, void-race) |
| Coverage | ⛔ ölçülemedi (vitest↔coverage-v8 major uyuşmazlık) | vitest/coverage-v8 hizala → api+db para/tenant coverage görünür |
| `any` (prod) | 0 | 0 (koru) |
| Dead files | ~11 (knip) | ~8 sil (onaya tabi) |
| Hardcoded i18n | web ~38 site + mobile 0 | 0 (Blok 9 i18n paketi) |
| Dairesel bağ | 0 | 0 (koru) |
| p95 hot-path | 84ms (boş-DB) | üretim-seed ile yeniden ölç |

## 7. Önerilen fix sırası (bağımlılık grafiği)

**FAZ 1 — Para BLOCKER'ları (ADR-önce, en yüksek öncelik):**
1. Mini-ADR: idempotency kontratı + recalc invariantı + void-race kilit (yazılı karar).
2. MONEY-01 + DB-TX-01 → tek PR (`insertItemsAndRecalc`: `status!='cancelled'` + `.forUpdate()`) + regresyon testi (recalc iptal-kalem + cancel-race).
3. DB-TX-05 → payments-tx recovery izolasyonu (savepoint) + void→reopen concurrency testi.
4. M10-A-01 → api replay-guard + web client-key + mobil client-key (3 parça, ADR-014 §4 şablon).

**FAZ 2 — Cross-cutting HIGH aileleri (merkezi fix, çok blok kapanır):**
5. response-PII (errors.ts merkezi) · 6. tz/store-date yardımcı · 7. reports/order_items index migration · 8. CSV sanitize.
9. **ADR-gerekli:** realtime emit kontratı + permissions matrisi (ikisi ayrı ADR).

**FAZ 3 — App-özel HIGH:**
10. web i18n 38-site + fetch-guard + Yazdır + Hızlı-Öde onay (Blok 9 paketi, hci-gate).
11. mobil netinfo/onlineManager + socket resync.
12. print-agent: config BOM + main() error-handling + installer key + backoff.
13. caller-bridge: StartAsync guard + USB-health + **interop ampirik smoke** (donanım — kullanıcı).
14. print-once idempotency (ADR-004 §A3.4 yeniden-değerlendir).

**FAZ 4 — Kalite/temizlik:**
15. vitest/coverage-v8 hizalama (nicel taban) → **✅ #363 (S95)**. 16. dead-code silme (onaya tabi liste) → **✅ #367/#368 (S96)**. 17. LOW/NIT süpürme → **✅ KAPANDI (S96):** 3 somut fix (eslint kural-key ezmesi [GERÇEK BUG: api/src'de Number-float yasağı sessizce devre dışıydı] + coverage-ignore + storeDate string-binding K10) + kalan ~55 LOW/~15 NIT **resmî v5.1-devir** — envanter+gerekçe `low-nit-devir.md` (hiçbiri MVP-fix etiketli değildi).

**Bağımlılık notu:** FAZ 1 bağımsız-paralel (farklı dosyalar) AMA hepsi mini-ADR'ye bağlı. FAZ 2.5-2.8 birbirinden bağımsız. FAZ 3 app-izole. Coverage hizalama (FAZ 4.15) BLOCKER testlerini ölçülebilir kıldığından **FAZ 1'e paralel çekilebilir** (tooling, prod-kod değişmez).

---

## 8. Onay kapısı
Bu sentez **fix BAŞLATMAZ** (master-prompt PART C + CLAUDE.md core-directive 2). Kullanıcı "başla" derse: **FAZ 1 mini-ADR → MONEY-01+DB-TX-01 PR** ile ADR-önce + cerrahi + DoD akışında ilerlenir. Draft PR'lar (#338-341 + bu #342) fix fazına referans; kasıtlı-kırmızı testler fix landing'inde yeşile döner (regresyon kilidi).
