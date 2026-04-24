# Architectural Decision Records (ADR)

> Bu dosya projenin mimari karar geçmişini tutar. Her karar immutable'dır — yanlış olduğu anlaşılırsa üzerine yazılmaz, yeni bir ADR ile "superseded" olarak işaretlenir.

## Format

Her ADR:
- **Numara**: Sıralı, 3 hane (ADR-001)
- **Başlık**: Kararın özeti
- **Durum**: `Proposed` | `Accepted` | `Superseded by ADR-XXX` | `Deprecated`
- **Tarih**: YYYY-MM-DD
- **Bağlam**: Neden bir karar gerekiyor
- **Karar**: Ne karar verildi
- **Alternatifler**: Değerlendirilen ve reddedilen seçenekler
- **Sonuçlar**: Pozitif ve negatif sonuçlar

Yeni ADR eklemek için: `/new-adr` slash command'ını kullan. `architect` sub-agent otomatik olarak bağlamı toplar ve dosyayı günceller.

---

## Şablon — her yeni ADR için kopyala

```markdown
## ADR-XXX: <kararın başlığı>

- **Durum**: Proposed
- **Tarih**: YYYY-MM-DD

### Bağlam
<neden bir karar gerekiyor>

### Karar
<ne karar verildi>

### Alternatifler
- **A**: <alternatif 1>
  - Artıları: ...
  - Eksileri: ...
  - Neden reddedildi: ...
- **B**: <alternatif 2>
  - ...

### Sonuçlar
- (+) <pozitif sonuç>
- (+) <pozitif sonuç>
- (−) <negatif sonuç / ödünleşim>

### Referanslar
- ADR-XXX (ilgili karar, varsa)
- Issue: #N (varsa)
- PR: #N (varsa)
```

---

## Aktif kararlar

<!-- ADR'lar buraya eklenir, kronolojik sırada -->

---

## ADR-003: DB Şema İlkeleri

- **Durum**: Draft (in-progress — bölüm bölüm yazılıyor)
- **Tarih**: 2026-04-23
- **Yazım sırası notu**: ADR numarası sabit, yazım sırası ADR-003 → ADR-001 → ADR-002 (gerekçe: monorepo yapısı migration tool kararına bağımlı, auth şemaya bağımlı — bkz. active-plan.md).

### Özet

Bu ADR, v5 PostgreSQL 17 şemasının uyması gereken **ilkeleri** tanımlar. Tablo tanımları değil, tablo tanımlarken uyulacak kurallar. Çıktıları: `packages/db/migrations/000_init.*` şablonu, `packages/db/tests/store-date-parity.test.ts` iskelet testi, `packages/db` boilerplate.

### Outline (16 bölüm)

1. **Context** — v3 şema ağrıları (pain-points P-06…P-10), v5 ilkelerinin gün 1 kilitlenme gerekçesi.
2. **Para & Sayısal Tipler** — `*_cents INT`, vergi `*_bps SMALLINT`, float yasak.
3. **Primary Key — UUID v7 App-Side** — `uuidv7` npm paketi, DB default yok (parent/child roundtrip sorunu).
4. **Zaman & İş Günü Modeli** — `TIMESTAMPTZ NOT NULL`, cutoff 04:00 Europe/Istanbul, `tenant_settings.business_day_cutoff_hour`, cutoff değişikliği audit'e düşer.
5. **store_date() Çift Katman + Parity Test** — DB fonksiyonu primary + TS util `toStoreDate()`, ~50 isimli kenar durum + property-based 10k rastgele, CI gate.
6. **Multi-Tenant İzolasyon** — `tenant_id UUID NOT NULL FK` her business tabloda, tüm UNIQUE'lerde prefix.
7. **Snapshot İnvaryantı** — order_items / orders / call_logs snapshot kolonları NOT NULL (P-08, Sinyal #6, #35).
8. **Soft vs Hard Delete** — referans varsa soft (`deleted_at`), yoksa hard; `canHardDelete()` helper (Sinyal #7).
9. **Enum Kullanımı** — PG native enum (order_status, order_type, payment_type{cash,card}, print_job_*, user_role); ikram enum değil.
10. **Ödeme Modeli & İnvaryantları** — (a) İkram modeli (is_comped + is_fully_comped) ve **enforcement authority (DB trigger 3 kural) + service/UX layer (OrderCompService)**; (b) Parçalı ödeme: N payments satırı, split enum değil.
11. **order_no Günlük Unique** — `store_date(created_at, tenant_id)` bazlı partial unique; 23:50 açılıp 00:10 ödenen sipariş açılış gününde.
12. **Audit Log Şema Kontratı** — `audit_logs` tablosu + `ip_address INET NULL` (doldurma ADR-002'ye), PII sanitize TS kontratı `AuditSanitizer<T>` deny-list ilkesi.
13. **Retention & TTL Cleanup** — call_logs 30 gün, audit_logs 2 yıl, merkezi `apps/api/src/cron/ttl-cleanup.ts`.
14. **Kritik Index'ler** — tek masa=tek açık adisyon partial unique, phone unique, order_no günlük, print_jobs idempotency.
15. **Migration Stratejisi — Forward-Only + Tool Seçimi** — node-pg-migrate (migration) + kysely (runtime) + kysely-codegen (tip üretimi); down yok; dev-reset yalnız local; drift detection **varlığı bu ADR'de zorunlu kural**, CI implementasyonu ADR-001'de.
16. **Consequences** — pozitif/negatif ödünleşimler.

---

### Bölüm 1 — Context

v3 SQLite şeması organik büyümüştü: float para (`grand_total REAL` + sonradan `grand_total_cents INT`), telefon UNIQUE eksik, kategori snapshot'ı sonradan eklendi, audit log retention yok, iki ayrı `incoming_calls` + `call_logs` tablosu. Her biri üretime girmiş pain-point (`docs/v3-reference/pain-points.md` P-06…P-10).

v5 sıfırdan kurulduğu için şema ilkeleri gün 1'de kilitlenmeli — yoksa aynı borcu tekrar yaratırız. Bu ADR, tablo tanımlarından önce tablo tanımlama kurallarını belirler. Kapsamı: tip/kolon konvansiyonları, invaryant enforcement mekanizması, migration stratejisi ve aracı, TTL politikası. Kapsam dışı: iş mantığı akışı, endpoint tasarımı, event taxonomy detayı (ayrı ADR, Sinyal #39), CI job mekanik kurulumu (ADR-001).

Altyapı varsayımları:
- **PostgreSQL 17** — Hetzner Cloud Almanya; 18'e atlamayız, 16'ya düşmeyiz.
- **DB katmanı `packages/db/`** altında yaşar: `migrations/`, `schema/`, `src/client.ts`, `tests/`. `apps/api` bu paketi tüketir. Monorepo yerleşimi ADR-001'de resmîleşir; bu ADR yapıyı varsayar.
- **Multi-tenant ready, single-tenant starting** — MVP tek tenant, `tenant_id` kolonu gün 1 şemada.

---

### Bölüm 2 — Para & Sayısal Tipler

**Kural:** Tüm parasal alanlar `INTEGER NOT NULL` tipinde, isim konvansiyonu `*_cents` (kuruş, minor unit). `NUMERIC`, `DECIMAL`, `REAL`, `DOUBLE PRECISION`, `FLOAT` para için **yasak**. Vergi oranları `*_bps SMALLINT` (basis points; 1800 = %18.00).

**Gerekçe:**
- v3'te `grand_total REAL` + `grand_total_cents INT` çift saklama → raporlarda `COALESCE(x.amount_cents, ROUND(x.amount * 100))` pattern + yuvarlama farkları (Sinyal #21, P-06).
- JavaScript `number` tipi `Number.MAX_SAFE_INTEGER` (2^53 − 1) aralığında; kuruş cinsinden 90 trilyon TL'ye kadar güvenli — restoran için sonsuz.
- ESLint kuralı: `number` tipinde kolon adlandırması `*_cents` veya `*_bps` **dışında** ise tip kontrolü hata verir (custom rule, ADR-001'de CI'a bağlanır).

**Döviz kuru / çoklu para:** Yok. Pilot TRY tek. Gerekirse ayrı ADR.

---

### Bölüm 3 — Primary Key: UUID v7 App-Side

**Kural:** Tüm PK'ler `UUID` tipinde. Üretim **uygulama tarafında** `uuidv7` npm paketi ile yapılır. DB default (`gen_random_uuid()`, `uuid_generate_v4()`) **kullanılmaz**.

**Gerekçe:**
- **Roundtrip eliminasyonu:** Parent satırı INSERT edip `RETURNING id` ile çocuk INSERT için beklemek yerine, ID app tarafında önceden üretilir → parent + children tek transaction'da batch insert edilebilir.
- **Zaman-sıralı:** UUID v7 yüksek 48 bit = unix timestamp ms. B-tree index locality v4'e göre çok daha iyi (random v4 → cache miss), INSERT-heavy tablolarda (orders, order_items, audit_logs) fark ölçülebilir.
- **Debug/grep:** Log'da görünen UUID v7 zaman bilgisi içerir — "bu kayıt ne zaman oluştu" sorusu eldeki ID'den direkt cevaplanır.
- **Multi-tenant + cloud:** INT AUTOINCREMENT merge/restore senaryolarında çakışır; UUID tenant-agnostic.

**Uygulama:**
```ts
// packages/db/src/id.ts
import { v7 as uuidv7 } from 'uuidv7';
export const newId = (): string => uuidv7();
```

Migration scriptlerinde UUID gerekirse PG tarafında `gen_random_uuid()` kullanılabilir (seed data için istisna, runtime yolu değil). Bu istisna migration başlığında yorumla belgelenir.

---

### Bölüm 4 — Zaman & İş Günü Modeli

**Kural 4.1 — Timestamp tipi:** Tüm timestamp kolonları `TIMESTAMPTZ NOT NULL`. `TIMESTAMP WITHOUT TIME ZONE` **yasak**. Her tablo `created_at` ve (mutable tablolar) `updated_at` kolonlarına sahip; DEFAULT `now()`.

**Kural 4.1.1 — `updated_at` auto-update trigger:** Her `updated_at` kolonlu tablo için `BEFORE UPDATE` trigger, `NEW.updated_at = now()` atar. Generic fonksiyon `set_updated_at()` 000_init'te bir kez tanımlıdır; her mutable tablo aynı fonksiyona bağlanır. Uygulama katmanı `updated_at`'i **elle yazmaz** — DB otoritatif, bypass yasak. Şablon:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- her mutable tabloya (örnek tenant_settings için):
CREATE TRIGGER tenant_settings_set_updated_at
  BEFORE UPDATE ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Kural 4.2 — İş günü ≠ takvim günü:** POS gün sonu 00:00'da değil, işletme kapandıktan saatler sonra biter. v3'te `store_date()` yardımcı fonksiyonu vardı ama cutoff hardcoded idi. v5'te cutoff çoklu-tenant hazır, tenant seviyesinde yaşar.

**4.3 — `tenant_settings` tablo şeması (kontrat):**

ADR gömülü CREATE TABLE kontratı; 000_init migration'ı bu şablonu birebir kopyalar (drift koruma). `tenants` tablo tanımı **Bölüm 6**'da; 000_init sıralaması: `tenants` → `tenant_settings` (FK bağımlılığı).

```sql
CREATE TABLE tenant_settings (
  tenant_id                UUID PRIMARY KEY REFERENCES tenants(id),
  timezone                 TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  business_day_cutoff_hour SMALLINT NOT NULL DEFAULT 4
    CHECK (business_day_cutoff_hour BETWEEN 0 AND 23),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**PK pattern (singleton per tenant):** `tenant_id PRIMARY KEY` bilinçli — tablo tenant başına **tek satır** tutar, `id UUID PK + tenant_id UNIQUE` kalıbı kullanılmaz. Gerekçe: (a) JOIN path tek hop (`tenants.id = tenant_settings.tenant_id`); (b) "hangi tenant_id için hangi ayar id'si" araması yok; (c) multi-tenant'ta satır başına garanti.

**4.4 — `timezone` doğrulama trigger'ı:**

`timezone TEXT` kolonu IANA zone adı tutar. CHECK constraint içinde subquery yasak (`EXISTS (SELECT 1 FROM pg_timezone_names …)` IMMUTABLE değil). Doğrulama **trigger** ile yapılır:

```sql
CREATE OR REPLACE FUNCTION validate_timezone() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_settings_tz_check
  BEFORE INSERT OR UPDATE OF timezone ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION validate_timezone();
```

Uygulama katmanı Zod şemasıyla client tarafta da doğrulama yapar; ama **otorite DB trigger'ında** — bozuk satır imkansız.

**4.5 — Cutoff / timezone değişikliği audit kuralı:**

`tenant_settings` UPDATE işlemleri `audit_logs`'a zorunlu düşer (`event_type` örnek: `tenant_settings.update` — tam event taxonomy formatı ayrı ADR'de kesinleşir, Sinyal #39). Payload: before/after snapshot, actor user_id. ADR-003'ün zorladığı: **event'in mutlaka yazılması**; string format ve taxonomy sorumluluğu Audit Event Taxonomy ADR'sinindir. Geçmiş rapor karşılaştırması için kritik; aynı gün iki kez kapanmış gibi görünmesin.

**4.6 — İlk seed:** Tek tenant için `tenant_id = <uuid>`, `timezone = 'Europe/Istanbul'`, `business_day_cutoff_hour = 4`. Seed 000_init'in son bloğunda.

**4.7 — Cutoff granularity bilinçli kısıtlama:**

`business_day_cutoff_hour SMALLINT` **saat-bazlı** (0..23, dakika yok). Pide/lokanta/kafe tipolojisi için yeterli — kimse 04:30'da kapamaz. Dakika hassasiyeti gerektiren tenant tipolojisi (bar, gece kulübü, 7/24 operasyon) ileride ortaya çıkarsa `cutoff_time TIME NOT NULL` kolonuna **forward-only migration** ile geçilir; DB fonksiyonu ve TS util imzaları o zaman güncellenir. MVP kapsamı dışı — bugünün basitliği gelecekte iki-migration pattern (ADD column + backfill + DROP old) ile çözülür, bugün büyük fonksiyon imzası taşımayız.

**Gerekçe multi-tenant:** Cutoff env'de olursa ikinci tenant farklı kapanış saati istediğinde migration gerekir. `tenant_settings`'e koymak bu bedeli gün 1'de öder; env-based alternatif bilinçli olarak reddedildi.

**Örnek (cutoff 04:00):**
- 23 Nisan 23:50'de açılan sipariş → store_date = 2026-04-23
- 24 Nisan 03:55'te açılan sipariş → store_date = 2026-04-23 (hâlâ önceki iş günü)
- 24 Nisan 04:05'te açılan sipariş → store_date = 2026-04-24

---

### Bölüm 5 — store_date() Çift Katman + Parity Test

**Kural:** `store_date()` hesaplaması hem DB hem TS katmanında **aynı formülle** tanımlı, iki implementasyon + parity test ile eşitlik garanti altında.

**5.1 — DB fonksiyonu: IMMUTABLE, saf argümanlı**

Fonksiyon **IMMUTABLE** olmak zorunda — fonksiyonel index'lerde kullanılabilmesi ve PostgreSQL planner'ının constant-fold edebilmesi gerekli. `tenant_settings` tablosundan okuma yapan plpgsql varyantı `STABLE`'a düşer → reddedilir.

**Karar:** Cutoff hour ve tz fonksiyona **parametre olarak geçirilir**; fonksiyon saf (pure), IMMUTABLE, PARALLEL SAFE.

```sql
CREATE OR REPLACE FUNCTION store_date(
  ts          TIMESTAMPTZ,
  cutoff_hour SMALLINT,
  tz          TEXT
) RETURNS DATE
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ((ts AT TIME ZONE tz) - make_interval(hours => cutoff_hour))::DATE;
$$;
```

**5.1.1 — IMMUTABLE taahhüdü (bilinçli sözleşme, N1):**

**Teknik gerçek:** PG 17'de `timestamptz AT TIME ZONE text` operatörü `pg_proc.provolatile = 's'` (STABLE), IMMUTABLE **değil**. Gerekçe: `text` argümanı runtime'da değerlendirilen IANA zone adı; çözülmesi `pg_timezone_names`/`pg_timezone_abbrevs` üzerinden geçer, bu view'lar tzdata kütüphane çağrılarına dayanır. Eğer tzdata değişirse `AT TIME ZONE` aynı input için farklı output verebilir — STABLE semantiği bu.

**Taahhüt:** SQL fonksiyonunu `IMMUTABLE` markalamamız zorunluluktur (fonksiyonel index + constant-fold), ama bu bir **operasyonel taahhüt** — "tzdata değişmediği sürece fonksiyon IMMUTABLE davranır" sözleşmesi. Üç tarafla doğrulanır:

- **(a) Test izolasyonu:** Parity testi sabit imaj ile koşar (`postgres:17.2-bookworm`, Debian tzdata sürümü imaj ile pin'li). Bkz. 5.4.
- **(b) Prod imaj pin'i — ADR-001 bağı (explicit contract):** Production PostgreSQL container'ı **tag ile pin'li** olmak zorunda (`postgres:17.2-bookworm` veya ADR-001'de kararlaştırılacak eş-pin imaj); `:17`, `:latest`, `:bookworm` gibi moving tag yasak. Ayrıca imaj içi tzdata **otomatik güncellenmez** (`unattended-upgrades` tzdata için disabled; deploy akışında `apt-get upgrade tzdata` çağrısı yasak). **Bu taahhüt ADR-001'in CI/deploy scope'unun parçasıdır**; ADR-001 yazılırken "container imaj pinleme politikası" bölümü ADR-003/5.1.1'e atıf içerecek. İki ADR arası bu sözleşme olmadan IMMUTABLE markalama güvensiz.
- **(c) tzdata update runbook:** tzdata sürümü bilinçli değiştirilirse (güvenlik/compliance), sabit prosedür: (1) yeni imaj ile parity test suite'i tamamıyla yeniden koşturulur — başarısız ise tzdata rollback; (2) `store_date` kullanan tüm fonksiyonel index'ler `REINDEX` edilir (IMMUTABLE varsayımı altında cache'lenen değerler invalidate olur); (3) değişiklik audit log'a düşer (`event_type = 'infra.tzdata.updated'`); (4) ilgili raporların cutoff-boundary siparişlerinde drift kontrolü. Runbook `docs/ops/tzdata-update.md` (Phase 5 öncesi yazılır).

**Downgrade yasağı:** Gelecekte hiçbir katkıcı bu fonksiyonu `STABLE` ya da `VOLATILE`'a düşürmesin; her iki downgrade fonksiyonel index'i ve planner optimizasyonunu kırar, migration `db-migration-guard` tarafından reddedilir.

**5.1.2 — Named parameters zorunlu:**

Fonksiyon çağrılarında **named parameter notasyonu zorunlu**, pozisyonel çağrı yasak. Gerekçe: parametre sırası ADR'de sabitlendiğinde bile çağrı yüzeyinde yanlış sıralama (cutoff ↔ tz flip) compile-time yakalanmaz, runtime'da yanlış store_date üretir.

✅ **Doğru:**
```sql
SELECT store_date(ts => o.created_at, cutoff_hour => 4, tz => 'Europe/Istanbul');
```
```ts
toStoreDate({ ts: order.createdAt, cutoffHour: 4, tz: 'Europe/Istanbul' })
```

❌ **Yasak:**
```sql
SELECT store_date(o.created_at, 4, 'Europe/Istanbul');  -- pozisyonel
```

**CI lint (Phase 0 sonu):** SQL'de `store_date(` çağrısının `=>` içermeyen formu grep-based pre-commit hook ile reddedilir; TS tarafında `toStoreDate` imzası sadece object parametre alacak (positional arg imkansız). İki taraflı şema-level enforcement.

**5.2 — `orders.store_date` stored kolon + trigger pattern (append-only)**

Fonksiyonel index'te `tenant_settings`'ten okuma yapmak imkansız olduğu için `orders` tablosunda **stored kolon** tutulur:

```sql
-- orders tablosunda:
store_date DATE NOT NULL  -- trigger ile doldurulur, append-only
```

**Üç trigger (INSERT + UPDATE guards):**

```sql
-- (a) INSERT: store_date'i tenant_settings'ten hesapla
CREATE OR REPLACE FUNCTION populate_order_store_date() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff SMALLINT;
  v_tz     TEXT;
BEGIN
  SELECT business_day_cutoff_hour, timezone
    INTO v_cutoff, v_tz
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_settings missing for tenant_id=% (orders insert blocked)', NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.store_date := store_date(ts => NEW.created_at, cutoff_hour => v_cutoff, tz => v_tz);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_populate_store_date
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION populate_order_store_date();

-- (b) UPDATE guard: created_at ve store_date append-only
CREATE OR REPLACE FUNCTION reject_temporal_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'orders.created_at is append-only (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.store_date IS DISTINCT FROM NEW.store_date THEN
    RAISE EXCEPTION 'orders.store_date is append-only (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_reject_temporal_update
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION reject_temporal_update();
```

**Append-only kuralı (B1):** `orders.created_at` ve `orders.store_date` — kolon düzeyinde **immutable**. Backoffice düzeltmesi, fixture reset, migration script'i — hiçbiri UPDATE edemez. Değişiklik gerekirse yeni sipariş oluştur + eskiyi cancel, iz audit'e düşsün. DB trigger bypass imkansız kılar.

**Cutoff değişikliği sabit davranış (N2):** Stored kolon bilinçli tercih. `tenant_settings.business_day_cutoff_hour` sonradan değişse bile tarihsel `orders.store_date` **sabit kalır** — raporlar stabil, cutoff değişikliği audit'e düşer (Bölüm 4.5). Rapor karşılaştırmasında "aynı tanımla yeniden hesapla" ihtiyacı doğarsa ayrı `recompute_store_date()` batch job ADR'si gerekir — **v5.0 MVP kapsamında değil.**

**DB otoritatif, app override imkansız:** Application layer `orders.store_date` değerini INSERT payload'ında **göndermez**; gönderse bile BEFORE INSERT trigger değeri üzerine yazar (NEW.store_date unconditional atama). Orm/query builder "explicit insert all columns" modunda çalışsa dahi sonuç aynı — trigger son sözü söyler. Bu tasarım bilinçli: `store_date` DB-otoriteli, app tarafı manipüle edemez, test fixture'ı bile bypass yapamaz. Kysely insert tiplerinde `store_date` alanı `Generated<...>` olarak işaretlenir (kysely-codegen + DEFAULT-like semantic; runtime'da trigger dolduruyor olsa da tip sisteminde app insert etmesi engellenir).

Aynı pattern `period_closes.store_date` ve raporlarda ad-hoc `store_date(ts => …, cutoff_hour => …, tz => …)` çağrısı olarak kullanılır (named parameter zorunluluğu, bkz. 5.1.2).

**5.3 — TS util (paralel, domain/app için)**

**İmza (N7):** Util `Date` nesnesi alır, **string almaz**. Input format ayrıştırma sorumluluğu util dışında; util sadece hesap yapar.

```ts
// packages/shared-domain/src/storeDate.ts
export interface ToStoreDateArgs {
  ts: Date;              // native Date — string kabul edilmez
  cutoffHour: number;    // 0..23
  tz: string;            // IANA timezone (validated upstream)
}

// Object parametre zorunlu (bkz. 5.1.2) — positional call compile-time imkansız.
export function toStoreDate(args: ToStoreDateArgs): string {  // ISO 'YYYY-MM-DD'
  // ...
}
```

**Temporal API + polyfill (N5 + kullanıcı ek koşulu):**

DST spring-forward nonexistent local time ve fall-back ambiguous time davranışını deterministik yapmak için TS tarafında **Temporal API (TC39 stage-3)** kullanılır. Native Temporal henüz yaygın değil → `@js-temporal/polyfill` bağımlılığı eklenir.

**Tip sızdırma yasağı (kritik kural):** Temporal tipleri (`Temporal.ZonedDateTime`, `Temporal.PlainDate`, vb.) **`packages/db` sınır dışına sızmaz**. `toStoreDate()` ve benzer util imzaları **native JS tipleri döner** (`Date`, `string`, `number`). Polyfill iç implementasyon detayıdır.

Gerekçe: Gelecekte native `Temporal` geldiğinde **geçiş tek import değişimi** olacak (`@js-temporal/polyfill` → builtin). İmza yüzeyi sabit kalır, çağıran kod etkilenmez. Bundle boyutu + framework bağımlılığı bu kararın parçası → ADR-level.

**Disambiguation:** Temporal çağrılarında `disambiguation: 'compatible'` kullanılır (PG `AT TIME ZONE` nonexistent local için bir sonraki geçerli saati döner; `compatible` aynı davranış). `Intl.DateTimeFormat` nonexistent/ambiguous local time'da undefined behavior → **kullanılmaz**.

**5.4 — Parity Test Altyapısı + tzdata Sanity Check**

`packages/db/tests/store-date-parity.test.ts` CI gate, PR bloklayıcı.

**Altyapı (tam cümle):** Parity testi **`@testcontainers/postgresql` (testcontainers-node) ile izole PG 17 container'ında** koşar; monorepo root'taki `docker compose` servisine **bağlanmaz**. Gerekçe: (1) testler paralel güvenli — her test kendi container'ını alır; (2) PG versiyonu kodla birlikte pin'lenir — **imaj tag `postgres:17.2-bookworm`** (tzdata Debian apt paketi, sürüm kodla birlikte release'lenir); (3) dev makinesindeki manuel Postgres'ten bağımsız, "benim makinemde çalışıyor" sınıfını eler; (4) CI runner izole. ADR-001 bu kararı CI job tanımıyla operasyonelleştirir ama **izolasyon gereksinimi ADR-003'ün parçası**.

**Node ICU gereksinimi:** Node.js 22 **full-icu** build kullanılır (küçük ICU → slim imajlarda eksik tzdata → parity false-pass riski). `package.json engines` veya Dockerfile'da explicit kontrol. TS tarafı Temporal polyfill + Node ICU birlikte çalışır.

**tzdata sanity check (B2) — fail-fast, parity suite başında:**

PG container ile Node ICU tzdata sürüm farkı CI'da parity'yi sessizce bozabilir (örn. 2016-09-07 Türkiye sabit UTC+3 geçişi bir tarafta, diğerinde yok). Suite'in ilk test bloğu aşağıdaki abbrev listesini **her iki tarafta enumerate** eder; eşleşmeyen satır **fail-fast** (diğer testler hiç koşmaz):

| Abbrev | Zone | PG kontrolü | Node kontrolü |
|---|---|---|---|
| `+03` | Europe/Istanbul, current (2016+) | `SELECT abbrev, utc_offset FROM pg_timezone_abbrevs WHERE abbrev='+03'` | `Intl.DateTimeFormat('en-US', {timeZone:'Europe/Istanbul', timeZoneName:'shortOffset'}).formatToParts(new Date('2024-06-15T12:00:00Z'))` → "GMT+3" |
| `EET` | Europe/Istanbul tarihsel standart (pre-2016) | `SELECT … WHERE abbrev='EET'` | Node `Intl` tarihsel tarih için (`new Date('2015-01-15T12:00:00Z')`) → "GMT+2" |
| `EEST` | Europe/Istanbul tarihsel DST (pre-2016) | `SELECT … WHERE abbrev='EEST'` | Node `Intl` (`new Date('2015-07-15T12:00:00Z')`) → "GMT+3" |
| `TRT` | Turkey Time (tarihsel alias; tzdata'da `Europe/Istanbul` zone.tab satırı) | `SELECT name FROM pg_timezone_names WHERE name='Turkey'` (Turkey alias beklenen) | Node `Intl.supportedValuesOf('timeZone').includes('Turkey')` → true |
| `UTC` | sanity | `SELECT … WHERE abbrev='UTC'` | `Intl … timeZone:'UTC'` → "GMT" |
| `+14` | Pacific/Kiritimati (uç offset) | `SELECT name FROM pg_timezone_names WHERE name='Pacific/Kiritimati'` | `Intl.supportedValuesOf('timeZone').includes('Pacific/Kiritimati')` |
| `-11` | Pacific/Niue (uç negatif) | `SELECT name FROM pg_timezone_names WHERE name='Pacific/Niue'` | `Intl.supportedValuesOf('timeZone').includes('Pacific/Niue')` |
| `+05:45` | Asia/Kathmandu (15-dk offset) | `SELECT name FROM pg_timezone_names WHERE name='Asia/Kathmandu'` | `Intl.supportedValuesOf('timeZone').includes('Asia/Kathmandu')` |

Her satır için assert: PG `utc_offset` ↔ Node `formatToParts(timeZoneName:'shortOffset')` **aynı offset** (dakika çözünürlüğünde). Herhangi bir satır fail → suite **aborted**, error mesajında PG imaj tag'i + Node version + ICU version basılır.

**Historical tzdata assertions (B2b, ek 3 satır):** Yukarıdaki offset tablosu *bugünkü* offset'i kontrol eder; aşağıdaki 3 tarihsel timestamp ise **tzdata tarihsel kayıtlarının PG ve Node arasında eşit** olduğunu ispat eder. Bu olmadan case #24-29 (Türkiye tarihsel DST + 2016 kalıcı geçiş) ve #45 (Samoa 2011 atlanan gün) başarısız olduğunda sebep tzdata versiyonu mu yoksa fonksiyon bug'ı mı ayırt edilemez.

| # | Tarihsel assert | PG | Node |
|---|---|---|---|
| H1 | `2015-03-29 03:30 Europe/Istanbul` → UTC | `SELECT '2015-03-29 03:30:00'::timestamp AT TIME ZONE 'Europe/Istanbul'` beklenen: `2015-03-29 00:30:00+00` (DST sonrası UTC+3) | `Temporal.ZonedDateTime.from('2015-03-29T03:30:00[Europe/Istanbul]').toInstant().toString()` beklenen: `2015-03-29T00:30:00Z` |
| H2 | `2011-12-30 12:00 Pacific/Apia` (atlanan gün) | PG `AT TIME ZONE` + `compatible` semantiği: Apia'da 30 Aralık hiç olmadı; PG next-valid-local davranışı 2011-12-31 12:00+13 → UTC `2011-12-30 23:00+00` | Temporal `disambiguation:'compatible'` aynı: `2011-12-30T23:00:00Z`. Eşit sonuç → tzdata Samoa geçişini içeriyor. |
| H3 | `2016-10-30 02:30 Europe/Istanbul` (post permanent shift) | Eski tzdata (< 2016e) UTC+2 yorumlar → yanlış; doğru tzdata UTC+3 sabit yorumlar → UTC `2016-10-29 23:30+00` | Node Temporal aynı: `2016-10-29T23:30:00Z`. Eşitsizlik → bir taraf pre-2016-fix tzdata kullanıyor, parity anlamsız. |

Üç satır aynı anda assert edilir; herhangi biri fail → suite **aborted**, "tzdata historical drift" hatası + PG imaj tag + Node tzdata kaynağı (ICU vs embedded) log'lanır. Bu 8+3 satır **minimum** — case #24-29, #45 ve Property-based tz kümesi bu sanity'nin geçtiği varsayımıyla koşar.

**5.4.a — Named edge cases (48 case, tam enumerate):**

Tablo formatı: `#` numara, `Kategori`, `Input (ts · tz · cutoff_hour)`, `Expected store_date`. Her case tek satır, parity test `test.each(cases)` ile koşar.

| # | Kategori | Input (ts · tz · cutoff) | Expected |
|---|---|---|---|
| 1 | Normal gün cutoff −1μs | `2026-04-23 03:59:59.999+03` · Europe/Istanbul · 4 | `2026-04-22` |
| 2 | Normal gün cutoff exact | `2026-04-23 04:00:00.000+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 3 | Normal gün cutoff +1μs | `2026-04-23 04:00:00.001+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 4 | Gece yarısı −1μs | `2026-04-23 23:59:59.999+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 5 | Gece yarısı exact | `2026-04-24 00:00:00.000+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 6 | Gece yarısı +1μs | `2026-04-24 00:00:00.001+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 7 | Cutoff=0 midnight −1μs | `2026-04-23 23:59:59.999+03` · Europe/Istanbul · 0 | `2026-04-23` |
| 8 | Cutoff=0 midnight exact | `2026-04-24 00:00:00.000+03` · Europe/Istanbul · 0 | `2026-04-24` |
| 9 | Cutoff=0 midnight +1μs | `2026-04-24 00:00:00.001+03` · Europe/Istanbul · 0 | `2026-04-24` |
| 10 | Cutoff=6 −1μs | `2026-04-23 05:59:59.999+03` · Europe/Istanbul · 6 | `2026-04-22` |
| 11 | Cutoff=6 exact | `2026-04-23 06:00:00.000+03` · Europe/Istanbul · 6 | `2026-04-23` |
| 12 | Cutoff=6 +1μs | `2026-04-23 06:00:00.001+03` · Europe/Istanbul · 6 | `2026-04-23` |
| 13 | Cutoff=12 midday −1μs | `2026-04-23 11:59:59.999+03` · Europe/Istanbul · 12 | `2026-04-22` |
| 14 | Cutoff=12 midday exact | `2026-04-23 12:00:00.000+03` · Europe/Istanbul · 12 | `2026-04-23` |
| 15 | Cutoff=12 midday +1μs | `2026-04-23 12:00:00.001+03` · Europe/Istanbul · 12 | `2026-04-23` |
| 16 | Yıl sonu cutoff −1μs | `2026-01-01 03:59:59.999+03` · Europe/Istanbul · 4 | `2025-12-31` |
| 17 | Yıl sonu cutoff exact | `2026-01-01 04:00:00.000+03` · Europe/Istanbul · 4 | `2026-01-01` |
| 18 | Yıl sonu cutoff +1μs | `2026-01-01 04:00:00.001+03` · Europe/Istanbul · 4 | `2026-01-01` |
| 19 | Leap (2024-02-29) cutoff −1μs | `2024-02-29 03:59:59.999+03` · Europe/Istanbul · 4 | `2024-02-28` |
| 20 | Leap cutoff exact | `2024-02-29 04:00:00.000+03` · Europe/Istanbul · 4 | `2024-02-29` |
| 21 | Leap crossing (March 1) | `2024-03-01 03:59:59.999+03` · Europe/Istanbul · 4 | `2024-02-29` |
| 22 | Gregorian invalid (2100-02-29, century non-leap) | Input string `2100-02-29 12:00:00+03` · Europe/Istanbul · 4 | **Invalid date parity**: PG `invalid_datetime_format` / JS `RangeError` — **her iki tarafın aynı hata sınıfıyla fail etmesi** başarı kriteri (parity geçer); sessiz geçerli kabul yasak. |
| 23 | Gregorian 400-rule valid (2400 leap) | `2400-02-29 12:00:00+03` · Europe/Istanbul · 4 | `2400-02-29` |
| 24 | Türkiye 2015 spring pre-gap | `2015-03-29 01:30:00 Europe/Istanbul` (UTC+2 EET) · Europe/Istanbul · 4 | `2015-03-28` |
| 25 | Türkiye 2015 spring nonexistent | `2015-03-29 02:30:00 Europe/Istanbul` (lokal **nonexistent**, `disambiguation:'compatible'` → 03:30 UTC+3) · Europe/Istanbul · 4 | `2015-03-28` |
| 26 | Türkiye 2015 spring post-gap | `2015-03-29 04:00:00 Europe/Istanbul` (UTC+3 EEST) · Europe/Istanbul · 4 | `2015-03-29` |
| 27 | Türkiye 2015 fall ambiguous (DST +03) | `2015-10-25T03:30:00+03:00` (ilk 03:30, EEST) · Europe/Istanbul · 4 | `2015-10-24` |
| 28 | Türkiye 2015 fall ambiguous (std +02) | `2015-10-25T03:30:00+02:00` (ikinci 03:30, EET) · Europe/Istanbul · 4 | `2015-10-25` |
| 29 | **Türkiye 2016 permanent DST abolish** | `2016-10-30 02:30:00 Europe/Istanbul` · Europe/Istanbul · 4 — **eski tzdata UTC+2 yorumlar, doğru tzdata UTC+3 sabit**. Historical assert H3 geçtikten sonra tek doğru değer. | `2016-10-29` |
| 30 | London BST spring pre-gap | `2024-03-31 00:30:00 Europe/London` (UTC+0 GMT) · Europe/London · 4 | `2024-03-30` |
| 31 | London BST spring nonexistent | `2024-03-31 01:30:00 Europe/London` (lokal nonexistent → 02:30 BST UTC+1) · Europe/London · 4 | `2024-03-30` |
| 32 | London BST spring post-gap | `2024-03-31 02:30:00 Europe/London` (UTC+1 BST) · Europe/London · 4 | `2024-03-30` |
| 33 | London fall ambiguous (BST +01) | `2024-10-27T01:30:00+01:00` (ilk 01:30 BST) · Europe/London · 4 | `2024-10-26` |
| 34 | London fall ambiguous (GMT +00) | `2024-10-27T01:30:00+00:00` (ikinci 01:30 GMT) · Europe/London · 4 | `2024-10-26` |
| 35 | NY DST spring pre-gap | `2024-03-10 01:30:00 America/New_York` (EST UTC−5) · America/New_York · 4 | `2024-03-09` |
| 36 | NY DST spring nonexistent | `2024-03-10 02:30:00 America/New_York` (lokal nonexistent → 03:30 EDT UTC−4) · America/New_York · 4 | `2024-03-09` |
| 37 | NY DST spring post-gap | `2024-03-10 03:30:00 America/New_York` (EDT UTC−4) · America/New_York · 4 | `2024-03-09` |
| 38 | NY fall ambiguous (EDT −04) | `2024-11-03T01:30:00-04:00` (ilk 01:30 EDT) · America/New_York · 4 | `2024-11-02` |
| 39 | NY fall ambiguous (EST −05) | `2024-11-03T01:30:00-05:00` (ikinci 01:30 EST) · America/New_York · 4 | `2024-11-02` |
| 40 | UTC midnight −1μs | `2026-04-23 23:59:59.999+00` · UTC · 0 | `2026-04-23` |
| 41 | UTC midnight exact | `2026-04-24 00:00:00.000+00` · UTC · 0 | `2026-04-24` |
| 42 | UTC midnight +1μs | `2026-04-24 00:00:00.001+00` · UTC · 0 | `2026-04-24` |
| 43 | Mikrosaniye lower | `2026-04-23 04:00:00.000001+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 44 | Mikrosaniye upper | `2026-04-23 04:00:00.999999+03` · Europe/Istanbul · 4 | `2026-04-23` |
| 45 | **Samoa 2011-12-30 skipped day (permanent −11 → +13 shift)** | Lokal `2011-12-30 12:00:00 Pacific/Apia` — **gün atlandı**. `disambiguation:'compatible'` semantiği: PG + Temporal **her ikisi de** 2011-12-31 12:00+13 UTC `2011-12-30 23:00+00`'a map eder; lokal 12:00 üzerinden cutoff=4 ile same-day. · Pacific/Apia · 4 | `2011-12-30` (parity: iki tarafın lokal map sonucu ve store_date aynı) |
| 46 | Niue uç negatif UTC−11 | `2024-06-15 04:00:00-11:00` · Pacific/Niue · 4 | `2024-06-15` |
| 47 | Asia/Kathmandu 15-dk offset cutoff −1s | `2024-06-15 03:59:59+05:45` · Asia/Kathmandu · 4 | `2024-06-14` |
| 48 | Asia/Kathmandu 15-dk offset cutoff exact | `2024-06-15 04:00:00+05:45` · Asia/Kathmandu · 4 | `2024-06-15` |

**Kapsam garantisi:** Cutoff-boundary triplet (−1μs / exact / +1μs) normal gün (1-3), gece yarısı (4-6), cutoff=0/6/12 varyantları (7-15), yıl sonu (16-18), Şubat 29 (19-21), Türkiye 2015 spring (24-26), London spring (30-32), NY spring (35-37) bağlamlarında **tekrar enumerate**. DST kapsama Türkiye tarihsel (24-29) + Europe/London (30-34) + America/New_York (35-39) üçü tam. Permanent offset shift Türkiye 2016 (#29) + Samoa 2011 (#45) = 2 case, parity test'in en nadir bug-prone sınıfı.

**5.4.b — Property-based — 10.000 rastgele timestamp:**

**Generator sınırları (somut):**

- **Timestamp aralığı:** `2024-01-01T00:00:00Z` .. `2029-12-31T23:59:59.999999Z` (5 yıl). Gerekçe: Türkiye 2016 permanent shift sonrası güvenli pencere, tzdata post-fix dönem, tüm 7 tz'de DST/non-DST karışık. Pre-2016 tarihsel DST named case'lere (24-29) bırakıldı — property-based'de tarihsel TZ kombinasyonu tzdata sürümüne kırılgan.
- **Cutoff hour dağılımı:** `fc.integer({ min: 0, max: 23 })` — uniform, bias yok. Sınır değerler (0, 23) named case'lerde zaten kapsandığı için property generator'da biased-sampling gereksiz.
- **Timezone kümesi (tam 7):**
  1. `Europe/Istanbul` — fixed UTC+3 post-2016, ana tenant
  2. `UTC` — offset-zero sanity
  3. `America/New_York` — DST (EST/EDT)
  4. `Europe/London` — DST (GMT/BST)
  5. `Asia/Tokyo` — fixed UTC+9, non-DST referans
  6. `Pacific/Kiritimati` — uç pozitif UTC+14
  7. `Asia/Kathmandu` — 15-dk offset UTC+05:45 (float/integer minute aritmetik hatası yakalar)

**Pseudocode (fast-check):**

```ts
// packages/db/tests/store-date-parity.test.ts (özet)
import fc from 'fast-check';
import { describe, test, expect } from 'vitest';

const TZ_SET = [
  'Europe/Istanbul', 'UTC', 'America/New_York', 'Europe/London',
  'Asia/Tokyo', 'Pacific/Kiritimati', 'Asia/Kathmandu',
] as const;

const RANGE_START = Date.UTC(2024, 0, 1);                // 2024-01-01
const RANGE_END   = Date.UTC(2029, 11, 31, 23, 59, 59);  // 2029-12-31

const arbCase = fc.record({
  ts:         fc.integer({ min: RANGE_START, max: RANGE_END }).map(ms => new Date(ms)),
  cutoffHour: fc.integer({ min: 0, max: 23 }),
  tz:         fc.constantFrom(...TZ_SET),
});

test('store_date parity (property-based, 10k)', async () => {
  await fc.assert(
    fc.asyncProperty(arbCase, async ({ ts, cutoffHour, tz }) => {
      const dbResult = await pg.one(
        'SELECT store_date(ts => $1, cutoff_hour => $2, tz => $3) AS d',
        [ts, cutoffHour, tz]
      );
      const tsResult = toStoreDate({ ts, cutoffHour, tz });
      return dbResult.d === tsResult;  // aynı ISO YYYY-MM-DD
    }),
    { numRuns: 10_000, seed: process.env.REPLAY_SEED ? Number(process.env.REPLAY_SEED) : undefined }
  );
});
```

**Oracle:** DB fonksiyonu (named parameters, IMMUTABLE) vs TS util (Temporal polyfill, object parameter). Başarı kriteri: aynı ISO `YYYY-MM-DD` string.

**5.4.c — Failure mode + debuggability spec (N6):**

Parity test'in değeri fail'de ne kadar hızlı teşhis edilebildiğine bağlı. Üç katman, her biri farklı failure stratejisi:

| Katman | Strateji | Çıktı formatı |
|---|---|---|
| **tzdata sanity (5.4 başı, 8+3 satır)** | **Fast-fail** — herhangi bir satır fail → suite aborted, edge cases/property koşmaz | Vitest reporter: PG imaj tag + Node version + ICU version + failing row detail (abbrev veya historical H1/H2/H3) |
| **Named edge cases (48)** | **Run-all + aggregate** — tek case fail diğerlerini durdurmaz, tüm 48 koşar, rapor toplu. Gerekçe: birden çok fail'in pattern'i (örn. tümü DST case'leri) teşhis açısından kritik | Vitest `test.each(cases)`; CI reporter: JSON (machine-readable); local dev: markdown tablosu, fail satırları highlight — `#`, `kategori`, `input`, `expected`, `actual`, `diff` kolonları |
| **Property-based (10k)** | **First-failure + shrink** — fast-check native behavior, ilk counterexample'da durur, minimum failing input'a shrink eder | Vitest + fast-check çıktısı: `seed`, shrunk `{ts, cutoffHour, tz}`, DB result, TS result, iteration number |

**Regression seed replay (zorunlu debug prosedürü):**

Property-based failure'da fast-check CI log'a **seed + counterexample** yazar. Geliştirici lokal replay için:

```bash
REPLAY_SEED=<seed-from-ci> pnpm --filter db test store-date-parity
```

Aynı seed → aynı rastgele dizi → aynı counterexample. fast-check native `seed` parametresiyle destekleniyor (yukarıdaki `asyncProperty` çağrısında `process.env.REPLAY_SEED` okunur). Test dosyası yorumu olarak belgelenir:

```ts
// REPLAY: REPLAY_SEED=<ci-seed> pnpm --filter db test store-date-parity
// fast-check deterministic replay — counterexample CI'daki seed ile birebir reproduce edilir.
```

**Çıktı format özet kural:** CI reporter JSON (CI log parse'ı için makine okunur); local dev pretty-print (terminal tablosu, renkli diff). `vitest.config.ts`'de `reporters: ['default', 'json']` iki kanal aynı anda.

**5.5 — Gerekçe özeti:**

v3'te rapor TZ hataları canlıda "bugün ciro sıfır" semptomu verdi (UTC-lokal karışması). IMMUTABLE + named parametre + stored kolon + trigger + iki-taraflı tip enforcement (`Generated<...>`) + 48 named case + 10k property-based + fast-fail tzdata sanity + seed replay — bu yedi katmanlı savunma TZ/cutoff hata sınıfını şema seviyesinde sıfırlar. Bakım yükü (parity test + trigger + ADR-001 imaj pin bağı + tzdata runbook) farkında, ama rapor doğruluğu + audit güvenilirliği + gün sonu invaryantı bundan büyük.

---

---

### Bölüm 6 — Multi-Tenant İzolasyon

**Kural 6.1 — `tenant_id` her business-scoped tabloda:** Her iş verisi tablosunda `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`. İstisnalar: platform tabloları — `tenants` (kendisi), `schema_migrations` (node-pg-migrate tarihçesi), `pg_timezone_names` (sistem). Kullanıcı hesapları dahil (`users.tenant_id NOT NULL`) — MVP'de tek tenant ama kolon gün 1 şemada, v5.2 multi-tenant açılışı migration'sız.

**Kural 6.2 — UNIQUE'lerde `tenant_id` prefix:** Tüm benzersiz kısıtlamalar (UNIQUE constraint, UNIQUE index, partial unique) ilk kolon olarak `tenant_id`'yi içerir. Örnekler:
- `UNIQUE(tenant_id, table_id) WHERE status='open'` — orders (tek aktif masa siparişi)
- `UNIQUE(tenant_id, normalized_phone)` — customer_phones — **tam UNIQUE; aynı numara yeni müşteriye atanabilsin diye anonimize'de hard delete (bkz. 8.3). customer_phones'ta deleted_at yok; partial `WHERE deleted_at IS NULL` kalıbı bu tabloya uygulanmaz.**
- `UNIQUE(tenant_id, store_date, order_no)` — orders (Bölüm 11 — günlük order_no reset)
- `UNIQUE(tenant_id, idempotency_key)` — print_jobs, payments
- `UNIQUE(tenant_id, email)` — users (global email unique yasak)

Global unique (örn. cross-tenant email) **yasak**; aynı email farklı tenant'larda serbest.

**Kural 6.3 — Query-level izolasyon (repository pattern):** Kysely query layer'ında repository pattern zorunlu — her repository constructor'da `tenant_id` alır, tüm **root FROM** query'lerine otomatik `WHERE tenant_id = :tenantId` enjekte eder. Raw SQL yazan her endpoint review'da `tenant_id` WHERE'i açıkça görür; eksikse PR blocked. Bu kural ADR-001 code-style ile linkli.

**Kural 6.3.1 — JOIN enforcement (kritik eksik savunma):**

Repository pattern root FROM'a tenant filter enjekte eder, **JOIN'lere etmez** — Kysely `.leftJoin(table, on)` / `.innerJoin(table, on)` çağrılarında JOIN'lenen tabloda tenant filter yazılmazsa **cross-row leak** doğar (tek tenant'ta bile: silinmiş/farklı tenant kategori join'inde yanlış rapor). Üç katmanlı enforcement:

**(a) TS helper `joinWithTenant` — imza:**

```ts
// packages/db/src/repository/joinHelper.ts
import { Kysely, ExpressionBuilder, SelectQueryBuilder } from 'kysely';
import { Database } from '../schema';  // kysely-codegen çıktısı

/**
 * Tenant-scoped JOIN helper. Request context'teki tenant_id'yi
 * repository constructor'dan alır (this.tenantId), JOIN'lenen tabloya
 * otomatik `<joinedTable>.tenant_id = :tenantId` koşulu ekler.
 *
 * Kullanım:
 *   this.joinWithTenant(qb, 'products', (eb) =>
 *     eb('order_items.product_id', '=', eb.ref('products.id'))
 *   )
 *
 * Raw .leftJoin / .innerJoin YASAK — ESLint 'no-raw-kysely-join'
 * kuralı ile reddedilir.
 */
protected joinWithTenant<TB extends keyof Database>(
  qb: SelectQueryBuilder<Database, any, any>,
  joinedTable: TB,
  on: (eb: ExpressionBuilder<Database, any>) => any,
  kind: 'left' | 'inner' = 'inner',
): SelectQueryBuilder<Database, any, any> {
  const tenantId = this.tenantId;  // repository constructor'da set edilir
  const method = kind === 'left' ? 'leftJoin' : 'innerJoin';
  return qb[method](joinedTable, (join) =>
    join.on(on).on(`${String(joinedTable)}.tenant_id`, '=', tenantId)
  );
}
```

tenant_id kaynağı: **repository constructor `this.tenantId`** — request context middleware (Express `req.tenantId`) repository instantiation'da geçilir. Explicit arg olarak JOIN call-site'a verilmez — drift yaratır.

**(b) ESLint rule `no-raw-kysely-join`:**

- **Kural adı:** `no-raw-kysely-join`
- **Tespit:** Kysely query builder üzerinde `.leftJoin(…)`, `.innerJoin(…)`, `.rightJoin(…)`, `.fullJoin(…)` çağrılarının repository method'ları dışında (yani `joinWithTenant` wrapper dışında) kullanılması.
- **Hata mesajı:** `"Raw Kysely join kullanımı yasak. 'this.joinWithTenant(qb, table, on, kind?)' helper'ını kullanın. Gerekçe: JOIN'lenen tabloda tenant_id filter'ı otomatik enforce edilir (ADR-003 §6.3.1). Helper dışı join cross-tenant/cross-row leak yaratır."`
- **Kapsam:** `packages/db/src/repository/**` hariç tüm dosyalar. Repository iç implementasyonunda raw join `joinWithTenant` içinde kullanılır, dışarı sızmaz.
- **Bypass:** Yok. `// eslint-disable-next-line no-raw-kysely-join` bile PR review gate'inde reddedilir (raw join kullanımı yeni ADR gerektirir).

**(c) db-migration-guard PR gate:**

`db-migration-guard` sub-agent (bu ADR'yi review eden agent) her PR'da:
- Grep: `\.leftJoin\(|\.innerJoin\(|\.rightJoin\(|\.fullJoin\(` pattern'ini `packages/db/src/repository/**` hariç dosyalarda arar.
- Fail modu: eşleşme varsa **BLOCKER** — PR merge yasak. Bypass yok.
- ESLint ile çift savunma: ESLint lokal + CI, db-migration-guard PR review. İkisi de fail ederse geçmez.

Bu üç katman birlikte (a) helper tek yol, (b) ESLint linter gate, (c) PR review gate — JOIN enforcement gün 1 aktif.

**Kural 6.4 — Row-Level Security (RLS) — ertelenmiş ama bağlı:**

**MVP'de kapalı** — gerekçe: tek tenant, ek complexity + performans maliyeti. Bölüm 6.3.1'deki üç katmanlı JOIN enforcement MVP'de yeterli savunma.

**v5.2 commit'i (ADR'ye bağlı):** v5.2 multi-tenant açılışı **öncesinde** RLS policy'leri eklenir. Bu cümle bu ADR'nin kararı — v5.2 ADR'si geldiğinde buna explicit atıf yapılır. RLS erteleme bilinçli ama **açık uçlu değil**.

Şema bugün RLS-ready (`tenant_id` her tabloda NOT NULL), policy migration sonradan eklenir — ayrı ADR + db-migration-guard review. Bu ADR RLS enforcement'ı **MVP için zorunlu kılmaz**, v5.2 için **zorunlu kılar**.

---

### Bölüm 7 — Snapshot İnvaryantı

**Kural:** Sipariş / çağrı / kapanış anında kritik referans verileri **snapshot'lanır** — kaynak tablo sonradan değişse/silinse bile tarihsel kayıt intact. v5'te snapshot kolonları **NOT NULL** zorunlu (v3'te opsiyoneldi, P-08 pain-point).

**7.1 — Snapshot kolon matrisi + enforcement stratejisi:**

Her snapshot alan için enforcement mekanizması alan başına seçilir. Üç mekanizma matrisi:

| Mekanizma | Güç | Zaaf | Ne zaman |
|---|---|---|---|
| **CHECK constraint** (tek-kolon) | DB-otoriter, bypass imkansız | cross-column ifadeler IMMUTABLE olamaz, FK-ref değer çekemez | NOT NULL + basit format (length/sign) |
| **BEFORE INSERT trigger** (cross-column) | FK-den değer çekebilir, rapor-kritik alan garantisi | trigger maintenance yükü, test karmaşıklığı | rapor-kritik alan, kaynak-FK'dan türeme |
| **Domain test (TS fabrika)** | esnek, anonimize/iş kuralı seviyesi | migration/manuel SQL ile bypass edilir | audit-only alan, anonimize-aware, null-ok |

| Tablo | Snapshot kolon | Kaynak | NOT NULL | CHECK | Trigger | Domain test | Gerekçe |
|---|---|---|---|---|---|---|---|
| `order_items` | `product_name TEXT` | `products.name` | ✓ | `length(product_name) > 0` | — | ✓ | Ürün rename eski siparişi etkilemez (Sinyal #6) |
| `order_items` | `unit_price_cents INT` | `portions.price_cents` | ✓ | `unit_price_cents > 0` | — | ✓ | Fiyat değişimi eski siparişi etkilemez |
| `order_items` | `category_id_snapshot UUID` | `products.category_id` | ✓ | — | — | ✓ | Kategori taşıma eski raporu etkilemez (Sinyal #35) |
| `order_items` | `category_name_snapshot TEXT` | `categories.name` | ✓ | `length > 0` | — | ✓ | Kategori rename eski raporu etkilemez (P-08). Rapor-kritik; MVP'de domain-only fabrika (7.2) garantisi yeterli. v5.1 açılışında snapshot trigger gerekliliği ayrı ADR'de değerlendirilir. |
| `order_items` | `portion_name_snapshot TEXT` | `portions.name` | ✓ | `length > 0` | — | ✓ | Porsiyon rename eski fişi etkilemez |
| `orders` | `customer_name_snapshot TEXT NULL` | `customers.full_name` | — | — | — | ✓ | **Domain-only (anonimize-aware).** DB CHECK/trigger yasak — anonimize sonrası `customers.full_name='Anonim'` olur ama eski `customer_name_snapshot` orijinal ad kalır; DB enforcement anonimize semantiğini kırar. NULL = masa siparişi. |
| `orders` | `address_snapshot JSONB NULL` | `customer_addresses.*` | — | — | — | ✓ | Paket siparişinde anlık adres; NULL = dine-in. Anonimize'de snapshot korunur. |
| `orders` | `table_name_snapshot TEXT NULL` | `tables.name` | — | — | — | ✓ | Masa rename aktif siparişi bozmaz; NULL = takeaway |
| `call_logs` | `customer_name_snapshot TEXT NULL` | `customers.full_name` | — | — | — | ✓ | **Domain-only (anonimize-aware).** Çağrı anındaki isim, sonradan anonimize olursa korunur. |
| `call_logs` | `address_snapshot JSONB NULL` | `customer_addresses.*` | — | — | — | ✓ | Çağrı anındaki adres |

**Trigger opsiyonel not (v5.1 takip):** `category_name_snapshot` için BEFORE INSERT trigger MVP'de **zorunlu değil** — domain fabrikası (7.2) tek giriş yolu, rapor riski düşük. MVP disiplini: domain-only yeter. v5.1 açılışında snapshot enforcement modelinin yeterli kalıp kalmadığı ayrı ADR'de değerlendirilir.

**NULL policy:** Referansı olan snapshot **zorunlu doldurulur**; NULL yalnız "referans yok" anlamı taşır (walk-in takeaway: customer_id NULL + customer_name_snapshot NULL).

**CHECK alternatifi reddedildi (N2):** `CHECK ((customer_id IS NULL AND customer_name_snapshot IS NULL) OR (customer_id IS NOT NULL AND customer_name_snapshot IS NOT NULL))` cross-column CHECK'i teknik olarak mümkün. Reddedildi çünkü **anonimize sonrası** customer_id dolu kalır ama `customer_name_snapshot` değeri sipariş anındaki orijinal ad olarak korunur — CHECK'i geçer ama semantik kontrolün anlamlı olduğu nokta sipariş **oluştururken**, geçmişte değil. INSERT-time CHECK koşulu yazılsa bile anonimize UPDATE'lerinde DB'ye "bu alan hâlâ senkronize mi?" sormak yanlış soru — senkronize değil, snapshot. Sonuç: DB enforcement değil domain fabrikası + test (7.2).

**7.2 — Shared-domain fabrikası:**

```ts
// packages/shared-domain/src/order.ts
export function createOrderItem(
  product: Product,
  portion: Portion,
  category: Category,
  quantity: number
): NewOrderItem {
  return {
    id: newId(),
    product_id: product.id,
    product_name: product.name,             // snapshot
    portion_id: portion.id,
    portion_name_snapshot: portion.name,    // snapshot
    unit_price_cents: portion.price_cents,  // snapshot
    category_id_snapshot: category.id,      // snapshot
    category_name_snapshot: category.name,  // snapshot
    quantity,
    is_comped: false,
  };
}
```

Snapshot alanları **tek fabrikadan** doldurulur; doğrudan INSERT yazan kod PR'da blocked (lint rule + review gate).

**7.3 — Raporlarda snapshot üzerinden GROUP BY:**

Tüm rapor sorguları `GROUP BY oi.product_name` ve `GROUP BY oi.category_name_snapshot` biçiminde snapshot kolonları kullanır — canlı `products.name` JOIN'i **yasak** (eski satırlar bozuk görünür). Bu kural Bölüm 14 (kritik index'ler) ile linkli — snapshot kolonları üzerinde rapor index'i.

---

### Bölüm 8 — Soft vs Hard Delete

**Kural (Sinyal #7, v3 products.js pattern'den):** Tablo satırının silinip silinmeyeceği **referans bütünlüğüne** bağlıdır, tablo tipine değil.

- **Referans varsa (FK ile bağlı geçmiş kayıt):** soft delete. Kolon `deleted_at TIMESTAMPTZ NULL` eklenir; DELETE yerine UPDATE. Aktif satırlar partial index üzerinden okunur.
- **Referans yoksa (hiç satılmamış ürün, test kaydı):** hard delete + ilişkili dosya (ör. görsel) cleanup.

Karar noktası runtime'da: `canHardDelete(entity)` helper (`packages/shared-domain/src/delete.ts`) ilgili tablolarda FK count'u sorgular; 0 ise hard, >0 ise soft.

**8.1 — Soft delete kullanılan tablolar:** `products`, `categories`, `portions`, `tables`, `printers`, `users`. Hepsinde:
```sql
deleted_at TIMESTAMPTZ NULL
```
Partial index aktif satırlar için:
```sql
CREATE INDEX ON products(tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_name_unique
  ON products(tenant_id, name) WHERE deleted_at IS NULL;
```

**8.2 — Hard delete kullanılan tablolar:** Retention cron'lu olanlar (`audit_logs`, `call_logs`) ve kısa yaşam döngülü archive (`print_jobs` başarılı basımdan sonra). TTL cron (Bölüm 13) `DELETE FROM` çalıştırır — referans yok.

**8.3 — Customers istisnası — anonimize modeli (Sinyal #15):** `customers` tablosunda `deleted_at` **yok**. KVKK silme talebi → `anonymizeCustomer()` domain servisi: `full_name='Anonim'`, `customer_phones` + `customer_addresses` satırları **hard delete**, `customers` satırı + `customer_name_snapshot` + `address_snapshot` dokunulmaz. Bu seçim rapor bütünlüğünü korur (geçmiş siparişlerde "Bilinmeyen" görünmez, çağrı anındaki ad korunur). `customers.anonymized_at TIMESTAMPTZ NULL` kolonu bu durumu işaretler.

**`customer_phones` neden hard delete (bkz. 6.2):** `customer_phones` tablosunda `UNIQUE(tenant_id, normalized_phone)` **tam UNIQUE** — partial değil, `deleted_at` kolonu yok. Anonimize sonrası telefon satırı hard delete edilir ki aynı numara yeni müşteriye atanabilsin (eski müşteri gitti, aynı numaradan yeni müşteri arar — iş kuralı). Partial `WHERE deleted_at IS NULL` kalıbı bu tabloya uygulanmaz; drift yaratmamak için Bölüm 6.2 explicit not içerir.

**Aktif customer partial index örneği (N3):**
```sql
-- Aktif (anonimize edilmemiş) müşteriler için partial index
CREATE INDEX customers_active
  ON customers(tenant_id)
  WHERE anonymized_at IS NULL;

-- Telefon aramasında aktif müşteri filtresi
CREATE INDEX customers_active_by_name
  ON customers(tenant_id, full_name)
  WHERE anonymized_at IS NULL;
```

**8.4 — FK davranışı:**

Soft delete'li tablolara FK'lar `ON DELETE RESTRICT` — normal akışta DELETE komutu çalıştırılmaz (domain fabrikası UPDATE yapar), ama manuel SQL / migration hatası / test ortamı temizlemesi gibi bypass durumlarına karşı DB seviyesinde savunma. Production'da tetiklenmemesi beklenir; tetiklenirse bir domain bypass var demektir, hata raporlanır.

Hard delete'li tablolara FK **yok** (audit_logs, call_logs, print_jobs arşivleri) — retention cron'u kayıt yaşına göre siler, FK bağımlılığı veri yaşam döngüsünü kilitler.

**8.5 — Default filter kuralı:**

Soft delete'li tablolardan SELECT yaparken `WHERE deleted_at IS NULL` filtresi default uygulanır — repository helper'ında (ör. `baseRepository.active()`) tanımlı, her repository bunu miras alır. Silinmiş kayıtlara erişim explicit opt-out (ör. `baseRepository.withDeleted()`) gerektirir — admin UI'ında "silinmiş ürünleri göster" sekmesi, migration scriptleri, audit review bu opt-out'u kullanır. Helper'ın somut implementasyonu Bölüm 15'te seçilen query builder'a bağlıdır; kural (default active filter + explicit opt-out) tool-agnostiktir.

Rapor query'leri `order_items` gibi snapshot tablolarından okur (Bölüm 7); bu tablolarda `deleted_at` kolonu yok — snapshot satırları immutable, silinmez. Yani "ürün silindi, satış raporundan kaybolur" sorunu yaşanmaz: rapor snapshot üzerinden çalışır, ürün tablosunun soft delete durumundan bağımsızdır.

`customers` tablosunda default filter `anonymized_at IS NULL` (§8.3 — `deleted_at` yerine `anonymized_at` kullanılıyor). Bu istisnai kural repository seviyesinde override edilir.

---

### Bölüm 9 — Enum Kullanımı

**Kural:** Sabit sayıda alternatifi olan kolonlar PostgreSQL **native enum** tipi kullanır (`CREATE TYPE ... AS ENUM`). TEXT + CHECK constraint kalıbı **kullanılmaz** — enum tip-güvencesi, depolama etkinliği, kysely-codegen ile TS union type üretimi için tercih edilir.

**9.1 — Enum listesi (000_init'te tanımlı):**

```sql
CREATE TYPE order_status      AS ENUM ('open', 'preparing', 'served', 'closed', 'cancelled');
CREATE TYPE order_type        AS ENUM ('dine_in', 'takeaway', 'delivery');
CREATE TYPE payment_type      AS ENUM ('cash', 'card');
CREATE TYPE payment_scope     AS ENUM ('full_order', 'split_item', 'equal_split');
CREATE TYPE print_job_type    AS ENUM ('receipt', 'kitchen', 'kitchen_adjustment', 'label');
CREATE TYPE print_job_status  AS ENUM ('queued', 'printing', 'printed', 'failed', 'cancelled');
CREATE TYPE user_role         AS ENUM ('admin', 'cashier', 'waiter', 'kitchen');
```

**9.2 — İkram enum değil:** İkram iş modeli Bölüm 10'da — `order_items.is_comped BOOLEAN` ve `orders.is_fully_comped BOOLEAN`. Enum içinde "comped" payment_type değeri **yok** (v3'teki `mixed` ve `other` sapmaları Sinyal #29 ile deprecate edildi).

**9.2.1 — Domain kararları (enum değer gerekçeleri):**

- **`order_type.delivery`:** Paket servis iki akışlı — müşteri gelip alıyor (`takeaway`) veya kurye gidiyor (`delivery`). Ay sonu raporunda gel-al/kurye ayrımı istenir. MVP'de kurye **kimliği ve çıkış saati kayıt altında tutulmaz** — yalnız `order_type=delivery` işaretlenir, kurye atama/takibi v5.1'e (ayrı ADR). Kapsam kilidi: MVP minimalizm. **v3→v5 geçiş notu:** v3'te `takeaway` tek akıştı, `delivery` ayrı bir enum değeri değildi — takeaway içinde status/flag ile yönetiliyordu. v5'te ayrıştı (ayrı enum değeri). v3'ten v5'e geçişte eski takeaway satırlarının `takeaway` mi `delivery` mi olarak işaretleneceği (backfill stratejisi) ayrı bir migration ADR'sinde karara bağlanır (Phase 5 geçiş planı).
- **`payment_scope.equal_split`:** "Adam başı böl" (ör. 4 kişi, 840₺ toplam → 4×210₺) Türk restoran pratiğinde yaygın; v3'te yoktu, v5'te eklenir. UI'da "Eşit Böl" butonu kişi sayısı input alır, N payment satırı otomatik üretir. Küsurat kuralı: son payment satırı artanı alır (ör. 841/4 → 3×210 + 1×211); kasiyer override edebilir. Detay Bölüm 10'da.
- **`payment_type` değişmedi:** `cash` + `card`. Yemek kartları (Sodexo, Ticket, Multinet, Setcard vb.) pilot restoranda kabul edilmiyor; MVP'de ayrı değer yok. İlerde farklı tenant yemek kartı kabul ederse `meal_card` ADD VALUE ile eklenir (9.3 iki-migration pattern).
- **`print_job_status.cancelled`:** Kuyruğa girmiş ama basılmamış job iptal edilebilir (sipariş iptali / manuel kasiyer iptali). `failed` ile ayrıştırılır: `failed`=yazıcı hatası, `cancelled`=operatör kararı. Audit ve retry davranışı farklı (Bölüm 13 TTL + retry kuralı).

**9.3 — Forward-only enum evolution kuralları:**

- **ADD VALUE: kabul.** `ALTER TYPE order_type ADD VALUE 'catering'` forward-only uyumlu — eski satırlar etkilenmez (örnek v5.1 gerçekçi genişleme: kurumsal catering siparişleri ayrı bir `order_type` değeri olarak rapor ayrıştırılsın). Yeni değer migration'da eklenir, TS tipi kysely-codegen ile senkronize olur.
  - **Kritik pattern — iki ayrı migration zorunlu:** PostgreSQL 12+ `ALTER TYPE ... ADD VALUE` transactional'dır (tx içinde başarısız olursa rollback), **ama aynı transaction içinde yeni değer kullanılamaz** (eklenen değer commit'ten önce visible değil). Sonuç: enum değer eklemesi ve o değerin ilk kullanımı (INSERT/UPDATE/backfill) **iki ayrı migration dosyası** olarak yazılır. Aynı migration içinde yapılırsa runtime hata — `ERROR: unsafe use of new value "catering" of enum type order_type`. Örnek akış: `20260501_add_catering_to_order_type.sql` (sadece `ALTER TYPE`) → commit → `20260502_backfill_catering_orders.sql` (INSERT/UPDATE). Bu pattern ADR kuralıdır, atlanamaz.
- **REMOVE VALUE: yasak.** PostgreSQL zaten desteklemez; forward-only disiplin açısından da ADR kuralı olarak kilitli. Kullanılmayan enum değeri deprecate edilmek isteniyorsa yeni kolon + migration + eski kolon hard-delete (ayrı ADR).
- **REORDER: yasak.** Enum sırası sorting'te kullanılabilir (PostgreSQL enum natural order = definition order). Sırayı değiştirmek sessizce rapor breaking change olur. Yeni değer eklerken **explicit position** (`BEFORE` / `AFTER`) kullanılır veya sona eklenir; re-order migration yazılmaz.
- **RENAME VALUE: yasak.** `ALTER TYPE ... RENAME VALUE 'old' TO 'new'` PG 10+ destekli ama **kullanılmaz** — rapor snapshot'lanan enum string'leri bozar (v3 sinyal: `period_z_close` → `daily_close` rename v5'te zaten değer değişikliği olarak yapıldı, rename değil). İstisna yok; yeni değer gerekiyorsa ADD VALUE + eski değerin deprecate'i.

**9.4 — TS tip üretimi:** kysely-codegen her migration sonrası `pnpm db:types` komutuyla çalıştırılır; PG enum'ları TS union type olarak üretir:
```ts
export type OrderStatus = 'open' | 'preparing' | 'served' | 'closed' | 'cancelled';
```
Domain kodu bu tipleri import eder; `as const` dizilerle paralel tutulmaz (çift truth source olur).

**9.5 — Review gate + forward-only disiplin (iki-migration pattern için):**

9.3'teki iki-migration kuralı (migration N: `ALTER TYPE ADD VALUE`, commit, migration N+1: yeni değer kullanımı) aşağıdaki üç ek kuralla bütünlenir:

**(a) Aynı PR'da iki migration yasak:** Bir PR içinde hem `ALTER TYPE … ADD VALUE` içeren migration **hem o değeri kullanan DML/DDL** (INSERT, UPDATE, CHECK constraint, backfill, yeni kolon DEFAULT vb.) içeren migration varsa **BLOCKER**. Migration N önce merge + deploy edilir, commit sonrası ayrı PR'da N+1 açılır. Gerekçe: N başarısız/ertelenmiş olursa N+1'in ön şartı yok — forward-only chain kırılır.

**(b) db-migration-guard tespit kuralı:** db-migration-guard (Claude Code sub-agent olarak tanımlı — `.claude/agents/db-migration-guard.md`; operasyonel enforcement PR review aşamasında, CI-native değil; pre-commit hook entegrasyonu ADR-001'de kesinleştirilecek) her migration PR'ında aşağıdaki pattern'i arar:
- Aynı PR'da `ALTER TYPE .* ADD VALUE '([^']+)'` regex eşleşmesi + aynı PR'da eşleşen string literal'in herhangi bir SQL dosyasında INSERT/UPDATE/CHECK içinde kullanımı.
- Eşleşme → **BLOCKER** + mesaj: `"ALTER TYPE ADD VALUE ve değer kullanımı aynı PR'da yasak (ADR-003 §9.5a). İki ayrı PR açın: önce ADD VALUE merge + deploy, sonra DML PR."`
- **Regex best-effort detection**; yorum satırı / multi-line string / başka dosyadaki aynı literal gibi durumlarda false-positive veya false-negative mümkün. Manuel review ikinci gate'tir — sub-agent detection tek başına yetki değil, disiplinli PR review şart.
- Bypass yok (ne `-- eslint-disable` benzeri yorum, ne manuel "skip").

**(c) Rollback yok — forward-only explicit:**

Migration'lar **forward-only**. Migration N production'a deploy edildikten sonra:
- **Rollback senaryosu yok.** "down migration" dosyası yazılmaz, node-pg-migrate'in down runner'ı production'da kullanılmaz (dev-reset lokal-only, Bölüm 15'te detay).
- Migration N yanlış çıkarsa: **düzeltme migration N+1** ile yapılır — yeni DDL/DML satırları ileriye dönük düzeltir. `ALTER TYPE` için REMOVE VALUE desteklenmediği (PostgreSQL native limitasyon) ve ADR kuralı da REMOVE'u yasakladığı için (9.3), eklenmiş enum değeri geri alınamaz — yanlış eklenen değer **deprecate** edilir (kullanılmaz bırakılır, UI'da sunulmaz, yeni ADR ile ayrı kolona taşınır).
- **Out-of-order deploy yasak:** node-pg-migrate `pgmigrations` tablosu üzerinden sıralı çalışır; out-of-order dosya eklemek (tarih backdate + schema manipulation) ADR-001 CI gate'i ile reddedilir — her migration dosya adı ISO timestamp prefix'li (`YYYYMMDD_HHMM_…`) + `pgmigrations.run_on` artan sırada artar, drift tespit edilirse CI fail. *(CI enforcement mekaniğinin detayı — workflow dosyası, gate script — ADR-001'de kesinleştirilecek; bu ADR kuralı zorunlu kılar, uygulama ADR-001'e bağlıdır.)*

Bu üç ek kural (a/b/c) forward-only chain'in bütünlüğünü operasyonel seviyede garanti eder — ADR kuralı teorik değil, review/CI/deploy pipeline'ında enforce edilir.

---

<!-- Bölüm 10-16 sıradaki turlarda yazılacak -->
<!-- Bölüm 10 (Ödeme Modeli & İnvaryantları) ve Bölüm 12 (Audit sanitize kontratı) kritik — tek tek db-migration-guard review'ı talep edilecek -->
<!-- Bölüm 6-9 toplu review önerisi: mevcut halde gönderilebilir -->

