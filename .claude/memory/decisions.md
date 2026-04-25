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

**Kural 6.5 — Composite UNIQUE `(id, tenant_id)` her business tablosunda zorunlu:**

Her multi-tenant business tablosu, birincil anahtarına (`PRIMARY KEY (id)`) ek olarak `UNIQUE (id, tenant_id)` constraint'i taşır. Bu, ADR boyunca kullanılan composite foreign key pattern'inin (`FOREIGN KEY (<parent>_id, tenant_id) REFERENCES parent (id, tenant_id)`) hedef olabilmesi için **zorunludur** — PostgreSQL composite FK, parent tarafında eşleşen UNIQUE/PK constraint bulunmazsa `CREATE TABLE` adımında FAIL eder.

```sql
CREATE TABLE orders (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- diğer kolonlar
  UNIQUE (id, tenant_id)
);

CREATE TABLE order_items (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id   UUID NOT NULL,
  -- diğer kolonlar
  UNIQUE (id, tenant_id),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)
);
```

**Kapsam — istisnasız:** `tenant_id` kolonu taşıyan her tablo 6.5 kuralına tabidir. `tenants` tablosu kapsam dışı (kendisi root — `tenant_id` kolonu yok). `users` tablosunun kapsamı **ADR-002 (Auth Stratejisi) kararına bağlıdır**: users tenant-scoped olarak şemalanırsa (`users.tenant_id NOT NULL`) 6.5 kuralı otomatik uygulanır; tenant-bağımsız global rol modeli seçilirse `users` bu kuralın dışında kalır. ADR-002 kabul sonrası bu not güncellenir.

**Maliyet:** Her tabloda ek bir UNIQUE index (PK + `(id, tenant_id)`) — disk/write overhead kabul edilir, composite FK güvencesi karşılığında.

**§6.2 ile karışıklık yok:** §6.2 "`tenant_id` UNIQUE prefix" kuralı iş-kuralı benzersizliği içindir (örn. tek masa = tek açık adisyon → `UNIQUE (tenant_id, table_id) WHERE order_status='open'`). §6.5 referansiyel bütünlük içindir (composite FK hedefi). İki kural aynı tablodaki farklı amaçlara hizmet eder, birbirini ikame etmez.

**Geçmişe dönük doğrulama:** §10.4.3'teki `payments` composite FK örnekleri (`FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)`) bu kurala dayanır. Bölüm 14'te detay tablo tanımları yazılırken 6.5 her business tabloda verbatim uygulanır; tablo tanımında `UNIQUE (id, tenant_id)` satırının eksik olması db-migration-guard tarafından red sebebi.

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

### Bölüm 10 — Ödeme Modeli & İnvaryantları

**Kapsam:** `payments` tablosunun davranış modeli, `payment_scope` enum (Bölüm 9.1) değerlerinin üç farklı üretim kalıbı, ikram (komplimen) akışının enforcement katmanları (domain service + DB trigger), `order_type=delivery` ödeme zamanlaması ve tablo-arası invaryantlar. Detay tablo tanımları (kolon listesi, FK, index) Bölüm 14'te; bu bölüm iş kurallarını ve enforcement authority'sini kilitler.

**10.1 — payment_scope davranışları:**

`payment_scope` her `payments` satırında NOT NULL olarak tutulur — ödemenin **hangi kapsamda** üretildiği tarihsel olarak korunur (rapor/audit için). Üç değerin davranışı:

| scope | satır sayısı | amount_cents üretimi | UI tetikleyici | Override |
|---|---|---|---|---|
| `full_order` | 1 | `= orders.total_cents` | "Öde" (tek buton) | — |
| `split_item` | N ≥ 2 | kasiyer seçimi × `order_items` alt-toplamı | "Kalemle Böl" | satır bazlı kalem atama |
| `equal_split` | N ≥ 2 | `floor(total/N)` + küsurat son satıra | "Eşit Böl" (kişi sayısı input) | satır tutarı manuel düzeltilebilir |

**(a) `full_order`:** Tek `payments` satırı; `amount_cents = orders.total_cents`. En yaygın akış (masa tek adisyon, tek ödeme, tek tip). `payment_type ∈ {cash, card}` tek değer.

Pilot restoranda tek müşteri-tek sipariş-iki ödeme tipi (ör. 100₺ nakit + 200₺ kart) senaryosu yaşanmıyor. MVP'de `full_order` tek `payment_type` taşır; kuraldışı senaryo çıkarsa v5.1'de ayrı scope ADR'si ile ele alınır. `split_item` ve `equal_split` zaten karışık `payment_type` destekliyor (her satır kendi type'ını taşıyor) — bu senaryolar kapsandı.

**(b) `split_item`:** Kasiyer ödeme ekranında `order_items` satırlarını gruplar; her grup bir `payments` satırına karşılık gelir. İlişki **`payment_items` junction tablosu** ile kurulur:

```sql
CREATE TABLE payment_items (
  payment_id    UUID NOT NULL,
  order_item_id UUID NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (payment_id, order_item_id),
  UNIQUE (tenant_id, order_item_id),  -- bir kalem yalnız tek payment'a (§6.2 tenant_id prefix)
  FOREIGN KEY (payment_id, tenant_id)    REFERENCES payments    (id, tenant_id),
  FOREIGN KEY (order_item_id, tenant_id) REFERENCES order_items (id, tenant_id)
);

-- C1 (mini-pass §10.5.2): is_comped=true kalem ödemeye eklenemez (DB defansif §10.2)
CREATE OR REPLACE FUNCTION block_comped_item_in_payment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items
    WHERE id = NEW.order_item_id
      AND tenant_id = NEW.tenant_id
      AND is_comped = true
  ) THEN
    RAISE EXCEPTION 'İkram edilmiş kalem ödemeye eklenemez (order_item_id: %)', NEW.order_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_items_block_comped_insert
  BEFORE INSERT ON payment_items
  FOR EACH ROW EXECUTE FUNCTION block_comped_item_in_payment();
```

Bir `order_item` yalnız **bir** `payments` satırına atanabilir. `is_comped=true` order_items satırları `payment_items` junction'a **EKLENMEZ** (ödeme yükümlülüğü yok). UI ödeme ekranında bu kalemler görünür ama "İkram" rozetiyle işaretli ve seçilemez (disabled). Invariant kontrolü (atanmamış kalem = eksik ödeme) yalnız `is_comped=false` kalemler üzerinden yapılır. Detay enforcement §10.2'de.

Atanmamış ödenmesi gereken kalem varsa UI "eksik ödeme" hatası verir, sipariş kapanmaz. Enforcement yalnız UI değil — domain service (`OrderService.closeOrder`) + DB katmanında çift kontrollü; detay §10.4 invaryantlar bölümünde. Gerekçe: "bu pideyi Ahmet ödedi, çorba + lahmacun Mehmet'ten" — Türk restoran pratiği (domain-rules.md). Karışık ödeme (nakit + kart) bu scope'un tipik kullanım sebebi: 2+ `payments` satırı, her biri farklı `payment_type` taşıyabilir.

**(c) `equal_split`:** Kasiyer kişi sayısı N girer (N ≥ 2); sistem `base = floor(orders.total_cents / N)` hesaplar; N-1 satır `base` tutarında, son satır `orders.total_cents - (N-1) * base` tutarında oluşturulur (küsurat son satıra). Örnek: 84100 kuruş / 4 → 21025, 21025, 21025, 21025 (eşit). 84101 / 4 → 21025, 21025, 21025, 21026. Kasiyer herhangi bir satırın `amount_cents` değerini manuel düzeltebilir; düzeltme sonrası invaryant `SUM(amount_cents) = orders.total_cents` (§10.4) kontrolü UI blokajı yapar — satır eklenip/çıkarılmadan kaydedilemez.

Kişi sayısı (N) değişikliği: `equal_split` satırları üretildikten sonra N doğrudan düzenlenemez — kasiyer yanlış N girerse mevcut satırlar iptal edilir ve "Eşit Böl" butonu yeniden tetiklenir (yeni N ile satırlar baştan üretilir). MVP kararı: basit akış, N re-calculation UI karmaşıklığı v5.1'e ertelendi. Kasiyer satır tutarını elle düzeltebilir (yukarıda açıklandığı gibi) ama satır sayısını doğrudan değiştiremez — satır ekleme/silme UI'da kapalıdır.

`payment_items` junction **kullanılmaz** (kalem bazlı ayrıştırma yok); her `payments` satırı kendi `payment_type` değerini taşır (karışık ödeme olabilir).

**Sinyal #29 atıfı — "split" payment_type değil, scope:** v3'te `payment_type='mixed'` + `'other'` belirsiz satırlar üretiyordu; raporda `SUM(amount) GROUP BY payment_type` net değildi. v5'te "karışık" ayrı bir `payment_type` değil, **N ayrı `payments` satırı** (her biri tek `payment_type`). "split" kavramı `payment_type` enum'unda değil, `payment_scope` enum'unda yaşar. Bu ayrım raporda satır bazlı toplam net çalıştırır — `mixed` bucket'ı yok.

**`payment_scope` ve `payment_type` bağımsızlığı:** İkisi ortogonal kolonlar. Örnekler: `(full_order, cash)` — tek nakit ödeme; `(split_item, card)` — kalemle bölünmüş satırlardan biri kart; `(equal_split, cash)` — 4 kişilik eşit bölümden nakit satır. CHECK constraint ile ilişki kurulmaz (kombinasyonlar tüm matris açık).

**10.2 — İkram (komplimen) enforcement:**

İkram, sipariş oldu-yendi ama müşteri ödemedi semantiği taşır — cancel değil (rapora gider: "ikram edilen gelir"). `payment_type='comp'` **enum değeri değil** (Bölüm 9.2): ikram `payments` satırı üretmez, `order_items` ve `orders` üzerinde bayrak modeliyle taşınır.

**10.2.1 — Kolon semantikleri:**

```sql
ALTER TABLE order_items
  ADD COLUMN is_comped BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN is_fully_comped    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN comped_amount_cents INT    NOT NULL DEFAULT 0
    CHECK (comped_amount_cents >= 0);
```

- `order_items.is_comped=true`: Bu kalem ikram; `payment_items` junction'a **dahil edilmez** (§10.1(b)); ödeme yükümlülüğüne sayılmaz; rapora "ikram edilen kalem" olarak çıkar.
- `orders.is_fully_comped=true`: Siparişin tamamı ikram; **hiç `payments` satırı üretilmez** (0 satır — sıfır tutarlı satır DEĞİL, yokluk); `orders.closed_at` set edilir, `order_status='closed'` (cancel değil).
- `orders.comped_amount_cents`: İkram edilen kalemlerin toplam kuruş değeri, snapshot hesabı; trigger ile güncellenir (10.2.4 T2). Rapor `SUM(comped_amount_cents) GROUP BY store_date` — gün bazlı ikram yükü.

**10.2.2 — `orders.total_cents` net/gross kararı (DOMAIN KİLİDİ):**

**Karar: `total_cents = GROSS`** (tüm `order_items` toplamı, `is_comped` bayrağından bağımsız).

```
total_cents         = SUM(oi.quantity * oi.unit_price_cents) FOR ALL order_items
comped_amount_cents = SUM(oi.quantity * oi.unit_price_cents) WHERE oi.is_comped=true
payable (türev)     = total_cents - comped_amount_cents
```

**Gerekçe:**
- **Snapshot stabilitesi (Bölüm 7 uyumu):** `total_cents` bir kere set edilince kalem eklenmediği sürece sabit; `is_comped` toggle'ı onu değiştirmez. Snapshot kuralı korunur.
- **Rapor tek kaynaktan:** Gross gelir, ikram yükü, net gelir üç ayrı SUM kolondan okunur — COALESCE/CASE karması yok.
- **Ödeme invaryantı basit (§10.4):** `SUM(payments) = total_cents - comped_amount_cents` (kural `is_fully_comped=false` için; `true` ise invaryant aşağıda 10.2.5'te).

**Alternatif A — `total_cents = NET` (reddedildi):** Kalem ikram edildikçe `total_cents` düşer. Reddedilme gerekçesi: (a) snapshot mutability → rapor'da tarihsel tutar kayar; (b) "ikramsız gross nedir?" sorusu item-level re-aggregation gerektirir (her raporda `SUM(qty*price)` yeniden); (c) payments invaryantı `SUM(payments)=total_cents` teorik olarak şık ama ikram bilgisi `orders` seviyesinde kaybolur — raporda comped tutarı için yine item seviyesine inmek gerek. Net yaklaşım basit görünüp rapor yükünü item tablosuna ittiği için reddedildi.

**10.2.3 — `OrderCompService` (domain layer, authoritative):**

Tüm ikram eylemleri `packages/shared-domain/src/orderComp.ts` servis fonksiyonlarından geçer. Doğrudan SQL UPDATE yasak (ESLint + PR review gate); servis içinde tek giriş yolu.

```ts
// Fonksiyon imzaları (implementation Phase 1)
compItem(orderId: string, orderItemId: string, reason: string, actor: UserId): void
compFullOrder(orderId: string, reason: string, actor: UserId): void
// uncomp MVP'de YOK — v5.1'de geri-alma akışı ayrı ADR
```

- **Rol yetkisi:** Yalnız `admin`. Cashier/waiter/kitchen ikram yapamaz; UI butonu gizli + backend `requireRole('admin')` guard. (Rol matrisi ADR-002'de; bu kural burada locked.)
- **Zorunlu `reason`:** İkram sebebi NOT NULL string (UI dropdown + free-text); audit log'a yazılır (Bölüm 12 şeması).
- **Audit log zorunlu:** Her `comp*` çağrısı `audit_logs` tablosuna event yazar — `action='order.comp_item'` veya `action='order.comp_full'`, `details JSONB` içinde reason + item list + amount.
- **İdempotence:** `compItem` aynı kalemde iki kez çağrılırsa no-op (zaten `is_comped=true`); audit log'a da tekrar yazılmaz (service seviyesinde check).

**Kapalı/iptal sipariş üzerinde comp yasak (§10.5 B2 kilidi):** `orders.order_status IN ('closed', 'cancelled')` iken `orders.is_fully_comped`, `orders.comped_amount_cents` veya `order_items.is_comped` güncellemesi DB seviyesinde `block_comp_on_closed_order` trigger'ıyla bloklanır (tam tanım §10.5.1 B2). Aynı transaction'da `order_status='closed'` + comp bayrağı set etmek serbest (kasiyer "kapat ve ikram et" akışı — trigger `OLD.order_status` kontrolü yapar); yalnız "zaten kapalı → sonradan comp toggle" senaryosu yasak. Bu kural v5.1 "admin uncomp" akışıyla gevşetilecek (ayrı ADR, MVP kapsamı dışı). `OrderCompService` çağrılarında client-side validation yapılır ama otorite DB trigger — domain bypass edilirse kural korunur.

**10.2.4 — 3 DB trigger (savunma katmanı):**

Domain service authoritative; DB trigger'lar "manuel SQL / migration / test fixture / bypass" senaryolarında invaryantı korur. Uygulama katmanı atlanamayan şeyler.

**T1 — Tam ikram → kalem otomasyonu (DOMAIN KİLİDİ):**

`orders.is_fully_comped` `false → true` geçişinde tüm kalemler otomatik `is_comped=true` yapılır.

```sql
CREATE OR REPLACE FUNCTION propagate_full_comp() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_fully_comped = true AND OLD.is_fully_comped = false THEN
    UPDATE order_items
      SET is_comped = true
      WHERE order_id = NEW.id AND tenant_id = NEW.tenant_id AND is_comped = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_propagate_full_comp
  AFTER UPDATE OF is_fully_comped ON orders
  FOR EACH ROW EXECUTE FUNCTION propagate_full_comp();
```

**Gerekçe:** Rapor item-level tutarlı kalır — "hangi kalemler ikram?" sorusu `order_items.is_comped` üzerinden net cevap. Aksi halde `is_fully_comped=true` siparişte kalemler `is_comped=false` görünür, rapor CASE'leri gerekir.

**Ters yön (tüm kalemler `is_comped=true` iken `is_fully_comped=false`):** Mümkün, kabul edilir — kasiyer kalemleri tek tek ikram etmiş olabilir ama henüz "tümü ikram" bayrağını açmamış. Ödeme davranışı aynı (payable=0), rapor sayımı aynı; `is_fully_comped` yalnız "hepsi bir kerede ikram edildi" auditable işaretidir.

**T2 — `comped_amount_cents` otomatik recompute:**

```sql
CREATE OR REPLACE FUNCTION recompute_comped_amount() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE orders
    SET comped_amount_cents = COALESCE((
      SELECT SUM(quantity * unit_price_cents)
      FROM order_items
      WHERE order_id = target_order_id AND is_comped = true
    ), 0)
    WHERE id = target_order_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER order_items_recompute_comp_amount
  AFTER INSERT OR UPDATE OF is_comped OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION recompute_comped_amount();
```

**Gerekçe:** `comped_amount_cents` domain service'ten elle yazılmaz (drift riski); DB otoriter hesaplar. `OrderCompService.compItem` yalnız `is_comped=true` set eder; trigger toplam alanı günceller.

**T3 — `is_fully_comped` rollback engeli:**

```sql
CREATE OR REPLACE FUNCTION block_fully_comped_rollback() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_fully_comped = true AND NEW.is_fully_comped = false THEN
    RAISE EXCEPTION 'is_fully_comped geri alınamaz. İptal için order_status=cancelled kullanın (ayrı akış).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_block_comp_rollback
  BEFORE UPDATE OF is_fully_comped ON orders
  FOR EACH ROW EXECUTE FUNCTION block_fully_comped_rollback();
```

**Gerekçe:** İkram kararı verildiğinde audit/rapor semantiği kilitlenir; "yanlışlıkla ikram ettim" senaryosu cancel yolu ile çözülür (10.2.6) — bayrak toggle'ı değil. v5.1 "comp geri al" ADR'si geldiğinde bu trigger güncellenir (o zaman yeni audit event + rol + reason).

**Item-level `is_comped` rollback:** MVP'de trigger ile bloklanmaz — kasiyer yanlış kalemi ikram işaretlediyse admin düzeltebilir (domain service `uncompItem` v5.1). MVP pratik: admin siparişi cancel edip yeniden açar; comp rollback UI yok. Trigger eklememe gerekçesi: item-level değişiklik audit log'da izlenebilir (Bölüm 12), kesin blok gerekmez.

**10.2.5 — `is_fully_comped=true` siparişte `payments` davranışı (DOMAIN KİLİDİ):**

- **Satır sayısı: 0** (sıfır). Hiç `payments` satırı üretilmez. "Sıfır tutarlı tek satır" yaklaşımı reddedildi — gerekçe: `payments.payment_type` enum'u (`cash`/`card`) ikramda anlamsız değer taşımak zorunda kalır; rapor `GROUP BY payment_type` ikram satırını hayali bir type'a koyar. Yokluk semantik olarak doğru.
- **`orders.closed_at` set edilir**, `order_status='closed'` (cancel değil).
- **Invariant (§10.4'te tam):** `is_fully_comped=true` ise `COUNT(payments WHERE order_id=X)=0` ve `SUM(payments.amount_cents WHERE order_id=X)=0` (tautology). `is_fully_comped=false` ise `SUM(payments)=total_cents - comped_amount_cents`.

**10.2.6 — `comp` vs `cancel` ayrımı:**

İki farklı akış, karıştırılmaz:

| Akış | `order_status` | `is_fully_comped` | `payments` | Rapor etkisi |
|---|---|---|---|---|
| **Tam iptal (cancel)** | `cancelled` | `false` | 0 satır | Sipariş **yok sayılır** (ciroya girmez, ikram yüküne girmez) |
| **Tam ikram (comp)** | `closed` | `true` | 0 satır | Gross ciroya girer, net ciroya girmez, ikram yüküne girer |
| **Kısmi ikram** | `closed` | `false` | N satır (≥1) | Gross tam, net = gross − comped, ikram yükü = comped_amount |

**Kısmi iptal (tek kalem iptali) kapsam dışı:** Pilot restoranda müşterinin sipariş verdikten sonra tek kalem iptal etme senaryosu (ör. "3 pideden 1'ini iptal edin") yaşanmıyor. MVP'de `order_items` seviyesinde `cancelled` bayrağı YOK — iptal akışı yalnız sipariş seviyesinde (tam iptal) işler. Yanlış sipariş senaryosu: kasiyer siparişi cancel eder + yeniden açar. Bu ihtiyaç v5.1'de ortaya çıkarsa `order_items.is_cancelled BOOLEAN` + ayrı audit event + mutfak ekranı davranışı ile ayrı ADR'de ele alınır. Kapsam kilidi gereği MVP kapsamına eklenmez.

Cancel yolu bu ADR kapsamı dışında tutuldu (MVP için basit tanım yeterli: `order_status='cancelled'` + `cancelled_at` + `cancel_reason` + audit event). Detaylı cancel akışı v5.1 ihtiyacı belirirse ayrı ADR ile tanımlanır.

**10.3 — `order_type=delivery` ödeme zamanlaması:**

`order_type` enum üç değer (Bölüm 9.1): `dine_in` / `takeaway` / `delivery`. Bu bölüm delivery'nin ödeme akışındaki özelliğini kilitler — fark yalnız teslim şeklinde, ödeme zamanlamasında değil.

**10.3.1 — Prensip: delivery ≡ takeaway (ödeme açısından):**

Ödeme zamanlaması `takeaway` ile aynı akışta ele alınır:

| order_type | Ödeme kimden | Ödeme zamanı | `payments` üretimi |
|---|---|---|---|
| `takeaway` | Müşteri kasada | Kapıda (müşteri paketi alırken) | Sipariş kapanışında tek adım |
| `delivery` | Kurye → kasa | Kurye döndüğünde | Kurye dönüşünde, kasiyer yazar |

Dine-in farklı akış (adisyon modeli, masa kapanışında ödeme). Bu bölümde kapsamı dışı; §10.1 kapsamı yeterli.

**10.3.2 — MVP senaryosu: yalnız "kapıda ödeme":**

v5.0 MVP'de `delivery` için **yalnız kapıda ödeme** desteklenir — kurye nakit veya mobil POS'tan müşteri kapısında tahsilat yapar; dönüşte kasiyer `payments` satırını oluşturur.

Sipariş durum geçişi:
- Açılış → `order_status='open'`
- Mutfak hazırlar → `preparing`
- Paket kuryeye teslim → `served` (semantik: "servis edildi" — kurye çıktı)
- Kurye döner + ödeme alındı → `closed` + `payments` satırı

**"Önceden ödeme" (online/link) v5.1'e ertelendi.** Müşterinin sipariş anında (ör. web linki, kredi kartı, gelmeden önce) ödeme yapması MVP kapsam dışı.

**Gerekçe:**
- Online ödeme sağlayıcı entegrasyonu (iyzico vb.) Phase 5+ iş — MVP kapsamı dışı;
- Pilot restoran müşterileri telefonla arıyor, link ödeme alışkanlığı yok;
- Kapsam kilidi — MVP pilot deneyimi için kapıda ödeme yeterli.

v5.1'de "önceden ödeme" açılırsa ayrı ADR: §10.4 invaryantı (`payments.created_at >= orders.created_at`) gevşer, online sağlayıcı webhook kuralı + ödeme öncesi sipariş kapanış engeli + iade/chargeback akışı ayrı karar noktaları.

**10.3.3 — Kurye tracking MVP'de YOK:**

Bölüm 9.2.1'den hatırlatma: `order_type.delivery` enum değeri var ama **kurye kimliği / çıkış saati / dönüş saati kayıt altında tutulmaz**. `orders.served_at` (kuryeye paket teslim saati) tek takip noktası; kurye kimliği users tablosuna FK değil.

**Gerekçe:**
- Pilot restoranda 1-2 kurye sabit, kim gittiği operasyonel olarak bilinir;
- Kurye performans raporu v5.1+ bir özellik;
- Kapsam kilidi (MVP minimalizm).

v5.1 kurye tracking ADR'si şunları getirecek: `orders.courier_id UUID FK` + `courier_dispatched_at` + `courier_returned_at` + rota/teslim audit event'leri + kurye performans raporu. Bu ADR kapsamı dışında.

**10.3.4 — Ödeme invaryantı delivery'de:**

§10.4 kuralları (scope, sum, tenant match, zamanlama) delivery için **değişmeden** uygulanır. Özel davranış yok:
- `payment_type ∈ {cash, card}` — kurye nakit veya mobil POS'tan döner; yemek kartı MVP'de kabul edilmiyor (Bölüm 9.2.1);
- `payment_scope` genelde `full_order` — delivery siparişleri tek müşteriye olduğu için split nadir; teknik olarak `split_item` / `equal_split` mümkün ama MVP UX bu seçenekleri delivery ödemesinde sunmaz (sadeleştirme kararı, kod'da enforce edilmez — UI'da gizlenir);
- `payments.created_at >= orders.created_at` — kurye dönüşünde ödeme alınır, sipariş öncesi payment olamaz. Bu invaryant MVP'de sıkıdır; "önceden ödeme" v5.1'de bu kuralı gevşetecek.

**10.3.5 — v3 → v5 geçiş hatırlatması:**

Bölüm 9.2.1'de açıldı: v3'te `takeaway` tek akıştı, `delivery` ayrı enum değeri değildi — takeaway içinde status/flag ile yönetiliyordu. v5'te `order_type` ayrıştı. Eski takeaway satırlarının `takeaway` mi `delivery` mi olarak backfill edileceği Phase 5 **backfill ADR'sinde** karara bağlanır (`active-plan.md` Follow-up'ta kayıtlı borç). Bu ADR v3→v5 geçiş stratejisini almaz; yalnız v5 sonrası semantiği kilitler.

**10.4 — Ödeme invaryantları ve enforcement katmanları:**

§10.1-10.3'te tanımlanan davranışların arkasındaki referansiyel/matematiksel kurallar bu bölümde liste halinde kilitli. Enforcement üç katmanda yapılır:

1. **Domain service** (`OrderService.closeOrder`, `OrderCompService.*`) — **authoritative**, tüm yazımlar tek transaction'da buradan geçer;
2. **DB CHECK + trigger** — savunma katmanı; manuel SQL, test fixture, migration hatası bypass'ını yakalar;
3. **UI blokajı** — live UX; kasiyer erken uyarı, kapatma butonunu disable eder.

**10.4.1 — Invaryant listesi:**

| # | İnvaryant | Domain | DB | UI |
|---|---|---|---|---|
| I1 | `payments.payment_scope` NOT NULL | ✓ | NOT NULL + enum | scope seçimsiz kaydedilemez |
| I2 | SUM(payments) = payable (is_fully_comped=false ise) | ✓ | deferred trigger | live toplam göstergesi |
| I3 | `is_fully_comped=true` ise `COUNT(payments)=0` | ✓ | deferred trigger | ikram sonrası ödeme butonu yok |
| I4 | tenant_id match: payments ↔ orders ↔ order_items | ✓ | composite FK | repository helper (§6.3.1) |
| I5 | zamanlama: `payments.created_at >= orders.created_at` | ✓ | trigger | — (sistem saatli) |
| I6 | split_item coverage: ödenmesi gereken her `order_item` bir `payments` satırına bağlı | ✓ | I2 içinde (SUM mismatch) | "eksik ödeme" hatası |
| I7 | `payment_items` uniqueness: bir `order_item` yalnız 1 payment'a | — | `UNIQUE(order_item_id)` (§10.1(b)) | — |
| I8 | `amount_cents > 0` (tüm `payments` satırları) | ✓ | CHECK | "Öde" butonu 0₺ kabul etmez |

**Kural:** Tüm 8 invaryant domain service tarafından enforce edilir; ayrıca DB seviyesinde yakalanabilenler (I1-I8, I6 hariç) çift savunmayla kilitli. I6 ekonomik nedenle ayrı trigger yerine I2 (SUM) içinde dolaylı enforce edilir — ödenmemiş kalem SUM mismatch'i tetikler.

**10.4.2 — I2: SUM = payable (en kritik kural):**

Formülasyon:

```
is_fully_comped=false  →  SUM(payments.amount_cents WHERE order_id=X)
                        = orders.total_cents - orders.comped_amount_cents
is_fully_comped=true   →  COUNT(payments WHERE order_id=X) = 0
```

**Kontrol zamanı:** Yalnız `order_status` `open|preparing|served` → `closed` geçişinde. Açık siparişte ödeme satırları kısmen eklenmiş olabilir (equal_split üretim ortası, split_item kalem atama ortası) — ara durumda SUM mismatch yasal.

Açık kalmış yarım ödenmiş siparişler (ör. equal_split 4 satırdan 3'ü yazılmış, sipariş henüz kapatılmamış) I2 kontrolüne girmez — kapanış tetiklenmemiştir. Bu siparişlerin temizlenmesi günlük kapanış (POS gün sonu) akışında yapılır: kasiyer açık sipariş listesinden teker teker kapatır veya iptal eder. Gün sonu akışı Bölüm 15 veya ayrı bir daily-closeout ADR'sinde tanımlanır (bu ADR kapsamı dışında).

**DB — deferred constraint trigger:**

```sql
CREATE OR REPLACE FUNCTION check_payment_sum() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ord        orders%ROWTYPE;
  total_paid INT;
  payable    INT;
BEGIN
  SELECT * INTO ord FROM orders
    WHERE id = COALESCE(NEW.order_id, OLD.order_id);

  -- Kontrol yalnız kapalı siparişlerde
  IF ord.order_status <> 'closed' THEN
    RETURN NULL;
  END IF;

  -- I3: fully comped → 0 satır
  IF ord.is_fully_comped THEN
    IF EXISTS (SELECT 1 FROM payments WHERE order_id = ord.id) THEN
      RAISE EXCEPTION
        'is_fully_comped=true siparişte payments satırı olamaz (I3).'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;

  -- I2: SUM = payable
  SELECT COALESCE(SUM(amount_cents), 0) INTO total_paid
    FROM payments WHERE order_id = ord.id;
  payable := ord.total_cents - ord.comped_amount_cents;

  IF total_paid <> payable THEN
    RAISE EXCEPTION
      'SUM(payments) mismatch: beklenen %, alınan % (I2).',
      payable, total_paid
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER payments_check_sum
  AFTER INSERT OR UPDATE OR DELETE ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_sum();

CREATE CONSTRAINT TRIGGER orders_check_sum_on_close
  AFTER UPDATE OF order_status ON orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_sum();
```

**Neden `DEFERRABLE INITIALLY DEFERRED`?** `equal_split` veya `split_item`'da N payments satırı tek transaction'da batch insert edilir; her satırdan sonra SUM kontrolü yapılsa transaction ortasında (tam set yazılmadan) FAIL ederdi. Deferred trigger yalnız `COMMIT` öncesi çalışır — "final state" doğrulanır, ara durumlar kabul edilir. Domain service `closeOrder` zaten tek transaction'da tüm insert'leri yapıp commit eder.

**UI tarafı:** Ödeme ekranında kasiyer satır eklerken running total göstergesi (`2/3 ödendi, 280₺ kaldı`). Payable tamamlanmadıkça "Siparişi Kapat" butonu disabled. UX-only; gerçek enforcement DB + domain'de.

**10.4.3 — I4: tenant_id match (§6.3.1 atıfı):**

Her `payments` satırı `tenant_id UUID NOT NULL` taşır. Referansiyel bütünlük composite FK ile kurulur:

```sql
-- payments tablosu içinde (detay Bölüm 14'te)
FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)
-- benzer şekilde payment_items için
FOREIGN KEY (order_item_id, tenant_id) REFERENCES order_items (id, tenant_id)
```

Bu pattern `orders` ve `order_items` tablolarında composite UNIQUE `(id, tenant_id)` gerektirir — ADR-003 §6'da kurulu; bu bölüm kural atıfı yapar.

Savunma katmanları (§6.3.1 a/b/c):
- Repository `joinWithTenant` helper — `payments` JOIN'lerine `WHERE tenant_id = :ctx` otomatik ekler;
- ESLint `no-raw-kysely-join` — helper dışı JOIN yasak;
- `db-migration-guard` PR gate — grep'le kaçağı yakalar.

Bu üçlü I4'ü tek noktadan korur; `payments` tablosunda ayrı kural eklenmez (§6 kurallarının uygulaması).

**10.4.4 — I5: zamanlama (`created_at` kuralı):**

```
payments.created_at >= orders.created_at (FOREACH payments.order_id)
```

PostgreSQL CHECK constraint subquery içermez (IMMUTABLE ihlali); enforcement trigger ile:

```sql
CREATE OR REPLACE FUNCTION check_payment_timing() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  order_created TIMESTAMPTZ;
BEGIN
  SELECT created_at INTO order_created
    FROM orders WHERE id = NEW.order_id;

  IF NEW.created_at < order_created THEN
    RAISE EXCEPTION
      'payments.created_at (%) < orders.created_at (%) — zaman ihlali (I5).',
      NEW.created_at, order_created
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_check_timing
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION check_payment_timing();
-- NOT: UPDATE OF created_at clause'u §10.5 B3 kararıyla kaldırıldı;
--      immutability ayrı trigger'la korunur (payments_block_created_at_update).
```

**"Önceden ödeme" v5.1 gevşetmesi (hatırlatma):** Online ödeme akışında müşteri sipariş oluşturmadan önce payment intent açabilir — sıralama tersine dönebilir. v5.1 "önceden ödeme" ADR'sinde bu trigger gevşetilir (detay o ADR'de).

**10.4.5 — I6: split_item coverage (dolaylı enforcement):**

`payment_scope='split_item'` siparişlerde: `order_items` satırlarından `is_comped=false` olanların her biri `payment_items` junction'da bir `payment_id`'ye bağlı olmalı. Eksik kalem = eksik ödeme.

**Enforcement stratejisi — ayrı trigger yerine I2 içinde:**

Eksik atanmış kalem → o kalem `payable` hesabına girer ama `SUM(payments)` karşılamaz → I2 trigger FAIL. Ayrı coverage trigger yazmak ek complexity yaratır; SUM mismatch semantik olarak aynı ihlali zaten yakalar.

- **Domain:** `OrderService.closeOrder` kapanış öncesi coverage check — eksik varsa erken exception (kullanıcı dostu mesaj: "Pide 2 satırı ödenmedi" vs generic SUM mismatch). UX için Domain'de ayrı check, DB'de I2 yeterli.
- **UI:** Ödeme ekranında atanmamış `is_comped=false` kalemler ayrı renkle vurgulu; "Siparişi Kapat" disabled.

**10.4.6 — I8: `amount_cents > 0`:**

```sql
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive
  CHECK (amount_cents > 0);
```

Sıfır tutarlı `payments` satırı yasak — ikram akışı satır üretmez (§10.2.5), cancel akışı satır üretmez (§10.2.6).

Refund akışı MVP kapsamı dışı — pilot restoranda ödeme iadesi yaşanmıyor. İhtiyaç v5.1'de ortaya çıkarsa ayrı ADR'de ele alınır (`payments`'ta negatif satır YOK kuralı o ADR'de korunacak).

**10.4.7 — Enforcement katmanları özeti:**

| Katman | Rol | Hangi invaryantlar |
|---|---|---|
| **Domain service** | Authoritative, tüm yazım yolu | I1, I2, I3, I5, I6, I7, I8 |
| DB CHECK | Simple predicate | I1 (NOT NULL + enum), I8 (> 0), `comped_amount_cents >= 0` |
| DB deferred constraint trigger | Cross-row/table, commit-time | I2, I3 |
| DB immediate trigger | Row-time reference | I5 (payments_check_timing), §10.2 T1/T2/T3 (ikram) |
| Composite FK | Referential | I4 |
| UNIQUE index | Uniqueness | I7 (`payment_items` UNIQUE `(tenant_id, order_item_id)`, §6.2) |
| UI blokajı | Live UX | I2, I6 (kasiyer erken uyarı) |
| Repository helper | Cross-query filter | I4 (`joinWithTenant`, §6.3.1) |
| ESLint + PR gate | Bypass koruma | I4 (no-raw-kysely-join), §10.2 OrderCompService tek giriş |

**Prensip:** Domain authoritative, DB defansif. DB trigger'lar manuel SQL / test / migration hatası senaryolarını yakalamak için — "başka nasıl bozulur?" sorusuna cevap. Domain bypass edilirse DB kilitleri invariant'ı korur; domain doğru çalışırsa DB trigger'lar sessizdir.

### Bölüm 10.5 — Review Gate Outcome (db-migration-guard, Session 12)

**Tarih:** 2026-04-24
**Reviewer:** `db-migration-guard` sub-agent (read-only)
**Kapsam:** Bölüm 10.1-10.4 (payment_scope davranışları, ikram modeli, trigger'lar, delivery timing, 8 invaryant, enforcement katmanları)
**Verdict:** **3 BLOCKER** + **7 CONCERN** + **8 green-light** maddesi. BLOCKER kararları bu bölümde kilitli ve §10.1-10.4 gövdesine sızdırılan küçük düzeltmeler §10.5.4'te listeli. CONCERN'ler §10.5.2'de üç bucket'a ayrılmış olarak Bölüm 11 öncesi ayrı pass'e veya v5.1 backlog'una yönlendirildi. Green-light maddeleri §10.5.3'te kilitli — sonraki bölümler bunlara dokunmaz.

**10.5.1 — Kabul edilen BLOCKER kararları:**

**B1 — Composite UNIQUE `(id, tenant_id)` parent tablolarda zorunlu (§6.5'e taşındı):**

Bulgu: §10.4.3 composite FK pattern (`FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)`) kullanıyor; bu PostgreSQL'de parent tabloda eşleşen `UNIQUE (id, tenant_id)` constraint'i gerektirir. §6'da böyle bir kural yoktu → migration zamanı `CREATE TABLE` FAIL.

Karar: **§6'ya yeni alt-bölüm 6.5 eklendi** — "Her multi-tenant business tablosu `UNIQUE (id, tenant_id)` constraint'i taşır; composite FK hedefi olabilmesi için zorunludur; istisnasız uygulanır." Tam tanım ve DDL örnekleri §6.5'te. `users` tablosunun kapsamı ADR-002 kararına bağlı olarak §6.5 notuyla işaretli. §10.4.3 artık geri-referanslı olarak doğru; ek değişiklik gerekmiyor.

**B2 — Kapalı/iptal sipariş üzerinde comp DB seviyesinde yasak (DOMAIN KİLİDİ):**

Bulgu: T2 (`recompute_comped_amount`, §10.2.4) kapalı siparişte item-level comp yapıldığında `orders.comped_amount_cents` günceller → payable kayar; ancak `check_payment_sum` (§10.4.2) `AFTER UPDATE OF order_status ON orders` + `ON payments` ile sınırlı, `comped_amount_cents` değişikliğinde re-fire etmiyor. Sonuç: kapalı siparişte sonradan ikram yapılırsa SUM invaryantı sessizce bozulur, check_payment_sum bu senaryoyu yakalamaz.

Karar: **Kapalı veya iptal edilmiş sipariş üzerinde comp işlemi DB seviyesinde BLOKLANIR.** `orders.order_status IN ('closed', 'cancelled')` iken `orders.is_fully_comped`, `orders.comped_amount_cents` veya bağlı `order_items.is_comped` kolonları güncellenemez. v5.1 "admin uncomp" akışı bu trigger'ı role-sensitive olarak gevşetecek — ayrı ADR, MVP kapsamı dışı. Forward-reference §10.2.3'e eklendi.

**OLD.order_status kullanılır (same-transaction closure serbest, "zaten kapalı" yasak):** Kasiyer aynı UPDATE'te `order_status='closed'` + `is_fully_comped=true` set edebilir (tek işlemde "kapat ve tamamını ikram et" — geçerli iş senaryosu). Yasak olan: sipariş zaten `closed` durumdayken sonradan comp bayrağı toggle etmek. Bu yüzden trigger `OLD.order_status` kontrolü yapar, `NEW.order_status` değil.

SQL — yeni trigger function + iki trigger:

```sql
CREATE OR REPLACE FUNCTION block_comp_on_closed_order() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  parent_status order_status;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    -- orders.is_fully_comped veya orders.comped_amount_cents güncellemesi
    IF OLD.order_status IN ('closed', 'cancelled') THEN
      RAISE EXCEPTION
        'Kapalı/iptal edilmiş sipariş üzerinde ikram değişikliği yasak (order_status=%). v5.1 admin uncomp akışı ile gevşetilecek.',
        OLD.order_status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    -- order_items.is_comped güncellemesi → parent orders.order_status lookup (tenant filtreli, §6.3.1 defense-in-depth)
    SELECT order_status INTO parent_status
      FROM orders
      WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id;
    IF parent_status IN ('closed', 'cancelled') THEN
      RAISE EXCEPTION
        'Kapalı/iptal edilmiş siparişin kalemi üzerinde ikram değişikliği yasak (order_status=%). v5.1 admin uncomp akışı ile gevşetilecek.',
        parent_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_block_comp_on_closed
  BEFORE UPDATE OF is_fully_comped, comped_amount_cents ON orders
  FOR EACH ROW EXECUTE FUNCTION block_comp_on_closed_order();

CREATE TRIGGER order_items_block_comp_on_closed
  BEFORE UPDATE OF is_comped ON order_items
  FOR EACH ROW EXECUTE FUNCTION block_comp_on_closed_order();
```

Gerekçe detayı:
- **`OLD.order_status` kontrolü (same-transaction closure serbest):** Atomik UPDATE'te "kapat + tamamını ikram et" geçerli akış; kasiyer siparişi kapatırken tek adımda ikram bayrağı açabilir. OLD kontrolü bu senaryoyu serbest bırakır; "zaten kapalı → sonradan comp toggle" senaryosu yasak. Aynı transaction'da `order_status` `open → closed` geçişiyle beraber `is_fully_comped=true` set edilebilir (OLD.order_status='open' → trigger izin verir).
- **`order_items` trigger'ında tenant filtresi (§6.3.1 defense-in-depth):** Parent orders lookup'ı `WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id` — C4 bulgusunda tespit edilen `propagate_full_comp` eksikliği burada tekrar etmez. Composite FK (§6.5) zaten tenant bütünlüğünü korur ama §6.3.1 "JOIN'e/UPDATE'e tenant filtresi her zaman eklenir" doktrini burada da uygulanır.
- **Trigger interaction — T1 ile uyum:** T1 (`propagate_full_comp`) `orders.is_fully_comped false → true` geçişinde `order_items.is_comped=true` toplu set eder. Bu AFTER UPDATE trigger'ı, B2'deki `BEFORE UPDATE OF is_comped ON order_items` trigger'ını tetikler mi? Tetikler — ama T1 yalnız `is_fully_comped` değişikliğinde çalışır; eğer o UPDATE'in parent orders satırında `OLD.order_status='open'` ise (kapat+tam-ikram akışı), B2 izin verir (parent status kontrolü `OLD.order_status`'a bakıyor, ama T1'in tetiklediği `order_items` trigger için parent lookup `NEW.order_id` üzerinden mevcut `orders` satırını okur — o anki `orders.order_status` `open`'dır çünkü `OF is_fully_comped` trigger'ı `status`'u değiştirmez). Same-transaction closure senaryosunda kasiyer önce `order_status='closed'` UPDATE eder → B2 orders trigger OLD='open' → geçer; sonra `is_fully_comped=true` UPDATE → B2 orders trigger OLD='closed' → **blok**. Bu yüzden domain service (`OrderCompService.compFullOrder` + `OrderService.closeOrder`) tek UPDATE'te status ve comp bayrağını birlikte set etmek zorunda — domain layer bu kısıtı belgeler.
- **ERRCODE seçimi:** `check_violation` (`23514`) — PG standard; domain service yakalayıp Türkçe mesaja çevirir (C6 doktrini, §10.5.2 Bucket C).

**B3 — `payments_check_timing` clause daraltıldı + ayrı immutability trigger:**

> Bu bölümdeki trigger isimleri §10.5.2 C3 mini-pass'i sonrası güncel formdadır. Eski isimler: B3 ilk yazıldığında `payments_timing_check` ve `payments_created_at_immutable` idi (§10.5.2 C3'te `payments_check_timing` ve `payments_block_created_at_update` olarak yeniden adlandırıldı).

Bulgu: §10.4.4'teki `payments_check_timing` trigger tanımı `BEFORE INSERT OR UPDATE OF created_at ON payments`. `payments.created_at` §7 snapshot disiplini gereği immutable olmalı. `UPDATE OF created_at` clause'u ya dead code (hiç tetiklenmez → yanıltıcı) ya da bir gün UPDATE izni verilirse backdoor.

Karar: **`payments_check_timing` artık yalnız `BEFORE INSERT`.** `payments.created_at` immutability için ayrı trigger `payments_block_created_at_update` eklendi — §7 snapshot invaryantının `payments` tablosuna uygulanması.

SQL — uygulama:

```sql
-- §10.4.4'teki mevcut trigger daraltıldı (clause değişikliği §10.5.4'te diff olarak uygulandı):
CREATE TRIGGER payments_check_timing
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION check_payment_timing();

-- Yeni trigger (§7 snapshot disiplini payments.created_at'e uygulanır):
CREATE OR REPLACE FUNCTION assert_payments_created_at_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION
      'payments.created_at immutable (§7 snapshot invaryantı). Eski: %, yeni: %.',
      OLD.created_at, NEW.created_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_block_created_at_update
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION assert_payments_created_at_immutable();
```

Gerekçe: §7 "snapshot kolonları NOT NULL + immutable" kuralı `payments.created_at` için de geçerli. Kolon `DEFAULT NOW()` ile DB tarafından yazılır, uygulama tarafında set edilmez; herhangi bir UPDATE girişimi kod hatası demektir — trigger erken yakalar. B3 sonrası `check_payment_timing` yalnız INSERT'te order-timing validation yapar (`payments.created_at >= orders.created_at` — I5), `UPDATE OF created_at` scenaryosu artık üstteki immutability trigger'ı tarafından engellenir.

**10.5.2 — CONCERN'ler (Bucket A+B mini-pass uygulandı 2026-04-25):**

Bucket A (C1) ve Bucket B (C2-C4) dört concern bu ADR'nin mini-pass adımında kapatıldı. Bucket C (C5-C7) forward-reference olarak korunuyor (aşağıda).

- **C1 ✅ Uygulandı — `payment_items_block_comped_insert` trigger eklendi.** §10.2.2(b) `payment_items` DDL'inin altına `BEFORE INSERT` trigger yazıldı; `is_comped=true` parent kalemi junction'a girmeyi DB seviyesinde reddediyor (`block_comped_item_in_payment` function, `RAISE EXCEPTION` + `check_violation` ERRCODE). Domain authoritative + DB defansif + UI UX üç katmanlı enforcement (§10.4.7) tamamlandı.
- **C2 ✅ Uygulandı — `payment_items` DDL §6.2 + §6.5 uyumlu hale getirildi.** Üç değişiklik: `UNIQUE (order_item_id)` → `UNIQUE (tenant_id, order_item_id)` (§6.2 prefix); `payment_id` ve `order_item_id` FK'leri tek-sütundan composite forma çevrildi (`FOREIGN KEY (..., tenant_id) REFERENCES ... (id, tenant_id)`, §6.5 + §10.4.3 niyetinin DDL'e yansıması). `payments` tablosu Bölüm 14'te yazılırken §6.5'e uyumlu olacak (`UNIQUE (id, tenant_id)` zorunlu) — eksiklik durumunda db-migration-guard PR gate'i red eder (§6.5 satır 656).
- **C3 ✅ Uygulandı — Trigger naming `<table>_<action>[_<when>]` tek formata çekildi.** Dört rename: `payments_sum_check` → `payments_check_sum`; `orders_sum_check_on_close` → `orders_check_sum_on_close`; `payments_timing_check` → `payments_check_timing`; `payments_created_at_immutable` → `payments_block_created_at_update`. Verb seçimi: validation/relasyonel kontrol için `check_`, prohibition için `block_` (mevcut `orders_block_comp_rollback`, `orders_block_comp_on_closed` desenine uyumlu, yeni verb girişi yok). Geri kalan beş trigger (`orders_propagate_full_comp`, `order_items_recompute_comp_amount`, `orders_block_comp_rollback`, `orders_block_comp_on_closed`, `order_items_block_comp_on_closed`) zaten verb-first formdaydı, dokunulmadı. Yeni C1 trigger'ı (`payment_items_block_comped_insert`) baştan bu konvansiyona uygun yazıldı. Function isimleri (örn. `assert_payments_created_at_immutable`) konvansiyon dışında — function naming bu pass'in kapsamı değil.
- **C4 ✅ Uygulandı — `propagate_full_comp` UPDATE'ine `AND tenant_id = NEW.tenant_id` eklendi.** §6.3.1 defense-in-depth ilkesi composite FK güvencesinin üstüne mekanik tenant filtresi koyuyor; §10.5.1 B2 örneğindeki (`order_items` trigger parent lookup'ı) deseni T1 trigger'ında da uygulanmış oldu.

**Bucket C — Forward-reference / v5.1 backlog değerlendirmesi:**

- **C5 — `payment_items.payment_id` DELETE davranışı.** MVP'de payment immutable (DELETE yolu kapalı — cancel akışı satır eklemiyor). §14 detay tablo tanımlarında `payment_items.payment_id` için `ON DELETE RESTRICT` explicit belirtilir; payment_items orphan'ı DB seviyesinde engellenmiş olur. Forward-reference §14.
- **C6 — DB hata mesajının UI'a ham sızdırılmaması.** `RAISE EXCEPTION` çıktıları kasiyere doğrudan gösterilmez; domain service wrapper hatayı yakalar, Türkçe i18n-key üzerinden `t('error.order.compOnClosed')` gibi mesaja çevirir. Bu kural §12 (error taxonomy / audit sanitize) veya ayrı "API error contract" ADR'sinde kilitli kılınır — bu ADR kapsamı dışı.
- **C7 — I8 (`amount_cents > 0`) refund forward-compat borcu.** v5.1 refund ADR'si bu CHECK'i gevşetir veya negatif satır yerine `payment_kind='refund'` ayrı satır modeli tanımlar (§10.4.6 zaten negatif yasak prensibini kaydetmiş). v5.1 backlog'a girer — `active-plan.md` Follow-up bölümüne §10.5 commit'iyle birlikte kayıt.

**10.5.3 — Green-light kilidi (bu maddelere §10.5 sonrası dokunulmaz):**

- **GL1:** `total_cents = GROSS` kararı (§10.2.2) — snapshot stabilitesi + rapor basitliği + payments invaryantı üç ayrı gerekçeyle airtight. Alternative A (NET) reddi clean.
- **GL2:** `DEFERRABLE INITIALLY DEFERRED` CONSTRAINT TRIGGER `check_payment_sum` kullanımı — PG feature match doğru (CONSTRAINT TRIGGER'lar DEFERRABLE olabilir, regular trigger'lar olamaz), batch insert rationale textbook.
- **GL3:** `is_fully_comped=true` siparişte **0 `payments` satırı** semantiği (yokluk) — "sıfır tutarlı tek satır" reddi `GROUP BY payment_type` raporlama kirliliğini önlüyor; doğru karar.
- **GL4:** Comp vs cancel ayrım tablosu (§10.2.6) — üç akış, üç davranış, üç rapor sonucu net. Phase 2'de yeniden okunduğunda karışıklık çıkmaz.
- **GL5:** Üç katmanlı enforcement (domain authoritative / DB defansif / UI UX) + §10.4.7 özet tablosu — her invaryant hangi katmanda korunduğu explicit.
- **GL6:** Deferred DB trigger + UI live running total ayrımı — commit-time DB truth + live UX feedback iki ayrı amaç, birleştirilmez.
- **GL7:** `OrderCompService` dört-prong savunma (tek giriş yolu + ESLint no-raw-update + audit log zorunlu + admin-only rol) — ikram akışı tek noktadan kontrol altında.
- **GL8:** Scope ≠ payment_type ortogonalliği (§10.1, sinyal #29 atfı) — v3 `'mixed'`/`'other'` pathology'sini kökten eleyen karar. `payment_scope` üç değerli (full_order/split_item/equal_split), `payment_type` iki değerli (cash/card), ortogonal kolonlar.

**10.5.4 — Bölüm 10.1-10.4'e uygulanan küçük düzeltmeler:**

Bu review gate sonucu BLOCKER kararları iki noktada mevcut §10.1-10.4 gövdesine dokundu; her ikisi de minimum yüzey diff olarak uygulandı:

1. **§10.4.4 — `payments_check_timing` trigger clause daraltıldı:** `BEFORE INSERT OR UPDATE OF created_at ON payments` → `BEFORE INSERT ON payments`. B3 kararı uygulaması. Eski clause dead code / backdoor riskiydi; immutability artık ayrı `payments_block_created_at_update` trigger'ıyla kilitli (SQL §10.5.1 B3). (Trigger isimleri §10.5.2 C3 mini-pass sonrası güncel; eski isimler `payments_timing_check` / `payments_created_at_immutable`.)
2. **§10.2.3 — forward-reference paragrafı eklendi:** "Kapalı/iptal edilmiş siparişte comp DB seviyesinde bloklu (§10.5 B2 `block_comp_on_closed_order` trigger); same-transaction closure serbest; v5.1 admin uncomp akışı bu kilidi gevşetecek." B2 kararı izi.

Başka §10.1-10.4 gövdesine dokunulmadı. CONCERN'ler Bucket A/B (C1-C4) §10.5.2'de mini-pass sonrası kapatıldı (2026-04-25 commit'i); §10.2.2(b) `payment_items` DDL'i + §10.4.2 T1 trigger'ı + §10.4.4 trigger isimleri + §10.4.5 (B3) trigger ismi mini-pass'in dokunduğu noktalar.

**10.5.5 — Bu gate sonrası `active-plan.md` Follow-up'a eklenecek borçlar:**

- **"Bölüm 11 öncesi mini-pass (CONCERN bucket A+B)":** ✅ Tamamlandı (2026-04-25 commit). C1 (DB guard for comped item in payment_items) + C2 (UNIQUE + composite FK §6.2/§6.5 uyumu) + C3 (trigger naming, dört rename) + C4 (propagate_full_comp tenant filter).
- **"v5.1 refund ADR borcu (C7)":** `payments.amount_cents > 0` CHECK'inin refund akışıyla ilişkisi; negatif yasak ilkesi korunacak; `payment_kind='refund'` ayrı satır model önerisi. Phase 5+ iş.
- **"ADR-002 sonrası §6.5 users notu güncellemesi":** users tenant-scoped mı global mı kararlandığında §6.5'teki "ADR-002 kararına bağlı" cümlesi netleşir.

---

### Bölüm 11 — `order_no` Günlük Unique Sayaç

**Bağlam:** v3'te `orders.order_no INTEGER` günlük reset edilen, kullanıcıya "Sipariş No: 47" diye gösterilen çıplak sayaç idi (v3 `orders` tablosu, `D:\dev\restoran-pos-v3\server\db\schema.sql` satır 94-98). Garson "47'nin çayı geldi mi?" diyebiliyor, mutfakta fişte 47 yazıyor, müşteriye "47 numara" diye sesleniliyor. v5'te bu davranış **paritetik** korunur; cloud + multi-tenant + cutoff'a uyumlu hale getirilir. Bu bölüm (a) format, (b) UNIQUE garantisi, (c) concurrency stratejisi, (d) cancel davranışı, (e) cutoff/iş-günü etkileşimi konularını kilitler.

---

#### 11.1 Format kararı

**Karar:** `orders.order_no INTEGER NOT NULL CHECK (order_no >= 1)`. Kullanıcıya çıplak INT olarak gösterilir ("Sipariş No: 47"). Tarih prefix'i, tenant prefix'i, "YYYYMMDD-NNNN" formatı **yok**.

**Gerekçe:** v3 paritesi (kullanıcı sözlü iletişimde "kırk yedi" diyor); kısa rakam mutfak fişinde okunaklı; tenant prefix'i tek-tenant MVP'de gürültü, multi-tenant'ta da kullanıcı zaten kendi işletmesinde — tenant kimliğini sayaçta görmesine gerek yok.

"YYYYMMDD-NNNN" string format alternatifi §11.9'da reddedilir.

---

#### 11.2 UNIQUE INDEX kontratı (Karar 2 — index immutability)

**Sorun:** Sayaç günlük reset edildiği için unique scope `(tenant_id, business_date, order_no)` olmalı. Ancak `business_date` türetilmiş bir değer — `store_date(created_at, cutoff_hour, tz)` çıktısı — ve §5.1 gereği `store_date()` IMMUTABLE etiketli olsa da `tenant_settings`'ten cutoff/tz okuyan bir wrapper IMMUTABLE değildir. Doğrudan `CREATE INDEX ON orders (tenant_id, store_date(created_at, ...), order_no)` mümkün değil.

**Alternatifler:**

- **(X) `business_date` GENERATED STORED kolon:**
  ```sql
  business_date DATE GENERATED ALWAYS AS (store_date(created_at, 4, 'Europe/Istanbul')) STORED
  ```
  **Sorun:** PG 17'de generated column expression'ı IMMUTABLE olmak zorunda. `store_date()` 5.1.1'deki gibi IMMUTABLE etiketli olsa bile cutoff/tz **literal** olarak yazılmak zorunda. Tenant başına farklı cutoff (Bölüm 4.3 multi-tenant taahhüdü) generated column ile **uyumsuz** — DDL tüm tenantlar için tek literal cutoff'a kilitlenir. Reddedilir.

- **(X′) BEFORE INSERT trigger ile plain DATE kolonu doldurma + UNIQUE INDEX:**
  ```sql
  -- orders kolonu (Bölüm 5.2'deki store_date kolonuyla AYNI alan; ayrı bir business_date kolonu YOK):
  -- store_date DATE NOT NULL  (Bölüm 5.2'de tanımlı, append-only)

  CREATE UNIQUE INDEX orders_tenant_store_date_no_unique
    ON orders (tenant_id, store_date, order_no);
  ```
  Trigger `orders_populate_store_date` (§5.2) zaten `store_date`'i tenant_settings'ten okuyup dolduruyor. Ekstra kolon **gereksiz** — `store_date` kolonu hem rapor hem unique scope için kullanılır. UNIQUE INDEX plain kolonlar üzerinde, IMMUTABILITY sorunu yok.

- **(Y) `store_date()`'i IMMUTABLE etiketleyip cutoff'u parametre yapmak:** Bu zaten §5.1'de yapıldı; ama generated column expression'ı tek literal cutoff zorlar — multi-tenant'ı kırar. (X) ile aynı duvar.

- **(Z) Application-level UNIQUE check + advisory lock, DB ikinci hat yok:** DB invaryantı atlanır, race condition kaçabilir. Reddedilir — "DB otoritatif" ilkesi (§5.2, §10.5) ihlal.

**Seçim: (X′)** — `orders.store_date` zaten Bölüm 5.2'de stored DATE kolonu olarak tanımlı, BEFORE INSERT trigger ile dolduruluyor, UPDATE guard ile append-only. Yeni kolon eklemek yerine bu mevcut altyapıyı reuse ederiz.

**Tam DDL kontratı:**

```sql
-- orders tablosunda zaten var (Bölüm 5.2):
--   store_date DATE NOT NULL  (trigger ile doldurulur, append-only)

-- Bu bölümde eklenir:
ALTER TABLE orders
  ADD COLUMN order_no INTEGER NOT NULL CHECK (order_no >= 1);

CREATE UNIQUE INDEX orders_tenant_store_date_no_unique
  ON orders (tenant_id, store_date, order_no);
```

`tenant_id` UNIQUE INDEX'in **ilk kolonudur** (§6 + §10.5 C2 tenant prefix kuralı).

---

#### 11.3 Sayaç üretim stratejisi — concurrency (Karar 1)

**Sorun:** İki paralel `INSERT INTO orders` aynı `(tenant_id, store_date)` için aynı `order_no` üretmemeli. UNIQUE INDEX (§11.2) **ikinci hat savunmasıdır** — birinci hat sayaç üretim mekanizmasıdır.

**Alternatifler:**

- **(A) Counter tablosu + ON CONFLICT atomic increment:**
  - **Atomicity:** PG `ON CONFLICT DO UPDATE` row-level lock alır, atomic.
  - **Performans:** Insert başına 1 row write (counter) + 1 row write (orders). Trigger lookup yok.
  - **Failure mode:** Transaction abort olursa counter rollback olur, gap üretmez (cancel sonrası gap §11.4'te ayrı konu).
  - **Observability:** `SELECT * FROM order_no_counters WHERE ...` her zaman son durumu verir; debug kolay.
  - **Migration kolaylığı:** Yeni tablo; v3 backfill'de eski siparişlerden MAX(order_no) ile seed edilir (forward-ref Phase 5).

- **(B) `pg_advisory_xact_lock` + MAX+1:**
  ```sql
  SELECT pg_advisory_xact_lock(
    hashtextextended($1::text || $2::text, 0)
  );
  SELECT COALESCE(MAX(order_no), 0) + 1
    FROM orders
   WHERE tenant_id = $1 AND store_date = $2;
  ```
  - **Atomicity:** Advisory lock transaction süresince tutulur, atomic.
  - **Performans:** Her insert MAX taraması — `(tenant_id, store_date)` üzerinde index var (§11.2 UNIQUE), ama yine de aggregate scan + lock contention.
  - **Hash collision riski:** `hashtextextended` 64-bit; (tenant_id, business_date) çiftlerinde collision teorik olarak mümkün. Farklı tenant + farklı tarih aynı hash'e düşerse iki paralel insert birbirini bekler — **correctness** etkilenmez (sadece performans), ama beklenmedik bekleme kaynağı.
  - **Failure mode:** Transaction abort'ta lock otomatik release; ama MAX+1 yaklaşımı v3 davranışına yakın (Sinyal #23 "MAX+1 + FOR UPDATE" — v3 SQLite'ta FOR UPDATE yoktu, app-level lock kullanılıyordu).
  - **Observability:** Lock state `pg_locks` view'dan okunur; counter table'a göre opaque.
  - **Migration kolaylığı:** Yeni tablo yok, ama backfill için MAX taraması zaten gerekli.

**Karşılaştırma tablosu:**

| Boyut | (A) Counter tablosu | (B) Advisory lock + MAX+1 |
|---|---|---|
| Atomicity | Row-level lock, atomic | Advisory lock, atomic |
| Insert başına IO | 1 counter write + orders write | 1 lock + 1 aggregate scan + orders write |
| Failure mode | Rollback gap üretmez | Rollback gap üretmez |
| Hash collision | Yok | Teorik var (correctness değil, perf) |
| Observability | Tablo durumu doğrudan görünür | `pg_locks` opaque |
| v3 paritesi | Farklı yaklaşım | Yakın (MAX+1) |
| Multi-tenant scaling | Counter row tenant başına | Lock keyspace tüm tenantlar |

**Öneri: (A) Counter tablosu.** Gerekçe: (i) atomicity garantisi PG'nin native row-level lock'una emanet, advisory lock geleneksel olarak "advisory" — yanlışlıkla unutulması veya bypass edilmesi mümkün; (ii) observability (counter tablosu inspect edilebilir, lock state edilemez); (iii) MAX+1 her insert'te aggregate scan, scaling için counter tablo daha temiz; (iv) v3 Sinyal #23 referansı **bağlayıcı değil** — v3 SQLite + Node sync I/O dünyasında MAX+1 gerekçesi vardı, PG 17'de native upsert daha temiz.

**`FOR UPDATE on orders` özel notu (§11.9'a kayıt):** "henüz yazılmamış satırı lock'layamazsın" — `FOR UPDATE` mevcut satırlara row lock koyar, INSERT'i serialize etmez.

**Tam DDL kontratı:**

```sql
CREATE TABLE order_no_counters (
  tenant_id     UUID    NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  business_date DATE    NOT NULL,
  last_no       INTEGER NOT NULL CHECK (last_no >= 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, business_date)
);
```

Generic `set_updated_at()` fonksiyonu **§4.1.1**'de tanımlı (000_init'in bir kez tanımlanan generic fonksiyonu); `order_no_counters` mutable tablolar listesine eklenir, ek fonksiyon DDL'i bu bölümde yazılmaz.

```sql
CREATE TRIGGER order_no_counters_set_updated_at
  BEFORE UPDATE ON order_no_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**§6.5 muafiyet notu:** `order_no_counters` PK'si doğal kompozit `(tenant_id, business_date)` — surrogate `id UUID` kolonu **yok**. §6.5 composite UNIQUE kuralı (`UNIQUE (id, tenant_id)` FK target sağlama) surrogate-tabanlı tablolar için bağlayıcı; `order_no_counters` ne FK source ne target olduğundan kuralın kapsamı dışında. PK ilk kolonu zaten `tenant_id` (tenant prefix kuralı §6.1 + §10.5 C2 otomatik karşılanır). Migration dosyasında `COMMENT ON TABLE order_no_counters IS 'Per-tenant per-business-date order sequence counter. §6.5 composite UNIQUE rule N/A: no surrogate id, neither FK source nor target.'` ile gerekçe inline kaydedilir.

Bu tablo **app-otoriteli** — domain service tarafından upsert edilir. Akış §11.5'te tek-CTE SQL ile.

---

#### 11.4 Cancel davranışı — gap kabul, recycle yok

**Karar:** Bir sipariş cancel edildiğinde `order_no` **iade edilmez**, sayaç ilerler. Aynı iş günü içinde 47 numara cancel olursa 48'inci sipariş 48'i alır, 47 ölü kalır. Sayaç **monotonik artan**, gap kabul.

**Gerekçe:**
- Mutfak/garson "47'nin çayı" diye sesleniyorken 47'nin başka bir siparişi tanımlaması (recycle) **çift-anlam** üretir; saniyeler arası "hangi 47?" karışıklığı yaşanır.
- Recycle implementasyonu race-prone: cancel anı + yeni insert anı arası counter'ın "bu numarayı geri al" mantığı LIFO/FIFO kararı, transaction izolasyonu, partial unique re-evaluation gibi karmaşıklıklar getirir. Gap kabul = **basit + güvenli**.
- v3 davranışı da aynıdır (cancel sonrası order_no recycle edilmez, kullanıcı gözleminden teyit edilmiş).
- Trigger gerekmez. Cancel sadece `orders.status = 'cancelled'` set eder; counter row'una dokunulmaz.

**Audit:** Cancel olayı zaten audit_logs'a düşer (§12 + ödeme/cancel ADR forward-ref); gap için ayrı log gerekmez.

---

#### 11.5 Insert akışı (DB-otoritatif, app `business_date` hesaplamaz)

§5.2'nin "DB otoritatif, app override imkansız" ilkesi: app `orders.store_date` veya `orders.order_no` payload'ında **göndermez**. Tek kaynak DB'deki `store_date(ts, cutoff_hour, tz)` SQL fonksiyonu (§5.1'de tanımlı). "TS tarafı `toStoreDate(...)` hesabı + parity test" akışı yasak.

**Seçenek değerlendirmesi:**

- **(α) İki-step transaction (orders insert → counter upsert → orders update):** `order_no` insert anında biliniyor olmalı (§5.2 B1 append-only invariantı). `order_no` kolonunu nullable bırakıp ikinci adımda doldurmak B1 ile çatışır — order satırı bir an için "no'suz" var olur, concurrent reader'lar yarı-oluşmuş kayıt görür. **Reddedildi.**

- **(β) Counter upsert önce, `business_date` DB'de hesaplat:** Tek transaction içinde sayaç upsert'i `store_date(now(), cutoff_hour, tz)` ile business_date'i kendi hesaplar; orders insert'i `RETURNING last_no`'yu `order_no` olarak alır. Orders BEFORE INSERT trigger'ı (§5.2) `orders.store_date`'i bağımsız hesaplar — counter'ın hesapladığı `bd.d` ile eşleşmek **zorunda** çünkü ikisi de aynı SQL fonksiyonunu **aynı transaction'ın `now()` snapshot'ında** çağırır (PG `now()` tek transaction içinde sabit; `statement_timestamp()` veya `clock_timestamp()` değil). **Seçildi.**

- **(γ) Üçüncü çözüm:** Orders insert'ini önce yap (trigger `store_date`'i doldursun), sonra `RETURNING store_date`'i counter upsert'inde kullan, sonra `UPDATE orders SET order_no`. Bu α'ya geri dönüş, B1 problemi aynen tekrarlanır. **Reddedildi.**

**Seçim: (β).** Gerekçe: (i) `order_no` insert anında final → §5.2 B1 korunur; (ii) app sadece `tenant_id` ve payload yollar, `business_date` ile `store_date` aynı DB fonksiyonundan üretilir → tek-kaynak; (iii) parity test yükü ortadan kalkar.

**Akış (transaction içinde, tek SQL):** Aşağıdaki SQL'de `orders` tablosuna eklenecek payload kolonları (`table_id`, `customer_id`, vb.) **service tarafından parametre olarak SELECT'e eklenir** — CTE'den gelmez. Şablon:

```sql
BEGIN;

WITH tenant_cfg AS (
  SELECT business_day_cutoff_hour AS h, timezone AS tz
  FROM tenant_settings WHERE tenant_id = $1
),
bd AS (
  SELECT store_date(ts => now(), cutoff_hour => tc.h, tz => tc.tz) AS d
  FROM tenant_cfg tc
),
upsert AS (
  INSERT INTO order_no_counters (tenant_id, business_date, last_no)
  SELECT $1, bd.d, 1 FROM bd
  ON CONFLICT (tenant_id, business_date)
    DO UPDATE SET last_no = order_no_counters.last_no + 1, updated_at = now()
  RETURNING last_no, business_date
)
-- payload kolonları service tarafından parametre olarak ($3, $4, ...) eklenir;
-- CTE'den sadece u.last_no (order_no'ya bind) gelir. tenant_id $1 ile aynı.
-- Örnek:
INSERT INTO orders (tenant_id, order_no, table_id, customer_id, /* … */)
SELECT $1, u.last_no, $3, $4 /* , … */
FROM upsert u
RETURNING id, order_no, store_date;

-- assertion: RETURNING.store_date == upsert.business_date
-- (DB-side invariant; integration test §11.10 doğrular)
COMMIT;
```

App TS tarafı sadece `tenant_id + payload` yollar; `order_no`, `store_date`, `business_date` üçü de DB'den gelir. Service kodu prepared statement template'inde payload kolonlarını dinamik bind eder.

**İkinci hat savunma:** `orders_tenant_store_date_no_unique` UNIQUE INDEX (§11.2). Counter mantığında bug olursa veya iki paralel servis instance'ı counter'ı bypass etse bile DB uniqueness check INSERT'i reddeder (`23505 unique_violation`). Service bu hatayı yakalar → exponential backoff retry → 3 deneme sonrası **CONFLICT** error code'u ile kullanıcıya hata. Error taxonomy detayı ayrı ADR'de (forward-ref).

**Race senaryosu (cutoff sınırı, iki ayrı transaction):** İki concurrent INSERT iki **ayrı transaction** olarak koşar; her biri kendi `BEGIN` anındaki `now()` snapshot'ını alır (`now()` transaction-stable garantisi **tek transaction içinde** geçerli, transaction'lar arası değil). Transaction T1 `now() = 2026-04-25 03:59:59.9`, transaction T2 `now() = 2026-04-25 04:00:00.1` (cutoff=04:00, tz=Europe/Istanbul). Her transaction kendi içinde `store_date(now(), 4, 'Europe/Istanbul')` çağırır → T1 `business_date = 2026-04-24`, T2 `business_date = 2026-04-25`. Counter row'ları **ayrı PK** (`(tenant_id, 2026-04-24)` vs `(tenant_id, 2026-04-25)`), çakışma yok; her biri `last_no = 1`'den başlar. İki sipariş iki ayrı iş gününe ait — doğru davranış. (β)'nın güvenliği **transaction-içi** atomik upsert'ten gelir, **transaction'lar-arası** sıralama PG'nin native concurrency control'üne emanet.

---

#### 11.6 Yazıcı / UI gösterimi

**Karar:** `order_no` UI ve yazıcı çıktısında **çıplak INT** olarak gösterilir. Tarih prefix, tenant prefix, sıfır-padding **yok**.

- UI: `Sipariş No: 47`
- Mutfak fişi: `#47`
- Müşteri adisyonu: `Adisyon No: 47`

i18n key: `order.numberLabel`, `order.numberPrefix`. v3 paritesi.

---

#### 11.7 Reset davranışı (cutoff geçişi)

**Karar:** Sayaç `(tenant_id, business_date)` skopu **iş günü** ile reset olur, takvim günü ile değil. Yeni iş günü başında counter tablosunda yeni satır oluşur, `last_no = 1` ile başlar.

**Outline §11 cümlesi doğrulaması:** Cutoff 04:00 olan tenant'ta:
- 23 Nisan 23:50'de açılan sipariş → `store_date = 2026-04-23`, `order_no = 47` (örnek)
- 24 Nisan 00:10'da açılan sipariş → `store_date = 2026-04-23` (hâlâ önceki iş günü), `order_no = 48`
- 24 Nisan 04:05'te açılan sipariş → `store_date = 2026-04-24`, `order_no = 1` (yeni iş günü)

23:50 açılıp 00:10'da ödenen sipariş **açılış gününde** sayılır (`store_date` `created_at` üzerinden, ödeme zamanı değil). Bu §5.2 append-only kuralı + Bölüm 4.7 cutoff örneğiyle bire bir tutarlı.

**§4.5 etkileşimi:** Cutoff sonradan değiştirilirse (örn 04:00 → 06:00) **tarihsel `orders.store_date` sabit kalır** (§5.2 N2), bu yüzden tarihsel counter row'ları da geçerli kalır. Yeni cutoff sonraki günden itibaren yeni `business_date` üretir, yeni counter row'u açılır. Eski raporlar tutarlı.

---

#### 11.8 Edge case'ler

- **Gün başı (counter row yok):** İlk insert `ON CONFLICT DO UPDATE` yerine `INSERT` path'inden geçer, `last_no = 1` set eder. Race: iki paralel ilk insert → biri INSERT eder, diğeri UNIQUE PK çakışmasıyla ON CONFLICT path'ine düşer ve `last_no + 1 = 2` alır. Tutarlı.
- **Cutoff değişikliği aynı gün içinde:** §4.5 audit'e düşer. Mevcut iş günündeki açık siparişler `store_date` sabit (append-only), counter row sabit. Yeni siparişler yeni cutoff'a göre `store_date` alır → muhtemelen yeni `business_date` (counter yeni row açar). Aynı gün içinde sayaç bir kez daha 1'den başlayabilir. Cutoff değişikliği **gece yapılmalı** — runbook (`docs/ops/cutoff-change.md`, Phase 5).
- **Concurrent insert (aynı ms):** Counter `ON CONFLICT` row-level lock ile serialize. UNIQUE INDEX ikinci hat. Concurrency stress test §11.10.
- **v3 backfill forward-ref:** v3'ten `order_no` zaten dolu sıralı sayılarla geliyor. Backfill ADR (Phase 5) `order_no_counters` tablosunu v3 son durumuyla seed edecek: `INSERT INTO order_no_counters (tenant_id, business_date, last_no) SELECT tenant_id, store_date, MAX(order_no) FROM orders GROUP BY tenant_id, store_date;`. Bu ADR **bu** ADR'nin scope'unda **değil** — sadece forward-ref.

---

#### 11.9 Reddedilen alternatifler

**(A) Counter tablosu + `ON CONFLICT DO UPDATE`** — seçildi (§11.3, §11.5).

**(B) Advisory lock + `MAX(order_no)+1`:** §11.3 karşılaştırma tablosunda dört bağımsız boyutta (A) lehine ödünleşim verir:

- **Observability:** lock state opaque (`pg_locks` view'ından okumak zorunlu); counter tablosu doğrudan SELECT'lenir.
- **Cost:** her insert'te `(tenant_id, store_date)` için aggregate `MAX` taraması; counter row write'ından pahalı, partial index gerekse bile read amplification var.
- **Scalability:** `hashtextextended` 64-bit lock keyspace'inde teorik collision; multi-tenant ölçeklendiğinde performans bekleme kaynağı.
- **Correctness-by-default:** advisory lock "advisory" — service kodunda yanlışlıkla atlanması mümkün; counter `ON CONFLICT` ise PG row-level lock ile correctness garantisini DB'ye emanet eder.

Sinyal #23 v3 SQLite + sync I/O bağlamından gelir, PG 17 native upsert primitives bu davranışı daha temiz karşılar. **Reddedildi.**

**PG `SEQUENCE` per (tenant, day):** Sequence dinamik isimle yaratılması gerekirdi (`orders_no_seq_<tenant>_<date>`); günlük temizlik, multi-tenant'ta on-demand DDL = unmaintainable. Reddedildi.

**`BIGSERIAL` + günlük modulo:** Global tek sayaç + raporlarda modulo gösterimi → çakışma kaçınılmaz; "47" iki farklı tenant'ta aynı gün üretilebilir, partial UNIQUE INDEX'i ihlal eder. Reddedildi.

**`YYYYMMDD-NNNN` string format:** Kullanıcı çıplak INT istedi (§11.1); string format gereksiz görsel kirlilik; v3 paritesini kırar. Reddedildi.

**v3 helper kod kopya-paste (`getNextOrderNo`):** CLAUDE.md "v3'ten kod kopya-paste yasak" kuralı (Asla yapmayacaklarımız §). v3'ten yalnızca davranışsal bilgi taşınır. Reddedildi.

**`FOR UPDATE on orders` (Sinyal #23 alıntısı):** Henüz yazılmamış satır lock'lanamaz; `FOR UPDATE` mevcut row lock alır, INSERT'i serialize etmez. v3 SQLite BEGIN IMMEDIATE pattern'i PG'de advisory lock veya counter table ile karşılanır. Sinyal #23 referans-bağlayıcı değil. Reddedildi.

**(Y) `store_date()`'i false-IMMUTABLE etiketle + cutoff'u tablo'dan oku:** Planner cache bozulur, §5.1.1 IMMUTABLE taahhüdünü ihlal eder, parity test'i kırar. Reddedildi.

**(Z) Application-only UNIQUE check, DB ikinci hat yok:** "DB otoritatif" ilkesi (§5.2, §10.5) ihlal. Reddedildi.

---

#### 11.10 db-migration-guard checklist

Migration script (`packages/db/migrations/000_init.sql` veya alt-migration) aşağıdaki maddeleri içermek **zorunda**; `db-migration-guard` sub-agent her maddeyi tek tek doğrular:

- [ ] `orders.order_no INTEGER NOT NULL CHECK (order_no >= 1)` kolon tanımı eklendi (§11.1).
- [ ] `orders_tenant_store_date_no_unique` UNIQUE INDEX `(tenant_id, store_date, order_no)` eklendi; `tenant_id` ilk kolon (§6 + §10.5 C2 tenant prefix kuralı).
- [ ] **IMMUTABLE çözümü**: §11.2 (X′) — UNIQUE INDEX `orders.store_date` plain stored kolonu üzerinde (Bölüm 5.2 kolonu reuse), generated column **kullanılmıyor**, expression index **kullanılmıyor**. Migration yorum satırında bu gerekçe yazılı.
- [ ] `business_date` adında **ayrı bir kolon yok** — `store_date` kolonu (Bölüm 5.2) hem rapor hem unique scope için reuse.
- [ ] `order_no_counters` tablosu DDL'i §11.3'teki **birebir** form: PK `(tenant_id, business_date)`, `last_no INTEGER NOT NULL CHECK (last_no >= 1)`, FK `tenant_id → tenants(id) ON DELETE RESTRICT` (§6.1), `created_at` ve `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. (`tenant_id` üzerinde ek standalone index gerekmez; PK leftmost-prefix `WHERE tenant_id = $1` sorgusu için yeterli.)
- [ ] `order_no_counters_set_updated_at` BEFORE UPDATE trigger'ı **§4.1.1**'deki generic `set_updated_at()` fonksiyonuna bağlı, ek fonksiyon DDL'i bu bölümde yazılmaz.
- [ ] **Single-transaction CTE orchestration** app tarafında (§11.5 (β)); **atomicity DB-side `ON CONFLICT DO UPDATE` row-level lock'una emanet**. UNIQUE INDEX (§11.2) ikinci hat savunması; advisory-lock veya app-mutex değil — §11.9 (B) reddedildi.
- [ ] **App `store_date` veya `order_no` payload'da göndermez** — §5.2 ilkesi. `order_no` CTE `RETURNING last_no`'sundan, `store_date` BEFORE INSERT trigger'ından doldurulur; **`tenant_id` ve diğer payload kolonları (`table_id`, `customer_id`, vb.) service tarafından parametre olarak bind edilir** (§11.5 SQL şablonu).
- [ ] **Integration test (DB-side invariant):** `RETURNING.store_date == upsert.business_date` — orders trigger çıktısı counter upsert'in business_date'i ile eşleşir (PG `now()` aynı transaction içinde sabit garantisi).
- [ ] **Cutoff-boundary race testi** (§11.5 son paragraf): iki ayrı transaction (T1 03:59:59.9, T2 04:00:00.1) → iki ayrı counter row, iki ayrı `order_no=1`, UNIQUE INDEX ihlali yok.
- [ ] **Rollback senaryosu testi**: counter upsert sonrası orders insert hata verirse transaction rollback `last_no` artışını da geri alır (single-transaction garantisi).
- [ ] **Cancel: gap kabul, trigger yok** — `orders.status = 'cancelled'` set'i counter row'una dokunmaz; bu davranış migration yorumunda açıkça not edilmiş.
- [ ] **Forward-only migration** (§15) — down migration yok, rollback yalnız `git revert` + yeni forward migration ile.
- [ ] **Tenant prefix doğrulaması** (§6 + §10.5 C2): UNIQUE INDEX'in ilk kolonu `tenant_id`; `order_no_counters` PK'sının ilk kolonu `tenant_id`; FK `tenant_id → tenants(id)` mevcut.
- [ ] **Trigger isimlendirme uyumu** (§10.5.2 C3 formu `<table>_<action>[_<when>]`): tek yeni trigger `order_no_counters_set_updated_at` — `<table>_<action>` formuna uyar.
- [ ] **§6.5 muafiyet doğrulaması**: `order_no_counters` surrogate `id` kolonsuz, FK source/target değil → §6.5 composite UNIQUE kuralı kapsamı dışı, gerekçe migration yorumunda (`COMMENT ON TABLE`).
- [ ] **§4.5 cutoff değişikliği etkileşimi** migration yorumunda açıklamalı (eski `business_date` satırları append-only `store_date` sayesinde sabit korunur).
- [ ] **v3 backfill forward-ref**: Migration yorumunda "v3 backfill ADR Phase 5'te `order_no_counters`'i v3 `MAX(order_no)`'sundan seed edecek" notu mevcut.
- [ ] **Error taxonomy forward-ref**: Service layer'da `23505 unique_violation` yakalanır → CONFLICT error code'u; tam taxonomy ayrı ADR (forward-ref active-plan follow-up listesi).
- [ ] Parity test (§5.4) `(tenant_id, store_date, order_no)` üçlüsü için concurrency stress test ekler (Phase 0).

---

### Bölüm 12 — Audit Log Şema Kontratı

**Bağlam:** v3'te `audit_log` tablosu vardı ama (a) PII sanitize kontratı yoktu — phone/password/refresh_token'ın yanlışlıkla payload'a düşmesi sadece code review'a emanetti; (b) retention politikası yoktu, tablo organik büyüyordu (Sinyal #38, P-09); (c) event_type taxonomy ad-hoc string'lerdi, `'order_create'` vs `'orders.create'` karışıklığı raporlamayı zorlaştırıyordu. v5'te audit_logs gün 1'de **şema kontratıyla** kilitlenir: hangi event'lerin yazılacağı, hangi alanların asla payload'a girmeyeceği, retention süresi, cleanup mekaniği — hepsi bu bölümde sabitlenir. Bu bölüm (a) outline drift notu (Session 16 ip_address iptal kararı), (b) tablo şeması, (c) PII sanitize kontratı (TS + DB hibrit), (d) cron retention, (e) cross-ref hookları, (f) outstanding işler, (g) review-gate checklist konularını kilitler.

---

#### 12.1 Outline Drift Notu — Session 16 ip_address iptal kararı

**Bağlam:** Bu ADR'nin §12 outline cümlesi (yukarıda L85) `ip_address INET NULL` kolonunu Bölüm 12 kapsamında listeler ("doldurma ADR-002'ye"). Session 16'da bu pre-lock **iptal edildi** (Karar A — v3 paritesini koru, KVKK forensic riskini v5.1'e ertele).

**Gerekçeler:**
- **v3 paritesi sabit** (context-anchor §4): v3 audit_log'unda IP toplanmıyordu; v5 MVP "v3 kapsamı + cloud + mobil" sınırı içinde IP sızdırması yeni risk yaratır.
- **KVKK Sinyal #40** açıkça IP'yi PII olarak işaretliyor (`docs/v3-reference/pain-points.md` Sinyal #40); IP toplanırsa ek sanitize / retention / DSAR (data subject access request) süreci gerekir — MVP scope dışı.
- **Pilot forensic ihtiyacı spekülatif:** Tek tenant + kendi restoranımız; "kim hangi IP'den login oldu" sorusu pilot evresinde sahip-yönetici tarafından sözlü teyit edilebilir. Forensic ihtiyacı doğarsa v5.1'de ayrı ADR ile resmî gerekçeyle eklenir.

**Karar:** `audit_logs` tablosunda `ip_address` kolonu **yok**. `actor` JSONB içinde `user_id + user_agent` ile sınırlandı (12.2'de tam şema).

**Immutable ADR ilkesi:** Outline (L85) silinmez — tarihsel kayıttır. Bu drift notu, outline'ın §12 gövdesi tarafından hangi noktada **geçersizleştirildiğini** belgeler. v5.1'de IP forensic ihtiyacı doğarsa ayrı ADR (forward-ref §12.7).

**user_agent KVKK orantılılık.** IP iptal edilirken `user_agent` korundu — gerekçe: (1) forensic değer (hangi cihaz/tarayıcıdan değişiklik yapıldı, oturum sürekliliği takibi); (2) UA tek başına kişisel kimlik tespiti yetmez (user_id ile birleşince anlam kazanır); (3) UA network konumu açığa vurmaz, IP'den düşük risk profilinde; (4) 2 yıl retention sonrası purge (§12.5); (5) admin-only erişim (audit viewer v5.1 RBAC). Pilot tek tenant + iç kullanım için orantılı; v5.1 multi-tenant geçişinde yeniden değerlendirme follow-up.

---

#### 12.2 Tablo şeması

**Karar:** Aşağıdaki DDL `audit_logs` tablosunu tanımlar. `tenant_id` zorunlu (multi-tenant prefix §6.1, sistem actor'ları için NULL stratejisi §13'te netleşir — §12.7 outstanding).

```sql
CREATE TABLE audit_logs (
  id              UUID        NOT NULL,                    -- uuidv7 app-side
  tenant_id       UUID        NULL REFERENCES tenants(id) ON DELETE RESTRICT,
                                                            -- NULL: sistem actor (cron-purge gibi tenant-bağımsız event'ler).
                                                            -- NOT NULL satırlar için RESTRICT — tenant silme audit kayıtlarını
                                                            -- orphan bırakmaz, manuel migration gerekir. Detay §13.
  event_type      TEXT        NOT NULL
                  CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
                                                            -- format: 'group.action'
                                                            -- örn: 'order.create', 'auth.login'
  actor_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
                                                            -- user silinse audit korunur
  actor           JSONB       NOT NULL,                     -- { user_agent: 'Mozilla/...', ... }
                                                            -- ip_address YOK (§12.1 drift notu)
  entity_type     TEXT        NULL,                         -- 'order', 'payment', 'user'
  entity_id       UUID        NULL,                         -- ilgili kaydın id'si
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb, -- sanitize edilmiş; deny-list §12.3
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),

  -- Top-level PII deny-list (DB second hat — §12.4 hibrit)
  -- Tek kanonik liste — başka yerde tekrarlanmaz (drift riski).
  -- Kapsam: İngilizce + Türkçe varyantlar + PCI-DSS + KVKK kritikler.
  CONSTRAINT audit_logs_payload_no_pii CHECK (
    NOT (payload ?| ARRAY[
      'address', 'adres', 'ad_soyad', 'api_key', 'authorization',
      'bearer', 'birthdate', 'card_holder', 'card_number', 'cookie',
      'customer_name', 'customer_phone', 'cvv', 'dob', 'email',
      'eposta', 'iban', 'ip', 'ip_address', 'jwt',
      'kart_no', 'musteri_adi', 'musteri_telefon', 'national_id',
      'password', 'password_hash', 'phone', 'phone_raw', 'refresh_token',
      'secret', 'session_id', 'session_token', 'set_cookie', 'sifre',
      'tax_id', 'tc_kimlik', 'tckn', 'telefon'
    ])
  )
);

-- Indexler (§12.8 madde 4):
CREATE INDEX audit_logs_tenant_created_idx
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX audit_logs_tenant_event_created_idx
  ON audit_logs (tenant_id, event_type, created_at DESC);

CREATE INDEX audit_logs_tenant_entity_idx
  ON audit_logs (tenant_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
```

**Gerekçe:**
- `event_type TEXT + regex CHECK`: PG enum reddedildi — yeni event ekleme her seferinde DDL migration gerektirir, regex disiplin için yeterli ('group.action' format §12.8 madde 1 ile uyumlu). Format örnekleri: `order.create`, `order.cancel`, `payment.create`, `auth.login`, `auth.logout`, `cutoff.change`, `audit.purge` (cron self-audit, §12.5).
- `actor_user_id ON DELETE SET NULL`: kullanıcı silinse bile audit kaydı korunur — KVKK + forensic ilkesi.
- `actor JSONB`: user_agent ve gelecekteki actor metadata'sı için esnek — şema değişikliği migration gerektirmez.
- `payload JSONB DEFAULT '{}'`: NOT NULL + DEFAULT ile NULL kontrolü gerekmez; boş event'ler `{}` ile kaydedilir.
- **Index seçimi:** (i) `(tenant, created_at DESC)` zaman-temelli listeleme; (ii) `(tenant, event_type, created_at DESC)` tip-filtreli rapor; (iii) `(tenant, entity_type, entity_id) WHERE entity_id NOT NULL` "bu siparişin tüm audit kayıtları" sorgusu — partial index, NULL entity'lerde indekssiz.

**Event taxonomy (4 grup, print HARİÇ):**
1. **Financial** — `order.create`, `order.cancel`, `payment.create`, `payment.refund`, `discount.apply`, `comp.apply`
2. **Auth** — `auth.login`, `auth.logout`, `auth.password_change`, `auth.token_refresh`
3. **Data-mutation** — `customer.create`, `customer.update`, `menu_item.update`, `cutoff.change`
4. **Admin-override** — `order.force_close`, `payment.force_void`, `audit.purge` (cron self)

**Print event'leri kapsam dışı:** `print_jobs` tablosu kendi audit'ini taşır (status_history); ayrı tablo, ayrı retention politikası (forward-ref print-agent ADR-004).

---

#### 12.3 PII Deny-list (TS allow-list whitelist + DB CHECK constraint)

**Bağlam:** v3'te audit payload'a yanlışlıkla `phone` veya `password_hash` düşmesi sadece code review ile yakalanıyordu. v5'te bu **iki katmanlı kontrat** olur: (a) TS sanitize layer event_type bazlı whitelist (allowedKeys) uygular; (b) DB CHECK constraint top-level deny-list ile son hattı tutar.

**Karar (D1 + D2 hibrit):**

**Deny-list (13 anahtar, top-level):**
```
phone, phone_raw, customer_phone, customer_name,
address, email,
password, password_hash, refresh_token, jwt,
card_number,
ip, ip_address
```

**phoneMasked istisnası:** Telefon numarasının **son 4 hanesi** (örn `***1234`) audit payload'a girmesine **izin verilir** — `phoneMasked` veya `phone_masked` anahtarı altında. Gerekçe: `docs/domain/domain-rules.md` L92 — "operator anlık tanıma için son 4 hane" kuralı; tam numara KVKK kapsamında, son 4 hane KVKK rehberi gereği maskelenmiş kabul edilir. `phone_masked` anahtarı deny-list'te **yer almaz**, tam `phone` anahtarı yer alır — sanitize layer farkı bilir.

**Whitelist (event_type bazlı `allowedKeys`):** Her event_type için TS const olarak izin verilen payload anahtarları listelenir. Örnek (implementer detayı, ADR'de prensip):
- `order.create`: `['order_id', 'order_no', 'table_id', 'item_count', 'total_cents']`
- `auth.login`: `['user_id', 'role']` (user_id zaten `actor_user_id` kolonunda; payload'da role ek bilgi)
- `payment.create`: `['order_id', 'payment_type', 'amount_cents', 'phone_masked']` (telefon son 4 hane gerekirse)

Whitelist dışı bir anahtar payload'a düşerse sanitize layer **drop eder ve warn loglar** (Sentry).

**Türkçe field adları yasak.** CLAUDE.md'deki "kod-içi İngilizce" kuralı PII alanları için ikinci hat: deny-list Türkçe varyantları (`telefon, adres, tckn, sifre, kart_no, eposta, ad_soyad, musteri_telefon, musteri_adi`) içerir. v3'ten davranış porting yapılırken Türkçe field adıyla payload yazılırsa hem TS sanitizer (whitelist'te yok → drop) hem DB CHECK (deny-list match) iki hat reddeder.

---

#### 12.4 AuditSanitizer kontratı + writeAudit() tek giriş noktası

**Karar:** `packages/shared-domain/src/audit/sanitizer.ts` içinde tip-güvenli `AuditSanitizer<T>` kontratı tanımlanır. Tek giriş noktası `writeAudit()` fonksiyonudur; `INSERT INTO audit_logs` raw SQL **yasaktır**.

**TS kontratı (prensip — implementer detayı):**

```typescript
type AuditEventType =
  | 'order.create' | 'order.cancel' | 'payment.create' | /* … */;

interface AuditSanitizer<T extends AuditEventType> {
  eventType: T;
  allowedKeys: ReadonlyArray<keyof AllowedPayload<T>>;
  sanitize(rawPayload: Record<string, unknown>): AllowedPayload<T>;
}

async function writeAudit<T extends AuditEventType>(params: {
  tenantId: string | null;       // null: sistem actor (cron)
  eventType: T;
  actorUserId: string | null;
  actor: { user_agent?: string };
  entityType?: string;
  entityId?: string;
  payload: AllowedPayload<T>;    // tip-güvenli, sanitize edilmiş
}): Promise<void>;
```

**Recursive nested traversal zorunlu.** allowedKeys whitelist'i nested objelere de uygulanır: izinli üst-anahtarın değeri obje ise iç anahtarlar da whitelist'e tabi tutulur (nested allowed shape tip-tanımlı, `AllowedShape<TEvent>` recursive type). Deny-list match'i her seviyede çalışır — payload ağacında herhangi bir derinlikte deny anahtar bulunursa sanitize fail eder. DB CHECK top-level only kalır (deterministik PG performansı); recursive savunma TS tarafında. Unit test zorunlu: nested PII fixture (`{snapshot:{customer:{phone:'0532...'}}}`) sanitizer tarafından reddedilmeli.

**Lint kuralı (prensip):** `audit_logs` tablosuna doğrudan INSERT yapan SQL/Kysely çağrısı **lint hatası** üretir. Tek istisna `writeAudit()` implementasyonu. Lint kuralı detayı implementer'a bırakılır (custom ESLint rule veya regex grep CI step).

**DB CHECK constraint (ikinci hat):** Kanonik deny-list §12.2 DDL CHECK constraint'indedir; bu bölümde yeniden listelenmez (drift riski).

**Önemli not:** DB CHECK **top-level key reddi**, derin scan değil. Nested object içindeki `{ user: { phone: '...' } }` DB tarafından yakalanmaz — TS sanitize layer'ın görevi. DB hattı "yanlışlıkla raw INSERT veya bypass" senaryosuna karşı son savunma. (Performans gerekçesi: derin JSONB scan her INSERT'te overhead yaratır; TS layer zaten birinci hat.)

**Gerekçe (D2 hibrit):**
- (+) TS layer tip-güvenli, IDE autocomplete, refactor güvenli, deep scan mümkün.
- (+) DB CHECK migration history'de kalıcı, raw SQL bypass'ı yakalar (örn DBA console insert).
- (−) DB CHECK list'i değiştirmek için migration gerekir — kabul, PII deny-list zaten **uzun vadeli sabit**.

---

#### 12.5 Retention & TTL Cleanup — birleşik cron

**Karar (D3):** `audit_logs` retention **2 yıl**, `call_logs` retention **30 gün** (§13 forward-ref). Her ikisi de **tek cron job** içinde (`apps/api/src/cron/ttl-cleanup.ts`), ayrı task'lar olarak çalışır.

**Cron schedule:** `0 30 3 * * *` (03:30 daily, **Europe/Istanbul** timezone). Cutoff (04:00) **öncesi** çalışır — gerekçe: cron iş günü kapanışından önce tamamlanır, cutoff sonrası rapor üretimi temiz veri üzerinde olur (§4 ile uyum).

**Batch DELETE pattern (tenant-loop):**

Cron, `(tenant_id, created_at DESC)` index'inin leading column'unu kullanmak için **per-tenant batch döngüsü** yapısında çalışır — tenant filtresiz tek DELETE seq scan'e düşerdi (3 mevcut index'in tümü `tenant_id` leading); 4. index eklenmek yerine sorgu pattern'i index-uyumlu hale getirildi.

```sql
-- 1) Aktif tenant listesi (audit_logs task):
SELECT id FROM tenants WHERE deleted_at IS NULL;

-- 2) Her tenant için batch döngüsü:
DELETE FROM audit_logs
WHERE id IN (
  SELECT id FROM audit_logs
  WHERE tenant_id = $1
    AND created_at < now() - INTERVAL '2 years'
  ORDER BY created_at ASC
  LIMIT 10000
);
-- loop until affected rows < 10000, sonra bir sonraki tenant

-- 3) Sistem actor (NULL tenant_id) için ayrı ek pass:
DELETE FROM audit_logs
WHERE id IN (
  SELECT id FROM audit_logs
  WHERE tenant_id IS NULL
    AND created_at < now() - INTERVAL '2 years'
  ORDER BY created_at ASC
  LIMIT 10000
);
-- loop until affected rows < 10000

-- call_logs task (30 gün — §13'te tam tanım) aynı tenant-loop pattern'i kullanır
-- (audit_logs ile birlikte ttl-cleanup.ts içinde, ayrı task; yapı §13'te netleşir).
```

**Pattern gerekçesi:** Tenant-loop, mevcut `(tenant_id, created_at DESC)` index'inin leading column'unu kullanır → seq scan elimine. Write hot path 3 index'le optimize kalır, 4. index gereksiz (write amp 3x korunur, 4x'e çıkmaz). Cron günde 1 kez çalışır; sorgu sayısı `tenant_count + 1` (sistem pass) — pilot tek tenant için 2 pass, multi-tenant'ta lineer.

**Idempotency:** Job aynı gün iki kez çalışsa zarar yok — ikinci run'da silinecek satır kalmamış olur. Lock olarak Postgres advisory lock (`pg_try_advisory_lock`) kullanılır — paralel cron instance'ı race olmasın.

**Observability:**
- Her batch sonunda `console.info({ deleted_count, batch_count, duration_ms })` log.
- Hata durumunda Sentry alert (severity: warning).
- Job tamamlandığında self-audit (§12.5.1).

**12.5.1 Cron self-audit — `audit.purge` event'i**

**Karar (OQ2 a):** Her purge run sonunda **bir** `audit.purge` event'i yazılır. Payload:

```json
{
  "table": "audit_logs",
  "deleted_count": 12340,
  "batch_count": 2,
  "duration_ms": 1850,
  "cutoff_date": "2024-04-25"
}
```

**v5-native gerekçe:** v3'te yoktu. v5'te eklendi çünkü (a) cron job sağlık takibi için son-run görünürlüğü gerek; (b) forensic — "geçen yıl Nisan'da audit kaydı sildim mi?" sorusunun cevabı kendi audit'ine kalsın.

**Sonsuz döngü yok:** `audit.purge` event'i kendi event_type'ını silmez (TTL yine 2 yıl — eski purge log'ları 2 yıl sonra silinir, ama her run sadece 1 satır yazar; toplam volume yıllık ~365 satır, ihmal edilebilir).

**Sistem actor:** `tenant_id NULL` (cron tüm tenantları kapsar; tenant başına ayrı task ihtiyacı v5.1+). `actor_user_id NULL`, `actor: { user_agent: 'cron/ttl-cleanup' }`. Sistem actor için `tenant_id NULL` stratejisi §13'te netleşir — bu bölümde "kabul" olarak kayıt edilir, detay §13.

---

#### 12.6 Cross-ref hookları (çift yönlü)

Aşağıdaki bölümler bu §12'ye **forward-ref** verir; §12 onlara **back-ref** verir:

- **§4.5 cutoff change audit:** Cutoff değişikliği `cutoff.change` event_type ile audit'e düşer; payload `{ old_hour, new_hour, changed_by }` (whitelist).
- **§6.5 users FK:** `audit_logs.actor_user_id → users(id) ON DELETE SET NULL` — §6.5 composite UNIQUE kuralı kapsamı dışı (FK target değil; users zaten surrogate id taşır). Audit kaydı user silinse korunur.
- **§10.5 comp audit hooks:** `comp.apply` event'i `OrderCompService` tarafından `writeAudit()` çağrısıyla yazılır; payload `{ order_id, comp_reason, amount_cents }`.
- **§11.4 cancel audit:** `order.cancel` event'i; payload `{ order_id, order_no, cancel_reason }`. Gap kabulü §11.4'te; audit gap için ayrı log gerekmez (sadece cancel için audit).
- **§13 TTL — call_logs:** Birleşik cron `ttl-cleanup.ts` içinde `call_logs` task'ı (30g) + `audit_logs` task'ı (2y) — bu §12.5'te tanımlandı, §13'te call_logs detayı.

---

#### 12.7 Outstanding işler (forward-ref)

Aşağıdaki konular bu ADR'nin scope'unda **değil**, ayrı ADR veya backlog item olarak takip edilir. Parent agent active-plan follow-up listesine ekler.

- **(a) Audit viewer UI v5.1:** Müdür kullanıcısı için audit_logs okuma arayüzü; filtre (event_type, tarih aralığı, entity), pagination. v5.0 MVP **kapsam dışı** — DB sorgusu ile manuel inceleme yeterli.
- **(b) Error taxonomy ADR (B1 follow-up):** DB `RAISE EXCEPTION` mesajlarının → Türkçe i18n-key'lere mapping standardı. `23505 unique_violation` → `error.conflict.orderNo` gibi. Ayrı ADR.
- **(c) v5.1 forensic `ip_address`:** Session 16'da iptal edilen IP toplama (§12.1 drift notu). v5.1+ ihtiyacı doğarsa ayrı ADR; KVKK DSAR akışı + sanitize + retention politikası gözden geçirilir.
- **(d) Sistem actor (cron) için `tenant_id NULL` stratejisi:** §12.5.1'de "kabul" olarak işlendi. §13'te (Retention & TTL) tam tanım — cron job'ları nasıl tenant kapsamlı çalışır, NULL `tenant_id`'li satırlar rapor sorgularından nasıl filtrelenir, multi-tenant geçişinde nasıl davranır.

---

#### 12.8 Review-gate checklist (security-reviewer + db-migration-guard)

Migration script + sanitize layer aşağıdaki maddeleri içermek **zorunda**; `security-reviewer` ve `db-migration-guard` sub-agent'ları her maddeyi tek tek doğrular.

- [ ] **Event taxonomy 4 grup**: financial / auth / data-mutation / admin-override; print event'leri **kapsam dışı** (print_jobs.status_history, ADR-004 print-agent).
- [ ] **Şema kolonları ve nullability**: `id` UUID NOT NULL, `tenant_id` UUID NULL (sistem actor), `event_type` TEXT NOT NULL + regex CHECK `^[a-z_]+\.[a-z_]+$` (PG enum **değil**), `actor_user_id` UUID NULL FK, `actor` JSONB NOT NULL, `entity_type/entity_id` NULL, `payload` JSONB NOT NULL DEFAULT `'{}'`, `created_at` TIMESTAMPTZ NOT NULL DEFAULT now().
- [ ] **FK `actor_user_id → users(id) ON DELETE SET NULL`**: user silinse audit kaydı korunur.
- [ ] **3 index** doğru tanımlı: (i) `(tenant_id, created_at DESC)`, (ii) `(tenant_id, event_type, created_at DESC)`, (iii) `(tenant_id, entity_type, entity_id) WHERE entity_id IS NOT NULL` — partial.
- [ ] **PII deny-list kanonik tek liste + DB CHECK constraint** (top-level reddi, derin scan değil): kanonik liste §12.2 DDL CHECK constraint'inde (~38 anahtar — İngilizce + Türkçe + PCI-DSS + KVKK). Madde burada yeniden listelenmez (drift riski). CHECK constraint `audit_logs_payload_no_pii` migration'da mevcut. TS sanitizer recursive nested traversal (§12.4) DB CHECK top-level kapsamını tamamlar.
- [ ] **allowedKeys whitelist event_type bazlı** TS const olarak `packages/shared-domain/src/audit/allowed-keys.ts` (veya muadili) içinde; her event_type için liste tanımlı.
- [ ] **AuditSanitizer<T> tip-güvenli kontrat** `packages/shared-domain/src/audit/sanitizer.ts` içinde; `AuditEventType` discriminated union, `AllowedPayload<T>` mapped type.
  - [ ] **7a. Recursive nested sanitize unit testi** — nested PII fixture (`{snapshot:{customer:{phone:'0532...'}}}`) sanitizer tarafından reddedilmeli (her derinlikte deny-list match).
- [ ] **writeAudit() tek giriş noktası**; raw `INSERT INTO audit_logs` SQL/Kysely çağrısı **yasak** — lint kuralı (custom ESLint veya CI grep).
- [ ] **phoneMasked istisnası** dökümante edilmiş: deny-list'te `phone` var, `phone_masked` yok; sanitize layer son 4 hane formatını (`***1234`) bilir; `docs/domain/domain-rules.md` L92 ile uyum gerekçesi sanitize.ts comment'inde.
- [ ] **Retention 2 yıl** (`audit_logs`); birleşik cron `apps/api/src/cron/ttl-cleanup.ts` içinde `call_logs` (30g) + `audit_logs` (2y) **ayrı task**.
- [ ] **Cron schedule `0 30 3 * * *` (03:30 Europe/Istanbul)**, cutoff 04:00 öncesi; gerekçe (rapor temiz veri) cron yorumunda yazılı.
- [ ] **Batch DELETE LIMIT 10000**, idempotent, paralel run koruma `pg_try_advisory_lock`; observability (`console.info` + Sentry warning hata durumunda).
- [ ] **Cron self-audit `audit.purge` event'i**: payload `{ table, deleted_count, batch_count, duration_ms, cutoff_date }`. v5-native (v3'te yoktu — gerekçe §12.5.1 yorumunda). Sonsuz döngü yok (her run 1 satır).
- [ ] **Cross-ref hookları çift yönlü**: §10.5 (comp audit), §11.4 (cancel audit), §4.5 (cutoff change audit), §6.5 (users FK) §12'ye forward-ref vermiş; §12.6 back-ref verir.
- [ ] **IP yok — KVKK Sinyal #40 madde**: `ip_address` kolonu **yok**, payload deny-list'te `ip`/`ip_address` mevcut. Outline (L85) drift notu §12.1 ile geçersizleştirildi; v5.1 forensic ihtiyacı ayrı ADR.
- [ ] **Audit viewer UI v5.1 forward-ref** active-plan follow-up'ta kayıtlı (§12.7 a).
- [ ] **Error taxonomy mapping ayrı ADR** (B1 follow-up — §12.7 b): DB `RAISE EXCEPTION` → Türkçe i18n-key mapping.
- [ ] **writeAudit() bypass vektörleri yasak.** (a) DB trigger / stored procedure içinde `INSERT INTO audit_logs` yasak — DB CHECK son hat ama trigger sanitizer'ı atlar. (b) Migration script'lerinde audit_logs seed INSERT yasak; gerçek event'ler runtime'da yazılır. (c) Test fixture'ları yalnız `writeAudit()` test helper üzerinden audit yazar; raw INSERT testte de yasak. ESLint kuralı (`no-restricted-syntax` audit_logs hedefli) + CI grep check (`grep -rE 'INSERT INTO audit_logs' src/ migrations/ tests/` PR'da fail). Phase 0 implementer kod borcu (lint kuralı + CI check yazılır).
- [ ] **TS AuditEventType union ↔ DB CHECK regex senkron.** TS taraf (`apps/api/src/audit/types.ts` discriminated union) yeni event tipi eklendiğinde DB CHECK regex (`^[a-z_]+\.[a-z_]+$`) zaten format'ı kapsar — değer drift'i ise PR review'da iki tarafın birlikte güncellendiği doğrulanır. Yeni event grubu eklendiğinde (`refund.*`, `inventory.*` gibi) hem TS union'a hem allowedKeys whitelist'e (§12.3) eşzamanlı eklenir; sadece TS güncellenirse runtime sanitize fail (whitelist'te yok → drop), tek yön drift erken yakalanır.
- [ ] **CHECK constraint migration aşaması.** Phase 0 migration'da CHECK constraint inline tanımlanır (`CREATE TABLE` içinde, tablo boş — lock yok). v5.1+ mevcut audit_logs tablosuna yeni CHECK eklenirken **iki aşamalı**: (a) `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` — yeni satırlar valide edilir, mevcut satırlar tarama yapılmaz, lock minimize. (b) Ayrı migration'da `ALTER TABLE ... VALIDATE CONSTRAINT ...` — online validation, AccessShareLock yeterli. Production downtime önlenir; mevcut veri yeni constraint'i ihlal ederse VALIDATE adımında yakalanır, rollback noktası net.

---

<!-- Bölüm 13-16 sıradaki turlarda yazılacak -->
<!-- Bölüm 10.5 ✓ (Session 12, 2026-04-24) — db-migration-guard review gate tamam -->
<!-- Bölüm 11 ✓ (Session 14, 2026-04-25) — db-migration-guard review gate sıradaki adım -->
<!-- Bölüm 12 ✓ (Session 16, 2026-04-25) — security-reviewer + db-migration-guard review gate sıradaki adım -->
<!-- Bölüm 6-9 toplu review önerisi: §6.5 eklendikten sonra yeniden değerlendirilecek -->

