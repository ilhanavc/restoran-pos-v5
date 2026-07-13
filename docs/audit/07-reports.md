# Blok 7 — apps/api: reports, CSV, timezone

> Derin denetim serisi Blok 7. **Tarih:** 2026-07-11 · **Branch:** `audit/07-reports` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: qa-engineer — timezone/iş-günü · B: qa-engineer — agregasyon para invariantı · C: security-reviewer — CSV injection + authz) + ana-context çapraz doğrulama + severity kalibrasyonu.
> **Canlı test:** SADECE `pos_test` — prod/pos_dev'e HİÇ dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** **5 yeni test dosyası, 31 test (18 yeşil + 13 kasıtlı KIRMIZI).** (Hat C read-only — CSV testini ana-context yazdı.)
> **Ham bulgu:** 13 (A:5, B:3, C:5) → konsolide **13 bulgu: 0 BLOCKER · 7 HIGH · 2 MEDIUM · 4 LOW.**

---

## 0. Yönetici özeti

**Para agregasyonunun ÇEKİRDEĞİ sağlam — asıl risk tarih/tz doğruluğu ve CSV export'ta.**

**✅ Üç büyük para-korkusu temiz (canlı kanıtlı):** (1) **void/iptal/merged ciroya SIZMIYOR** — 8 SUM sitesi `voided_at IS NULL` + `status='paid'` çift-filtre, gerçekten iş yapıyor; (2) **float sızıntısı SIFIR** (integer SUM/`Math.floor`; 25000/3→8333); (3) **Blok 5 PAY-02 phantom ödemesi rapora SIZMIYOR** (`status='paid'` bağımsız ikinci hat). İş-günü motoru (`business-day.ts`) gece yarısı geçişlerinde DOĞRU (canlı); cutoff ADR-015 K7/K10 ile kaldırılmış.

**🟠 7 HIGH — üç temada:**
- **Tarih/tz (4):** takvim-geçersiz tarih 200 dönüp yanlış güne kayıyor (SD-T-C-01 route'ta canlı: `2026-02-30`→2 Mart, `2026-13-01`→2027); `store-date.ts` UTC kullanıyor (okuma default'u Istanbul 00:00-03:00 yanlış gün — **yazma DB-trigger ile güvenli**); daily-close gelir/ödeme pencere tutarsızlığı; order_no_counters vs store_date ayrışma.
- **Agregasyon (1):** anomalies `totalLossCents` ikram+iptal çakışmasında kalemi iki kez sayıyor.
- **CSV export (2):** formula-injection (csvEscape `=/+/-/@` prefix'lemiyor); cashier finansal+personel CSV export edebiliyor (API-AZ-04 kesinleşme, user-performance KVKK).

### Severity kalibrasyonu (şeffaflık)
Hat A 2 bulguyu BLOCKER önerdi → HIGH'a çekildi: (a) **SD-T-C-01** — kullanıcı-girdisi (geçersiz tarih typo) tetikliyor + veri bozulmuyor (yanlış gün gösteriliyor), Blok 2 HIGH ile tutarlı; (b) **R7-TZ-11 store-date UTC** — ana-context doğruladı: `orders.store_date` YAZMASI DB trigger `populate_order_store_date` ile `created_at + tenant_tz`'den yeniden hesaplanıyor (uygulamanın UTC payload'ını override ediyor) → **veri yazma GÜVENLİ**; `todayStoreDate()` UTC yalnız GET/POST default filtresinde → okuma hatası → HIGH. **Bu blokta gerçek BLOCKER YOK.**

### En kritik 3
1. **R7-TZ-11** (HIGH) — `store-date.ts` UTC ≠ DB tenant-tz; okuma default'u gece yarısı penceresinde yanlış gün. Fix: `todayStoreDate()`'i tenant tz'ye taşı.
2. **R7-CSV-01** (HIGH) — CSV formula-injection (stored→admin-export cross-privilege). Fix: `csvEscape`'e `'` prefix (tek fonksiyon).
3. **SD-T-C-01** (HIGH) — takvim doğrulamasız tarih → yanlış günün Z-raporu. Fix: `yyyyMmDd` refine (Blok 2 ile ortak).

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/api/src/routes/reports/` 16 dosya (~2400 LOC) + `utils/{business-day(331), store-date(25), csv-stream(170), csv-format-handler(191)}`. Devir: SD-T-C-01 (Blok 2), API-AZ-04 (Blok 4), PAY-02/MONEY-01 (Blok 5), TERMINAL/void filtreleri (Blok 3).
**Canlı:** pos_test + supertest; gece yarısı sınır, void/reopen, takvim-geçersiz, CSV payload senaryoları.

---

## 2. Bulgular

### 2.1 HIGH (7)

### [HIGH] [BUG] `store-date.ts todayStoreDate()` UTC kullanıyor, tenant tz değil — okuma default'u yanlış gün (ID: R7-TZ-11)
- **Dosya:** `apps/api/src/utils/store-date.ts:12-16` (`Date.UTC(...)`) · kullanım `orders.ts:949,1841` (GET/POST default)
- **Kanıt (ana-context doğrulandı):** `todayStoreDate()` UTC midnight döner; Istanbul UTC+3 → gece 00:00-03:00 arası UTC hâlâ önceki gün → default filtresi önceki günün siparişlerini gösterir. **YAZMA GÜVENLİ:** `orders.store_date` DB trigger `populate_order_store_date` (000_init.sql:81) ile `created_at + tenant_tz`'den yeniden hesaplanıyor (payload override) — DB'de store_date DOĞRU.
- **Etki:** OKUMA/default hatası (yazma değil); gece geç saatte GET /orders default penceresi yanlış gün. store-date.ts yorumu "MVP UTC midnight" itiraf ediyor ama trigger tenant-tz ile tutarsız.
- **Öneri:** `todayStoreDate()`'i tenant tz (Europe/Istanbul) ile hesapla; DB `store_date()` fonksiyonuyla hizala. · **Etiket:** MVP-fix

### [HIGH] [BUG] CSV formula injection — `csvEscape` tehlikeli ilk-karakteri nötrleştirmiyor (ID: R7-CSV-01)
- **Dosya:** `apps/api/src/utils/csv-stream.ts:44-69`
- **Kanıt (ana-context + kırmızı test):** yalnız RFC 4180 quoting (`"`, `;`, CR, LF); `=/+/-/@/\t/\r` prefix YOK. `csv-injection.findings.test.ts` 5 KIRMIZI. Stored vektör: `anomalies.reason` (serbest-metin iptal gerekçesi), top-selling/category product/name, user-performance username.
- **Senaryo (cross-privilege):** düşük-yetkili personel `reason='=cmd|...'` yazar → admin `anomalies?format=csv` Excel'de açar → formül admin makinesinde. (BLOCKER değil: Excel açma + formül onayı gerektiriyor, otomatik değil.)
- **Öneri:** `csvEscape` içinde quoting'den ÖNCE tehlikeli ilk-karakterde `'` prefix (OWASP). Tek fonksiyon, tüm export'lar. · **Etiket:** MVP-fix

### [HIGH] [SEC/KVKK] Cashier finansal + personel CSV export edebiliyor + matris drift (ID: R7-AZ-01 = API-AZ-04)
- **Dosya:** 16 reports route `authorize(['admin','cashier'])` vs `permissions.ts:66` `reports.run`=admin-only · **Kanıt:** cashier `user-performance?format=csv` → personel username + kişi-bazlı ciro (KVKK çalışan verisi) + tüm finansal CSV; JSON view ↔ CSV export rol ayrımı yok. Müşteri PII reports CSV'lerinde YOK (doğrulandı — pozitif).
- **Öneri:** CSV export=`reports.run` (admin), JSON=`reports.read` (cashier); matris-tabanlı middleware. · **Etiket:** ADR-gerekli (Blok 2/4 permissions kablolama kararıyla)

### [HIGH] [BUG] Takvim-geçersiz tarih 200 dönüp yanlış güne kayıyor (ID: SD-T-C-01, Blok 2 route-doğrulama)
- **Dosya:** `reports.ts yyyyMmDd` regex + `daily-close.ts`/`ReportRangeQuerySchema` · **Kanıt (canlı):** `date=2026-02-30`→**200**, pencere 2 Mart; `date=2026-13-01`→**200**, 2027-01-01 (yıl atlıyor). `reports-tz-findings.test.ts` KIRMIZI. Aynı kök 11-endpoint `range=custom` ailesinde.
- **Etki:** Kullanıcı geçersiz tarih (typo) girerse yanlış günün finansal verisini "başarılı" görür. · **Öneri:** `yyyyMmDd`'ye takvim round-trip refine. · **Etiket:** MVP-fix

### [HIGH] [BUG] anomalies `totalLossCents` ikram+iptal çakışmasında kalemi iki kez sayıyor (ID: R7-AGG-10)
- **Dosya:** `reports/anomalies.ts` (cancelVoidLoss + compLoss) · **Kanıt (canlı):** bir kalem ikram edilip SONRA adisyon tamamen iptal edilirse kalem hem cancelVoidLoss hem compLoss'a giriyor (`is_comped` sorgusu order-status'tan bağımsız). `reports-money-findings.test.ts` KIRMIZI. · **Öneri:** iptal/ikram kayıp hesabını mutual-exclusive yap. · **Etiket:** MVP-fix

### [HIGH] [BUG] daily-close gelir/ödeme pencere kaynağı tutarsızlığı (ID: R7-TZ-12)
- **Dosya:** `reports/daily-close.ts` · **Kanıt:** `orders.created_at` vs `payments.created_at` farklı pencere kaynağı → geç kapanan masalarda `totalRevenueCents` ↔ paymentBreakdown/hourlyBuckets uyuşmuyor. · **Öneri:** tek tutarlı pencere kaynağı (store_date). · **Etiket:** MVP-fix

### [HIGH] [BUG] `order_no_counters` vs `orders.store_date` sessiz ayrışma (ID: R7-TZ-13)
- **Dosya:** order-no üretimi vs store_date · **Kanıt (Hat A canlı):** sipariş no sayacı ile store_date farklı tarih kaynağı kullanabiliyor → gün sınırında sayaç/rapor günü ayrışır. · **Öneri:** ikisini aynı business-date kaynağına bağla. · **Etiket:** MVP-fix

*(Türev not — R7-AGG-11 [HIGH]: Blok 5 MONEY-01 recalc bug'ı rapora sızıyor — today-revenue ≠ category-sales aynı adisyon; yeni kök değil, **MONEY-01 fix'i otomatik çözer** — Blok 5'te sayıldı.)*

### 2.2 MEDIUM (2)
- **R7-AGG-PERF-01** [PERF] `orders`/`order_items`'ta rapor sorgularını destekleyen `(tenant_id, created_at)` kompozit index yok; ADR-015 K9'un önerdiği migration hiç yazılmamış (gerçek 028 alakasız). pg_indexes ampirik. 11 endpoint etkilenir, veri hacmiyle büyür. (Blok 3 DB-TX-04 order_items order_id index ile ortak migration.) · MVP-fix/v5.1.
- **R7-DOS-01** [SEC/DoS] `/reports` rate-limit yok (app.ts:165) — cashier 90-günlük export'u limitsiz tekrarlar → exfil + yük. · MVP-fix.

### 2.3 LOW (4)
- **R7-CSV-02** [BUG] `share_pct` `.` ondalık → TR Excel `12.5`'i 125 okuyabilir (para=cents, etkilenmez).
- **R7-CSV-03** [BUG] CSV hücre tarihleri UTC ISO, dosya adı tenant TZ → tutarsız.
- **R7-ROB-01** [ROB] csv-stream "stream" yanlış-isim (tümü belleğe); 100k cap `toCsv`'den SONRA (bellek-koruması değil). Data bounded (range 90g + limit) → kabul.
- **R7-CSV-04** [ROB] parseDateParam UTC (store-date.ts:22) — R7-TZ-11 ailesi, düşük etki.

---

## 3. Temiz çıkan alanlar (canlı kanıtlı)

- **🎯 Void/iptal/merged ciroya SIZMIYOR** — 6 endpoint 8 SUM sitesi `voided_at IS NULL` + `status='paid'` çift-filtre; void+aynı-gün-yeniden-ödeme senaryosunda çift sayım YOK (canlı R7-AGG-02).
- **🎯 Float sızıntısı SIFIR** — tüm para integer SUM veya `Math.floor`; `Math.round` yalnız `sharePct` (yüzde). 25000/3→8333 (canlı R7-AGG-04).
- **🎯 PAY-02 phantom ödeme rapora SIZMIYOR** — `orders.status='paid'` bağımsız ikinci hat 3 ciro endpoint'inden de dışlıyor (canlı R7-AGG-06).
- **İş-günü motoru DOĞRU** — `business-day.ts` Istanbul gece yarısı geçişleri (23:59:59.5 / 00:00:00.5) doğru güne (canlı HTTP+DB, trigger ile tutarlı); cutoff kaldırılmış.
- **CSV RFC 4180 sağlam** — quoting/escape, UTF-8 BOM (Excel), `;` ayırıcı, CRLF, null→boş, no-store cache, export audit (PII taşımıyor).
- **Müşteri PII reports CSV'lerinde YOK** (yalnız finansal + personel); CSV util reports dışında kullanılmıyor.
- **Tenant izolasyonu** her reports SQL'inde `where tenant_id`; range 90g + limit cap.

## 4. Eklenen test envanteri (5 dosya, 31 test)

| Hat | Dosya | Test | Sonuç |
|---|---|---|---|
| A | reports-tz-audit / reports-tz-findings | 7+8 | ✅7 / 🔴6+✅2 |
| B | reports-money-audit / reports-money-findings | 9+2 | ✅9 / 🔴2 |
| ana | csv-injection.findings (R7-CSV-01) | 5 | 🔴5 |

**Kırmızı → bulgu (13):** R7-TZ-08/09/10/11/12/13 (6) · R7-AGG-10/11 (2) · R7-CSV-01 (5).
**Koşu (pos_test):** 31 test → 18 yeşil + 13 kırmızı; tsc + eslint temiz; canlı yalnız pos_test. Tam apps/api paketi regresyonsuz (kırmızılar yalnız yeni findings).
**Not:** Hat C read-only → CSV injection testini ana-context yazdı; authz (cashier export) testi entegrasyon-ağır → Blok 13'e (Blok 4 API-AZ-04 ile).

## 5. Etiket özetleri
- **MVP-fix:** R7-TZ-11 (store-date tz), R7-CSV-01 (csvEscape prefix), SD-T-C-01 (takvim refine — Blok 2 ile), R7-AGG-10 (anomalies double-count), R7-TZ-12 (daily-close pencere), R7-TZ-13 (counters/store_date), R7-DOS-01 (rate-limit), R7-AGG-PERF-01 (index — Blok 3 DB-TX-04 ile).
- **ADR-gerekli:** R7-AZ-01 (CSV export rol ayrımı — permissions kablolama).
- **v5.1-backlog:** R7-CSV-02/03/04, R7-ROB-01.

## 6. Sonraki bloklara devir
- **Blok 13 (fix fazı):** R7-CSV-01 (csvEscape) + R7-AZ-01 (export authz) tek "reports-güvenlik" PR'ı; R7-TZ ailesi (store-date tz + takvim refine + daily-close pencere) tek "tz-doğruluk" PR'ı; R7-AGG-PERF-01 + Blok 3 DB-TX-04 + R6-TBL-01 + DB-MIG-01 tek "index/migration" PR'ı; R7-AGG-11 MONEY-01 fix'iyle otomatik.

## 7. Blok DoD durumu
- [x] 16 reports + 4 util okundu (3 hat + ana-context; BLOCKER-adayları kaynak/canlı teyitli + kalibre)
- [x] tz/iş-günü/agregasyon/CSV denetlendi — **void sızması yok + float yok + phantom sızmıyor** (para çekirdeği temiz)
- [x] Bulgular A.4 (13 ham → 13 konsolide; Hat A 2-BLOCKER kalibrasyonu şeffaf: store_date yazma trigger-güvenli)
- [x] Her HIGH için kırmızı test (R7-TZ×6, R7-AGG×2, R7-CSV×5 canlı/unit); authz testi Blok 13'e
- [x] Canlı testler yalnız pos_test; prod kod değişmedi; bağımlılık yok
- [ ] BLOCKER yok; 7 HIGH Blok 13 sentezine (reports-güvenlik + tz-doğruluk PR'ları)
