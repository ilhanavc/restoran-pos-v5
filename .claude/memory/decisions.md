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

## ADR-005: Claude Code otomasyon katmanı (MCP + skill + agent + hook)

- **Durum**: Accepted
- **Tarih**: 2026-04-25

### Bağlam
v5 monorepo'sunda 7 reviewer subagent + 8 skill var ama (a) Postgres şema introspection elle `docker exec`, (b) ADR'ı kapatma akışı yok, (c) kapsam kilidi & i18n key denetimi her PR'da elle yapılıyor, (d) tip drift ve migration gate'i otomatik hatırlatılmıyor.

### Karar
Aşağıdaki katmanı **CLAUDE.md anayasası altına** ekliyoruz:
- **MCP**: `postgres` (lokal `pos_dev` introspection) + `context7` (Express 5 / Kysely / zod canlı doc).
- **Skill**: `adr-closer` (Accepted'e taşı + cross-link), `scope-guard` (MVP-vs-v5.1 kontrol).
- **Subagent**: `kapsam-kilidi-reviewer` (PR diff → MVP whitelist), `i18n-key-checker` (hardcoded TR string + duplike key tarayıcı).
- **Hook**: `PostToolUse(Edit|Write)` → değişen paketin `tsc --noEmit`'ı; `PreToolUse(Edit|Write on packages/db/migrations/**)` → `db-migration-guard` hatırlatması.

### Alternatifler
- **A**: Hiçbir şey ekleme — Eksisi: anayasa kuralları manuel uygulanmaya devam eder, sessiz kapsam büyümesi riski.
- **B**: Sadece subagent ekle, MCP'siz — Eksisi: Postgres şema soruları her seferinde Bash'te kalır, context şişer.

### Sonuçlar
- (+) ADR-first / kapsam kilidi / i18n / typecheck disiplinini araç katmanına devrederiz.
- (+) Postgres + canlı doc MCP'si ile main context'te kod yazmak için yer kalır (Core Directive #5).
- (−) settings.json + .claude/ altında ekstra dosya yükü; kurulum tek seferlik.
- (−) MCP serverları için `claude mcp add` lokal kullanıcıda çalıştırılır (repo'ya commit edilmez).

### Referanslar
- CLAUDE.md → Core directives 1–7
- docs/project-charter.md → MVP / v5.1 ayrımı

---

## ADR-003: DB Şema İlkeleri

- **Durum**: Accepted (2026-04-25 — 16 bölüm tamamlandı, §1-§16 review geçti)
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

### Bölüm 8.6 — Products/Variants Lifecycle (Amendment 2026-04-27)

**Bağlam:** Phase 2 Sprint 3b Görev 18 (Products/Variants CRUD) öncesi 4 açık uygulama-katmanı karar. ADR-003 §7 (snapshot invariant) + §8 (soft/hard delete) ilkeleri uygulamayı yönlendirir; bu alt-bölüm endpoint sözleşmesini kilitler.

**Prerequisite (BLOCKER):** `product_variants` tablosu 000_init.sql'de **yok**. Bu amendment Görev 18 PR'ından önce ayrı migration (`006_add_product_variants.sql`) ile karşılanmalı. Migration tasarımı:

```sql
CREATE TABLE product_variants (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id          UUID NOT NULL,
  name                TEXT NOT NULL,
  price_delta_cents   INTEGER NOT NULL,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  sort_order          SMALLINT NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX product_variants_tenant_active_idx
  ON product_variants (tenant_id, product_id) WHERE deleted_at IS NULL;
```

`zod ProductVariantSchema` ile drift kapatılır (zod'a `tenantId`, `sortOrder`, `createdAt`, `updatedAt` eklenir). Migration ve zod senkronu **Görev 17.5** (yeni, plan'da eklenir).

**Karar 1 — Variant write stratejisi: nested write**

`POST /products` ve `PATCH /products/:id` body'sinde `variants: ProductVariantInput[]` array kabul edilir. Tek transaction: parent `products` upsert + child `product_variants` upsert. Ayrı endpoint (`POST /products/:id/variants`) **MVP'de yok**.

- **Gerekçe:** v3 davranışı (admin UI tek formda ürün+varyant). Atomic update — yarı-yazılmış variant set yok. UI 1 round-trip.
- **Reddedilen — ayrı endpoint:** REST ortodoks ama UI overhead, partial state riski. v5.1'de variant import/bulk edit gerekirse eklenebilir.
- **PATCH semantiği:** `variants` body'de **var ise** declarative replace — gönderilen array yeni durum, eksikler soft delete (Karar 2), yeniler insert. Body'de **yok ise** variants dokunulmaz. Boş array `variants: []` = "tüm varyantları sil" (audit'e düşer; UI confirm modal şart).
- **Validation:** zod `ProductWriteRequestSchema = ProductSchema.omit({id, tenantId, ...timestamps}).extend({ variants: z.array(ProductVariantWriteSchema).optional() })`. `is_default` kuralı (superRefine):
  - **En fazla 1 `is_default=true`** — birden fazlası 422 VALIDATION_ERROR
  - **Variants array boş değilse en az 1 `is_default=true` zorunlu** — hepsi false ise 422 VALIDATION_ERROR (UI: yeni product create'de ilk varyant otomatik default işaretlenmeli, form-level default selection)
  - **Variants array boş veya `optional` undefined ise** kural devre dışı (variantsız basit ürün)

**Karar 2 — Product soft delete cascade: variants cascade soft delete**

Product `deleted_at` set olunca, aynı transaction'da o product'ın `deleted_at IS NULL` tüm `product_variants` satırları için `deleted_at = now()` set edilir.

- **Gerekçe:** ADR-003 §7 snapshot kuralı uyumu — `order_items` ürün+kategori snapshot'ı taşır (variant adı henüz snapshot kolonu değil; v5.1 backlog). Cascade tutarlı.
- **Reddedilen (a) — variants dokunulmaz:** Aktif variant filtresi her query'de çift JOIN gerektirir. Drift kaynağı.
- **Reddedilen (b) — `is_active=false` flag:** İki silme yolu §8 tek-yol kuralını bozar.
- **Implementasyon:** Domain service `ProductService.softDelete(id)` transaction içinde iki UPDATE.
- **Restore (v5.1):** Product `deleted_at = NULL` set edilirse variants otomatik restore **edilmez** — admin manuel.

**Karar 3 — Variant lifecycle: soft delete (product yaşıyorken)**

Product yaşıyor, variant kaldırılıyor → `product_variants.deleted_at = now()`.

- **Gerekçe:** Şu an variant adı `order_items` snapshot'a yazılmıyor. Ama `order_items.variant_id` FK v5.1'de eklenirse soft delete defansif. §8 ana kural: "şüpheli durumda soft."
- **Reddedilen — hard delete:** Bugün referansiyel risk yok ama v5.1'de FK eklenirse migration zorlaşır.
- **`is_default=true` variant silme kuralı:** Default soft delete edilirse aynı transaction'da diğer aktif variant'lardan biri (en küçük `sort_order`) `is_default=true` set edilir. Hiç aktif variant kalmayacaksa: izin verilir, product variantsız çalışır.

**Karar 4 — GET response: nested variants**

`GET /products` ve `GET /products/:id` response'unda `variants: ProductVariant[]` (sadece `deleted_at IS NULL`) dahil.

- **Gerekçe:** Admin UI tek query'de ürün+varyant listesi gösterir. List view `variants.length` veya price aralığı için array gerekli.
- **Reddedilen — ayrı endpoint:** N+1 round-trip riski.
- **N+1 query yasağı:** Implementasyonda iki sorgu — (1) products list, (2) `WHERE product_id = ANY($1)` ile tek SELECT IN. Her product için ayrı SELECT döngüsü **YASAK**. Görev 18 DoD'a explicit eklenir.
- **Performans:** 50-100 ürün × 3-5 variant = 200-500 satır. <50ms p95 hedefi. Pagination v5.1.

**Sonuçlar**

- (+) Admin UI tek transaction ürün+varyant CRUD; v3 davranışı korunur
- (+) Soft delete tutarlılığı §8 ile uyumlu, drift yok
- (+) Snapshot kuralı (§7) ihlal edilmez
- (−) `variants: []` PATCH semantiği UI accidental clear riski → confirm modal
- (−) Variant rename eski sipariş raporunda görünmez (variant adı snapshot'a yazılmıyor; risk teorik, v5.1)
- (−) `product_variants` migration prerequisite — Görev 17.5 ayrı PR

**Cross-ref:** §7 (snapshot invariant), §8 (soft/hard delete kuralı), §8.4 (FK ON DELETE RESTRICT), §14.5.A (soft-delete partial index pattern), §10.2.3 (domain service authoritative pattern).

**Amendment 2026-04-28 — `price_delta_cents` semantiği (Görev 17.5 keşfi)**

`product_variants.price_delta_cents` kolonunun semantiği orijinal §8.6 amendment'ında (2026-04-27) açıkça yazılmamıştı; Görev 17.5 (Migration 006) sırasında schema sync yaparken belirsizlik tespit edildi (BLOCKER işaretiyle context-anchor §2 + active-plan §18'e eklenmişti). Bu amendment netleştirir:

- **Tip:** `INTEGER NOT NULL` (PostgreSQL signed 32-bit integer)
- **Anlam:** Variant fiyatının base ürün fiyatına göre **delta** değeri (cent cinsinden, integer money kuralı)
- **İzinli değer aralığı:**
  - **Pozitif:** büyük boy / üst seviye varyant (örn. büyük pide +3 TL = `300`)
  - **Sıfır:** base ile aynı fiyat (örn. "orta" base'den ekstra ücret yok)
  - **Negatif:** küçük porsiyon / indirim varyantı (örn. küçük pide -2 TL = `-200`) — **v3 davranış referansı:** pide ve porsiyon varyantlarında gerçek senaryo, ürün fiyatının altına inen variant
- **Range hard-cap:** Yok. Doğal sınır PostgreSQL `INTEGER` (`-2147483648` ~ `2147483647`) ve zod `z.number().int()` JS safe-integer (`±2^53-1`); restoran fiyat ölçeğinde anlamsız uç değerler input layer'da reddedilmez (CHECK constraint eklenmedi — kapsam dışı, gerekiyorsa v5.1 amendment).
- **Zod schema:** `priceDeltaCents: z.number().int()` (signed, `packages/shared-types/src/menu.ts` Görev 17.5 hâli). `.nonnegative()` veya `.positive()` kısıtlaması **YOK** — DB INTEGER signed ile bire bir tutarlı, drift'siz.
- **Görev 18 implikasyonu:** `ProductCreateSchema` / `ProductUpdateSchema` `variants[].priceDeltaCents` zod refine'ları bu kararı değiştirmez (signed kabul); UI input katmanı (Phase 2 web ekranları) negatif delta için açık gösterim (`-` prefix) sunar.
- **Reddedilenler:**
  - `nonnegative()`: v3 davranışına aykırı, küçük porsiyon use case'i bozar
  - `positive()`: 0 değerini engeller, "base'le aynı fiyat" varyantını imkânsızlaştırır
  - `CHECK (price_delta_cents BETWEEN ...)`: keyfi sınır, restoran ölçeğine bağlı — ADR-dışı kapsam

**Cross-ref (amendment):** ADR-003 §8.6 (4 karar 2026-04-27), Görev 17.5 (PR #33 `f4d2f0e`), context-anchor §2 borç listesi (RESOLVED).

**Amendment 2026-04-28b — Kategori Cascade Kararı (Görev 20)**

`menu/categories` DELETE endpoint'i için cascade kararı (Görev 20 schema sync sırasında tespit edilmişti, aktif borç değil — ADR'siz kod yasak). Karar: **A. Engelle (cascade YOK)**.

- **DELETE /menu/categories/:id** — kategori altında aktif (`deleted_at IS NULL`) `products` satırı varsa 409 `MENU_CATEGORY_HAS_PRODUCTS` döner. Cascade soft delete YAPILMAZ.
- **Gerekçe:** Görev 19 (tables active orders 409) defansif pattern'iyle tutarlı. Veri kaybı riski sıfır — admin önce ürünleri başka kategoriye taşımalı (PATCH /products/:id `category_id`) veya soft delete etmeli (DELETE /products/:id, Görev 18).
- **Reddedilenler:**
  - **B. Cascade soft delete:** §8.6 product→variants cascade pattern'iyle uyumlu görünüyor ama kategori-product silsilesi farklı seviye (admin tipik olarak kategori siler ürünleri taşımak ister, otomatik silmek beklemez)
  - **C. Orphan policy** (`category_id = NULL`): order_items snapshot kuralı (§7) `category_name_snapshot` kopyaladığı için referansiyel risk yok ama products tablosu denormalize olur
- **Snapshot invariant (§7):** Kategori soft delete eski `order_items.category_name_snapshot` etkilemez — order_items kolon snapshot'ı korur.
- **v5.1 mass-edit:** kategori birleştirme (örn. "Tatlılar" + "İçecekler" → "Sıcak/Soğuk") ayrı UI/migration ile gelebilir; bu kapsamda DEĞİL.

**Cross-ref:** ADR-003 §7 (snapshot invariant), §8.6 (cascade pattern), Görev 19 (tables active orders guard).

**Superseded by ADR-012 (2026-04-30).** product_variants tablosu kalır
ama runtime'da kullanılmaz. v5.1'de DROP migration backlog (charter follow-up).

---

### Bölüm 9 — Enum Kullanımı

**Kural:** Sabit sayıda alternatifi olan kolonlar PostgreSQL **native enum** tipi kullanır (`CREATE TYPE ... AS ENUM`). TEXT + CHECK constraint kalıbı **kullanılmaz** — enum tip-güvencesi, depolama etkinliği, kysely-codegen ile TS union type üretimi için tercih edilir.

**9.1 — Enum listesi (000_init'te tanımlı):**

```sql
CREATE TYPE order_status      AS ENUM ('open', 'preparing', 'served', 'closed', 'cancelled');
CREATE TYPE order_type        AS ENUM ('dine_in', 'takeaway', 'delivery');
CREATE TYPE payment_type      AS ENUM ('cash', 'card', 'transfer');
CREATE TYPE payment_scope     AS ENUM ('full', 'item', 'partial');
CREATE TYPE print_job_type    AS ENUM ('receipt', 'kitchen', 'kitchen_adjustment', 'label');
CREATE TYPE print_job_status  AS ENUM ('queued', 'printing', 'printed', 'failed', 'cancelled');
CREATE TYPE user_role         AS ENUM ('admin', 'cashier', 'waiter', 'kitchen');
```

**9.2 — İkram enum değil:** İkram iş modeli Bölüm 10'da — `order_items.is_comped BOOLEAN` ve `orders.is_fully_comped BOOLEAN`. Enum içinde "comped" payment_type değeri **yok** (v3'teki `mixed` ve `other` sapmaları Sinyal #29 ile deprecate edildi).

**9.2.1 — Domain kararları (enum değer gerekçeleri):**

- **`order_type.delivery`:** Paket servis iki akışlı — müşteri gelip alıyor (`takeaway`) veya kurye gidiyor (`delivery`). Ay sonu raporunda gel-al/kurye ayrımı istenir. MVP'de kurye **kimliği ve çıkış saati kayıt altında tutulmaz** — yalnız `order_type=delivery` işaretlenir, kurye atama/takibi v5.1'e (ayrı ADR). Kapsam kilidi: MVP minimalizm. **v3→v5 geçiş notu:** v3'te `takeaway` tek akıştı, `delivery` ayrı bir enum değeri değildi — takeaway içinde status/flag ile yönetiliyordu. v5'te ayrıştı (ayrı enum değeri). v3'ten v5'e geçişte eski takeaway satırlarının `takeaway` mi `delivery` mi olarak işaretleneceği (backfill stratejisi) ayrı bir migration ADR'sinde karara bağlanır (Phase 5 geçiş planı).
- **`payment_scope.partial`:** "Adam başı böl" (ör. 4 kişi, 840₺ toplam → 4×210₺) Türk restoran pratiğinde yaygın; v3'te yoktu, v5'te eklenir (`001_fix_enum_values.sql` ile eski `equal_split` rename'inden gelir). UI'da "Eşit Böl" butonu kişi sayısı input alır, N payment satırı otomatik üretir. Küsurat kuralı: son payment satırı artanı alır (ör. 841/4 → 3×210 + 1×211); kasiyer override edebilir. Detay Bölüm 10'da.
- **`payment_type`:** `cash` + `card` + `transfer` (`001_fix_enum_values.sql` ile eklendi — havale/EFT). Yemek kartları (Sodexo, Ticket, Multinet, Setcard vb.) pilot restoranda kabul edilmiyor; MVP'de ayrı değer yok. İlerde farklı tenant yemek kartı kabul ederse `meal_card` ADD VALUE ile eklenir (9.3 iki-migration pattern).
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
| `full` | 1 | `= orders.total_cents` | "Öde" (tek buton) | — |
| `item` | N ≥ 2 | kasiyer seçimi × `order_items` alt-toplamı | "Kalemle Böl" | satır bazlı kalem atama |
| `partial` | N ≥ 2 | `floor(total/N)` + küsurat son satıra | "Eşit Böl" (kişi sayısı input) | satır tutarı manuel düzeltilebilir |

**(a) `full`:** Tek `payments` satırı; `amount_cents = orders.total_cents`. En yaygın akış (masa tek adisyon, tek ödeme, tek tip). `payment_type ∈ {cash, card}` tek değer.

Pilot restoranda tek müşteri-tek sipariş-iki ödeme tipi (ör. 100₺ nakit + 200₺ kart) senaryosu yaşanmıyor. MVP'de `full` tek `payment_type` taşır; kuraldışı senaryo çıkarsa v5.1'de ayrı scope ADR'si ile ele alınır. `item` ve `partial` zaten karışık `payment_type` destekliyor (her satır kendi type'ını taşıyor) — bu senaryolar kapsandı.

**(b) `item`:** Kasiyer ödeme ekranında `order_items` satırlarını gruplar; her grup bir `payments` satırına karşılık gelir. İlişki **`payment_items` junction tablosu** ile kurulur:

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

**(c) `partial`:** Kasiyer kişi sayısı N girer (N ≥ 2); sistem `base = floor(orders.total_cents / N)` hesaplar; N-1 satır `base` tutarında, son satır `orders.total_cents - (N-1) * base` tutarında oluşturulur (küsurat son satıra). Örnek: 84100 kuruş / 4 → 21025, 21025, 21025, 21025 (eşit). 84101 / 4 → 21025, 21025, 21025, 21026. Kasiyer herhangi bir satırın `amount_cents` değerini manuel düzeltebilir; düzeltme sonrası invaryant `SUM(amount_cents) = orders.total_cents` (§10.4) kontrolü UI blokajı yapar — satır eklenip/çıkarılmadan kaydedilemez.

Kişi sayısı (N) değişikliği: `partial` satırları üretildikten sonra N doğrudan düzenlenemez — kasiyer yanlış N girerse mevcut satırlar iptal edilir ve "Eşit Böl" butonu yeniden tetiklenir (yeni N ile satırlar baştan üretilir). MVP kararı: basit akış, N re-calculation UI karmaşıklığı v5.1'e ertelendi. Kasiyer satır tutarını elle düzeltebilir (yukarıda açıklandığı gibi) ama satır sayısını doğrudan değiştiremez — satır ekleme/silme UI'da kapalıdır.

`payment_items` junction **kullanılmaz** (kalem bazlı ayrıştırma yok); her `payments` satırı kendi `payment_type` değerini taşır (karışık ödeme olabilir).

**Sinyal #29 atıfı — "split" payment_type değil, scope:** v3'te `payment_type='mixed'` + `'other'` belirsiz satırlar üretiyordu; raporda `SUM(amount) GROUP BY payment_type` net değildi. v5'te "karışık" ayrı bir `payment_type` değil, **N ayrı `payments` satırı** (her biri tek `payment_type`). "split" kavramı `payment_type` enum'unda değil, `payment_scope` enum'unda yaşar. Bu ayrım raporda satır bazlı toplam net çalıştırır — `mixed` bucket'ı yok.

**`payment_scope` ve `payment_type` bağımsızlığı:** İkisi ortogonal kolonlar. Örnekler: `(full, cash)` — tek nakit ödeme; `(item, card)` — kalemle bölünmüş satırlardan biri kart; `(partial, cash)` — 4 kişilik eşit bölümden nakit satır. CHECK constraint ile ilişki kurulmaz (kombinasyonlar tüm matris açık).

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

Tüm ikram eylemleri `apps/api/src/services/orderComp.ts` servis fonksiyonlarından geçer (Phase 2'de yazılacak). Doğrudan SQL UPDATE yasak (ESLint + PR review gate); servis içinde tek giriş yolu.

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
- `payment_scope` genelde `full` — delivery siparişleri tek müşteriye olduğu için split nadir; teknik olarak `item` / `partial` mümkün ama MVP UX bu seçenekleri delivery ödemesinde sunmaz (sadeleştirme kararı, kod'da enforce edilmez — UI'da gizlenir);
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
| I6 | item coverage: ödenmesi gereken her `order_item` bir `payments` satırına bağlı | ✓ | I2 içinde (SUM mismatch) | "eksik ödeme" hatası |
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

**Kontrol zamanı:** Yalnız `order_status` `open|preparing|served` → `closed` geçişinde. Açık siparişte ödeme satırları kısmen eklenmiş olabilir (partial üretim ortası, item kalem atama ortası) — ara durumda SUM mismatch yasal.

Açık kalmış yarım ödenmiş siparişler (ör. partial 4 satırdan 3'ü yazılmış, sipariş henüz kapatılmamış) I2 kontrolüne girmez — kapanış tetiklenmemiştir. Bu siparişlerin temizlenmesi günlük kapanış (POS gün sonu) akışında yapılır: kasiyer açık sipariş listesinden teker teker kapatır veya iptal eder. Gün sonu akışı Bölüm 15 veya ayrı bir daily-closeout ADR'sinde tanımlanır (bu ADR kapsamı dışında).


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

**Neden `DEFERRABLE INITIALLY DEFERRED`?** `partial` veya `item`'da N payments satırı tek transaction'da batch insert edilir; her satırdan sonra SUM kontrolü yapılsa transaction ortasında (tam set yazılmadan) FAIL ederdi. Deferred trigger yalnız `COMMIT` öncesi çalışır — "final state" doğrulanır, ara durumlar kabul edilir. Domain service `closeOrder` zaten tek transaction'da tüm insert'leri yapıp commit eder.

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

**10.4.5 — I6: item coverage (dolaylı enforcement):**

`payment_scope='item'` siparişlerde: `order_items` satırlarından `is_comped=false` olanların her biri `payment_items` junction'da bir `payment_id`'ye bağlı olmalı. Eksik kalem = eksik ödeme.

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
- **C6 — DB hata mesajının UI'a ham sızdırılmaması.** `RAISE EXCEPTION` çıktıları kasiyere doğrudan gösterilmez; domain service wrapper hatayı yakalar, Türkçe i18n-key üzerinden `t('error.order.compOnClosed')` gibi mesaja çevirir. Bu kural §12 (error taxonomy / audit sanitize) veya ayrı "API error contract" ADR'sinde kilitli kılınır — bu ADR kapsamı dışı. **(→ ADR-006 §4 — DB Error → Domain Error mapping artık kilitlendi.)**
- **C7 — I8 (`amount_cents > 0`) refund forward-compat borcu.** v5.1 refund ADR'si bu CHECK'i gevşetir veya negatif satır yerine `payment_kind='refund'` ayrı satır modeli tanımlar (§10.4.6 zaten negatif yasak prensibini kaydetmiş). v5.1 backlog'a girer — `active-plan.md` Follow-up bölümüne §10.5 commit'iyle birlikte kayıt.

**10.5.3 — Green-light kilidi (bu maddelere §10.5 sonrası dokunulmaz):**

- **GL1:** `total_cents = GROSS` kararı (§10.2.2) — snapshot stabilitesi + rapor basitliği + payments invaryantı üç ayrı gerekçeyle airtight. Alternative A (NET) reddi clean.
- **GL2:** `DEFERRABLE INITIALLY DEFERRED` CONSTRAINT TRIGGER `check_payment_sum` kullanımı — PG feature match doğru (CONSTRAINT TRIGGER'lar DEFERRABLE olabilir, regular trigger'lar olamaz), batch insert rationale textbook.
- **GL3:** `is_fully_comped=true` siparişte **0 `payments` satırı** semantiği (yokluk) — "sıfır tutarlı tek satır" reddi `GROUP BY payment_type` raporlama kirliliğini önlüyor; doğru karar.
- **GL4:** Comp vs cancel ayrım tablosu (§10.2.6) — üç akış, üç davranış, üç rapor sonucu net. Phase 2'de yeniden okunduğunda karışıklık çıkmaz.
- **GL5:** Üç katmanlı enforcement (domain authoritative / DB defansif / UI UX) + §10.4.7 özet tablosu — her invaryant hangi katmanda korunduğu explicit.
- **GL6:** Deferred DB trigger + UI live running total ayrımı — commit-time DB truth + live UX feedback iki ayrı amaç, birleştirilmez.
- **GL7:** `OrderCompService` dört-prong savunma (tek giriş yolu + ESLint no-raw-update + audit log zorunlu + admin-only rol) — ikram akışı tek noktadan kontrol altında.
- **GL8:** Scope ≠ payment_type ortogonalliği (§10.1, sinyal #29 atfı) — v3 `'mixed'`/`'other'` pathology'sini kökten eleyen karar. `payment_scope` üç değerli (full/item/partial), `payment_type` iki değerli (cash/card), ortogonal kolonlar.

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
- [ ] **Error taxonomy forward-ref**: Service layer'da `23505 unique_violation` yakalanır → CONFLICT error code'u; tam taxonomy ayrı ADR (forward-ref active-plan follow-up listesi). **(→ ADR-006 §4 — `23505` ve `40001 serialization_failure` retry pattern artık kilitlendi: maks 3 şeffaf retry, başarısız olursa 500 `INTERNAL_ERROR`.)**
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

**Sprint 1 audit backlog (Sprint 0 Madde 3 security-reviewer WARN — bloker değil):**
1. **`actor` JSONB sanitize edilmiyor** (`writeAudit.ts` — caller `{user_agent, ip:'1.2.3.4'}` geçirirse PII direkt DB'ye gider). Fix: `actor` field'ı da deny-list filtresinden geçir.
2. **Deny-list eksik kategoriler**: `birth_date`/`dob`/`dogum_tarihi` (KVKK), `iban`/`account_number`/`hesap_no` (finansal), `authorization`/`session_token`/`refresh_token` (header secret), `latitude`/`longitude`/`konum` (lokasyon), `pwd`/`passwd`/`pass` kısaltmaları. Migration + TS deny-list birlikte güncellenir.
3. **CI grep guard sıkılaştırma**: `-v ".test.ts"` substring match → `-vE '\.test\.ts$'` regex. `grep -i` ile case-insensitive SQL pattern. Ayrı CI PR.
4. **Cyclic reference guard**: `sanitizeRecord` döngüsel referansta stack overflow eder. `WeakSet` visited tracking veya max depth (4) sınırı ekle.

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

### Bölüm 13 — Retention, TTL Cleanup & RLS Hazırlığı

**Bağlam:** §12.5'te `audit_logs` (2y) ve `call_logs` (30g) için birleşik cron `apps/api/src/cron/ttl-cleanup.ts` taslağı çıktı; §12.7 (d) sistem-actor `tenant_id NULL` davranışını ve §12 db-guard CONCERN-B3 advisory-lock namespace çakışma riskini §13'e devretti. Bu bölüm beş borcu kapatır: (a) **retention politikasının genel ilkesini** kurar (iş kaydı = sınırsız, log/PII = bounded, archive = TTL); (b) §12.5 birleşik cron'unu **formal kontrat** seviyesine taşır (zamanlama, lock id konvansiyonu, batch boyutu, hata davranışı, observability, self-audit); (c) yeni TTL task eklenirken izlenecek **TTL job kontratı** çatısını çizer (v5.1+ genişleme yolu); (d) sistem-actor `tenant_id NULL` audit satırlarının §6.4 v5.2 RLS açılışında nasıl handle edileceğini **policy şablonu** olarak kilitler; (e) `print_jobs` archive retention boşluğunu kapatır.

**RLS yerleşim kararı (önce kilit):** RLS bu bölüme **alt-bölüm olarak** dahil edildi (yeni §6 alt-kuralı yerine). Gerekçe: §6.4 RLS'i MVP'de kapatma + v5.2 öncesi açma kararını zaten verdi; §13'te eklenen yalnızca **TTL/sistem-actor kesişiminin policy şablonu** — yani retention semantiği RLS davranışını şekillendiriyor (cron'un `tenant_id NULL` satırları yazması §6.4 policy tasarımını etkiliyor). RLS politikalarının tablo-tablo enforcement'ı v5.2 ADR'sinin işi; bu §13 sadece **audit_logs için BLOCKER policy şablonunu** kilitler. §6'yı genişletmek §6'nın "izolasyon ilkesi" odağını dağıtırdı; §13'te tutmak retention + RLS bağını netleştirir. Trade-off (kabul): RLS okuyucusu iki yere bakar — §6.4 (genel ilke) + §13.5 (audit_logs özel davranışı).

---

#### 13.1 Retention politikası genel ilkeleri

**Karar 13.1.A — Tablo retention kategorileri (üç sınıf):**

Her tablo şu üç kategoriden **tam birine** atanır; kategori migration'da yorum olarak işaretlenir (`-- retention: business-record | bounded-log | archive`).

| Kategori | Tanım | Retention | Cleanup mekaniği | Örnek tablolar |
|---|---|---|---|---|
| **business-record** | İş kaydı; iade, denetim, vergi, finansal raporlama için kalıcı | **Sınırsız** (soft delete §8) | Yok — `deleted_at` ile pasifleştirilir, fiziksel silme yok | `orders`, `order_items`, `payments`, `customers`, `customer_phones`, `tenants`, `users`, `tables`, `products`, `categories` |
| **bounded-log** | PII veya yüksek-volume log; KVKK orantılılık + disk şişme önleme | **Bounded** (her tablo için bu ADR'de açık değer) | Birleşik cron `ttl-cleanup.ts` → hard DELETE batch | `call_logs` (30g, P-10), `audit_logs` (2y, P-09) |
| **archive** | Kısa yaşam döngülü; başarı sonrası anlamsız | **Status-bounded** (örn. başarılı basımdan N gün sonra) | Aynı cron içinde ayrı task — hard DELETE veya status-archive | `print_jobs` (§13.6) |

**Genel ilke (slogan):** "İş kaydı sonsuz, log/PII bounded, archive status-temelli." Yeni tablo eklenirken hangi kategoriye girdiği migration PR'ında **yazılı** olur — db-migration-guard kategori yorumunu zorunlu görür (§13.8 madde 1).

**Karar 13.1.B — Retention süresi belirleme kuralı:**

bounded-log tablolarında retention süresi şu ölçütlere göre belirlenir:
- **KVKK orantılılık:** PII içeriyorsa "amaç sınırlılığı" ilkesi — ihtiyaçtan fazla tutma. `call_logs` operatif tanıma için 30 gün; daha uzun forensic değer yok.
- **Denetim/yasal yükümlülük:** Türk Ticaret Kanunu defter tutma 5 yıl, vergi 5 yıl. Ama `audit_logs` defter değil — operasyonel forensic. 2 yıl pratik orta-yol (KVKK Sinyal #40 + P-09).
- **Volume tahmini:** Pilot 25 masa, ~150 sipariş/gün → ~1500 audit event/gün → 2 yılda ~1M satır → INT pageable, sorun yok. 5 yıl olsaydı ~2.7M, hâlâ kabul; ama orantılılık ilkesi 2 yılı tercih ettirdi.

**Reddedilen alternatifler:**
- **A. Tüm tablolar için tek retention süresi (örn. 2 yıl):** Reddedildi — `orders` 2 yılda silinemez (vergi + iade), `call_logs` 2 yıl tutmak KVKK ihlali.
- **B. "Archive" kategorisini ayrı tabloya taşıma (örn. `print_jobs_archive`):** Reddedildi — MVP overhead, status-temelli silme yeterli. v5.1 volume büyürse yeniden değerlendirilir (§13.7 forward-ref).
- **C. Soft delete + retention combo (`deleted_at + N gün sonra hard delete`):** Reddedildi — bounded-log kategorisinde soft delete anlamsız (PII zaten satırda); audit_logs için hard delete tek yol.

---

#### 13.2 Birleşik cron `ttl-cleanup.ts` — formal kontrat

**Karar 13.2.A — Cron schedule (§12.5'ten kilit):**

`0 30 3 * * *` — her gün **03:30 Europe/Istanbul**, cutoff (04:00) **öncesi**. Gerekçe (§12.5 ile aynı, burada kilit): cron iş günü kapanışından önce tamamlanır → cutoff sonrası rapor üretimi temiz veri üzerinde. Cron container/host saat dilimi `TZ=Europe/Istanbul` env ile sabitlenir; UTC kayma yasağı.

**Karar 13.2.B — Task taksonomisi (MVP):**

Cron tek dosya içinde **iki ayrı task** sırayla çalıştırır; task'lar bağımsızdır (biri fail → diğeri yine çalışır):

1. `purgeAuditLogs` — retention 2 yıl, hard DELETE batch, tenant-loop + sistem-actor (NULL) ek pass
2. `purgeCallLogs` — retention 30 gün, hard DELETE batch, tenant-loop (sistem-actor satırı yok — call_logs sadece tenant kaynaklı)

`print_jobs` archive task'ı §13.6'da; v5.1+ task ekleme §13.7 forward-ref.

**Karar 13.2.C — Batch boyutu standardı:**

Tüm DELETE batch'leri **`LIMIT 10000`**. Gerekçe: PG WAL & vacuum dengesi — küçük batch (örn. 1000) cron süresi uzar; büyük batch (örn. 100000) lock window genişler, autovacuum stres. 10000 PG community pratiği orta-yol; pilot ölçümünde uzar/kısalırsa §13.7 forward-ref ile revize.

**Karar 13.2.D — Tenant-loop pattern (§12.5'ten kilit):**

```sql
-- Şablon (kavramsal — implementer Kysely ile yazar):
-- 1) Aktif tenant listesi:
SELECT id FROM tenants WHERE deleted_at IS NULL;

-- 2) Her tenant için döngü:
DELETE FROM <table>
WHERE id IN (
  SELECT id FROM <table>
  WHERE tenant_id = $1
    AND created_at < now() - INTERVAL '<retention>'
  ORDER BY created_at ASC
  LIMIT 10000
);
-- loop: affected_rows < 10000 olunca bir sonraki tenant'a geç

-- 3) Sistem-actor pass (yalnız audit_logs):
DELETE FROM audit_logs WHERE id IN (... WHERE tenant_id IS NULL ...);
```

Gerekçe (§12.5): mevcut `(tenant_id, created_at DESC)` index'inin leading column'unu kullanır → seq scan elimine, 4. index gereksiz. Tenant-loop her bounded-log task'ı için **zorunlu pattern**.

**Karar 13.2.E — Advisory lock id registry (CONCERN-B3 kapanışı):**

`pg_try_advisory_lock(<bigint>)` ile paralel cron instance koruması. **Lock id çakışma riskini** önlemek için **merkezi sabit registry**:

- Lock id'ler `packages/shared-domain/src/cron/lock-ids.ts` (veya muadili) içinde **TS const** olarak tanımlanır:
  ```ts
  // Kavramsal — implementer detayı
  export const CRON_LOCK_IDS = {
    TTL_CLEANUP_AUDIT_LOGS: 4_201_001n,
    TTL_CLEANUP_CALL_LOGS:  4_201_002n,
    TTL_CLEANUP_PRINT_JOBS: 4_201_003n,  // §13.6
    DAILY_CLOSE:            4_201_010n,  // forward-ref kapanış cron'u
  } as const;
  ```
- Namespace prefix: `4_201_xxx` (cron job'ları için ayrılmış aralık). Diğer advisory lock kullanan kod (örn. order_no sayaç §11) **farklı prefix** kullanır.
- **Kural:** `pg_try_advisory_lock(<literal>)` raw çağrısı **yasak** — yalnız registry'den okunur. db-migration-guard PR gate grep ile reddeder (`pg_try_advisory_lock\(\d` literal pattern).
- Registry'ye yeni id eklemek = ADR mini-pass veya yeni ADR (sessiz değişiklik yasak).

**Hash-temelli alternatif reddedildi:** "task adının hash'inden bigint üret" pattern'i (örn. `hashtext('audit-purge')::bigint`) reddedildi — (a) determinizm zayıf (PG sürümü hash algoritmasını değiştirebilir), (b) çakışma teorik var (64-bit ama yine de), (c) registry okunabilir, hash okunamaz. Sabit literal + merkezi const + lint gate üçü birden net.

**`cron_locks` tablosu reddedildi:** "DB tablosu olarak lock kayıt tut" pattern'i reddedildi — advisory lock zaten in-memory, tablo eklemek round-trip artırır + `tenant_id` izolasyonu (`cron_locks` tenant-bağımsız sistem tablosu olur, §6 prefix ihlali). Advisory lock + TS registry yeterli.

**Karar 13.2.F — Hata davranışı:**

- Bir task fail ederse (örn. PG bağlantı kopması) **diğer task çalışmaya devam eder** — task'lar bağımsız `try/catch` bloklarında. Cron'un bir parçası fail edince hepsi durmaz.
- Lock alınamazsa (başka instance çalışıyor) **sessiz exit** (warning log, alert yok) — beklenen senaryo (ör. iki container).
- Task içi loop hatası: batch fail → Sentry alert (severity: warning, mevcut §12.5'ten kilit) + task abort (sıradaki task çalışır) + self-audit yazılmaz (hata satırının integrity'si yok).
- Hiçbir hata cron'u "down" işaretlemez — bir sonraki run'da retry. Idempotent batch DELETE bunu mümkün kılar (silinmiş satır ikinci run'da match etmez).

**Karar 13.2.G — Observability:**

Her task için (zorunlu):
- `console.info({ task, tenant_id, deleted_count, batch_count, duration_ms })` her tenant batch sonunda.
- Task tamamlanınca `audit.purge` event (sistem-actor, §13.4).
- Hata: Sentry warning + kontekst (`task`, `tenant_id`, `error.message`). PG bağlantı kopması durumunda Sentry duplicate'i suppress eder (15 dk pencere — ayrı ADR'de değil, Sentry config'inde).
- Metric (forward-ref §13.7): Prometheus `ttl_cleanup_deleted_total{task,tenant}` counter — observability ADR'si geldiğinde eklenir; MVP'de console.info yeterli.
- **Retention overflow alarmı (A3):** Task sonunda `deleted_count == LIMIT` ise Sentry **warning** (retention pressure); ardışık 3 run warning verirse multi-batch loop (örn. 5 batch/run) §13.7(d) volume revize tetiklenir.

---

#### 13.3 Lock id konvansiyonu özet (db-migration-guard kontrol noktası)

**Karar 13.3 — Üç-katmanlı enforcement:**

- **(a) TS const merkezi:** `packages/shared-domain/src/cron/lock-ids.ts` tek kaynak. Yeni cron job → registry'ye ekle → import → kullan.
- **(b) ESLint kuralı `no-raw-advisory-lock`:** `pg_try_advisory_lock(<literal>)` veya `pg_advisory_lock(<literal>)` raw literal arg ile çağrı yasak (sadece import edilmiş const). Detay implementer (custom rule veya regex grep).
- **(c) db-migration-guard PR gate:** Grep `pg_(try_)?advisory_lock\(\d` pattern → eşleşme varsa BLOCKER.

**Implementation borcu:** Phase 0 implementer turu `docs/engineering/cron-conventions.md` dosyasını yazar — bu §13.3 + §13.2 kararlarını **kullanım kılavuzu** formuna çevirir (örn. "yeni cron job nasıl eklenir" 5 adım). ADR §13 çatıyı, doc operasyonu kapsar.

---

#### 13.4 Cron self-audit — `audit.purge` event detayı

**Karar 13.4 — §12.5.1'den kilit + genişletme:**

Her purge task tamamlandığında **bir** `audit.purge` event yazılır (`writeAudit()` üzerinden, §12.4). Payload tek şablon:

```json
{
  "table": "audit_logs",          // veya "call_logs" / "print_jobs"
  "deleted_count": 12340,
  "batch_count": 2,
  "duration_ms": 1850,
  "cutoff_date": "2024-04-25"      // retention window üst sınırı (now() - interval)
}
```

**Sistem-actor şeması:** `tenant_id = NULL`, `actor_user_id = NULL`, `actor = { user_agent: 'cron/ttl-cleanup' }`. user_agent değeri sabit string — task adını payload'a değil actor'a koymak audit viewer filtre tutarlılığı için (§12.7 a, v5.1 audit viewer).

**`task` payload anahtarı ayrımı:** `table` payload'ta zaten var; `task` ek anahtar olarak yazılmaz — cron job yapısı (1 cron, N task) audit volume'unu artırmaz, `table` yeterli ayrım sağlar.

**Multi-task tek run:** İki task (audit + call) tamamlandığında **iki ayrı** `audit.purge` event yazılır (her task için bir). Tek run = tek event yapılmaz — `table` ayrımı korunur, retrospektif sorgu kolaylığı.

**allowedKeys whitelist (§12.3):** `audit.purge` için `['table', 'deleted_count', 'batch_count', 'duration_ms', 'cutoff_date']`. Yeni payload anahtarı eklemek = whitelist + ADR mini-pass.

---

#### 13.5 Sistem-actor `tenant_id NULL` + RLS policy şablonu (CONCERN-B3 ikinci kapanış)

**Bağlam:** §12.7 (d) outstanding — cron'un `audit.purge` event'ini `tenant_id NULL` ile yazması §6.4 v5.2 RLS açılışında nasıl handle edilir? §6.4 RLS'i MVP'de kapalı tuttu; v5.2 öncesi açar. Bu §13.5 **v5.2 RLS migration'ında uygulanacak policy şablonunu** kilitler — MVP'de enforcement yok ama policy yazılırken bu şablon kullanılır.

**Karar 13.5.A — `audit_logs` RLS policy şablonu (v5.2):**

```sql
-- v5.2 RLS migration'ında uygulanacak (MVP'de değil):
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- (1) Tenant kullanıcısı: yalnız kendi tenant satırları (NULL HARİÇ).
-- Sistem-actor (NULL) satırlarının payload'ı global metadata içerir
-- (deleted_count toplamı vb.) — tenant viewer bu satırları görmez.
CREATE POLICY tenant_select_audit ON audit_logs
  FOR SELECT
  TO app_tenant
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- (2) Sistem-actor satırlarına erişim ayrı policy + ayrı rol/endpoint:
-- admin viewer "sistem cron'u kim ne sildi" sorgusu için.
CREATE POLICY system_select_audit_admin ON audit_logs
  FOR SELECT
  TO app_admin
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id')::uuid
  );

-- (3) INSERT: cron sistem-actor olarak NULL yazabilir; tenant kullanıcısı NULL yazamaz.
-- Cron'un kullandığı DB rolü ('cron_purger') BYPASSRLS taşır — NULL INSERT'i RLS atlar.
CREATE POLICY tenant_insert_audit ON audit_logs
  FOR INSERT
  TO app_tenant
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND tenant_id IS NOT NULL
  );

-- (4) DELETE: yalnız BYPASSRLS rol. Tenant rolü policy yokluğu nedeniyle silemez.
-- (Cron 'cron_purger' bypass; uygulama erişimi audit DELETE yapmaz.)
```

**A4 — Sistem-actor metadata sızıntı önlemi:** Sistem-actor satırlarının payload'ı global metadata içerir (deleted_count toplamı); tenant viewer'da bu satırlar **gösterilmez** — repository `findByTenant` sistem-actor satırlarını ayrı method (`findSystemEvents`, admin-only) ile döndürür. `OR tenant_id IS NULL` policy v5.2 RLS açıldığında `cron_purger` rolüne özgü kalır; `app_tenant` SELECT policy'si NULL'ı **dışlar** (yukarıdaki `tenant_select_audit`). Sistem audit'i ayrı admin endpoint okur (`system_select_audit_admin` policy + `app_admin` rolü).

`audit_logs.tenant_id` kolonu NULL serbest (NOT NULL constraint yok); §12.2 şeması bu davranışı kilitler. FK `REFERENCES tenants(id) ON DELETE RESTRICT` NULL satırları için pasif (NULL FK kontrolünden muaf). db-migration-guard yeni audit-benzeri tablo eklenirken sistem-actor INSERT senaryosu varsa NOT NULL koymadığını doğrular.

**Üç DB rolü ayrımı (v5.2):**
- `app_tenant` — uygulama API'sinin kullandığı rol; RLS'e tabi; `tenant_id NULL` INSERT yapamaz, sadece kendi tenant satırlarını okur (+ sistem-actor satırları read-only).
- `cron_purger` — cron job'larının kullandığı rol; **BYPASSRLS** flag'li; `tenant_id NULL` INSERT + cross-tenant DELETE serbest. Uygulamadan erişimi yok (env'de ayrı connection string).
- `migrator` — migration tool rolü; superuser değil ama BYPASSRLS + DDL yetkisi. Yalnız deploy zamanı.

**Karar 13.5.B — Sistem-actor satırlarının kapsam dışı kalmaması:**

`tenant_id IS NULL` satırları audit viewer'da **görünür** (policy `OR tenant_id IS NULL` eklendi) — gerekçe: müdür "geçen ay cron neyi sildi" sorgusunu yapabilmeli. Tenant-bazlı raporlamada bu satırlar **dahil edilmez** (rapor sorgusu `WHERE tenant_id = $1` explicit filtre koyar; policy genişletme rapor count'una sızmaz).

**Cron rolü process boundary (A1):** `cron_purger` connection string yalnız cron process env'inde (`CRON_DATABASE_URL`); API runtime env'inde **bulunmaz**. Process boundary ihlali (örn. API'den shell-out) supply-chain incident sayılır. v5.2 RLS ADR'si rolü `LOGIN` + `CONNECTION LIMIT 2` ile kısıtlar.

**Advisory lock DoS yüzeyi (A2):** `app_tenant` rolünden `pg_advisory_lock` / `pg_try_advisory_lock` fonksiyon `EXECUTE` yetkisi `REVOKE` edilir (v5.2 RLS migration'ında); MVP'de role separation enforce edilmediğinden risk **kabul** — pilot süresince DB'ye doğrudan erişim yalnız operator'da.

**Karar 13.5.C — Reddedilen alternatifler:**

- **A. Ayrı `system_audit_logs` tablosu:** Reddedildi — şema duplikasyonu, iki sanitize layer, iki retention task, audit viewer iki source merge etmek zorunda. NULL strategy + RLS policy minimum overhead ile aynı sonucu verir.
- **B. Sentinel UUID (örn. `00000000-0000-0000-0000-000000000000` tenant_id):** Reddedildi — magic value pattern; FK `REFERENCES tenants(id)` constraint sentinel için fake tenant kayıt gerektirir (kirli). NULL semantik açıdan doğru — "bu satırın tenant'ı yok".
- **C. RLS policy `OR tenant_id IS NULL` olmadan:** Reddedildi — sistem-actor satırları kimse okuyamaz; audit viewer cron forensic kapalı kalır, P-09 amacı yarım gerçekleşir.

**Karar 13.5.D — MVP enforcement:**

MVP'de RLS **kapalı** (§6.4). `tenant_id NULL` davranışı (A4 sonrası iki ayrı method):
- `auditLogsRepo.findByTenant(tenantId)` — sadece tenant satırları (`WHERE tenant_id = :tenantId`, NULL **hariç**). Tenant viewer/raporlar bu method'u kullanır; sistem-actor metadata sızması yok.
- `auditLogsRepo.findSystemEvents()` — yalnız `WHERE tenant_id IS NULL` satırlarını döner; **admin-only** endpoint'ten çağrılır (örn. `/api/admin/audit/system`); tenant viewer route'larından erişim yok.
- Otomatik tenant filter middleware'i `app_tenant` çağrılarında `audit_logs` için NULL'ı es geçmez (drift yaratır) — `findSystemEvents` middleware'i bypass eden admin scope'unda çağrılır. db-migration-guard PR gate `audit_logs` SELECT'lerinde `OR tenant_id IS NULL` kalıbının **yalnız** `findSystemEvents` veya cron task içinde olduğunu doğrular; tenant scope'unda eşleşme BLOCKER.

**Karar 13.5.E — Forward-ref:**

v5.2 RLS ADR'si (henüz yok, ADR-XXX) yazılırken bu §13.5 policy şablonu **referans** olarak kullanılır; o ADR'de RLS açma migration'ı + tüm tabloların policy listesi + role bootstrap detayı yer alır. §13.5 audit_logs için **policy çatısını** kilitler, diğer tabloları kapsamaz.

---

#### 13.6 `print_jobs` retention — archive kategorisi

**Karar 13.6 — Status-temelli archive:**

`print_jobs` tablosu archive kategorisinde (§13.1.A). Retention kuralı:
- `status = 'success'` ve `printed_at < now() - INTERVAL '7 days'` → hard DELETE
- `status = 'failed'` veya `status = 'cancelled'` ve `created_at < now() - INTERVAL '30 days'` → hard DELETE (forensic için 30 gün)
- `status IN ('queued', 'printing', 'retry')` → asla silinmez (aktif iş)

Cron task `purgePrintJobs` `ttl-cleanup.ts` içinde üçüncü task olarak — MVP **kapsam dışı** (ADR-004 print-agent ADR'sinin sorumluluğu). §13.6 retention kuralını **kilitler** ama task implementation'ı ADR-004 + print-agent'ın çalışan kodu sonrasına ertelenir. Forward-ref: `print_jobs` tablosu Phase 0'da şema tanımlı, cron task Phase 1+'da yazılır.

**Gerekçe (7g / 30g ayrımı):** Başarılı basım = audit zaten yapıldı (ADR-004 status_history), 7 gün debug penceresi yeter. Başarısız = pattern analizi (P-02 sessiz arıza) için 30 gün gerek, kasiyer "geçen hafta hangi yazıcı sıkılı" sorgusu.

---

#### 13.7 Outstanding işler (forward-ref)

- **(a) v5.2 RLS ADR'si:** §13.5 policy şablonu uygulayan ayrı ADR — tüm tablolar için policy listesi, **dört-rol bootstrap** (`app_tenant`, `cron_purger` BYPASSRLS, `migrator` BYPASSRLS, `app_admin` sistem-actor satır viewer), migration sözdizimi (tool kararı sonrası). §13.5 mini-pass A4 sonrası `app_admin` rolü `system_select_audit_admin` policy'siyle ilk kez geçer; üç-rol modeli dört-rol modeline burada genişler. §13.5 referans materyaldir, ayrı ADR detayı kapsar. Bootstrap order kilit: (1) CREATE ROLE app_tenant, cron_purger BYPASSRLS, migrator BYPASSRLS, app_admin; (2) GRANT yetki matrisi; (3) CREATE TABLE; (4) CREATE POLICY; (5) ALTER TABLE ENABLE ROW LEVEL SECURITY. v5.2 RLS ADR'si bu sırayı migration sözdizimi ile kilitler.
- **(b) Observability ADR'si:** §13.2.G Sentry + Prometheus metric — observability ADR'si yazıldığında `ttl_cleanup_*` metric'leri formal hale gelir. MVP'de `console.info` + Sentry warning yeterli.
- **(c) `print_jobs` cron task implementation (ADR-004):** §13.6 retention kuralı kilit; task kodu Phase 1+'da ADR-004 print-agent ADR'siyle birlikte yazılır.
- **(d) Volume revize:** Pilot 6 ay sonrası `audit_logs` volume ölçümü; 1M satır tahmini ±%50 sapma varsa retention süresi yeniden değerlendirilir (mini-pass ADR).
- **(e) `docs/engineering/cron-conventions.md`:** §13.3 implementation borcu — Phase 0 implementer turu yazar; "yeni cron job ekleme" 5-adım kılavuzu, lock id registry kullanımı, advisory lock anti-pattern'leri.
- **(f) Cross-tenant izolasyon test stratejisi:** §6.3 + §6.4 + §13.5 hibrit — RLS off MVP'de repository pattern'i, RLS on v5.2'de policy testleri. §5 parity test modelinin RLS uzantısı v5.2 RLS ADR'sinde tanımlanır.
- **(g) Partition stratejisi (volume tetikleyici):** `audit_logs` satır sayısı tenant başına 5M veya toplam 50M aşarsa PostgreSQL declarative partitioning (RANGE by `created_at`, quarterly) değerlendirilir. `DELETE WHERE created_at < ...` sorgusu partition pruning ile O(1) `DROP PARTITION`'a dönüşür. MVP/v5.2'de gereksiz; pilot 6 ay sonrası §13.7(d) volume revize ile birlikte ölçülür.

---

#### 13.8 Review-gate checklist

**Bölüm A — db-migration-guard maddeleri:**

- [ ] **Retention kategori yorumu zorunlu**: Yeni tablo migration'ında `-- retention: business-record | bounded-log | archive` yorumu mevcut. Kategori yoksa BLOCKER.
- [ ] **Birleşik cron tek dosya**: `apps/api/src/cron/ttl-cleanup.ts` tek dosya; iki task (`purgeAuditLogs`, `purgeCallLogs`) içinde tanımlı; `purgePrintJobs` placeholder yorum (ADR-004 forward-ref).
- [ ] **Cron schedule `0 30 3 * * *`** + `TZ=Europe/Istanbul` env veya cron yorumunda timezone explicit.
- [ ] **Tenant-loop pattern**: Her bounded-log task'ı `(tenant_id, created_at DESC)` index leading column'unu kullanan tenant-loop ile yazılmış; tek sorgu seq scan tespit edilirse BLOCKER.
- [ ] **Batch boyutu `LIMIT 10000`** her DELETE'te mevcut; literal değer yorumla gerekçeli (§13.2.C).
- [ ] **Sistem-actor pass yalnız `audit_logs`**: `WHERE tenant_id IS NULL` ek pass sadece audit_logs için var; call_logs'ta yok.
- [ ] **Advisory lock id registry**: `pg_try_advisory_lock(<literal>)` raw çağrı yok; `CRON_LOCK_IDS` const'undan import. Grep `pg_(try_)?advisory_lock\(\d` eşleşmesi varsa BLOCKER.
- [ ] **Lock id namespace prefix**: `4_201_xxx` aralığı cron için ayrılmış; başka kod (örn. order_no §11) farklı prefix kullanıyor.
- [ ] **Idempotency**: Aynı gün ikinci run zarar yaratmaz (lock zaten alındı → sessiz exit; lock yoksa silinecek satır kalmamış).
- [ ] **Hata izolasyonu**: Task'lar bağımsız `try/catch`; bir task fail diğerini durdurmaz.
- [ ] **`print_jobs` retention kuralı dökümante**: Şema yorumunda 7g success / 30g failed kuralı yazılı; cron task ADR-004 forward-ref.
- [ ] **`audit_logs` repository iki method ayrımı (A4)**: `findByTenant` yalnız tenant satırları (NULL hariç); `findSystemEvents` admin-only NULL satırları. Tenant scope'unda `OR tenant_id IS NULL` kalıbı BLOCKER.
- [ ] **`app_tenant` advisory lock EXECUTE revoke (v5.2)**: v5.2 RLS migration'ında `pg_advisory_lock` / `pg_try_advisory_lock` fonksiyonları `app_tenant` rolünden REVOKE edilmiş.
- [ ] **Retention overflow alarmı (A3)**: `deleted_count == LIMIT` Sentry warning üretiyor; ardışık 3 run pattern'i §13.7(d) volume revize tetikleyici.
- [ ] **Sistem-actor tablolarda tenant_id nullability**: cron NULL INSERT yapan tablo (audit_logs) tenant_id NULL serbest; NOT NULL koyulmuş ise BLOCKER.

**Bölüm B — security-reviewer maddeleri:**

- [ ] **`audit.purge` event yazılıyor**: Her task tamamlandığında bir `audit.purge`; payload `{ table, deleted_count, batch_count, duration_ms, cutoff_date }`; whitelist (§12.3) güncel.
- [ ] **Sistem-actor şeması**: `tenant_id=NULL`, `actor_user_id=NULL`, `actor.user_agent='cron/ttl-cleanup'` sabit.
- [ ] **`audit.purge` sonsuz döngü yok**: event_type kendi event'ini silmez (TTL 2 yıl); volume tahmini yıllık ~365 satır × task-count.
- [ ] **Gizli veri purge log'unda yok**: `audit.purge` payload sadece sayısal/tarih; hiç PII (deleted satırın içeriği) yok.
- [ ] **PII tablo (call_logs) retention 30g**: KVKK orantılılık (Sinyal #40) ADR §13.1.B gerekçesi mevcut; daha uzun retention ADR güncellemesi gerektirir.
- [ ] **`audit_logs` retention 2y**: KVKK + denetim dengesi (P-09 + Sinyal #40); 5 yıl reddedildi gerekçeli.
- [ ] **RLS policy şablonu kilit**: §13.5 audit_logs policy şablonu yazılı (v5.2 forward-ref); `OR tenant_id IS NULL` SELECT, `WITH CHECK tenant_id IS NOT NULL` INSERT, DELETE yalnız BYPASSRLS rol.
- [ ] **Üç DB rolü ayrımı**: `app_tenant` / `cron_purger` (BYPASSRLS) / `migrator` v5.2 ADR'sinde uygulanacağı kayıtlı; MVP'de role separation belgelenmiş ama enforce edilmemiş kabul.
- [ ] **`tenant_id NULL` audit görünürlüğü**: Tenant-bazlı raporlarda explicit `WHERE tenant_id = $1` filtre; sistem-actor satırları rapor count'una sızmıyor.
- [ ] **Cron rolü uygulama erişimi yok**: `cron_purger` connection string ayrı env (`CRON_DATABASE_URL`); uygulama API'si bu rolü kullanamaz (v5.2 enforcement, MVP'de doc-only).
- [ ] **`audit.purge` writeAudit() üzerinden yazılıyor**: Cron `INSERT INTO audit_logs` raw çağrı yok (§12.4 lint kuralı kapsamına dahil).
- [ ] **Forward-ref kayıtları**: §13.7 (a) v5.2 RLS ADR, (b) observability ADR, (c) ADR-004 print task, (d) volume revize, (e) cron-conventions.md, (f) cross-tenant test stratejisi — active-plan follow-up'a kayıtlı.

---

### Bölüm 14 — Kritik Index'ler ve Ortak Konvansiyonlar

**Bağlam:** §6, §7, §8, §10, §11, §12, §13 boyunca tablolara özgü index kararları parçalı verildi (composite UNIQUE id+tenant_id, orders günlük unique, audit_logs üç index, soft-delete partial pattern, vb.). §14 bu kararları **index strategy** açısından konsolide eder; yeni domain kararı almaz, mevcutları **explicit-lock** eder + ortak konvansiyonları (naming, CONCURRENTLY, INCLUDE kararı) tek başlık altına bağlar. Migration sözdizimi §15 tool kararı sonrası yazılır — §14 yalnız **şablon kontratı** verir.

---

#### 14.1 Ortak konvansiyonlar — tüm tablolara uygulanır

**Karar 14.1.A — Naming şeması:**

İndex/constraint adı formu `<table>_<columns>[_partial-suffix]_<kind>` — `kind` ∈ `{uq, idx, pk, fk, ck}`. Örnekler:
- `orders_id_tenant_uq` — composite UNIQUE (id, tenant_id)
- `orders_tenant_store_date_order_no_uq` — günlük unique (§11.2)
- `orders_tenant_table_open_uq` — partial unique (§14.6)
- `audit_logs_tenant_created_idx` — bounded-log leading
- `products_tenant_active_idx` — partial soft-delete
- `customer_phones_tenant_normalized_uq` — full unique
- `print_jobs_status_created_idx` — archive cron

**Partial-suffix sözlüğü (kapalı liste):** *— Mini-pass A3, Session 18*
- `_active` = `WHERE deleted_at IS NULL` (soft-delete tabloları: `products`, `categories`, `customers`, `tables`).
- `_open` = `WHERE status NOT IN ('paid','cancelled')` (orders tek-aktif-masa partial unique).
- `_pending` = `WHERE status IN ('queued','printing','retry')` (print_jobs worker poll partial; forward-ref ADR-004).
- `_uq` = unique constraint/index, `_idx` = non-unique index, `_pk` = primary key, `_fk` = foreign key, `_ck` = check constraint.

**Kural:** Partial-suffix sözlüğü dışına çıkan ad PR'da BLOCKER (db-migration-guard gate). Yeni partial pattern eklenecekse §14.1.A güncellenir + mini-pass ADR atfı zorunlu — drift kaynağı yaratmamak için. §14.8 print_jobs aktif iş partial örneği bu sözlükle birlikte `_pending` suffix'ine bağlanır (eski "active" form drift, kullanılmaz). *— Mini-pass A3, Session 18*

**Yasak:** PG default ad (`<table>_<col>_key` / `<table>_<col>_idx`) MVP'de **kabul edilmez** — drift kontrolü ve PR review okunaklığı için adlandırma kontratı zorunlu. db-migration-guard `_key` veya isimsiz `CREATE INDEX` (PG'nin generated isim atadığı durum) eşleşmesinde BLOCKER.

**Trade-off:** Ad uzunluğu PG 63 karakter limitini aşmamalı; uzun tablo+kolon kombinasyonlarında kısaltma kuralı (örn. `category` → `cat`, `customer` → `cust`) `docs/engineering/db-conventions.md`'da listelenir (forward-ref §15 implementer turu).

**Karar 14.1.B — `CREATE INDEX CONCURRENTLY` zorunluluğu:**

Prod migration'larda **mevcut tabloya** index ekleyen tüm DDL `CREATE INDEX CONCURRENTLY` kullanır — lock-blocking index yaratımı yasak (sipariş alımını durdurur). 000_init seed migration **istisnadır** (boş tablo, ACCESS EXCLUSIVE bedeli yok).

Forward-ref §15 — migration tool seçimi `CONCURRENTLY` desteğini garantilemeli; transaction-içi DDL toolu (örn. tek BEGIN/COMMIT bloğu zorlayan) **reddedilir**, çünkü `CONCURRENTLY` transaction dışı çalışır.

**§14.1.B.1 — INVALID index retry policy (drift koruma):** *— Mini-pass A1, Session 18*

`CREATE UNIQUE INDEX CONCURRENTLY` failure halinde `INVALID` index bırakır; migration tool retry/rollback policy'si §15'te kilitlenir. Migration runner her başlangıçta `pg_index WHERE indisvalid = false` taraması yapar; INVALID kalmış index varsa migration BLOCKER (operatör runbook ile elle `DROP INDEX <name>` edip retry tetikler — sessiz "tekrar dene" yok). CONCURRENTLY retry'dan önce mutlaka `DROP INDEX IF EXISTS <name>` ile başlar — INVALID stack-up'a karşı sigorta. Forward-ref §15 (migration tool ADR'si) bu kontratı koda bağlar; tool seçimi bu policy'i destekleyemiyorsa reddedilir.

**§14.1.B.2 — CONCURRENTLY rol kontratı:** *— Mini-pass A6, Session 18*

DDL (CREATE INDEX dahil) yalnız `migrator` rolüyle (BYPASSRLS, §13) çalıştırılır — `app_admin` (sistem-actor viewer, §12.4) ile DDL **yasak**, operatör runbook'unda kilit. Drift koruma: db-migration-guard pre-commit hook DDL satırlarını `migrator`-only flag ile gate'ler. §15 migration tool ADR'si DDL gate'ini tanımlar; cron-spesifik DDL kuralları `docs/engineering/cron-conventions.md`'a düşer.

**§14.1.B.3 — Phase-conditional enforcement (Amendment 2026-04-27):** *— Phase 2 Sprint 3a Görev 14, Session 31*

§14.1.B kuralı **prensip olarak korunur** — `CREATE INDEX CONCURRENTLY` mevcut tabloya index ekleyen tüm DDL için zorunluluğu **kaldırılmaz, gevşetilmez**. Bu alt-bölüm kuralın **aktivasyonunu** koşullandırır: enforcement Phase 4 prod cutover hazırlığıyla birlikte aktive olur, Phase 0-3 dev ortamında SQL migration paterni `CREATE INDEX` (CONCURRENTLY'siz) **geçici olarak** kabul edilir.

**§14.1.B + §15.5 ilişkisi (netleştirme):** Bu iki madde farklı seviyelerde çalışır — §14.1.B **kuralı** (CONCURRENTLY zorunluluğu) tanımlar, §15.5 **enforcement mekanizmasını** (db-migration-guard parser-level grep + BLOCKER) tanımlar. §15.5 içindeki `000_init.sql` istisnası **parser-level whitelist**'tir (boş DB → lock-blocking riski yok, kalıcı istisna). §14.1.B.3 Phase-conditional enforcement bundan **ayrı bir istisna** değildir; aynı kuralın **aktivasyon zamanlamasını** koşullandırır — dev ortamı (Phase 0-3) lock-blocking riski yaratmaz, prod cutover'a (Phase 4) kadar enforcement gate'i kapalı kalır. İki istisnanın gerekçesi farklı (boş DB vs. dev ortamı), kapsamı farklı (kalıcı vs. geçici); birleştirilmez.

**Geçici izin — Phase 0-3 dev ortamı:**

- `packages/db/migrations/002_*.sql` — `004_*.sql` (ve Sprint 3a Görev 14 ile gelecek `005_*.sql`) `CREATE INDEX` SQL pattern'i CONCURRENTLY olmadan kullanır.
- **Gerekçe:** Phase 0-3 boyunca prod traffic yok — lock-blocking index yaratımı sipariş alımını durdurma riski yaratmıyor. §14.1.B'nin koruduğu sorun (peak saat ACCESS EXCLUSIVE ile masa açılamaması) bu fazda gerçek değil.
- **Sınır:** Bu izin **Phase 0-3 ile sınırlı**, Phase 4 prod cutover hazırlığıyla sona erer. Phase 4'te §14.1.B.3 hükmü kalkar, §14.1.B + §15.5 tam enforcement'a geçer.
- **Teknik gerekçe (paralel):** node-pg-migrate v7 SQL migration formatında `CONCURRENTLY` desteği yok (singleTransaction default true, parser directive yok). TS migration moduna geçiş `ts-node` + ESM + tsconfig migrations include + migrate script flag güncellemesi gerektirir — Phase 4 öncesi tek başına bir altyapı PR'ı olarak ele alınır (madde 4 İş #1).

**Aktivasyon planı — somut iş sıralaması:**

Phase 4 prod cutover öncesinde aşağıdaki üç iş tamamlanır. (a)/(b) opsiyonları ve (#1)/(#2) alternatifleri için final karar Phase 4 başında verilir (yeterli bilgi: smoke sonuçları, prod traffic profili, 002-005 index'lerinin gerçek lock-blocking değerlendirmesi o zaman olur).

| # | İş | Bağımlılık | Çıktı |
|---|---|---|---|
| 1 | TS migration infrastructure PR — `ts-node` dep ekle, ESM uyum + tsconfig migrations include + `--migration-file-language ts --ts-node` flag'leri `migrate` script'inde. | Tek başına merge edilebilir (Phase 4 öncesi). | Mevcut SQL migration'lar (000-004/005) regression yok smoke; TS migration `pgm.createIndex(..., { concurrently: true })` çağrısı çalışır kanıtı. |
| 2 | Migration runner değişimi değerlendirmesi — `umzug`, `dbmate`, `goose` gibi ESM-doğal + transaction control granular tool'lar. | İş #1'in alternatifi VEYA paralel inceleme. Karar: #1 smoke iyiyse #1 yeter; kötüyse #2'ye geçilir. | Tool seçim ADR (Phase 4 başı). |
| 3 | 002-005 migration'larındaki `CREATE INDEX` pattern'lerinin re-create kararı. | İş #1 veya #2 sonrası. | İki opsiyon Phase 4 başında değerlendirilir: **(a)** Yeni TS migration: her index için `DROP INDEX <name>; CREATE INDEX CONCURRENTLY <name> ...` — forward-only korunur (§15.3.A "Hot-fix forward N+1"), mevcut 002-005 SQL migration'ları dokunulmaz. **(b)** Runner #2 ile değiştirildiyse runner'ın migration tarihini sıfırlamadan işlevi tekrar çalıştırması (eğer destekliyorsa). |

**db-migration-guard CI check Phase 4 ile aktive olur:**

§15.5 parser-level grep kuralı (CREATE INDEX without CONCURRENTLY → BLOCKER) bugün **CI'de check olarak çalışmıyor** — 000_init.sql üst yorumunda "db-migration-guard enforced" iddiası sözleşme niyetidir, mevcut runtime gate yoktur (Phase 0-3 boyunca sistemik drift kaynağı bu eksiklik). Phase 4 aktivasyonuyla birlikte:

- CI workflow'a §15.5 regex check eklenir: `CREATE\s+(UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)\s+` eşleşmesi → migration reddedilir.
- Whitelist: `000_init.sql` (§15.5 mevcut istisnası).
- 002-005 dosyalarının CI check'ten geçmesi için **iki opsiyon, karar Phase 4 başında:**
  - **(a)** İş #3 (a) yolu seçilirse: 002-005 eski dosyalar regex check'ten geçemez ama yeni TS forward migration index'leri CONCURRENTLY ile yeniden yaratır. Eski dosya adlarını whitelist'e ekle (`002_add_refresh_tokens.sql`, `003_users_add_email.sql`, `004_categories_unique_name.sql`, `005_orders_add_waiter_user_id.sql`) — bunlar Phase 0-3 grandfathered (bu metnin bağlamında "grandfathered" parser whitelist anlamında, politika gevşetmesi değil).
  - **(b)** Runner #2 yolu seçilirse: yeni runner pgmigrations tarihini koruyarak işlevi tekrar yürütüyorsa eski dosyalar zaten dokunulmaz — CI gate Phase 4 cutover sonrasında aktive olur (yalnız yeni migration'lar denetlenir).

**Forward-ref:** v5.1+ multi-tenant onboarding ADR'si **(henüz yazılmamış)** — yeni tenant onboarding sırasında lock-blocking riski test edilir; §14.1.B Phase 4 enforcement'ından sonra bu ADR'nin yazımıyla birlikte multi-tenant index pattern'leri pin'lenir.

**Cross-ref:** §14.1.B (kural metni — değişmez), §15.5 (parser-level enforcement, 000_init istisnası), §15.3.A (Hot-fix forward N+1 — İş #3 (a) opsiyonu uyumlu), ADR-008 (Phase 4 prod cutover Sprint zinciri — forward-ref).

**Karar 14.1.C — INCLUDE (covering index) kararı:**

`INCLUDE` (PG 11+ covering index) **default kapalı** — yalnız aşağıdaki üç koşulun **hepsi** sağlanırsa kullanılır:
- (1) Sorgu pattern'i `EXPLAIN`'de Index Only Scan'e dönüşüyor (heap fetch eliminasyonu ölçülebilir).
- (2) Eklenecek INCLUDE kolonu nadiren UPDATE ediliyor (write amp kabul edilebilir).
- (3) Toplam index satır boyutu page'in (8KB) yarısını geçmiyor.

MVP'de **hiçbir tabloda INCLUDE yok** — pilot ölçüm sonrası rapor query'leri için değerlendirilir (forward-ref `docs/engineering/index-tuning.md`, Phase 1+).

**Gerekçe:** Premature optimization; INCLUDE write amp + bytes maliyeti taşır, EXPLAIN ölçümü olmadan kararı alamayız.

**Karar 14.1.D — Composite UNIQUE id+tenant_id (§6.5 konsolide):**

Her business tablosunda (`orders`, `order_items`, `payments`, `customers`, `customer_phones`, `tables`, `products`, `categories`) ek UNIQUE constraint `(id, tenant_id)` mevcut — §6.5 zaten kuralı koydu. §14 angle'ı: bu **constraint**'tir (UNIQUE constraint → arka planda UNIQUE INDEX), saf "index" değil; FK target rolü oynar (composite FK kompozit hedef gerektirir, §6.5.A).

- `users` tablosu için kapsam ADR-002 auth kararına bağlı (forward-ref).
- `order_no_counters` muaf (§11.7 — surrogate id yok, FK source/target değil).
- `tenants` muaf (referans tablosu, multi-tenant'ın kendisi).
- Bu UNIQUE'lere ek standalone `tenant_id` index gerekmez — composite leftmost-prefix `WHERE tenant_id=?` sorgusunu karşılar; yine de iş kuralına özel composite (ör. `(tenant_id, store_date, order_no)`) gerekirse ayrı tanımlanır.

**Yasak:** `(tenant_id, id)` sıralaması (id-leading) §6.5 ile çelişir — `(id, tenant_id)` zorunlu, çünkü `id` UUID (uuidv7) zaten yüksek kardinalite ve constraint UNIQUE olarak çalışsın diye id-first yazılır. Tenant filtresi composite'in ikinci kolonundan gelir.

**Cross-ref:** §6.5 (composite UNIQUE kuralı), §11.6 (orders muafiyet doğrulaması), ADR-002 (users kararı, forward-ref).

---

#### 14.2 `orders` — günlük unique + tek aktif masa partial

**Karar 14.2.A — `(tenant_id, store_date, order_no) UNIQUE` çift-rol (§11.2 konsolide):**

§11.2 stored generated column `store_date` üzerinde UNIQUE INDEX `orders_tenant_store_date_order_no_uq` tanımlandı. §14 bu index'in **iki rol** oynadığını lock'lar:
- (1) **Unique scope**: günlük order_no benzersizliği (§11.1 X′ çözümü).
- (2) **Rapor leading prefix**: `WHERE tenant_id=? AND store_date=?` (günlük rapor, kasiyer "bugünkü siparişler") leftmost-prefix kullanır → ek `(tenant_id, store_date)` index gereksiz.

**Trade-off:** Üçlü composite ile ikili filter sorgusu Index Range Scan'a düşer (tüm `order_no` değerleri tarana**maz** — leftmost iki kolon eşleşmesi yeter, üçüncü kolon serbest). pilot ölçüm `EXPLAIN` ile doğrulanır; ek `(tenant_id, store_date)` standalone index **eklemez** (write amp'i artırır, fayda yok).

**Yasak:** `(tenant_id, store_date)` üzerinde standalone `idx` eklemek — leftmost-prefix yeterli; ekleme PR BLOCKER.

**Karar 14.2.B — Tek masa = tek açık adisyon partial unique:**

```
CREATE UNIQUE INDEX orders_tenant_table_open_uq
  ON orders (tenant_id, table_id)
  WHERE status NOT IN ('paid', 'cancelled');
```

Restoran kuralı: bir masada aynı anda yalnız bir açık adisyon olabilir. Partial filter `status NOT IN ('paid','cancelled')` `'open' / 'sent_to_kitchen' / 'served'` durumlarını kapsar — her status eklendiğinde whitelist (negative form) güncellenir.

**Edge case — takeaway/delivery:** `table_id NULL` (takeaway/delivery) → partial unique muafiyeti, DB seviyesinde aynı tenant için N paket sipariş eş zamanlı açılabilir. Bu DB davranışı kasıtlı: partial filter masa-bazlı tek-aktif kuralını kapsar, masasız siparişler bu kuralın dışındadır (pozitif form `WHERE table_id IS NOT NULL` muafiyeti açıkça tanımlar). Pilot restoranda eş zamanlı paket girişi operasyonel olarak yok (§14.2.B A4) — DB muafiyeti pratikte tetiklenmez. Domain-side duplicate guard ihtiyacı v5.1 (A4). Migration yorumunda explicit not olarak yazılır.

**Takeaway duplicate-prevention (v5.1 backlog):** Pilot restoranda paket girişi tek noktadan yapılır (%90 kasiyer ana bilgisayar / %10 garson mobil, eş zamanlı değil); duplicate sipariş vakası yaşanmamış. Sistem-level guard MVP kapsamı dışı. v5.1'de çok-kasiyer/çok-garson ortamları için idempotency key veya domain-side guard değerlendirmesi §10 takeaway state machine ADR'sinde yapılır — bu §14 kapsamı dışı. *— Mini-pass A4, Session 18 (kullanıcı gözlemi: eş zamanlı giriş yok)*

**Yasak:** `WHERE status = 'open'` formu (yalnız tek status) — `sent_to_kitchen` durumundaki sipariş için ikinci adisyon açılmasına izin verir; pozitif liste değil **negatif liste** (`NOT IN ('paid','cancelled')`) kullanılır.

**Trade-off:** Negative liste yeni status eklendiğinde manuel revize gerektirir; pozitif liste `IN (...)` whitelist disiplinli ama `served` gibi nadir status'lar atlanırsa hatalı veri yaratır. Negative + db-migration-guard PR gate `orders.status` enum genişletmesinde §14.2.B partial filter güncel mi sorusunu otomatik check eder (forward-ref).

**Cross-ref:** §6.2 (UNIQUE tenant_id prefix), §11.2 (günlük unique), §10 (orders status state machine).

---

#### 14.3 `audit_logs` ve `call_logs` — bounded-log leading column

**Karar 14.3.A — `(tenant_id, created_at DESC)` leading column (§12 + §13 konsolide):**

Bounded-log tabloları (`audit_logs`, `call_logs`) için leading column kararı **`tenant_id`** — §13.2 cron tenant-loop pattern'i bu index'in leftmost prefix'ini kullanır. Alternatif `(created_at DESC, tenant_id)` reddedildi — multi-tenant filtreli sorgular (audit viewer, KVKK tenant export) seq scan'e düşer.

**Cron purge pattern uyumu:** `WHERE tenant_id = $1 AND created_at < $2` cron her batch'i index range scan ile çalışır; tek seq scan **yok** (§13.2.C BLOCKER kuralı).

**DESC index ASC sorgu uyumu:** PG backward index scan ASC sorgular için DESC index'i eşit maliyetle kullanır; her iki sıra için ayrı index gereksiz. Audit viewer ASC kronolojik query'si (`ORDER BY created_at ASC`) `(tenant_id, created_at DESC)` index üzerinden backward scan ile çalışır → performans regresyon **değil**, ek `(tenant_id, created_at)` ASC index önerisi BLOCKER (write amp 2x, fayda yok). *— Mini-pass A2, Session 18*

**`(created_at, tenant_id)` reddi:** Tek tenant pilotunda fark görünmez; multi-tenant'ta tenant başı sorgu lineer-zaman değil O(table_size) olur. Ek olarak RLS açıldığında (§13.5 v5.2) `current_setting('app.tenant_id')::uuid` filter'ı leading column'a denk gelmeli — RLS policy + index uyumu zorunlu (§14 review-gate security maddesi).

**Yasak:** `audit_logs` veya `call_logs` üzerinde `created_at` standalone index — `(tenant_id, created_at DESC)` leftmost prefix tek-tenant filtre + sıralama için yeterli; ek index write amp.

**Karar 14.3.B — `audit_logs` üç-index kontratı (§12.2 explicit-lock):**

§12.2 üç index tanımladı; §14'te explicit-lock — değiştirilmesi mini-pass ADR gerektirir:

| # | Index | Pattern |
|---|---|---|
| (i) | `audit_logs_tenant_created_idx (tenant_id, created_at DESC)` | Zaman-temelli listeleme + cron purge leading |
| (ii) | `audit_logs_tenant_event_created_idx (tenant_id, event_type, created_at DESC)` | Tip-filtreli rapor (`WHERE tenant_id=? AND event_type LIKE 'order.%'`) |
| (iii) | `audit_logs_tenant_entity_idx (tenant_id, entity_type, entity_id) WHERE entity_id IS NOT NULL` | "Bu siparişin tüm audit kayıtları" — partial, NULL entity hariç |

**(ii) için INCLUDE alternatifi reddedildi:** `(tenant_id, created_at DESC) INCLUDE (event_type)` covering index düşünüldü ama §14.1.C üç-koşul karşılanmadığı için reddedildi — `event_type` filter `LIKE 'group.%'` prefix scan kullanır, INCLUDE kolonu üzerinde range scan yapamaz; dedicated composite `(tenant_id, event_type, created_at DESC)` zorunlu.

**4. index eklenmedi (§13.2 explicit-lock):** `event_type` filter sorgusu için ayrı bir partition-style index önerildi — reddedildi. Üç index write amp 3x; 4. index 4x'e çıkarır, fayda marjinal (rapor sorguları cron olmayan, on-demand). Bu karar §14'te **kilit** — yeni audit query pattern'i için index önerisi geldiğinde öncelikle mevcut üçten birinin yeterli olup olmadığı (EXPLAIN) sorulur, ardından mini-pass ADR.

**Sistem-actor NULL satırlar index davranışı:** Sistem-actor satırlar (`tenant_id IS NULL`, §13.5) `(tenant_id, created_at DESC)` index'inin NULL-ucu üzerinden range scan ile bulunur (PG B-tree NULL'ları sona koyar, planner NULL eşitliğini index seek ile çözer). `findSystemEvents` repository (admin-only, §12.4) bu pattern'i kullanır; ek partial `WHERE tenant_id IS NULL` index gereksiz — bounded set (cron self-audit + system-init), tablo scan kabul. *— Mini-pass A5, Session 18*

**Karar 14.3.C — `call_logs` leading column:**

`call_logs` (§13.1.B + KVKK Sinyal #40) bounded-log + 30g retention; index kontratı:
- `call_logs_tenant_created_idx (tenant_id, created_at DESC)` — cron purge leading + müdür "son 30 gün arayanlar" listesi.

`call_logs` şeması Phase 0'da tanımlı; ek phone-based lookup index ihtiyacı **v5.1 KVKK DSAR ADR'si tetikleyicisidir** — DSAR ADR `(tenant_id, normalized_phone, created_at DESC)` composite index'ini tanımlar (forward-ref, §14 B3 follow-up). MVP'de tek index yeterli.

**Cross-ref:** §12.2 (audit_logs şema), §13.2 (cron tenant-loop), §13.5 (RLS policy şablonu), v5.2 RLS ADR (forward-ref).

---

#### 14.4 `order_no_counters` — ek index yok (§11 explicit-lock)

**Karar 14.4 — PK yeterli, standalone tenant_id index yasak:**

`order_no_counters` PK `(tenant_id, business_date)` composite. Sorgu pattern'i tek satır lookup `WHERE tenant_id=? AND business_date=?` + ON CONFLICT DO UPDATE — PK üzerinden çalışır.

- Ek standalone `tenant_id` index **gereksiz**: PK leftmost-prefix `WHERE tenant_id=?` sorgusunu (örn. tenant'ın tüm geçmiş günleri) karşılar; rapor sorgu pattern'i bu tabloda yok (§11 backfill forward-ref hariç).
- §6.5 composite UNIQUE id+tenant_id muafiyeti (§11.6.4) — surrogate `id` kolonu yok.
- §14.1.D ile çelişmez: muafiyet §11.6.4'te explicit yazılı.

**Yasak:** `order_no_counters` üzerinde herhangi bir ek index PR BLOCKER — gerekçe migration yorumunda yazılı olmalı; aksi halde drift.

**Cross-ref:** §11.3 (sayaç şeması), §11.6.4 (§6.5 muafiyet doğrulaması), §11.7 (review-gate).

---

#### 14.5 Soft-delete partial index pattern

**Karar 14.5.A — Hangi tablolarda partial, hangilerinde değil:**

§8 soft-delete tabloları → katalog/master data:
- `products` — partial **var**: `products_tenant_active_idx ON (tenant_id, name) WHERE deleted_at IS NULL` (ürün listesi sık sorgu).
- `categories` — partial **var**: `categories_tenant_active_idx ON (tenant_id, sort_order) WHERE deleted_at IS NULL`.
- `customers` — partial **var**: `customers_tenant_active_idx ON (tenant_id, name) WHERE deleted_at IS NULL`.
- `tables` — partial **var**: `tables_tenant_active_idx ON (tenant_id, code) WHERE deleted_at IS NULL`.

Partial filter `WHERE deleted_at IS NULL` aktif satırlar için index'i küçültür + planner'ı doğru tablo üzerine yönlendirir. Soft-delete edilen satırlar (genelde küçük yüzde) index'te yer kaplamaz.

**Snapshot tablolarında partial yok:** §7 snapshot pattern'i (`order_items.product_name`, `category_name_snapshot`) immutable — soft-delete bu tablolarda anlamsız (rapor query'leri snapshot'tan okur). `order_items` ve `payments` üzerinde `deleted_at` kolonu **yok** → partial pattern bu tablolarda uygulanmaz.

**Yasak — `customer_phones`:**

`customer_phones` üzerinde **partial UNIQUE yasak** — §6.2 + §8.3 hibrit kararı: telefon UNIQUE'i tam (`customer_phones_tenant_normalized_uq ON (tenant_id, normalized_phone)`) + müşteri silindiğinde phone satırı **hard delete** (CASCADE). Partial `WHERE deleted_at IS NULL` koymak iki risk yaratır:
- (1) Soft-delete edilmiş müşterinin telefonu yeni müşteriye atanırsa rapor history bozulur (caller-id "bu numara hangi müşteri" sorgusunda iki cevap çıkar).
- (2) `customer_phones` tablosunda `deleted_at` kolonu yok (§8.3) — partial filter referans bulamaz.

db-migration-guard `customer_phones` üzerinde `WHERE deleted_at` partial pattern eşleşmesinde BLOCKER.

**Karar 14.5.B — Snapshot kolonları üzerinde rapor index'leri:**

§7 snapshot kolonları zaten denormalize → rapor query'leri GROUP BY üzerinden çalışır. MVP'de iki rapor index'i tanımlanır:
- `order_items_tenant_product_idx ON (tenant_id, product_name)` — top-selling rapor.
- `order_items_tenant_category_idx ON (tenant_id, category_name_snapshot)` — kategori cirosu rapor.

Trade-off: rapor sorguları cron'lanmış değil, kullanıcı talep ettiğinde (haftalık/aylık) çalışır → write amp kabul edilebilir; index olmadan tablo seq scan (10K+ satır pilot ay sonu).

**Forward-ref:** `EXPLAIN` ölçümü Phase 1 sonrası `docs/engineering/index-tuning.md`'da; gereksiz çıkarsa `IF EXISTS` migration ile DROP. p95 INSERT-time eşiği `docs/engineering/index-tuning.md`'da kilitlenir; eşik aşımında index DROP, rapor query tablo-level scan'e döner — kabul.

**Cross-ref:** §8 (soft-delete), §7 (snapshot pattern), §6.2 (customer_phones tam unique), §8.3 (phone hard delete).

---

#### 14.6 `payments` — split + comp trigger context

**Karar 14.6 — Çoklu split satır + trigger uyumlu index:**

§10 `payments` tablosu çoklu satır pattern'i (split payment: bir sipariş N parçaya bölünebilir, her parça ayrı satır). `payments_block_comped_insert` trigger'ı (§10) sipariş zaten comped ise yeni payment INSERT'ini reddeder. Trigger `WHERE order_id = NEW.order_id` lookup yapar.

Index kontratı:
- `payments_tenant_order_idx ON (tenant_id, order_id)` — trigger lookup + sipariş bazlı toplam hesabı (`SUM(amount) GROUP BY order_id`).
- `payments_id_tenant_uq` — §6.5 composite UNIQUE (her business tablosu).

**Partial unique YOK:** `payments` üzerinde "bir sipariş başına bir comp satırı" gibi partial unique **eklenmez** — comp business kuralı (§10) state-machine + trigger ile enforce edilir, index katmanı değil. Trigger ve index sorumluluğu ayrı tutulur (§10 trade-off explicit lock'lu).

**Yasak:** `payments(payment_type)` standalone index — kardinalite düşük (3-4 değer), bitmap scan zaten yeterli; standalone bytes maliyeti fayda vermiyor.

**Cross-ref:** §10 (payments state machine + trigger), §6.5 (composite UNIQUE).

---

#### 14.7 `customer_phones` — tam UNIQUE + hard-delete pattern (§6.2 + §8.3 explicit-lock)

**Karar 14.7 — Drift koruma:**

`customer_phones_tenant_normalized_uq ON (tenant_id, normalized_phone)` **tam** UNIQUE (partial yok, `deleted_at` filter yok). §14.5.A yasağı + §8.3 hard delete kararıyla tutarlı.

- Caller-ID lookup `SELECT customer_id FROM customer_phones WHERE tenant_id=? AND normalized_phone=?` index seek; O(1).
- Müşteri soft-delete edildiğinde `customer_phones` satırları **hard delete** (CASCADE veya app-side). Telefon recycle (yeni müşteriye atama) drift değil — hard delete ile zaten boşalmış.

**Yasak:**
- Partial `WHERE deleted_at IS NULL` — §14.5.A explicit yasak.
- `normalized_phone` standalone unique (tenant prefix yok) — §6.2 ile çelişir, BLOCKER.

**Cross-ref:** §6.2 (UNIQUE tenant prefix), §8.3 (phone hard delete kararı), §14.5.A (yasağın bağı).

---

#### 14.8 `print_jobs` — archive cron index'i (forward-ref ADR-004)

**Karar 14.8 — `(status, created_at)` composite + ADR-004 detayı:**

§13.6 print_jobs archive retention (7g success / 30g failed) cron task'ı için index gerekli. §14 angle'ı: index'i kayda al, detay ADR-004 print-agent'a bırak.

- `print_jobs_tenant_status_created_idx ON (tenant_id, status, created_at)` — cron `WHERE tenant_id=? AND status IN ('success','failed','cancelled') AND created_at < cutoff` pattern'i için.
- Aktif iş listesi (`status IN ('queued','printing','retry')`) için ayrı partial: `print_jobs_pending_idx ON (tenant_id, created_at) WHERE status IN ('queued','printing','retry')` — print-agent worker poll sorgusu. (Suffix `_pending` §14.1.A partial-suffix sözlüğüne uyumlu; eski `_active` form drift, kullanılmaz. *— Mini-pass A3, Session 18*)

**Detay ADR-004'te:** Kolon listesi, status enum tam tanımı, status_history tablosu, idempotency key index'i (örn. `print_jobs_idem_uq`) — bunlar §14 kapsamı dışı; ADR-004 kararının vermesi gereken kalemler.

**Forward-ref:** ADR-004 print-agent ADR'si (henüz yok). §14.8 yalnız retention cron'u destekleyen index pattern'ini lock'lar.

**Cross-ref:** §13.6 (print_jobs retention), ADR-004 (print-agent, forward-ref).

---

#### 14.9 RLS uyumu — index leading column kontratı

**Karar 14.9 — RLS policy + index leftmost-prefix uyumu (§13.5 forward-ref):**

v5.2 RLS açıldığında her tablo için policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)` formunda olur — bu filter index leftmost prefix `tenant_id` ile **uyumlu** olmalı, aksi halde her sorgu seq scan + filter (DoS yüzeyi).

**Kontrat:**
- Tüm UNIQUE/INDEX'ler ilk kolon olarak `tenant_id` taşır (§6.2 + §14.1.D zaten kuralı koydu).
- RLS policy filter'ı index leading column'a **birebir denk gelir** — drift kontrolü §15 migration tool review-gate'inde.
- Bypass yolu yok: `app_tenant` rolü RLS'e tabi; `cron_purger` BYPASSRLS (§13.5) — uygulama kullanıcısı policy'i atlayamaz.

**Yasak:**
- RLS policy `OR tenant_id IS NULL` formu **yalnız** `audit_logs` admin scope'unda (§13.5.A policy 2); diğer tablolarda BLOCKER.
- Index leading column `created_at` veya başka kolon olan tablo RLS açıldığında **performance regression** — §14.3.A reddi bu yüzden kilit.

**Cross-ref:** §13.5 (audit_logs RLS policy şablonu), §6.4 (RLS off MVP), v5.2 RLS ADR (forward-ref).

---

#### 14.10 Review-gate checklist

**Bölüm A — db-migration-guard maddeleri (primary):**

- [ ] **Composite UNIQUE id+tenant_id (§14.1.D + §6.5)**: Her business tablosunda `<table>_id_tenant_uq` constraint mevcut; muafiyet (`order_no_counters`, `tenants`) migration yorumunda gerekçeli.
- [ ] **Naming kontratı (§14.1.A)**: Tüm yeni index/constraint adı `<table>_<columns>[_partial-suffix]_<kind>` formuna uygun; PG default ad (`_key` suffix, isimsiz CREATE INDEX) eşleşmesi yok. PG 63 karakter limit kontrol.
- [ ] **CONCURRENTLY zorunlu (§14.1.B)**: Mevcut tabloya index ekleyen migration `CREATE INDEX CONCURRENTLY` kullanıyor; 000_init istisnası dışında lock-blocking DDL yok.
- [ ] **INCLUDE default kapalı (§14.1.C)**: Yeni index'te INCLUDE kullanımı varsa üç-koşul gerekçesi (Index Only Scan ölçümü + nadiren UPDATE + page boyutu) PR açıklamasında yazılı; aksi halde reddedilir.
- [ ] **`orders` günlük unique çift-rol (§14.2.A)**: `(tenant_id, store_date, order_no)` UNIQUE INDEX `orders_tenant_store_date_order_no_uq` adıyla mevcut; ayrı `(tenant_id, store_date)` standalone idx **yok** (eklenmişse BLOCKER).
- [ ] **`orders` partial unique (§14.2.B)**: `orders_tenant_table_open_uq ON (tenant_id, table_id) WHERE status NOT IN ('paid','cancelled')` formu birebir; pozitif liste (`WHERE status='open'`) BLOCKER.
- [ ] **`orders.status` enum genişlemesi**: Yeni status değeri eklendiğinde §14.2.B partial filter `NOT IN (...)` listesi güncel mi sorusu açıkça cevaplanmış (PR açıklamasında).
- [ ] **`audit_logs` üç-index lock (§14.3.B)**: Birebir üç index ((i)/(ii)/(iii)) tanımlı; 4. index önerisi varsa mini-pass ADR referansı zorunlu.
- [ ] **`call_logs` tek index (§14.3.C)**: `call_logs_tenant_created_idx` mevcut; ek index v5.1 admin viewer ADR'si olmadan eklenmez.
- [ ] **Bounded-log leading column (§14.3.A)**: `audit_logs` ve `call_logs` üzerinde `created_at` standalone index **yok**; `(tenant_id, created_at DESC)` leading composite tek leading index.
- [ ] **`order_no_counters` ek index yok (§14.4)**: PK dışında index yok; eklenmişse migration yorumunda gerekçe + ADR mini-pass referansı zorunlu, aksi halde BLOCKER.
- [ ] **Soft-delete partial pattern (§14.5.A)**: `products` / `categories` / `customers` / `tables` üzerinde aktif satır rapor index'leri partial `WHERE deleted_at IS NULL` formuna uygun; snapshot tablolarında (`order_items`, `payments`) partial yok.
- [ ] **`customer_phones` partial yasağı (§14.5.A + §14.7)**: `WHERE deleted_at IS NULL` partial filter yok; tam UNIQUE `(tenant_id, normalized_phone)`.
- [ ] **`payments` index kontratı (§14.6)**: `payments_tenant_order_idx (tenant_id, order_id)` mevcut; `payment_type` standalone idx yok; comp business kuralı index ile değil trigger ile enforce.
- [ ] **`print_jobs` index forward-ref (§14.8)**: `print_jobs_tenant_status_created_idx` + `print_jobs_pending_idx` partial pattern'leri ADR-004 hazır olduğunda eklenecek; MVP migration'ında schema-only yer tutucu. (`_pending` suffix §14.1.A sözlüğüne uyumlu.)
- [ ] **Snapshot rapor index'leri (§14.5.B)**: `order_items_tenant_product_idx` + `order_items_tenant_category_idx` Phase 1 rapor sürümünde tanımlı; `EXPLAIN` ölçümü `docs/engineering/index-tuning.md`'a yazılacak (forward-ref).
- [ ] **`docs/engineering/db-conventions.md` kısaltma sözlüğü**: PG 63 karakter limit aşımına yol açan tablo+kolon kombinasyonları için kısaltma kuralı yazılmış (§14.1.A trade-off; forward-ref §15 implementer turu).
- [ ] **§15 migration tool seçimi `CONCURRENTLY` desteği**: Tool transaction-içi DDL zorlamıyor; `INVALID` index retry/rollback policy'si tool seçim ADR'sinde belgeli.

**Bölüm B — security-reviewer maddeleri (secondary):**

- [ ] **RLS policy + index leading column uyumu (§14.9)**: v5.2 RLS açılışında her tablo için policy `tenant_id` filter'ı index leftmost prefix'iyle birebir; uyumsuzluk seq scan + DoS yüzeyi → BLOCKER.
- [ ] **`audit_logs` policy `OR tenant_id IS NULL` kapsamı**: Yalnız §13.5.A admin scope policy'sinde; diğer tablolarda eşleşme **yok**.
- [ ] **Bounded-log leading column güvenlik açısı (§14.3.A)**: `(tenant_id, created_at DESC)` form RLS uyumlu; `(created_at, tenant_id)` reddi v5.2 RLS açılışı için kritik (cross-tenant data leak yüzeyi yok).
- [ ] **`customer_phones` PII drift koruması (§14.7)**: Tam UNIQUE + hard delete pattern KVKK uyumlu; soft-delete edilmiş müşteri telefonu yeni müşteriye atanırsa rapor history bozulmaz (recycle test senaryosu §6.3 cross-tenant test stratejisinde).
- [ ] **Index leading column tek-tenant pilot regression yok**: Tek tenant pilotunda `(tenant_id, ...)` leading column fark görünmez; multi-tenant açılışta lineer-zaman değil O(table_size) regression olmadığı `EXPLAIN` ile doğrulanır.
- [ ] **`cron_purger` BYPASSRLS rol bypass yüzeyi (§13.5)**: BYPASSRLS rolü cross-tenant DELETE serbest; uygulama API'si bu rolü kullanamaz (env ayrımı `CRON_DATABASE_URL`); §14 index kararları RLS bypass yolu yaratmıyor.
- [ ] **Audit `event_type` filter regex CHECK + index uyumu (§14.3.B (ii))**: `LIKE 'order.%'` prefix scan `(tenant_id, event_type, created_at DESC)` composite ile uyumlu; full-text search index önerisi gelirse ayrı ADR.
- [ ] **`customer_phones` rate-limit + index seek O(1)**: Caller-ID flood saldırısı için index seek O(1) yeterli; partial filter saldırı yüzeyi yaratmıyor (§14.7 explicit lock).
- [ ] **Forward-ref kayıtları**: §14.8 ADR-004 print_jobs detay, §14.5.B `index-tuning.md`, §14.1.A `db-conventions.md` kısaltma sözlüğü, §14.9 v5.2 RLS ADR — active-plan follow-up'a kayıtlı.

---

### Bölüm 15 — Migration Stratejisi — Forward-Only + Tool Seçimi

#### 15.1 Tool seçimi — pre-locked

**Karar 15.1 — `node-pg-migrate` (runner) + `kysely` (query builder) + `kysely-codegen` (TS tip üretimi):**

v5 boyunca tek tool kombinasyonu kilitlenir. Üç sorumluluk üç ayrı paket:

| Sorumluluk | Tool | Komut |
|---|---|---|
| Migration runner | `node-pg-migrate` | `pnpm db:migrate` |
| Runtime query builder | `kysely` | (uygulama runtime'ı) |
| TS tip üretimi (DB → kod) | `kysely-codegen` | `pnpm db:codegen` |

**Neden bu üçlü:**

- Ham SQL migration'ları (`.sql` dosyası) — DBA okunabilir, no DSL overhead, copy-paste ile psql'de çalıştırılabilir (debugging).
- `node-pg-migrate` `CONCURRENTLY` doğal destekli (transaction-outside mode); §14.1.B kuralı tool ile uyumlu.
- `pgmigrations` tablosu basit yapılı (`id`, `name`, `run_on`); elle inceleme + manuel düzeltme mümkün (ama yasak — §15.6).
- `kysely` runtime query builder; migration runner'dan **tamamen ayrı** sorumluluk → versiyon çakışması yok.
- `kysely-codegen` DB introspection ile `packages/db/schema/generated.ts` üretir → şema-vs-kod drift CI gate'i (§15.3).

**`pgmigrations` tablo şeması (node-pg-migrate default):**

```sql
CREATE TABLE pgmigrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  run_on TIMESTAMP NOT NULL
);
```

**Cross-ref:** §9.5.c (forward-only kural temeli), §14.1.B (`CONCURRENTLY` zorunluluğu), §13.5 (migrator rolü).

---

#### 15.2 Alternatif redleri

**Reddedilen 1 — `drizzle-kit`:**

- Introspection-first workflow: `drizzle-kit push` schema drift'i otomatik yakalar ve migration üretir → forward-only disiplinle çelişir (geliştirici şemayı değiştirir, tool migration üretir; manuel review yüzeyi düşer).
- Migration dosyaları Drizzle internal format'ında (JSON snapshot + ham SQL karışımı) — DBA review zorlaşır, psql'de copy-paste çalışmaz.
- `CONCURRENTLY` desteği sınırlı: index ekleme işlemlerinde otomatik `CONCURRENTLY` yok, özel handler gerekir.
- `kysely` ile aynı anda kullanmak tip çoğaltması yaratır (Drizzle ORM kendi tip sistemini dayatır).

**Reddedilen 2 — `prisma-migrate`:**

- Prisma schema (`.prisma`) ayrı DSL → tek truth source ilkesini kırar (migration SQL + `.prisma` dosyası çift bakım yükü).
- Prisma runtime stack'a girer — `kysely` yerine Prisma Client kullanmak zorunda kalırız (§15.1 ile çelişir).
- `CONCURRENTLY` **desteklemiyor** — Prisma migrate transaction içinde DDL çalıştırır; `CREATE INDEX CONCURRENTLY` PostgreSQL transaction içinde yasak (§14.1.B BLOCKER).
- Shadow database mekanizması ek operasyonel karmaşıklık + dev makinesinde ikinci PG instance.

**Karar gerekçesi (özet):** v5 mimarisinde DDL = manuel-yazılmış SQL + insan review; otomatik schema generation forward-only + cerrahi değişiklik ilkesini bozar. `node-pg-migrate` minimum magic, maksimum şeffaflık.

**Cross-ref:** Core directive #7 (cerrahi değişiklik), §9.5.c (forward-only).

---

#### 15.3 Forward-only enforcement — `down` yazılmaz

**Karar 15.3 — `down` migration **dosyası yazılmaz**, runner only-up mode'da çalışır:**

§9.5.c "forward-only" temel kuralını bu bölüm uygulama detayıyla genişletir:

- **Migration dosyası kuralı:** Her `.sql` dosyası **yalnız** `-- Up Migration` bölümü içerir. `-- Down Migration` bölümü **yazılmaz** (boş bırakılırsa node-pg-migrate `down` runner çağrıldığında no-op'tur — ama prod'da çağrılmaz, §15.3.B).
- **Kontrat:** Geri alma yok, zaten gönderilmiş migration'ı düzeltmek için **forward migration N+1** yazılır.

**Karar 15.3.A — Hot-fix pattern: forward migration N+1:**

Production'da çalışmış bir migration hata yarattıysa:
1. Yeni timestamp'li migration dosyası açılır (`YYYYMMDD_HHMM_fix_<önceki>.sql`).
2. Düzeltici SQL forward yönde yazılır (örn. `DROP INDEX <bozuk>;` + `CREATE INDEX CONCURRENTLY <doğru>;`).
3. PR review → merge → `pnpm db:migrate` → `pgmigrations` tablosuna yeni satır.

**Geri alma yok:** N. migration `pgmigrations` tablosundan silinmez; "düzeltildi" bilgisi git history + PR linkinde.

**Karar 15.3.B — `node-pg-migrate down` runner prod'da yasak:**

- node-pg-migrate `pnpm node-pg-migrate down` komutu mevcut (tool feature) — ama **prod'da çalıştırılmaz**.
- `package.json` script bu komutu **expose etmez**; sadece `db:migrate:dev-reset` lokal-dev script'i içinde kullanılır (§15.6).
- DBA console kuralı (§15.5): operatör doğrudan `node-pg-migrate down` çağıramaz; tek geçerli yol forward migration N+1.

**Cross-ref:** §9.5.c (forward-only temel kural), §13.6 (cron retention forward-only delete pattern).

---

#### 15.4 Drift detection — CI gate kuralları

**Karar 15.4 — Üç drift gate'i ADR-001 CI workflow'unda implement edilir:**

Bu ADR yalnız **kuralı tanımlar**; CI job tanımı (GitHub Actions step) ADR-001'de yazılır (aynı §9.5.c cross-ref pattern'i).

**Karar 15.4.A — INVALID index taraması (§14.1.B forward-ref kapatma):**

CI step: aşağıdaki sorgu **0 satır** dönmeli, aksi halde job FAIL.

```sql
SELECT i.indexname, i.tablename
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_index idx ON idx.indexrelid = c.oid
WHERE NOT idx.indisvalid;
```

**Senaryo:** `CREATE INDEX CONCURRENTLY` başarısız (lock timeout, deadlock) → PG `INVALID` index bırakır. §14.1.B retry policy: rollback **değil**, drop + retry forward migration:

```sql
-- YYYYMMDD_HHMM_drop_invalid_<index>.sql
DROP INDEX IF EXISTS <invalid_index_name>;
CREATE INDEX CONCURRENTLY <index_name> ON <table> (<cols>);
```

**Karar 15.4.B — Şema-vs-kod diff (kysely-codegen):**

CI step:
1. `pnpm db:migrate` (test DB'sine tüm migration'ları uygula).
2. `pnpm db:codegen --output /tmp/generated.ts` (DB introspection).
3. `diff /tmp/generated.ts packages/db/schema/generated.ts` → fark varsa FAIL.

**Senaryo:** Geliştirici migration ekledi ama `kysely-codegen` çıktısını commit'lemedi → tip drift → runtime query builder eski şemayla çalışır.

**Karar 15.4.C — `pgmigrations` ordering gate (§9.5.c explicit-ref):**

CI step: `pgmigrations` tablosu `name` kolonu (timestamp prefix) **ascending** sırada olmalı; out-of-order eklenmiş bir migration tespit edilirse FAIL.

```sql
-- WHERE'de window function yasak — CTE ile sar
WITH ordered AS (
  SELECT name, run_on, LAG(name) OVER (ORDER BY id) AS prev_name
  FROM pgmigrations
)
SELECT name, run_on, prev_name
FROM ordered
WHERE prev_name IS NOT NULL AND name < prev_name;
-- 0 satır beklenir
```

**Senaryo:** İki branch paralel migration ekledi, geç merge edenin timestamp'i daha eski → `pgmigrations` insert sırası ile name sırası uyuşmaz → drift.

**Cross-ref:** ADR-001 (CI workflow implementasyonu, forward-ref), §14.1.B (CONCURRENTLY + INVALID retry), §15.6 (timestamp ordering).

---

#### 15.5 CONCURRENTLY enforcement — parser-level grep (§14.1.B kapatma)

**Karar 15.5 — db-migration-guard parser her `.sql` dosyasında DDL pattern'lerini grep'ler:**

§14.1.B forward-ref'i bu maddede kapatılır. db-migration-guard sub-agent her PR'da:

**Eşleşme kuralı (BLOCKER):**

```
CREATE\s+(UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)\s+
ALTER\s+TABLE\s+\S+\s+ADD\s+CONSTRAINT(?!.*\bUSING\s+INDEX\b)
```

- `CREATE INDEX` veya `CREATE UNIQUE INDEX` satırında `CONCURRENTLY` keyword'ü yoksa → BLOCKER.
- `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` satırı (yeni index implicit yaratır, lock alır) → BLOCKER; istenen pattern: önce `CREATE UNIQUE INDEX CONCURRENTLY`, sonra `ALTER TABLE ... ADD CONSTRAINT ... USING INDEX`.

**İstisna — `000_init.sql`:**

İlk migration boş DB'ye yazılır; lock kontrolü anlamsız (kimse yok). Dosya başında **açıkça yorum**:

```sql
-- 000_init.sql
-- §14.1.B + §15.5 istisna: boş DB üzerinde CONCURRENTLY gerekmez.
-- Bu dosya tüm initial schema + index'leri NORMAL DDL ile yaratır.
-- Sonraki tüm migration'larda CONCURRENTLY zorunlu (db-migration-guard enforced).

CREATE TABLE tenants (...);
CREATE INDEX tenants_status_idx ON tenants (status);  -- CONCURRENTLY yok, istisna
```

**Format:** §9.5.b db-migration-guard tespit kuralı pattern'i ile aynı (parser-level grep + BLOCKER label).

**Cross-ref:** §14.1.B (CONCURRENTLY kuralı), §9.5.b (db-migration-guard format şablonu).

---

#### 15.6 Migrator-only DDL — rol matrisi (§13.5 + §14.1.B kapatma)

**Karar 15.6 — DDL yalnız `migrator` rolüyle çalışır; ayrı env değişkeni `MIGRATOR_DATABASE_URL`:**

§13.5'te tanımlanan 4 rolün DDL yetkisi:

| Rol | DDL? | Kullanım |
|---|---|---|
| `app_tenant` | **HAYIR** | Uygulama runtime (RLS-scoped) |
| `cron_purger` | **HAYIR** | Retention cron (BYPASSRLS, sadece DELETE) |
| `app_admin` | **HAYIR** | Read-only viewer |
| `migrator` | **EVET** | Sadece migration run sırasında |

**Karar 15.6.A — Env ayrımı:**

- `DATABASE_URL` → `app_tenant` credential (uygulama runtime).
- `CRON_DATABASE_URL` → `cron_purger` credential (cron job).
- `MIGRATOR_DATABASE_URL` → `migrator` credential (yalnız `pnpm db:migrate` komutu okur).
- `ADMIN_DATABASE_URL` → `app_admin` credential (DBA viewer console).

`node-pg-migrate` runner **sadece** `MIGRATOR_DATABASE_URL`'i okur; uygulama hiçbir kod yolundan bu env'e erişmez.

**Karar 15.6.B — GRANT şablonu (000_init.sql sonu):**

```sql
-- Migrator: tam DDL yetkisi
GRANT ALL ON SCHEMA public TO migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO migrator;

-- App tenant: yalnız DML (yeni tablolar otomatik kapsanır)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
REVOKE ALL ON SCHEMA public FROM app_tenant;
GRANT USAGE ON SCHEMA public TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;

-- Cron purger: yalnız bounded-log DELETE (whitelist — §13.5 retention)
-- UYARI: `GRANT ... ON ALL TABLES` antipattern — iş tablolarına (orders, payments) DELETE sızdırır. BLOCKER.
-- Yeni bounded-log tablosu eklenince bu GRANT satırı ayrı migration'da genişletilir.
GRANT SELECT, DELETE ON audit_logs, call_logs, print_jobs TO cron_purger;

-- App admin: yalnız SELECT
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_admin;
```

**Karar 15.6.C — Operatör runbook kuralı:**

- DBA console'dan (`psql` interactive) **DDL yasak** — `CREATE TABLE`, `ALTER TABLE`, `DROP INDEX` vb. komutlar `app_admin` role ile reddedilir (GRANT mekanizması).
- Acil hot-fix dahi olsa: yeni migration dosyası → PR → review → merge → `pnpm db:migrate`. Console DDL **denetim izi bırakmaz**, kabul edilemez.
- `migrator` credential rotasyonu: her deploy sonrası rotate; deploy-bot CI vault'tan çeker, runtime'da expose edilmez.

**Cross-ref:** §13.5 (4 rol tanımı), §14.1.B (CONCURRENTLY + lock), §15.5 (DDL parser).

---

#### 15.7 Migration dosyası ordering + naming

**Karar 15.7 — ISO timestamp prefix + lock'lu init:**

**Format:**

```
000_init.sql                                  ← İlk migration, sabit ad
YYYYMMDD_HHMM_<short_description>.sql         ← Sonraki tüm migration'lar
```

**Örnekler:**

```
000_init.sql
20260425_1430_add_print_jobs.sql
20260426_0915_orders_partial_unique_fix.sql
20260501_1200_drop_invalid_audit_logs_idx.sql
```

**Kurallar:**

- Dosya adı yalnız küçük harf + rakam + underscore. Boşluk, büyük harf, tire **yok**.
- `<short_description>` snake_case, 30 karakter altı, yapılan işi tek kelimeyle özetler.
- ISO timestamp dakika hassasiyetinde (saniye gerekmiyor — branch çakışması nadir, gerekirse bir dakika sonraya kaydır).

**Karar 15.7.A — `000_init.sql` lock'lu sıralama:**

İlk migration §4 `tenants` + `tenant_settings` tablolarını içerir, ardından §6+ business tabloları:

```sql
-- 000_init.sql
-- 1. Roller (GRANT'lerden önce role'ler var olmalı)
-- UYARI: PASSWORD bu dosyada YOK — migration git'e commit edilir, hardcode yasak.
-- Login credential'ları DBA runbook'unda vault'tan inject edilir:
--   ALTER ROLE migrator PASSWORD :'MIGRATOR_PW';  (psql \set + :var notasyonu)
CREATE ROLE migrator NOLOGIN;   -- migration sonrası vault login aktive eder
CREATE ROLE app_tenant NOLOGIN;
CREATE ROLE cron_purger BYPASSRLS NOLOGIN;
CREATE ROLE app_admin NOLOGIN;

-- 2. Tenant tabloları (FK referansları için ilk)
CREATE TABLE tenants (...);
CREATE TABLE tenant_settings (...);

-- 3. Business tabloları (§6+ sırası)
CREATE TABLE categories (...);
CREATE TABLE products (...);
-- ...

-- 4. Index'ler (lock-free, ilk migration'da CONCURRENTLY gerekmez — §15.5 istisna)
CREATE INDEX ... ;

-- 5. GRANT'ler (§15.6.B şablonu)
GRANT ...;
```

**Karar 15.7.B — Branch çakışma kuralı:**

İki branch aynı timestamp prefix'iyle migration eklemişse:
- Son rebase eden timestamp'ini **ileri** alır (bir dakika sonraya).
- Timestamp **geri** götürülmez (out-of-order CI gate FAIL — §15.4.C).
- `pgmigrations` tablosu `name` kolonu monotonic ascending, ihlal BLOCKER.

**Karar 15.7.C — `package.json` scripts:**

```json
{
  "scripts": {
    "db:migrate": "node-pg-migrate up",
    "db:migrate:status": "node-pg-migrate status",
    "db:migrate:dev-reset": "node scripts/dev-reset.ts && node-pg-migrate up",
    "db:codegen": "kysely-codegen --out-file packages/db/schema/generated.ts"
  }
}
```

`scripts/dev-reset.ts` (lokal-dev only) — **dört guard AND'i geçilmeden abort**:

```ts
// Guard 1: NODE_ENV !== 'production'
// Guard 2: process.env.ALLOW_DEV_RESET === 'true'  (explicit opt-in)
// Guard 3: DB host'u localhost / 127.0.0.1 değilse abort
//          (prod hostname ile bağlanmış .env yanlışlığını yakalar)
// Guard 4: İnteraktif TTY'de `> Devam et? (yes): ` confirm
//          (CI'da --yes flag ile bypass; otomasyonda zorunlu arg)
// ----
// 1. Dört guard geçildi → DROP SCHEMA public CASCADE
// 2. CREATE SCHEMA public
// 3. node-pg-migrate up (clean state)
```

**`db:migrate:down` script'i `package.json`'da YOK** — §15.3.B kararı.

**Cross-ref:** §15.4.C (ordering CI gate), §15.6 (env ayrımı), §4 (`tenants` ilk tablo).

---

#### 15.8 Review-gate checklist

**Bölüm A — db-migration-guard maddeleri (primary):**

- [ ] **Tool kullanımı (§15.1)**: PR'da migration dosyası `node-pg-migrate` formatına uygun (`-- Up Migration` header); başka tool (drizzle-kit, prisma) kullanım izi yok.
- [ ] **`down` bölümü yok (§15.3)**: Migration dosyasında `-- Down Migration` bölümü yazılmamış (boş header dahi yok); dev-reset dışında geri alma mekanizması önerilmemiş.
- [ ] **Hot-fix forward N+1 (§15.3.A)**: Önceki migration'ı düzeltici PR ise yeni timestamp'li dosya açılmış; `pgmigrations` tablosundan satır silme önerisi yok.
- [ ] **CONCURRENTLY parser-grep (§15.5)**: Tüm `CREATE INDEX` ve `ALTER TABLE ... ADD CONSTRAINT UNIQUE` satırları `CONCURRENTLY` (veya `USING INDEX`) ile; `000_init.sql` istisnası açıkça yorum satırıyla belgelenmiş.
- [ ] **INVALID index retry (§15.4.A)**: Önceki deploy'da `CONCURRENTLY` başarısız index varsa drop + retry forward migration formatında; rollback önerisi yok.
- [ ] **Şema-vs-codegen diff (§15.4.B)**: Migration eklenen PR'da `packages/db/schema/generated.ts` de güncellenmiş; CI `db:codegen` diff step'i yeşil.
- [ ] **`pgmigrations` ordering (§15.4.C + §15.7.B)**: Yeni migration dosyasının timestamp prefix'i mevcut son migration'dan **büyük** (out-of-order BLOCKER); branch çakışmasında rebase eden ileri kaydırmış.
- [ ] **Naming format (§15.7)**: Dosya adı `YYYYMMDD_HHMM_<snake_case>.sql` formatında; büyük harf, boşluk, tire yok; `<description>` 30 karakter altı.
- [ ] **`000_init.sql` lock'lu sıralama (§15.7.A)**: İlk migration roller → tenant tabloları → business tabloları → index → GRANT sırasına uyuyor; sonradan eklenen tablo `000_init.sql`'e enjekte edilmemiş (yeni timestamp'li dosya açılmış).
- [ ] **`package.json` scripts (§15.7.C)**: `db:migrate:down` rollback script'i yok; `db:migrate` `--no-lock` flag içermiyor (advisory lock default on); `db:migrate:dev-reset` dört guard (NODE_ENV, ALLOW_DEV_RESET, localhost-check, TTY confirm) geçmeden abort ediyor.

**Bölüm B — security-reviewer maddeleri (secondary):**

- [ ] **Migrator-only DDL (§15.6)**: PR `MIGRATOR_DATABASE_URL` env'i app code path'inden okumuyor; runtime'da migrator credential expose edilmiyor.
- [ ] **Migration dosyasında credential yok (§15.7.A)**: `000_init.sql` ve diğer migration dosyalarında `PASSWORD '...'` hardcode yok; rolle`r NOLOGIN yaratılıyor, login+password vault injection DBA runbook'unda.
- [ ] **GRANT şablonu uyumu (§15.6.B)**: Yeni tablo eklendi ise `app_tenant` (DML), `cron_purger` (DELETE — yalnız bounded-log tabloları), `app_admin` (SELECT) GRANT'leri migration sonunda var.
- [ ] **`cron_purger` GRANT scope (§15.6.B + §13.5)**: Cron rolü yalnız `audit_logs`, `call_logs`, `print_jobs` üzerinde DELETE; iş tablolarına (orders, payments) DELETE yetkisi yok.
- [ ] **DBA console DDL yasağı (§15.6.C)**: PR açıklamasında "console'dan değiştirildi" notu yok; tüm şema değişikliği migration dosyasından geçmiş (denetim izi mevcut).
- [ ] **`migrator` credential rotasyonu**: Deploy pipeline `MIGRATOR_DATABASE_URL`'i vault'tan çekiyor; runtime env'e enjekte edilmiyor; rotation policy ADR-001'de yazılı (forward-ref).
- [ ] **RLS policy + index leading column uyumu (§14.9)**: Migration yeni RLS policy ekliyorsa `tenant_id` filter'ı yeni index'in leftmost prefix'iyle birebir; cross-ref §14.10.B madde 1 ile aynı kural.
- [ ] **`down` runner prod yasağı (§15.3.B)**: Production deploy script'inde `node-pg-migrate down` çağrısı yok; CI workflow yalnız `up` mode'da çalıştırıyor.
- [ ] **Forward-ref kayıtları**: §15.4 üç CI gate ADR-001'de implement edilecek; §15.6.B GRANT şablonu §13.5 rol matrisine kanonik referans; `dev-reset.ts` script'i implementer turunda yazılacak — active-plan follow-up'a kayıtlı.

---

### Bölüm 16 — Consequences

§1-§15 boyunca alınan kararların toplu çıktısı. Madde başına tek satır; gerekçe yukarıdaki bölümlerde.

#### 16.1 Pozitif sonuçlar

- (+) Para tipi güvenliği (§2): float yuvarlama bug'ı imkansız; tüm tutarlar `bigint` kuruş.
- (+) UUID v7 app-side (§3): insert-roundtrip yok, zaman-sıralı index locality, multi-tenant ID çakışması imkansız.
- (+) `store_date()` çift katman + parity test (§5): cutoff-saat bug'ı imkansız; CI gate Node ile PG çıktısını eşitliyor.
- (+) `tenant_id` her tabloda + UNIQUE prefix zorunluluğu (§6): cross-tenant veri sızıntısı şema seviyesinde engellendi; RLS'ye hazır.
- (+) Snapshot invaryantı (§7): menü/fiyat değişikliği geçmiş raporu/adisyonu retroaktif bozmaz.
- (+) Soft/hard delete hibrit (§8): aktif referans bütünlüğü korunur; KVKK silme talebi `gdpr_erase()` ile karşılanır.
- (+) Forward-only enum evolution (§9): yeni değer eklemek DB backward compat'ı kırmaz; rename/drop yasak.
- (+) DB trigger enforcement (§10): ikram/ödeme/round invaryantları uygulama bypass'ına kapalı.
- (+) `order_no` günlük unique + counter tablosu (§11): concurrency-safe; gap kabulü dökümante.
- (+) `AuditSanitizer` + `writeAudit()` tek giriş (§12): PII sızıntısı iki katmanda (sanitizer + CI lint) engellendi.
- (+) TTL cron + tenant-loop (§13): `audit_logs`/`webhook_deliveries` bounded; write amplification §3 hedeflerinde.
- (+) Kritik index'ler (§14): hot-path query plan deterministik; leading column'lar RLS-ready.
- (+) `node-pg-migrate` + forward-only + drift detection (§15): her şema değişikliği denetim izinde; `CONCURRENTLY` enforcement otomatik; rollback policy net.

#### 16.2 Negatif ödünleşimler / kabul edilen borçlar

- (−) `store_date` IMMUTABLE taahhüdü operasyonel kuralla korunuyor (tzdata pin); teknik garanti yok — runbook zorunlu.
- (−) UUID v7 app-side: DB default yok; her ORM insert'inde `id` üretimi convention'a bağlı, unutulursa NULL hatası.
- (−) Trigger çokluğu (§4/§5/§10): her tablo ek PL/pgSQL yükü; trigger test coverage zorunlu, yoksa sessiz invaryant kaybı.
- (−) Forward-only migration: yanlış migration geri alınamaz; her düzeltme N+1 yeni forward migration üretir, repo şişer.
- (−) `CREATE INDEX CONCURRENTLY`: tablo lock yok ama `INVALID` index riski var; retry policy (§14/§15) operatöre yük bindiriyor.
- (−) `kysely-codegen` zorunluluğu: her migration sonrası `pnpm db:codegen` atlanırsa TS tip drift; CI gate olmadan sessiz hata.
- (−) Snapshot kolonları (§7): tablo genişliği artar; storage maliyeti ~%15-20 fazla, raporlama hızı için kabul.
- (−) `gdpr_erase()` (§8): hard-delete + audit log tutuyor; "tamamen sil" beklentisini operatöre net açıklamak gerekir.
- (−) Açık ADR borçları: §15 B1-B9 + önceki §'lardan toplam ~20 follow-up kalem; active-plan'da takip ediliyor, kapanmazsa teknik borç birikir.
- (−) Multi-tenant şema-içi izolasyon (§6): RLS yerine `tenant_id` filter convention; uygulama bug'ı tek başına leak yapabilir — RLS aktivasyonu §13.5 follow-up.

---

<!-- Bölüm 16 ✓ (Session 19, 2026-04-25) — GREEN-LIGHT, review yok -->
<!-- Bölüm 14 ✓ (Session 18, 2026-04-25) — db-migration-guard + security-reviewer review GREEN-LIGHT mini-pass A1-A6 sonrası; CONCERN-B1..B5 follow-up'a kayıtlı -->
### Amendment History

> ADR amendment paterni: bu altbölüme tek satır eklenir, inline (Amendment ...) notları kullanılmaz. Sonraki ADR amendment'leri kendi ADR'lerinde aynı altbölüm ile takip edilir.

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-04-27 | §14.1.B Phase-conditional enforcement | §14.1.B.3 (yeni alt-bölüm) | Phase 2 Sprint 3a Görev 14 implementasyonunda §14.1.B "CREATE INDEX CONCURRENTLY zorunlu" kuralının Phase 0-3 boyunca enforce edilmediği keşfedildi (002-004 migration'larında CONCURRENTLY yok). Kural prensip olarak korundu; aktivasyonu Phase 4 prod cutover hazırlığına koşullandırıldı. db-migration-guard CI check + TS migration infrastructure + 002-005 re-create kararı Phase 4 başında üç iş olarak planlandı. §14.1.B + §15.5 ilişkisi netleştirildi (§15.5 enforcement mekanizması, §14.1.B.3 aktivasyon zamanlaması — ayrı katmanlar). |
| 2026-04-27 | §8.6 — Products/Variants Lifecycle | §8 (yeni alt-bölüm Bölüm 8.6) | Phase 2 Sprint 3b Görev 18 prerequisite: nested write + cascade soft delete + nested GET response + `is_default` kuralı (en az 1 zorunlu, en fazla 1). `product_variants` tablosu Görev 17.5 migration prerequisite (006_add_product_variants.sql + zod sync, schema-only PR). PATCH semantiği declarative replace (eksikler soft delete, `variants: []` = tüm sil + UI confirm modal). N+1 query yasağı `WHERE product_id = ANY($1)` SELECT IN ile DoD'a kilitli. |
| 2026-04-28 | §8.6 — `price_delta_cents` semantiği | §8.6 (Amendment 2026-04-28 sub-heading) | Görev 17.5 schema sync sırasında tespit edilen belirsizlik (Sprint 3b kapanış BLOCKER): signed INTEGER, negatif/sıfır/pozitif izinli, range hard-cap yok, v3 davranış referansı (küçük porsiyon -2 TL). Zod `z.number().int()` mevcut hâli korunur, drift'siz. Görev 18 unblock. |
| 2026-04-28b | §8.6 — Kategori cascade kararı (Görev 20) | §8.6 (Amendment 2026-04-28b sub-heading) | Sprint 4 Görev 20 implementasyonu öncesi karar: kategori altında aktif products varsa DELETE 409 MENU_CATEGORY_HAS_PRODUCTS (Seçenek A engelleme). Cascade YAPILMAZ; cascade ve orphan reddedildi. Görev 19 (tables active orders) pattern'iyle tutarlı. v5.1 mass-edit kapsam dışı. |

<!-- Bölüm 15 ✓ (Session 19, 2026-04-25) — db-migration-guard (0 BLOCKER + 4 CONCERN-A + 4 CONCERN-B + 9 GREEN) + security-reviewer (0 BLOCKER + 3 CONCERN-A + 5 CONCERN-B + 9 GREEN); mini-pass A1-A7 uygulandı (--no-lock kaldır, LAG CTE, DEFAULT PRIVILEGES, dev-reset 4-guard, cron GRANT uyarısı, role NOLOGIN + checklist güncellemesi); CONCERN-B1..B9 follow-up'a kayıtlı -->
<!-- Bölüm 10.5 ✓ (Session 12, 2026-04-24) — db-migration-guard review gate tamam -->
<!-- Bölüm 11 ✓ (Session 14, 2026-04-25) — db-migration-guard review gate sıradaki adım -->
<!-- Bölüm 12 ✓ (Session 16, 2026-04-25) — security-reviewer + db-migration-guard review gate sıradaki adım -->
<!-- Bölüm 13 ✓ (Session 17, 2026-04-25) — db-guard review GREEN-LIGHT mini-pass A1-A3 sonrası -->
<!-- Bölüm 6-9 toplu review önerisi: §6.5 eklendikten sonra yeniden değerlendirilecek -->

---

## ADR-001: Monorepo Yapısı, Paket İsimlendirme ve CI/Deploy Pipeline Standartları

- **Durum**: Accepted
- **Tarih**: 2026-04-25

### Bağlam

v5 dört deploy edilebilir uygulama (`api`, `web`, `mobile`, `print-agent`) ve en az üç paylaşılan paket (`shared-types`, `shared-domain`, `shared-ui`) içeriyor. Tek dil ekosistemi (TypeScript) ve zod-temelli kontrat paylaşımı seçildiği için backend ↔ frontend ↔ mobil arasında **tip eşitliği gün 1'den garanti** olmalı. Aynı zamanda ADR-003 §15 kararları (kysely + kysely-codegen + node-pg-migrate, iki rol — `app_user` / `migrator` — disposable PG instance üzerinde codegen diff) bir paket konumu ve CI altyapısı ister. ADR-003 §15.3.B / §15.6.C / §15 log-masking forward-ref'leri bu ADR'de resolve edilir.

Multi-repo (her app ayrı repo) seçeneği elenir çünkü zod schema senkronizasyonu sürekli versiyon çakışması üretir, atomik PR (örn. order schema + UI + migration tek PR) imkânsızlaşır ve tek geliştiriciyle (İlhan) operasyonel yük katlanır.

### Karar

pnpm workspaces + Turborepo + GitHub Actions tabanlı bir monorepo. Migration toolchain ayrı `packages/db` paketinde yaşar. Tüm dahili paketler `@restoran-pos/*` namespace'i altındadır. Node.js 22 hem `.nvmrc` hem `engines` ile pinlenir, CI `node:22-bookworm-slim` resmi imajını kullanır. CI ve deploy güvenlik kontratları aşağıda §6–§7'de tanımlandığı şekilde reusable workflow olarak şablonlaşır.

---

### §1 — Monorepo Tool

**Karar:** **pnpm workspaces + Turborepo**.

**Gerekçe:**
- pnpm content-addressable store: `node_modules` disk kullanımı npm/yarn'a göre ~%60 az; CI cache ısınması hızlı.
- pnpm `workspace:*` protokolü: dahili paketler arası versiyon kayması imkânsız (npm workspaces'te `file:` tuhaflıkları var).
- pnpm strict peer-dependency davranışı: phantom dependency (transitives'i yanlışlıkla import etme) derleme hatası verir — TypeScript strict ile uyumlu.
- Turborepo: incremental task graph + remote cache + task pipeline (`build` → `test` → `lint`) deklaratif tanımlanır. Vercel'in ücretsiz remote cache hizmeti opsiyonel.
- Native React Native + Expo desteği pnpm'de `node-linker=hoisted` flag'i ile çözülür (Metro bundler hoisting bekler) — bu tek pnpm "tuzak" noktasıdır, `.npmrc`'de pinlenir.

### §2 — Package Yapısı

```
restoran-pos-v5/
├── apps/
│   ├── api/              Express 5 + kysely query layer
│   ├── web/              React 18 + Vite
│   ├── mobile/           Expo SDK 53+ Dev Client
│   └── print-agent/      Windows servisi (Node.js, ESC/POS)
├── packages/
│   ├── db/               Migration toolchain + kysely instance + generated types
│   ├── shared-types/     zod schemas (request/response, domain entities)
│   ├── shared-domain/    Pure functions (sipariş hesabı, KDV, store_date TS util)
│   └── shared-ui/        Cross-platform component primitives (bkz. §2.3)
├── docs/
├── .github/workflows/
└── turbo.json
```

#### §2.1 — Migration toolchain konumu (açık soru çözümü)

**Karar:** **Seçenek B — `packages/db` ayrı paket.**

İçerik:
- `packages/db/migrations/` — `node-pg-migrate` SQL migration dosyaları (`000_init.sql` zaten burada)
- `packages/db/src/kysely.ts` — kysely instance factory (her app `createDb(connectionString)` ile alır)
- `packages/db/src/generated.ts` — `kysely-codegen` çıktısı (commit edilir, CI diff gate'i ADR-003 §15.4)
- `packages/db/src/types.ts` — `Insertable<T>`, `Selectable<T>`, `Updateable<T>` re-export
- `packages/db/scripts/` — `migrate.ts`, `codegen.ts`, `verify-roles.ts` (deploy CLI)

**Reddedilen seçenekler:**
- **A (`apps/api/` içine göm):** print-agent ileride okuma için kysely tip kullanmak isteyebilir; `web` ise zod tipini `shared-types`'tan alıp DB tipini görmek **istemez** (sızıntı). Ama `migrate` CLI ve `kysely` instance factory'si en az iki app tarafından kullanılır → ayrı paket gerekli.
- **C (`shared-types` içine göm):** zod schema'lar (kontrat) ile DB tipi (implementasyon) **farklı abstraction katmanı**. shared-types'ı web/mobile import eder; web'in kysely Generated tipini import etmesi yanlış. Ayrı kalmalı.

**Güvenlik notu:** `generated.ts` şema topolojisini açar. Repo private. CI artifact upload'larında `packages/db/src/generated.ts` log/comment'a basılmaz.

#### §2.2 — `packages/db` import izinleri

| Paket | `packages/db` import edebilir mi? |
|---|---|
| `apps/api` | Evet (kysely + migrations runner) |
| `apps/print-agent` | Evet (sadece read-only kysely instance, ileride job tablosu için) |
| `apps/web` | **Hayır** (DB tipi UI'ya sızmaz, sadece `shared-types` zod) |
| `apps/mobile` | **Hayır** (aynı) |
| `packages/shared-domain` | **Hayır** (pure, DB-agnostic kalır) |
| `packages/shared-ui` | **Hayır** |

Bu kural ESLint `no-restricted-imports` ile lint-time enforce edilir.

#### §2.3 — `shared-ui` cross-platform stratejisi

React (web) ve React Native (mobile) component imzaları farklı (`<div>` vs `<View>`). `shared-ui` saf component dump'ı **olmaz**. Onun yerine:

- `packages/shared-ui/src/primitives/` — platform-agnostic logic (hooks, formatter'lar, validation, design tokens)
- `packages/shared-ui/src/web/` — `.web.tsx` uzantılı React component'ler
- `packages/shared-ui/src/native/` — `.native.tsx` uzantılı RN component'ler
- `package.json` `exports` field: koşullu export (`"react-native"` ve `"default"` koşulu)

Metro bundler ve Vite'ın platform-extension resolution'ı doğal destekler. v5.0 MVP'de `shared-ui` **sadece primitives** içerir (formatters, hooks). Web/native somut component'leri v5.1'e ertelenir — bu kararla scope creep önlenir.

### §3 — Package İsimlendirme

**Karar:** **`@restoran-pos/<paket-adı>`** namespace.

| Paket | İsim |
|---|---|
| API | `@restoran-pos/api` |
| Web | `@restoran-pos/web` |
| Mobile | `@restoran-pos/mobile` |
| Print Agent | `@restoran-pos/print-agent` |
| DB | `@restoran-pos/db` |
| Shared Types | `@restoran-pos/shared-types` |
| Shared Domain | `@restoran-pos/shared-domain` |
| Shared UI | `@restoran-pos/shared-ui` |

**Gerekçe:**
- npm scope ileride özel registry'ye taşırken (örn. ileride `@restoran-pos` GitHub Packages scope'u) yeniden isimlendirme **maliyeti yok**.
- Çakışmasız: public npm'de `restoran-pos` adlı bir org/scope yok (kontrol edilecek; alınmamışsa register edilir — sadece squat koruması, paket publish edilmeyecek).
- Scope-less isimler (örn. `pos-api`) public registry'de çakışır ve istemeden public'e push edilirse karışıklık doğar; scope'lu paketler npm'de **default olarak private** ayarlanabilir (`publishConfig.access: "restricted"`).

### §4 — Node.js Versiyon Pinleme

**Karar:**
- **Repo kökünde `.nvmrc`:** `22.11.0` (Node 22 LTS, "Jod" — exact patch).
- **Her `package.json` `engines.node`:** `">=22.11.0 <23.0.0"` (minor güncellemelere izin, major'a kapalı).
- **`engines.pnpm`:** `">=9.0.0 <10.0.0"`.
- **CI imajı:** `node:22-bookworm-slim` (alpine değil — `bcrypt`, `node-thermal-printer` gibi native modüller glibc bekler; alpine musl ileride print-agent build'inde patlar).
- **Migration runner CI step'i** (ADR-003 §5.1.1.b bağı): aynı `node:22-bookworm-slim` imajını kullanır. Ayrı runtime yok; reusable workflow `migration-check.yml` ana CI ile aynı `setup-node@v4` `node-version-file: .nvmrc` çağrısını paylaşır.
- pnpm `engine-strict=true` (`.npmrc`'de): yanlış Node versiyonunda `pnpm install` reddedilir.

### §5 — TypeScript Yapılandırma

**Karar:** Repo kökünde **`tsconfig.base.json`**:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true
  }
}
```

- Her `apps/*` ve `packages/*` kendi `tsconfig.json`'unda `"extends": "../../tsconfig.base.json"`.
- **Path alias YOK.** Workspace protokolü (`@restoran-pos/shared-types`) zaten kanonik yol; path alias çift ad sistemi yaratır, IDE / Vite / Metro / tsc / vitest arasında senkron sorunu çıkarır.
- `apps/mobile` Expo defaults'unu extend eder (JSX runtime farklı): `"extends": ["../../tsconfig.base.json", "expo/tsconfig.base"]`.
- `apps/api` ek kısıt: `"types": ["node"]` (DOM tipi yok — yanlışlıkla `window` import'u derlemez).

### §6 — CI Pipeline (GitHub Actions + Turborepo)

**`turbo.json` task graph:**
```
typecheck ──┐
lint ───────┼──► test ──► build
            │
codegen-diff (sadece packages/db değişince)
```

**Workflows:**
- `.github/workflows/ci.yml` — PR ve `main` push'ta tetiklenir
  - `pnpm install --frozen-lockfile`
  - `turbo run typecheck lint test build --cache-dir=.turbo`
  - Turborepo remote cache: GitHub Actions cache backend (free, `actions/cache@v4`)
- `.github/workflows/migration-check.yml` — `packages/db/**` değişince tetiklenir (ADR-003 §15.4.B forward-ref resolve)
  - `services.postgres: image: postgres:17` (disposable instance, GitHub Actions service container)
  - Step'ler: migration apply → kysely-codegen run → `git diff --exit-code packages/db/src/generated.ts`
  - Diff varsa CI fail; geliştirici lokalde `pnpm --filter @restoran-pos/db codegen` çalıştırıp commit eder.

**Concurrency:** `group: ${{ github.ref }}` — aynı branch'e art arda push'larda eski run iptal.

#### §6.1 — Integration Test Infrastructure (Amendment 2026-04-27, Görev 15.5)

**Bağlam:** Phase 2 Sprint 3a Görev 15 sırasında keşfedildi: `apps/api/src/__tests__/*.test.ts` integration test'leri `describe.skipIf(DB_URL === undefined || DB_URL.length === 0)` guard'ı ile CI'de **skip** oldu — `DATABASE_URL` `.github/workflows/ci.yml` job env'inde set edilmiyordu. Sonuç: PR #18, #19, #24, #26 hepsi "CI yeşil" göründü ama integration test'ler hiç çalışmadı (skip durumu). Lokal'de fail eden fixture drift'leri (örn. `tenant_settings` missing) CI'de yakalanmadı. Amendment, sahte yeşil drift'i kapatır ve test infrastructure'ı belge altına alır.

**Karar:**

1. **Postgres service container.** `.github/workflows/ci.yml` `ci` job'ına `services.postgres: image: postgres:17` eklenir (lokal Docker image ile aynı major versiyon, reproducibility). Health check (`pg_isready`) ile job step'leri başlamadan önce ready beklenir. Port `5432` runner'a expose edilir.

2. **`DATABASE_URL` job env.** Job env'inde `DATABASE_URL: postgresql://postgres:postgres@localhost:5432/pos_dev`. Service container hostname `localhost` (action runner perspektifi, GitHub Actions service container paterni). Credential'lar **hardcode** — secret değil. **Gerekçe:** her job fresh ephemeral container, production veri yok, throwaway test DB. CI integration test DB credentials production secret zincirine bağlı değil; service container PR job'ı sonunda imha edilir, persistent state yok. Production credential'ları (`MIGRATOR_DATABASE_URL` / `APP_DATABASE_URL` §7.2/§7.3) ayrı zincir — bu pattern'le karışmaz.

3. **TZ + locale pin (zorunlu).** Job env: `TZ: UTC`. Container env: `LANG: C.UTF-8`. **Gerekçe:** ADR-003 ve Sprint 1+ test'lerinde `order_no_counters.store_date` trigger ve günlük resetlemeler timezone-hassas. Geliştirici lokali `Europe/Istanbul`, CI runner `UTC` — pin'lenmezse subtle drift fail tetikleyebilir. Production tenant timezone'u uygulama-katmanı kararıdır (ADR-003 ilgili maddesi); CI infrastructure katmanı UTC'de sabitlenir.

4. **Step sırası ve workflow değişiklik diff'i.** Mevcut `.github/workflows/ci.yml` job step zinciri korunur, aralarına migration step'i eklenir. Job-level değişiklikler: `jobs.ci.services.postgres` (yeni) + `jobs.ci.env` (yeni). Step ekleme yeri: mevcut "Audit log INSERT guard" step'inden SONRA, "pnpm turbo run" step'inden ÖNCE — audit guard pure regex (DB'siz), turbo `test` task DB gerektirir, migration ortada.

   ```yaml
   jobs:
     ci:
       runs-on: ubuntu-latest
       env:
         DATABASE_URL: postgresql://postgres:postgres@localhost:5432/pos_dev
         TZ: UTC
       services:
         postgres:
           image: postgres:17
           env:
             POSTGRES_USER: postgres
             POSTGRES_PASSWORD: postgres
             POSTGRES_DB: pos_dev
             LANG: C.UTF-8
           ports: ['5432:5432']
           options: >-
             --health-cmd "pg_isready -U postgres -d pos_dev"
             --health-interval 10s
             --health-timeout 5s
             --health-retries 5
       steps:
         # ... mevcut step'ler korunur (Mask secrets, checkout, setup-node, pnpm,
         #     install, Turborepo cache, Audit log INSERT guard) ...

         # YENİ STEP — migrate (Audit guard'dan sonra, turbo run'dan önce):
         - name: Run DB migrations
           run: pnpm --filter @restoran-pos/db migrate

         - run: pnpm turbo run typecheck lint test build
   ```

   **§6.1.4.1 — Turbo env passing (post-implementation amendment).** Turborepo task sandbox env'i parent shell env'inden izole eder (cache reproducibility için): job env'inde set edilen `DATABASE_URL` ve `TZ` turbo task'larına **otomatik geçmez**. `turbo.json` içinde explicit declare edilmesi gerekir; aksi halde integration test'ler `skipIf` guard'ı nedeniyle pass-but-skipped duruma düşer (sahte yeşil; CI yeşil görünür ama gerçek execution yok — bu amendment'ın kapatmaya çalıştığı drift'in **kendi tuzağı**). **Tercih:** `tasks.test.env: ["DATABASE_URL", "TZ"]` (task-level, cerrahî). **Reddedilen alternatif `globalEnv`:** DATABASE_URL veya TZ değişimi build/typecheck/lint cache invalidate eder (alakasız task'lar etkilenir), turbo cache philosophy ihlali. **Migrate task** turbo dışında (workflow'da direkt `pnpm --filter @restoran-pos/db migrate` step'i), turbo env'inden etkilenmiyor.

5. **`skipIf` davranışı belge altına alınır (kod değişmez).** Mevcut `describe.skipIf(DB_URL === undefined || DB_URL.length === 0)` guard'ı **korunur** — koddan kaldırılmaz. Davranış: CI'de `DATABASE_URL` set edildiği için integration test'ler **çalışır** (zorunlu execution); lokal dev'de geliştirici DB ayağa kaldırmadan unit test koşturmak isterse skip doğal olarak devreye girer (kabul edilen DX). "Neden hâlâ skipIf var?" sorusunun cevabı bu amendment'tır.

6. **Fail policy + scope-patlama önleme stratejisi.** CI'de fail eden integration test PR block'lar (mevcut Turborepo `test` task davranışı). Amendment merge'i ile Sprint 0/1/2'de birikmiş fixture drift'leri ilk kez gerçekten çalışacak — yeni amendment scope dışı bilinen drift'ler için strateji: ilgili test bloğu **`it.skip()` ile geçici işaretlenir** + `docs/context-anchor.md` §2 borç maddesi açılır + Görev 15.5 bağımsız merge edilir. **Sınır:** `it.skip` ile geçici işaretlenen test sayısı **≤3 ile sınırlıdır**. Daha fazlası: Görev 15.5 scope'u patladı demektir, ayrı görev (Görev 15.6 — fixture drift cleanup) açılır + Görev 16 öncesi yeni blocker. Bu sınır "it.skip + borç" stratejisinin kötüye kullanımını engeller; amendment "her şeyi düzeltsin" tuzağına düşmez, ama "her şeyi atlat" yoluna da kaçmaz.

7. **Out of scope (v5.1+).** Test paralelleştirme, per-worker DB isolation (her worker kendi schema'sı), coverage reporting (codecov/coveralls), test execution time optimization, multiple PostgreSQL major version matrix (16/17/18). Bunlar `docs/engineering/nfr.md` v5.1 backlog'una düşer.

**Etkilenen dosyalar:** `.github/workflows/ci.yml` (yukarıdaki YAML diff), `apps/api/src/__tests__/*.test.ts` (kod değişmez, davranış belgelenir).

**Referans:** ADR-001 §6 ana metin (workflow envanteri), `.github/workflows/migration-check.yml` (postgres service container paterni — bu workflow zaten aynı pattern'i kullanıyor, integration test job'ı aynı pattern'i benimser).

### §7 — Deploy Pipeline ve Güvenlik Kontratları

#### §7.1 — `migrator` DELETE revoke (ADR-003 §15.3.B resolve)

**Karar:** REVOKE **`000_init.sql`'in son SQL bloğunda** yapılır, ayrı DDL değil.

```sql
-- 000_init.sql sonu:
REVOKE DELETE ON public.pgmigrations FROM migrator;
```

**Gerekçe:** Ayrı bir "ops DDL" dosyası iki kaynak gerçeği üretir; staging/prod arasında uygulanma sırası kayar. Aynı migration içinde olması: tablo yaratıldığı anda yetki kapanır, atomik. `pgmigrations` tablosunu `node-pg-migrate` kendi yaratır → REVOKE `000` _en son_ blokta, `pgmigrations` yaratıldıktan sonra çalışır (migration runner ilk çalıştığında tabloyu yaratır, sonra `000`'ı uygular). Bu sıralama node-pg-migrate'in default davranışıdır.

**Deploy checklist maddesi** (`docs/engineering/deploy-checklist.md`'ye eklenecek):
- [ ] `psql -c "SELECT has_table_privilege('migrator', 'pgmigrations', 'DELETE');"` → `f` döner.

#### §7.2 — `migrator` Credential Rotation (ADR-003 §15.6.C resolve)

**Karar:** **Haftalık zamanlı rotasyon + breach durumunda on-demand**, overlap penceresi 1 deploy.

Mekanizma:
1. **Pazar 03:00 UTC** zamanlı GitHub Actions workflow (`rotate-migrator.yml`):
   - PG'de `migrator_new` rolü, yeni şifreyle yaratılır (aynı yetkiler — bir SQL fonksiyonu `clone_role_grants(src, dst)` kullanır, repo'da version'lı).
   - Yeni `MIGRATOR_DATABASE_URL` GitHub Secret'a yazılır (`gh secret set` API).
   - Eski credential 24 saat **revoke edilmez** (overlap penceresi).
2. **24 saat sonra** (Pazartesi 03:00 UTC) ikinci workflow eski rolü `DROP ROLE migrator_old` yapar, yeniyi `ALTER ROLE migrator_new RENAME TO migrator`.
3. **On-demand breach modu:** `gh workflow run rotate-migrator.yml -f breach=true` → overlap atlanır, eski rol _hemen_ DROP, çalışan deploy varsa fail eder ve manuel re-run gerekir (kabul edilebilir trade-off — breach senaryosu seyrek).

**Deploy pipeline'a etkisi:** Deploy job `MIGRATOR_DATABASE_URL` secret'ını okur. Rotasyon penceresinde (pazar 03:00 — pazartesi 03:00) iki credential da geçerli olduğundan, deploy başarısız olmaz. `app_user` credential'ı bu rotasyondan **bağımsız**, ayrı rotasyon takvimi ileride ADR ile tanımlanır.

#### §7.3 — CI Log Masking (ADR-003 §15 log-masking resolve)

**Karar:** **CI template'in zorunlu parçası**, kural değil — manuel uygulamaya bırakılmaz.

`.github/workflows/_setup-secrets.yml` (reusable workflow) ilk step olarak çağrılır:
```yaml
- name: Mask sensitive secrets
  run: |
    echo "::add-mask::${{ secrets.MIGRATOR_DATABASE_URL }}"
    echo "::add-mask::${{ secrets.APP_DATABASE_URL }}"
    echo "::add-mask::${{ secrets.JWT_SECRET }}"
```

Migration runner ve deploy workflow'ları bu reusable'ı `uses:` ile çağırır → unutma riski yok. PR review sırasında bir workflow `_setup-secrets`'i çağırmıyorsa CODEOWNERS otomatik review request atar (`security-reviewer`).

---

### Alternatifler

- **A — Nx monorepo:** Daha güçlü generator/dependency-graph görselleştirme, ama config ağırlığı v5 ölçeği için fazla. Nx plugin ekosistemi kendi tooling kararlarını dayatır (örn. Jest'i Vitest'e tercih). Reddedildi.
- **B — Lerna + npm workspaces:** Lerna 2022'den beri aktif geliştirilmiyor (Nrwl bakım modu). Reddedildi.
- **C — Yarn Berry PnP:** PnP modu Expo / Metro bundler ile uyumsuz; Expo dokümantasyonu açıkça `node_modules` resolution bekler. Reddedildi.
- **D — Turborepo + npm workspaces:** Turborepo aynı kalır ama npm workspaces phantom dependency'leri yakalamaz, peer-dep enforcement zayıf. Reddedildi.
- **E — Migration toolchain `apps/api` içinde (Seçenek A):** §2.1'de gerekçeli reddedildi.
- **F — Migration toolchain `shared-types` içinde (Seçenek C):** Abstraction karışımı; §2.1'de reddedildi.
- **G — Path alias (`@/*`):** §5'te gerekçeli reddedildi (workspace protokolü kanonik).
- **H — `node:22-alpine`:** Native modül (bcrypt, ESC/POS) musl uyumsuzluğu. Reddedildi.
- **I — Credential rotation "her deploy sonrası":** Operasyonel yük + zero-downtime overlap karmaşıklığı. Reddedildi.
- **J — REVOKE DELETE ayrı DDL dosyasında:** İki kaynak gerçeği. §7.1'de reddedildi.

### Sonuçlar

- (+) zod schema değişikliği API + Web + Mobile'i tek PR'da atomik günceller; tip kayması imkânsız.
- (+) `packages/db` ayrı paket: print-agent ileride okuma katmanı eklerse hazır; web/mobile DB tipini göremez (lint enforced).
- (+) `migrator` rolü `pgmigrations`'tan satır silemez (down runner zaten yok + DELETE revoke + haftalık rotasyon) → ADR-003 §15.3.B/§15.6.C tamamen kapanır.
- (+) CI log masking reusable workflow'da → unutma riski yapısal olarak kaldırıldı.
- (+) Tek dil + tek toolchain: 6 ay sonra tek geliştiricinin onboard maliyeti minimum.
- (−) pnpm `node-linker=hoisted` Expo için zorunlu → pnpm'in strict isolation avantajı `apps/mobile` için kısmen kayboluyor (kabul edilebilir; sadece mobile workspace'i etkiler).
- (−) `shared-ui` v5.0 MVP'de sadece primitives içerir → web ve mobile arasında bazı ufak component duplication (örn. button) v5.1'e kadar kalır. Scope creep'i önlemek için bilinçli kabul.
- (−) Haftalık `migrator` rotasyon workflow'u ek bakım yükü (yılda ~52 otomatik run + 1-2 breach drill).
- (−) Turborepo remote cache GitHub Actions backend'inde 10GB limit var; v5 ölçeğinde sorun olmaz, ama v5.1 sonrası izlenecek.

### Referanslar

- ADR-003: DB Şema İlkeleri ve Migration Stratejisi (§5.1.1.b, §15.3.B, §15.4.B, §15.6.C, §15 log-masking forward-ref'leri bu ADR'de resolve)
- `docs/project-charter.md`: stack lock
- `CLAUDE.md`: repo yapısı specification
- Hatırlatma: `.claude/memory/MEMORY.md` "Yazıcı sıfırdan yazılır (ADR-004)" — print-agent'ın `packages/db` import izni §2.2'de ileriye dönük olarak açıldı (job queue okuma için)

### Amendment History

> ADR amendment paterni: bu altbölüme tek satır eklenir, inline (Amendment ...) notları kullanılmaz. Sonraki ADR amendment'leri kendi ADR'lerinde aynı altbölüm ile takip edilir.

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-04-27 | §6.1 Integration Test Infrastructure | §6 alt-bölüm §6.1 (yeni) | Phase 2 Sprint 3a Görev 15.5: CI integration test sahte yeşil drift'i kapatır. postgres:17 service container + DATABASE_URL env + TZ=UTC pin + migrate step. skipIf koddan kaldırılmaz, davranışı belgelenir. Sprint 0/1/2'de birikmiş fixture drift'leri için scope-patlama önleme stratejisi (it.skip + borç, ≤3 sınır). |

<!-- ADR-001 ✓ (Session 20, 2026-04-25) — Accepted; architect sub-agent; ADR-003 §15.3.B + §15.6.C + log-masking forward-ref'leri resolve edildi -->

---

## ADR-002: Auth Stratejisi — JWT, Token Taşıma, Refresh Rotation ve Role Matrix

- **Durum**: Accepted
- **Tarih**: 2026-04-25

### Bağlam

v5 üç tip insan istemcisine (web tarayıcı: kasiyer/müdür/mutfak; mobil: garson; admin paneli aynı web) ve iki tip makine istemcisine (Print Agent — restoran PC'sinde Windows hizmeti; Kitchen Display — sabit tablet/PC) hizmet verecek. CLAUDE.md auth seçimini kilitlemiş: **JWT (access + refresh) + bcrypt**. Bu ADR kilitli olmayan kararları belirler: token taşıma (cookie vs header), token süreleri, refresh stratejisi (stateless vs DB-backed vs RTR), logout akışları, role × endpoint matrisi, makine kimliği, password politikası, JWT payload şeması.

Kısıt: **Redis yok** — token storage = PostgreSQL (ADR-003 §6 multi-tenant ilkesine uygun). Roller kilitli: `admin | cashier | waiter | kitchen` (+ bu ADR'de eklenen makine rolleri). MVP tek tenant; ileride 2-3 işletme. Super-admin v5.0 kapsam dışı.

ADR-003 §6.5 iki forward-ref bıraktı: (a) `users` tenant-scoped mi global mi, (b) `audit_logs.ip_address` doldurma kuralı. Bu ADR (a)'yı resolve eder; (b) §9 sonunda kısa kuralla bağlanır, detayı middleware implementer'a kalır.

### Karar

Aşağıdaki dokuz bölümde kararlar verildi. Özet:

1. **Users tenant-scoped** (`users.tenant_id NOT NULL`), UNIQUE `(tenant_id, username)`. Junction tablo MVP'de yok.
2. **Token taşıma**: web + mobile **her ikisi de Authorization Bearer header**. Web'de access token in-memory, refresh token HttpOnly+Secure+SameSite=Strict cookie'de. Mobil'de her ikisi de `expo-secure-store` (Keychain/Keystore).
3. **Access token süresi**: **30 dakika**. Vardiya boyu sürekli yenileme + revoke responsiveness dengesi.
4. **Refresh token**: **DB-backed + Rotation on Use (RTR) + reuse detection**. Süre **30 gün** (sliding). PostgreSQL'de `refresh_tokens` tablosu, token değeri **SHA-256 hash** olarak saklanır.
5. **Logout**: Üç akış — single-session, all-sessions, admin-force-logout. Hepsi `refresh_tokens` üzerinden.
6. **Role permissions matrix**: Aşağıda tablo. Default-deny.
7. **Makine kimliği**: Print Agent + Kitchen Display için **ayrı `device_credentials` tablosu + uzun ömürlü API key (bcrypt hash, rotateable)**. Insan JWT akışından ayrı.
8. **Password**: bcrypt cost **12**, min **10 karakter**, NIST 800-63B uyumlu (karmaşıklık kuralı yok, breach-list kontrolü v5.1).
9. **JWT payload**: `sub, tenant_id, role, jti, iat, exp, type`. HS256 + 256-bit secret (env). `kid: "v1"` header'da. Audience/issuer claim eklendi.

---

### §1 — Users scope (ADR-003 §6.5 resolve)

**Karar**: **Seçenek A — Tenant-scoped users**.

`users` tablosu:
- `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- `UNIQUE (tenant_id, username)` — aynı `ahmet` kullanıcı adı iki ayrı tenant'ta var olabilir
- `UNIQUE (tenant_id, email)` — email opsiyonel ama varsa tenant içinde tek

**Gerekçe**:
- MVP tek tenant; A ile B arasında pratik fark yok ama A daha basit (junction tablo yok, yetkilendirme middleware tek `tenant_id` claim'iyle çalışır).
- İleride 2-3 işletme: her işletme bağımsız sahip — kullanıcılar paylaşılmaz. Aynı insan iki işletmede çalışacaksa **iki ayrı user satırı** açılır (ayrı şifre, ayrı vardiya). Bu ihtimal nadir (3 işletme × ortalama 8 personel = 24 user, çakışma sıfıra yakın).
- Junction tablo (Seçenek B) super-admin / cross-tenant raporlama gerektirir → v5.0 kapsam dışı (CLAUDE.md ürün sınırı).
- ADR-003 §6 her business tabloda `tenant_id NOT NULL` ilkesini korur, RLS hazırlığı bozulmaz.

**B'ye geçiş yolu** (gerekirse v6'da): `users` global olur, `user_tenant_roles(user_id, tenant_id, role, primary_user_id)` eklenir, mevcut user'lar kendi tenant'ında pivot kayıt alır. Migration karmaşık ama mümkün — bu ADR yolu kapatmıyor.

---

### §2 — Token taşıma stratejisi (web + mobile)

**Karar**:

**Web (React + Vite)**:
- **Access token**: in-memory (React context / Zustand store). Sayfa reload'da kaybolur, refresh ile yenilenir. localStorage **yasak** (XSS'te tüm token sızar).
- **Refresh token**: **HttpOnly + Secure + SameSite=Strict cookie**, `Path=/auth/refresh`. JS okuyamaz (XSS'e kapalı). SameSite=Strict CSRF'i kapatır. CORS açıldıysa `credentials: 'include'`.
- Refresh isteği: `POST /auth/refresh` — cookie otomatik gider, yeni access döner (body'de) + yeni refresh cookie set edilir (RTR).

**Mobile (React Native + Expo)**:
- **Hem access hem refresh token**: `expo-secure-store` (iOS Keychain / Android Keystore — OS-level şifreli).
- Her istek için `Authorization: Bearer <access>` header.
- Cookie kullanmıyoruz — RN'de cookie yönetimi platforma göre değişir, secure-store native ve daha güvenli.

**Neden iki farklı transport**:
- Web'de XSS > CSRF risk profili (XSS yaygın, CSRF SameSite ile çözülür) → HttpOnly cookie en güvenli.
- Mobil'de XSS yok (WebView değil), cookie yönetimi karmaşık → Keychain en güvenli.
- API endpoint aynı (`POST /auth/refresh`); fark sadece transport. Backend `req.cookies.refresh_token ?? req.body.refresh_token` order'ıyla okur.

**CSRF ek savunma**: Web'de `POST /auth/refresh` dışındaki state-changing endpoint'ler header'daki access token ile çalışır → CSRF zaten yok (cookie auth değil). `/auth/refresh` SameSite=Strict + custom header (`X-Refresh-Request: 1`) gerektirir. **Bu header zorunludur** — eksikse backend 403 döner, "savunma var" yanılsamasına yer bırakılmaz.

**CORS kuralı (security-reviewer A1):** `Access-Control-Allow-Credentials: true` ile birlikte `Access-Control-Allow-Origin: *` **kesinlikle yasak**. CORS allowlist tek explicit web origin'e kilitlenir (örn. `https://pos.restoran.com`). Geliştirme ortamında `http://localhost:5173` eklenir; wildcard hiçbir env'de açılmaz.

---

### §3 — Access token süresi

**Karar**: **30 dakika**.

**Gerekçe**:
- 15 dk: Vardiya boyunca (8-12 saat) çok sık refresh — ağ kesintisinde UX riski. Mobile'da garson menü gezerken token süresi dolarsa istek başarısız → fakir UX.
- 1 saat: Çalınan access token 1 saat geçerli — kasiyer telefonu kayıp/çalınma senaryosunda kabul edilemez pencere.
- 24 saat: Stateless revoke imkânsızlığıyla birleşince çok riskli. Reddedildi.
- **30 dk**: Tipik kasa/garson işlem aralığında çoğu istek tek access ile biter. Refresh otomatik (axios interceptor / RN equivalent), kullanıcı görmez. Çalınma penceresi 30 dk — kabul edilebilir.

Otomatik yenileme stratejisi: client `exp - 60s` kala proaktif refresh; 401 dönerse reactive refresh + tek retry.

---

### §4 — Refresh token stratejisi ve DB şeması

#### §4.1 — Strateji seçimi

**Karar**: **DB-backed + Rotation on Use (RTR) + reuse detection** (Seçenek B + C kombinasyonu).

- **Stateless (A) red**: Logout yok, çalınan token revoke edilemez, "tüm cihazlardan çıkış" imkânsız. Restoran ortamında garson işten ayrılınca anında çıkış şart.
- **Sade DB-backed (B) yetersiz**: Revoke var ama çalınan refresh token'ın kullanıldığı tespit edilemez. Saldırgan + meşru kullanıcı paralel kullanır.
- **B + C (RTR)**: Her refresh kullanımında yeni token üret, eskisini `revoked_at` damgala. Eski token tekrar gelirse → **reuse detected** → o kullanıcının **tüm aktif refresh token'ları invalidate edilir** (ihlal sinyali, security log).

#### §4.2 — refresh_tokens tablosu şeması

```sql
CREATE TABLE refresh_tokens (
  id              UUID PRIMARY KEY,                      -- uuidv7 app-side (ADR-003 §3)
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      BYTEA NOT NULL,                        -- SHA-256(token), 32 byte
  parent_id       UUID NULL REFERENCES refresh_tokens(id),  -- RTR zinciri (önceki token)
  family_id       UUID NOT NULL,                         -- aynı login session'ının tüm token'ları
  device_label    TEXT NULL,                             -- "iPhone 15 - Garson Ahmet" gibi (UI için)
  user_agent      TEXT NULL,
  ip_address      INET NULL,                             -- KVKK: anomali tespiti amaçlı; retention max 37 gün (30g expires + 7g TTL cron); aydınlatma metnine eklenmesi implementer DoD item'ı
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                  -- issued_at + 30 gün
  last_used_at    TIMESTAMPTZ NULL,
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT NULL,                             -- 'logout' | 'rotated' | 'reuse_detected' | 'admin_force' | 'all_sessions'
  CONSTRAINT refresh_tokens_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX refresh_tokens_user_active_idx
  ON refresh_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX refresh_tokens_family_idx
  ON refresh_tokens (family_id)
  WHERE revoked_at IS NULL;

CREATE INDEX refresh_tokens_expires_idx
  ON refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;
```

ADR-003 konvansiyonları:
- `id` UUID v7 app-side (DB default yok).
- `TIMESTAMPTZ NOT NULL` zaman kolonları için.
- `tenant_id` her business tabloda — refresh_tokens dahil.
- Soft delete yok; `revoked_at` istek tarihçesini kayıtta tutar (audit). TTL cron (ADR-003 §13) `expires_at < now() - 7 gün` olanları hard delete eder.

**Token değeri**: 256-bit cryptographic random (Node `crypto.randomBytes(32)`), base64url-encode → 43 karakter string. **Plaintext asla DB'ye yazılmaz**, sadece SHA-256 hash. (bcrypt değil — refresh token zaten yüksek-entropy random; bcrypt overhead'e gerek yok, SHA-256 yeterli.)

#### §4.3 — Rotation on use (RTR) mekanizması

`POST /auth/refresh` akışı:

1. Token al (cookie: web, body: mobile).
2. SHA-256 hash hesapla → `refresh_tokens` lookup.
3. **Token bulunamadı** → 401 (saldırı veya bug; log'a "unknown token attempt").
4. **Token bulundu ama `revoked_at IS NOT NULL`** → **REUSE DETECTED**:
   - O `family_id`'nin **tüm aktif token'larını** revoke et (`revoked_reason = 'reuse_detected'`).
   - Security log: "refresh reuse detected for user X family Y".
   - 401 dön. Kullanıcı tekrar login olmak zorunda.
5. **Token bulundu, `expires_at < now()`** → 401 ("expired").
6. **Token geçerli**:
   - Yeni refresh token üret (random 32 byte), aynı `family_id`, `parent_id = eski.id`, `expires_at = now() + 30 gün` (sliding).
   - Eski token: `revoked_at = now(), revoked_reason = 'rotated'`.
   - Yeni access token üret.
   - Response: `{ access_token, expires_in: 1800 }` + (web: Set-Cookie refresh; mobile: body'de refresh_token).

Bu işlem **tek transaction**'da, `SELECT ... FOR UPDATE` ile race-condition korumalı.

---

### §5 — Logout akışı

Üç endpoint:

1. **`POST /auth/logout`** (single-session): İstekteki refresh token'ı `revoked_at = now(), revoked_reason = 'logout'` yapar. Web'de cookie clear. Diğer cihazlar etkilenmez.

2. **`POST /auth/logout-all`** (all-sessions): O `user_id`'ye ait tüm aktif refresh token'ları revoke eder (`revoked_reason = 'all_sessions'`). Şifre değişikliği sonrası **otomatik tetiklenir**.

3. **`POST /admin/users/:id/force-logout`** (admin only): Admin başka bir kullanıcının tüm token'larını revoke eder (`revoked_reason = 'admin_force'`). Garson işten ayrıldı senaryosu. `audit_logs`'a yazılır.

**Access token revoke**: 30 dk pencere açık kalır. Hassas endpoint'ler (örn. ödeme iptali, kullanıcı silme) için ek "fresh auth" kontrolü eklenebilir (v5.1). MVP'de 30 dk kabul edilebilir.

---

### §6 — Role permissions matrix

Default-deny. Endpoint grubu × rol matrisi. ✓ = izinli, — = yasak, R = read-only.

| Endpoint grubu                           | admin | cashier | waiter | kitchen |
|------------------------------------------|:-----:|:-------:|:------:|:-------:|
| Sipariş oluştur (POST /orders)           | ✓     | ✓       | ✓      | —       |
| Sipariş güncelle (kalem ekle/çıkar)      | ✓     | ✓       | ✓ (kendi açtığı) | — |
| Sipariş iptal / kalem iptal              | ✓     | ✓       | —      | —       |
| İkram işaretle (is_comped)               | ✓     | ✓       | —      | —       |
| Ödeme al (POST /payments)                | ✓     | ✓       | —      | —       |
| Ödeme iptal / iade                       | ✓     | —       | —      | —       |
| Adisyon görüntüle (GET /orders)          | ✓     | ✓       | ✓ (kendi)| R (mutfak)|
| Masa durumu                              | ✓     | ✓       | ✓      | R       |
| Masa yönetimi (ekle/düzenle/sil)         | ✓     | —       | —      | —       |
| Menü okuma (kategori/ürün listesi)       | ✓     | ✓       | ✓      | ✓       |
| Menü yönetimi (CRUD ürün/kategori)       | ✓     | —       | —      | —       |
| Özellik grupları okuma (`attributes.read`) | ✓   | ✓       | ✓      | ✓       |
| Özellik grupları yönetimi (`attributes.manage`) | ✓ | —     | —      | —       |
| Fiyat değiştirme                         | ✓     | —       | —      | —       |
| Personel yönetimi (user CRUD)            | ✓     | —       | —      | —       |
| Şifre değiştir (kendi)                   | ✓     | ✓       | ✓      | ✓       |
| Rapor / günlük kapanış                   | ✓     | R       | —      | —       |
| Mutfak ekranı (KDS)                      | ✓     | R       | R      | ✓       |
| Yazıcı ayarları                          | ✓     | —       | —      | —       |
| Tenant ayarları (cutoff, vergi vb.)      | ✓     | —       | —      | —       |
| Audit log görüntüle                      | ✓     | —       | —      | —       |
| Caller ID logları                        | ✓     | R       | —      | —       |

**Implementation notu**:
- Express middleware: `requireRole('admin', 'cashier')` decorator.
- "Kendi açtığı sipariş" gibi ABAC kuralları middleware sonrası handler içinde — `order.created_by === req.user.sub` kontrolü.
- Permission constants: `packages/shared-types/src/permissions.ts` — string union tipi, `any` yok.
- Yeni endpoint eklendiğinde: bu tabloya satır eklenmesi DoD checklist item'ı.

**Amendment 2026-04-29 (Sprint 6, Görev 24 — settings endpoint):**
"Tenant ayarları" satırı write-only `tenant.settings` action olarak kalır (admin-only). Read için ayrı action eklenir: **`tenant.settings.read`** (admin + cashier). Gerekçe: kasiyer dashboard'unda restoran adı + iş günü cutoff saatinin görünmesi gerek (UI ihtiyacı, Sprint 8a/8d). Action permissions.ts matrix'inde:
- `admin`: `tenant.settings` (write) + `tenant.settings.read` (read)
- `cashier`: yalnız `tenant.settings.read`
- `waiter`/`kitchen`: ikisi de yok

Cross-ref: ADR-006 §5.2 yeni kodlar `SETTINGS_NOT_FOUND` (404) + `SETTINGS_INVALID_TIMEZONE` (400, DB trigger `validate_timezone` çift savunma).

---

### §7 — Print Agent ve Kitchen Display kimliği

**Karar**: **Seçenek A — Uzun ömürlü API key + ayrı `device_credentials` tablosu**. Insan JWT akışından ayrı.

**Gerekçe**:
- Print Agent Windows hizmeti olarak çalışır — her gün login eden kullanıcı yok. Refresh akışı burada gereksiz karmaşa.
- Kitchen Display sabit cihaz; vardiya kavramı yok.
- mTLS (C) operasyonel maliyet (cert yönetimi, rotation) MVP için aşırı.
- Machine JWT (B) üretmek için yine bir credential gerekir → API key'i JWT'ye çevirmek katman ekler, fayda yok.

**Şema**:

```sql
CREATE TYPE device_kind AS ENUM ('print_agent', 'kitchen_display');

CREATE TABLE device_credentials (
  id            UUID PRIMARY KEY,                 -- uuidv7
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  kind          device_kind NOT NULL,
  label         TEXT NOT NULL,                    -- "Mutfak Yazıcısı 1", "KDS Pide Bölümü"
  api_key_hash  TEXT NOT NULL,                    -- bcrypt(api_key), cost 12
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NULL,
  revoked_at    TIMESTAMPTZ NULL,
  CONSTRAINT device_credentials_label_uq UNIQUE (tenant_id, label)
);

CREATE INDEX device_credentials_active_idx
  ON device_credentials (tenant_id, kind)
  WHERE revoked_at IS NULL;
```

**API key formatı**: `pos_<env>_<32-byte-base64url>` (örn. `pos_prod_aB3xK...`). Prefix sayesinde sızdığında grep'le tespit edilebilir (GitHub secret scanning uyumlu).

**Transport**: `Authorization: Bearer <api_key>` header. Cookie yok.

**Doğrulama**: Header'daki key prefix'ten kind çıkarılmaz; `device_credentials` üzerinden bcrypt compare. Performans için tablo küçük (tek tenant ~3-5 row), in-memory cache (60 sn TTL) eklenebilir.

**Rotation**: Admin UI'dan "yeni key üret" → eski `revoked_at` damgalanır, yeni key admin'e bir kere gösterilir (plaintext kayıtsız). Print Agent config dosyasına manuel girilir.

**Roller**: `print_agent` ve `kitchen_display` insan rolü değil — middleware ayrı: `requireDevice('print_agent')`. JWT permission matrix'ine (§6) **eklenmez**, ayrı endpoint scope:
- `print_agent`: yalnız `/print-jobs/*` (claim, ack, fail).
- `kitchen_display`: yalnız `/kds/*` (read orders, mark item ready).

---

### §8 — Password politikası

**Karar**:
- **Hash**: bcrypt, cost factor **12** (~250-300ms/hash, OWASP 2024 önerisi).
- **Min uzunluk**: **10 karakter**. Restoran personeli için (kasiyer, garson) telefonda yazılabilir; >12 karakter dirençle karşılaşır.
- **Karmaşıklık kuralı yok** (NIST 800-63B): büyük/küçük/sayı/sembol zorunluluğu kullanıcıyı `Sifre1!` benzeri zayıf paternlere iter. Uzunluk + breach-list daha etkili.
- **Breach-list kontrolü**: `haveibeenpwned` API entegrasyonu **v5.1** (k-anonymity, prefix endpoint). MVP'de yok ama kapı açık.
- **Timing attack koruması (security-reviewer A3):** Kullanıcı bulunamasa bile **her zaman** sabit-cost bcrypt compare (`bcrypt.compare(password, DUMMY_HASH)`) çalıştırılır. "User not found" ile "wrong password" response süresi eşitlenir → user enumeration imkânsız. `DUMMY_HASH` uygulama başlangıcında bir kere bcrypt ile üretilir, env'den okunur.
- **Lockout**: 5 başarısız denemeden sonra 15 dk lock. **Öncelik: per IP** (saldırgan farklı kullanıcı adı dener → IP engellenir). Per username: exponential backoff (5 deneme → 1dk, 10 → 5dk, 15 → 15dk) — sabit lockout değil, meşru kullanıcıyı DoS'a kapatmaz. `failed_login_attempts` tablosu (TTL 24 saat, ADR-003 §13).
- **Şifre değişikliği**: eski şifre + yeni şifre alır. Başarılı olunca **otomatik logout-all** (§5) — diğer cihazlar zorla çıkar.
- **Şifre sıfırlama**: MVP'de admin manual reset (admin yeni şifre belirler, kullanıcı ilk girişte değiştirmek zorunda — `must_change_password BOOLEAN`). Email-based reset v5.1.

**`users` tablosu auth kolonları**:
```sql
password_hash             TEXT NOT NULL,
password_changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
must_change_password      BOOLEAN NOT NULL DEFAULT false,
last_login_at             TIMESTAMPTZ NULL,
failed_login_count        SMALLINT NOT NULL DEFAULT 0,
locked_until              TIMESTAMPTZ NULL
```

---

### §9 — JWT payload

**Algoritma**: **HS256** (HMAC-SHA256). RS256 değil — tek issuer (kendi API'miz), JWKS dağıtımına gerek yok, simetrik secret operasyonel olarak basit. Secret 256-bit, env'den (`JWT_SECRET`).

**`kid` claim (security-reviewer A5):** Access token header'ına `kid: "v1"` eklenir. MVP'de tek key (`"v1"`), ileride ikinci key (`"v2"`) paralel kullanılır → graceful rotation kesinti yaratmaz. Maliyet sıfır; atlanırsa rotation her kullanıcıyı logout eder. `jsonwebtoken.sign(..., secret, { keyid: process.env.JWT_KID })` — `JWT_KID=v1` env'den okunur.

**Access token claims**:
```json
{
  "iss": "restoran-pos-v5",
  "aud": "restoran-pos-v5-api",
  "sub": "<user_id UUID v7>",
  "tenant_id": "<tenant_id UUID v7>",
  "role": "admin | cashier | waiter | kitchen",
  "jti": "<random UUID v7>",
  "iat": 1714000000,
  "exp": 1714001800,
  "type": "access"
}
```

**Refresh token**: JWT **değil**, opaque random string (§4.2). Backend SHA-256 hash ile lookup yapar.

**Açıklamalar**:
- `iss` + `aud`: token misuse'a karşı (başka servisin token'ı kabul edilmez). Doğrulama `jsonwebtoken.verify(..., { issuer, audience })`.
- `tenant_id` claim: her istekte DB lookup'a gerek yok — multi-tenant izolasyon middleware'i bu claim'i kullanır. **Asla request body / query'den alınmaz** (IDOR riski).
- `role` claim: tek role (kullanıcı tek rol taşır — §1 tenant-scoped users). Multi-role v5.1+.
- `jti`: log korelasyonu, ileride access token denylist (revoke list) için kapı.
- `type`: `access | refresh` ayrımı — refresh JWT olmasa da audit log'da type kullanılır.
- **Hassas veri yok**: email, phone, password — hiçbiri claim'e girmez. JWT base64-decode edilebilir, PII içermemeli (KVKK).

**Audit log IP doldurma kuralı (ADR-003 §6.5 forward-ref kısmi resolve)**:
- `audit_logs.ip_address` Express `req.ip` ile doldurulur (trust proxy = 1, Hetzner Caddy/nginx önünde).
- KVKK: IP kişisel veridir; retention 2 yıl (ADR-003 §13'e uygun), erişim sadece `admin`. Anonimleştirme (son oktet maskeleme) v5.1'e ertelendi (operasyonel ihtiyaç çıkarsa).

---

### Alternatifler

- **Users global + junction table** (§1 alternatif B): Reddedildi — MVP'de aşırı, super-admin yok. Geçiş yolu açık.
- **Web'de cookie-only (access dahil cookie)**: Reddedildi — access token'ı cookie'de tutmak CSRF surface'i genişletir, custom header korumasını her endpoint'te zorlar. In-memory access daha temiz.
- **Web'de localStorage Bearer**: Reddedildi — XSS'te tüm token sızar. SameSite=Strict cookie XSS'e dayanıklı.
- **Stateless refresh JWT** (§4 alternatif A): Reddedildi — revoke imkânsız, restoran ortamında kabul edilemez (işten ayrılan personel).
- **Sade DB-backed refresh** (§4 alternatif B): Reddedildi — çalınan token'ın kullanıldığı tespit edilemez, RTR şart.
- **Machine JWT for Print Agent** (§7 alternatif B): Reddedildi — refresh akışı makine için anlamsız, API key daha basit ve operasyonel olarak doğru araç.
- **mTLS** (§7 alternatif C): Reddedildi — cert yönetimi MVP için aşırı.
- **bcrypt cost 10**: Reddedildi — 2026'da OWASP minimum 12 öneriyor; ~250ms login penalty kabul edilebilir.
- **Password karmaşıklık kuralları**: Reddedildi — NIST 800-63B'ye aykırı, kullanıcıyı zayıf paternlere iter.
- **15 dk access token**: Reddedildi — restoran vardiyasında çok sık refresh, ağ kesintisinde UX kırılır.
- **24 saat access token**: Reddedildi — çalınma penceresi kabul edilemez.
- **RS256 JWT**: Reddedildi — tek issuer, simetrik secret yeterli, operasyonel basitlik.

### Sonuçlar

**Pozitif**:
- (+) Web'de XSS ve CSRF her ikisine de savunma (HttpOnly cookie + SameSite=Strict + in-memory access).
- (+) Mobil'de OS-level secure storage (Keychain/Keystore).
- (+) RTR + reuse detection: çalınan refresh token kullanıldığında otomatik tespit + tüm session invalidate.
- (+) "Tüm cihazlardan çıkış" + "admin force-logout" mümkün — restoran personel turnover'ına uygun.
- (+) Makine kimliği insan auth'tan ayrı — Print Agent'a JWT refresh karmaşıklığı yüklenmez.
- (+) Tenant izolasyonu JWT claim'inden gelir, her istekte DB lookup yok — performans iyi.
- (+) ADR-003 §6.5 (a) resolve edildi: tenant-scoped users.
- (+) NIST 800-63B uyumlu password policy — modern ve kullanıcı dostu.
- (+) JWT payload PII içermez (KVKK).

**Negatif / Ödünleşim**:
- (−) Access token 30 dk → revoke gecikme penceresi 30 dk. Kabul edilebilir; hassas işlemler için ileride "fresh auth" eklenebilir.
- (−) Web ve mobile farklı transport → backend `req.cookies.refresh_token ?? req.body.refresh_token` ikili okuma. Kod karmaşıklığı küçük.
- (−) `refresh_tokens` tablosu büyür: 30 gün × N user × M cihaz. TTL cron (ADR-003 §13) revoke+expired olanları temizler. Tek tenant + ~10 user × ~3 cihaz = ~900 satır steady-state, sorunsuz.
- (−) RTR race condition riski: aynı refresh token paralel iki istek geldiğinde biri 401 alır. `SELECT FOR UPDATE` ile çözüldü ama client retry mantığı dikkatli yazılmalı (qa-engineer test yazacak).
- (−) Junction tablosu eklenirse (v6) migration karmaşık — ama kapı açık, dokümante edildi.
- (−) bcrypt cost 12: login ~300ms. 5 paralel login senaryosunda Node event loop bloklanmaz (worker thread / native bcrypt async). Yine de monitor edilmeli.
- (−) HS256 tek shared secret — key compromise tüm tenant'ı etkiler. `kid: "v1"` ile graceful rotation kapısı açık (§9), ikinci key ekleme v5.1.
- (−) Audit IP retention 2 yıl, KVKK aydınlatma metnine eklenmeli (admin UI'da "Veri saklama politikası" sayfası — implementer gate).

### Açık takip maddeleri

1. JWT secret rotation için ikinci key (`kid: "v2"`) paralel kullanımı — v5.1 (`kid: "v1"` §9'da zaten mevcut).
2. Email-based password reset — v5.1.
3. haveibeenpwned breach-list entegrasyonu — v5.1.
4. Audit IP anonimleştirme (son oktet) — operasyonel ihtiyaç çıkarsa.
5. Access token denylist (jti tabanlı) — hassas işlem revoke için, v5.1.
6. KVKK aydınlatma metni admin UI'da — implementer DoD item'ı.

---

### §10 — User Lifecycle: Soft Delete + Token Revoke + Last Admin Guard

**Bağlam**: §1-9 user'ın yaratılması ve auth akışını tanımladı; silinmesi tanımsız kaldı. Phase 2 Sprint 3b `DELETE /users/:id` endpoint'i bu kararı bağlayıcı kabul eder. ADR-003 §8 (soft vs hard delete) `users` için "referans varsa soft" kuralı koymuş — `audit_logs.actor_user_id` FK mevcut (ADR-003 §12), dolayısıyla soft delete zorunlu.

#### §10.1 — Soft delete davranışı

**Karar**: `users` üzerinde **soft delete** — `deleted_at TIMESTAMPTZ NULL` kolonu set edilir. Hard delete yok.

- `password_hash` **silinmez / null'lanmaz** — audit kanıtı (silinen kullanıcının o tarihteki credential izi, "şifre buydu" kanıtlamaz ama "kullanıcı vardı" kanıtlar).
- `email` ve `username` korunur. Mevcut `users_tenant_email_ci_idx` (migration 003: `UNIQUE (tenant_id, lower(email))`) **full UNIQUE** — partial değil. Soft delete sonrası aynı email yeniden register edilemez; bu MVP'de **kabul edilen kısıt** (hesap silindi → aynı email yeni kullanıcıya verilmez, denetim izi korunur). Email UNIQUE partial-leştirmesi (yeniden kullanılabilirlik) **v5.1 forward-ref**.
- `username` üzerinde UNIQUE constraint **mevcut şemada yok** (000_init users tablosu yalnız `(id, tenant_id)` composite PK UNIQUE'i taşır). Bu §10 kapsamı dışı ayrı bir tutarsızlık — Sprint 0/1 borç olarak ayrı issue açılır, §10'da çözülmez (context-anchor §2 'Açık stratejik borçlar' listesinde takip edilir).
- KVKK anonimize akışı (silinen kullanıcının PII'sini hash veya null'lama) **v5.1 backlog** — MVP'de retention ADR-003 §13 business-record kuralı geçerli (kalıcı).

#### §10.2 — Self-delete guard

**Karar**: `req.user.sub === id` ise **403 `USER_CANNOT_DELETE_SELF`** dönülür.

- **Neden 403, 422 değil**: 422 (Unprocessable Entity, RFC 9110 §15.5.21) request body'nin **semantic parse** hatası içindir (ör. zod refine başarısız). Burada body geçerli; reddedilen şey **actor=target** ABAC kuralı. Bu ABAC reddi RFC 9110 §15.5.4 (403 Forbidden) tanımına uyar: "server understood the request but refuses to authorize it".
- **Neden 403, 409 değil**: 409 (Conflict, RFC 9110 §15.5.10) **kaynağın mevcut state'iyle** çatışmayı ifade eder (ör. başka transaction kaydı değiştirdi). Self-delete reddedilmesi state çatışması değil — kaynak müsait, aktör uygun değil. İlişki kuralı 403 ile ifade edilir.

#### §10.3 — Last admin guard

**Karar**: Bir tenant'ta **aktif (deleted_at IS NULL) admin sayısı 1 ise**, son admin'in soft-delete'i reddedilir → **409 `USER_LAST_ADMIN_PROTECTED`**.

- **Neden 409**: RFC 9110 §15.5.10 — "request could not be completed due to a conflict with the current state of the target resource". Tenant'ın "en az bir admin" invariant'ı kaynak state'inin parçasıdır; bu invariant'ı bozan istek state conflict üretir. 422 (semantic parse) değil; 403 (aktör yetkisiz) değil — aktör admin, izin var, fakat sistem invariant'ı engelliyor.

#### §10.4 — Atomicity kontratı (race condition)

İki admin paralel olarak birbirini (veya kendini) silmeye kalkarsa naif kontrol (önce SELECT count, sonra UPDATE) yarış üretir: ikisi de "2 admin var" görür, ikisi de UPDATE atar, son admin sıfırlanır. Önlem: **tek transaction + satır kilidi**.

```sql
BEGIN;

-- 1) Self-delete guard handler katmanında zaten reddedildi (§10.2).

-- 2) Hedef kullanıcı admin mi? Aktif admin sayısını kilitleyerek say.
SELECT count(*) AS active_admin_count
FROM users
WHERE tenant_id = $1
  AND role     = 'admin'
  AND deleted_at IS NULL
FOR UPDATE;
-- count = 1 ve hedef admin ise → ROLLBACK + 409 USER_LAST_ADMIN_PROTECTED

-- 3) Soft delete.
UPDATE users
SET deleted_at = now()
WHERE id = $2
  AND tenant_id = $1
  AND deleted_at IS NULL;
-- affected_rows = 0 ise → ROLLBACK + 404 RESOURCE_NOT_FOUND (hedef yok / zaten silinmiş)

-- 4) Refresh token revoke (§10.5).
UPDATE refresh_tokens
SET revoked_at     = now(),
    revoked_reason = 'user_deleted'
WHERE user_id = $2
  AND revoked_at IS NULL;

-- 5) Audit log entry (§10.7) — gerçek audit_logs şemasıyla.
INSERT INTO audit_logs (id, tenant_id, actor_user_id, actor, event_type, entity_type, entity_id, payload, created_at)
VALUES ($auditId, $1, $actorAdminId, $actorJson, 'user.soft_delete', 'user', $2, $payloadJson, now());

COMMIT;
```

`FOR UPDATE` ikinci paralel transaction'ı bloklar; ilk COMMIT'te ikinci transaction güncel sayıyı görür (`count = 0` veya hedef satır artık `deleted_at IS NOT NULL`) → 409 veya 404 döner. Default-deny garanti.

#### §10.5 — Refresh token revoke

**Karar**: Soft delete COMMIT'inden önce `refreshTokens.revokeAllForUser(userId, reason='user_deleted')` çağrılır (transaction içinde — §10.4 step 4). `refresh_tokens.revoked_reason` kolonu **TEXT** (ENUM değil; 002_add_refresh_tokens.sql doğrulandı), dolayısıyla yeni değer için migration gerekmez — `'user_deleted'` standart değer kümesine eklenir (002 dosyasındaki yorum satırı `'logout'|'rotated'|'reuse_detected'|'admin_force'|'all_sessions'|'user_deleted'` olarak güncellenir).

**Merged migration disiplin notu**: Migration 002 zaten merged ve prod fresh DB'ler bu dosyayla geliyor. Bu güncelleme **yalnız SQL yorum satırı (`--`) değişikliğidir** — CREATE TABLE / CREATE INDEX / GRANT ifadeleri dokunulmaz, runtime SQL semantiği değişmez, migration idempotency korunur, geçmiş prod uygulamaları geriye dönük etkilenmez. "Merged migration dokunulmaz" prensibi runtime davranışı içindir; dökümantasyon yorumu istisnadır. db-migration-guard review bu istisnayı doğrular.

**Refresh akışı davranışı (§10 self-contained, §4.3 metni dokunulmaz):** Silinmiş kullanıcı `POST /auth/refresh` isteği gönderirse — token DB'de bulunur ama `revoked_at IS NOT NULL`. §4.3 step 4 ("REUSE DETECTED" → family-wide revoke) branch'inden **önce** §10.5 ek-kontrolü çalışır: `revoked_at IS NOT NULL AND revoked_reason = 'user_deleted'` ise 401 `AUTH_REFRESH_INVALID` döner, family-wide revoke tetiklenmez (zaten hepsi revoked). §4.3 sözleşmesi genişletilir, değiştirilmez — §10.5 §4.3'ün üstüne yeni branch tanımlar.

#### §10.6 — Login filter

**Karar**: `usersRepository.findByEmail(email)` ve `findById(id)` query'lerine `AND deleted_at IS NULL` filtresi eklenir.

- Silinmiş kullanıcının login denemesi → user "bulunamamış" gibi davranılır → §8 timing-attack koruması gereği **dummy bcrypt compare çalışır** → 401 `AUTH_INVALID_CREDENTIALS` (mevcut kod, ADR-006 §5.1).
- **Neden ayrı `ACCOUNT_DISABLED` kodu yok**: User enumeration sızıntısı — saldırgan "hesap silindi" cevabı ile "şifre yanlış" cevabını ayırt ederse hangi email'in sistemde **olduğunu** öğrenir. KVKK ve OWASP ASVS V2 (auth) gereği auth hata yüzeyi tek mesaj olmalı. Timing eşitliği §8'de zaten kuruldu.

#### §10.7 — Audit log entry

**Karar**: Soft delete operasyonu `audit_logs` tablosuna kayıt edilir (§10.4 step 5). Gerçek şema (000_init.sql) kolonlarıyla:

- `id` = uuidv7 (app-side, ADR-003 §3)
- `tenant_id` = silinen kullanıcının tenant'ı
- `actor_user_id` = silen admin (`req.user.sub`)
- `actor` (JSONB) = `{ "role": "admin" }` — sanitize edilmiş aktör metadata. **Yalnız `role`** saklanır (forensic context: "kim sildi" sorusunun rolünü ayırmak için, audit_user_id zaten kim'i veriyor; role audit retention süresince stabil snapshot). JTI saklanmaz — access token'ın benzersiz id'si forensic değer üretmez (audit zaten user_id + timestamp + event_type ile kim/ne/ne zaman'ı kapsar), JTI denylist senaryosu MVP'de yok (§10.8 v5.1 forward-ref). YAGNI: gerekçesiz alan eklenmez.
- `event_type` = `'user.soft_delete'` — TEXT kolonu, CHECK regex `^[a-z_]+\.[a-z_]+$` ile uyumlu (000_init.sql doğrulandı)
- `entity_type` = `'user'`
- `entity_id` = silinen user id
- `payload` (JSONB) = `{}` boş bırakılır; silinen kullanıcının PII'sini buraya koymak deny-list ihlali (`email`, `password_hash`, `phone` vd. yasak, `audit_logs_payload_no_pii` CHECK constraint reddeder)

**IP adresi `audit_logs`'a yazılmaz** — şemada IP kolonu yok ve `payload` JSONB deny-list'i `'ip'` ve `'ip_address'` anahtarlarını yasaklar (000_init.sql `audit_logs_payload_no_pii` CHECK). IP application log'a (pino) yazılır, audit'e değil. Bu mimari bir karar (§12 deny-list ile uyumlu).

Retention ADR-003 §13 audit-log kuralına tabi (2 yıl).

#### §10.8 — Access token risk window — kabul edilen risk

**Karar**: Access token TTL 30dk (§3). Soft delete sonrası mevcut access token, süresi dolana kadar (max 30dk) handler'ları çalıştırabilir. Refresh akışı kesilmiş olduğundan (§10.5) yeni access üretilemez; risk penceresi tek access token ömrüyle sınırlıdır.

- **Neden kabul edilebilir**: §3 gerekçesinde 30dk çalınma penceresi tüm token'lar için zaten kabul edildi; soft delete bu pencerenin özel bir vakası. Stateless JWT performansı (her istekte DB lookup yok) korunur.
- **Reddedilen alternatif — JTI denylist**: Her access verify'da `revoked_jti` lookup yapılması istek başına +1 DB roundtrip getirir (~5-15ms p50 yük altında). MVP'de gerekçesiz maliyet → **v5.1 forward-ref**: §5 "force-logout" + hassas işlem "fresh auth" ihtiyacıyla birlikte gündeme gelir.
- **Reddedilen alternatif — Compensating control ("zorla çıkar" admin UI butonu)**: Admin'e "30dk beklemek istemiyorum, hemen at" UX'i v5.1 backlog. MVP'de **yok** — sessiz feda değil, kabul edilen risk olarak işaretli.

Bu pencerenin bilinçli kabulü §10'un parçasıdır; "unutuldu" yorumlanmasın diye explicit yazıldı.

#### §10.9 — Handler dışı precondition

`DELETE /users/:id` rotası ADR-002 §6 role matrix'te **admin-only** ("Personel yönetimi (user CRUD)" satırı). §10 bu yetkinin önceden doğrulandığını kabul eder; §10.2-10.3 guard'ları rol kontrolünden sonra çalışır. Yetkisiz aktör 403 `ACCESS_DENIED` (ADR-006 §5.2) ile zaten reddedilir.

#### §10.10 — Amendment 2026-05-01: Soft delete → Hard delete

**Bağlam:** Sprint 6'da yazılan §10.1 soft delete kararı, Görev 35 (Users UI, Session 49) manuel testinde UX problemi üretti: silinmiş kullanıcının email'i `users_tenant_email_ci_idx` UNIQUE constraint'i nedeniyle yeniden kullanılamıyor. Restoran operasyonunda bu yaygın senaryo (personel ayrılır, aynı email ile yeni hesap açılır). Soft delete'in audit/recovery faydası bu UX maliyetini karşılamıyor.

**Karar:** `users` üzerinde **hard delete** — `DELETE FROM users WHERE id = $1` doğrudan satırı kaldırır. `deleted_at` kolonu kaldırılır.

**FK ON DELETE davranışları:**
- `audit_logs.actor_user_id` → **SET NULL** ✅ (000_init.sql line 358, mevcut) — audit kaydı kalır, "kim sildi" NULL olur
- `orders.waiter_user_id` → **SET NULL** ✅ (005 migration, mevcut) — sipariş geçmişi korunur, garson NULL
- `refresh_tokens (user_id, tenant_id)` → **CASCADE** (Migration 018'de RESTRICT default'undan değiştirilir) — refresh token satırları otomatik silinir

**§10.1 / §10.4-10.7 etkileri:**
- §10.1 (`deleted_at` damgalama) → `DELETE FROM users`. `deleted_at` kolonu schema'dan kaldırılır.
- §10.4 atomicity transaction'ı: FOR UPDATE + count guard korunur; UPDATE `SET deleted_at = now()` yerine `DELETE FROM users`. Self-delete (§10.2) + last admin (§10.3) guard'ları **aynen kalır**.
- §10.5 refresh token revoke transaction step → kaldırılır (CASCADE otomatik). `'user_deleted'` `revoked_reason` enum değeri ölü kalır (refresh_tokens satırı CASCADE ile zaten yok olur).
- §10.6 login filter `deleted_at IS NULL` → kaldırılır (silinen satır yok). `findByEmail` / `findById` filtresiz çalışır. Timing-attack korumasını etkilemez.
- §10.7 audit event_type → `'user.soft_delete'` → `'user.deleted'` (yeni event_type, eski mevcut kayıtlar tarihsel veri olarak kalır).

**Recovery imkânsızlığı (kabul edilen risk):** Yanlışlıkla silme geri alınamaz. UI delete dialog'u "kalıcı silinir, geri alınamaz" sert tonu kullanır (Görev 35 PR'ı). Operasyonel önlem: admin-only + last-admin guard + self-delete guard + rate-limit (mevcut, korunur). Bu kombinasyon kazara silmeyi pratik düzeyde önler.

**KVKK perspektifi:** Hard delete varsayılan davranış olarak "kullanıcı kaydı yok edilir" beklentisini doğrudan karşılar. `audit_logs.actor_user_id` SET NULL → audit kaydı kalır ama silinmiş kullanıcının PII'si yok (audit_logs payload deny-list zaten PII'yi engelliyor — §10.7). Resmi "veri silme talebi" akışı (kullanıcı portalı + 30 gün cooldown) v5.1+ ekstrası, MVP scope dışı.

**Reddedilen alternatifler:**
- **A. Partial UNIQUE index** (`WHERE deleted_at IS NULL`): email reuse problemini çözer ama soft delete'in tüm karmaşıklığı (filter, recovery yok, KVKK belirsiz) korunur. Ek değer üretmez.
- **B. Soft delete + "undelete" UI**: recovery hayali, MVP'de gerçek talep yok. UI ekstra ekran/onay/audit gerektirir. YAGNI.

**Migration 018 (DoD):**
1. `ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_user_id_tenant_id_fkey, ADD … ON DELETE CASCADE`
2. `DELETE FROM users WHERE deleted_at IS NOT NULL` (mevcut soft-deleted satırlar gerçekten silinir; CASCADE refresh_tokens'ı otomatik temizler)
3. `ALTER TABLE users DROP COLUMN deleted_at`
4. `db-migration-guard` review

**Backend etkileri:**
- `packages/db/src/repositories/users.ts`: `softDelete` → `hardDelete` (DELETE FROM); `findMany` / `findById` / `countActiveAdmins` query'lerinden `deleted_at IS NULL` filtreleri kaldırılır
- `apps/api/src/routes/users.ts`: DELETE handler'ında manuel `refresh_tokens` revoke UPDATE'i kaldırılır (CASCADE); audit event_type `'user.deleted'`

**Cross-ref:** Görev 35 (PR pending), Migration 018, ADR-003 §8 ("referans varsa soft" kuralı bu amendment ile **users özelinde override** edilir — gerekçe: FK ON DELETE SET NULL/CASCADE birlikte kanıt + recovery'i çözüyor).

#### §10.11 — Amendment 2026-05-08: Username Uniqueness (Sprint 0/1 borç kapanışı)

**Bağlam:** §10.1 (Sprint 6) `username` UNIQUE eksikliğini açıkça borç işaretledi: "username üzerinde UNIQUE constraint mevcut şemada yok... bu §10 kapsamı dışı ayrı bir tutarsızlık — Sprint 0/1 borç olarak ayrı issue açılır." Migration 018 (Session 49) `users.deleted_at` kolonunu DROP edip hard-delete davranışına geçirdiğinden, "soft-delete edilmiş duplicate username" karmaşıklığı ortadan kalktı. Bu amendment borcu kapatır.

**Karar:** `users (tenant_id, lower(username))` üzerinde **full UNIQUE index** — case-insensitive, hard-delete pattern ile uyumlu (partial WHERE clause gerekmez).

- **Index adı:** `users_tenant_username_ci_idx` (Migration 003 email index `users_tenant_email_ci_idx` ile paralel naming).
- **Email index** (`users_tenant_email_ci_idx`, Migration 003) zaten full UNIQUE — username bu sözleşmeye katılır.
- **Login akışı `findByEmail`** üzerinden çalışmaya devam eder; `username` yalnız display + audit (orders.waiter snapshot). Yine de duplicate username yaratımı UI'da kafa karışıklığı doğurur ("Garson Ali" iki kişi) → app-level guard zorunlu.
- **Storage:** `username` AS-IS saklanır (case korunur); UNIQUE check `lower()` ile (current pattern korunur).

**Error code (ADR-006 §5.2):**
- `USER_USERNAME_ALREADY_EXISTS` (409) — `POST /users` veya `PATCH /users/:id` UNIQUE violation.
- `USER_EMAIL_ALREADY_EXISTS` (409) — paralel olarak bu amendment ile eklenir; mevcut Migration 003 email index'i runtime'da silent DB error (500) riski taşıyordu, application-level handler eksik.

**Reddedilen alternatif:** Partial UNIQUE `WHERE deleted_at IS NULL` — geçersiz, kolon Migration 018 ile DROP edildi.

**Cross-ref:** Migration 033 `033_users_username_unique.sql`, ADR-006 §5.2 amendment (+2 kod), anchor §2 borç kapanışı.

---

### Referanslar

- ADR-003: DB Şema İlkeleri (§6.5 forward-ref `users.tenant_id` kararı bu ADR §1'de resolve; §12 `audit_logs.ip_address` doldurma kuralı bu ADR §9 sonunda).
- ADR-001: Monorepo yapısı — `packages/shared-types/src/permissions.ts` ve `packages/shared-types/src/auth.ts` zod şemaları bu ADR'nin somut çıktıları.
- CLAUDE.md: Auth kilidi (JWT + bcrypt), roller (admin/cashier/waiter/kitchen), Redis yok kısıdı.
- OWASP ASVS 4.0 (auth controls).
- NIST SP 800-63B (password guidelines).
- RFC 6749 / RFC 6750 (OAuth 2.0 + Bearer Token).
- RFC 7519 (JWT).

<!-- ADR-002 ✓ (Session 20, 2026-04-25) — Accepted; architect sub-agent + security-reviewer (0 BLOCKER + 5 CONCERN-A mini-pass + 5 CONCERN-B follow-up + 11 GREEN); ADR-003 §6.5 (a) users tenant-scoped resolve -->

## ADR-004: Print Agent Mimarisi

- **Durum**: Accepted
- **Tarih**: 2026-04-25 (Draft) → 2026-04-25 Accepted (Session 25, Phase 2 başı)
- **Yazım notu**: Phase 1 hafta 3-4 (Session 24) Draft olarak başlatıldı — Phase 1 exit kriteri. Session 25 (Phase 2 başı) `architect` sub-agent 8 açık soruyu yanıtlayıp Accepted'a çevirdi. Bu blok artık Phase 2 API katmanı (`print_jobs` tablosuna yazan endpoint'ler) için bağlayıcıdır. Agent kodu hâlâ Phase 4+ — bu ADR yalnız protokol/karar sınırını çeker, `apps/print-agent/` dosyaları YOK.

### Bağlam

v3 (Electron monolit) yazıcı katmanı: StoreBridge denilen lokal Node.js modülü, Electron app içinde çalışırdı. ESC/POS protokolü, CP857 karakter seti, USB ve TCP 9100 yazıcılar. v3'te tek-makine + tek-yazıcı/secondary-printer override mantığı, elle Windows kurulumu, lokal stack içinde tightly-coupled.

v5 cloud-first mimari: API Hetzner Almanya'da, restoran PC'si lokal ağda. Yazıcılar restoran ağında (USB/local-IP). Cloud'dan doğrudan yazıcıya basmak fiziksel olarak mümkün değil — restoran public IP genelde yok, port-forward KVKK/güvenlik açısından risk.

Çözüm: Cloud API'de print job kuyruğu (`print_jobs` tablosu — ADR-003 §13'te tanımlı: `id`, `tenant_id`, `payload`, `status`, `attempts`, `created_at`, `processed_at`, `error_text`, `dead_letter_at`), restoran PC'sinde küçük bir Windows hizmeti (`apps/print-agent/`) cloud'dan job çeker, ESC/POS byte stream'i yazıcıya gönderir.

**v3 StoreBridge kodu ÖLÜ — copy-paste yasak (CLAUDE.md "v3'ten taşıma kuralı").** Yalnız davranışsal referans:
- `docs/v3-reference/printer-notes.md` — CP857 karakter set kuralı, ESC/POS başlangıç/cut komutları, v3'te kullanılmış kontrol kodları
- `docs/v3-reference/pain-points.md` — v3'te yaşanan yazıcı sorunları (kurulum zorluğu, network reset davranışı, encoding bozulmaları), bu ADR'nin önlemesi gereken hataların öğretileri

Phase 1 sonu Draft olarak yazılmasının nedeni: Phase 2 sipariş + masa + menü domain'i için API katmanı `print_jobs` tablosuna yazmaya başlamadan önce mimarinin ana hatları sabitlenmiş olmalı; ancak Agent kodu Phase 4+ (yazıcı entegrasyonu) sprint'inde yazılacağı için tam şema/protokol detayı şimdi gerekli değil. Bu Draft, kapsam kilidini koruyarak (yeni özellik eklenmemesi) ve Phase 2 API tasarımına yön vermek için "sınırı çek" amaçlı.

### Karar (yüksek seviye + Phase 2 başı kesinleşen 8 soru yanıtı)

1. **Print Agent yeri:** `apps/print-agent/` — Node.js 22, TypeScript strict, küçük tek-process Windows hizmeti. Repo yapısı CLAUDE.md "Repo yapısı" bölümüyle uyumlu. Build çıktısı standalone executable veya `node`+script (Phase 2'de paketleme detayı).

2. **Job transport (CHOICE — Draft önerisi):** **HTTP long-polling** (Agent → Cloud `GET /print/jobs/next?wait=...`). Gerekçe:
   - Restoran NAT/firewall arkasında daha güvenilir (outbound HTTP TLS hep çalışır, WebSocket bazen reset edilir)
   - Auth basit (Bearer JWT header), TLS HTTPS mevcut
   - Latency 3-5sn restoran için tolere edilebilir (mutfak fişi 3sn'de basılırsa kullanıcı için kabul)
   - Tek connection per Agent, sunucu tarafı bookkeeping minimal
   - **Karar (Phase 2 başında kesinleşti, Yanıtlandı §Soru #1 + #2):** HTTP long-polling **seçildi**, Socket.IO **reddedildi** (NAT reset reconnect karmaşıklığı + hibrid transport gereği yok). Polling interval **5 saniye sabit** (3sn agresif, 10sn yoğun saatte kuyruk birikmesi; 5sn restoran operasyonu için "neredeyse anlık" + sunucu yükü makul). Adaptive polling **reddedildi** (kapsam genişlemesi).

3. **Job state machine (ADR-003 §13 ile uyumlu):**
   ```
   pending → printing → printed                     (success)
   pending → printing → failed → retry (≤3) → ...
                              ↓ (3 deneme aşıldı)
                           dead_letter
   ```
   - Backoff: 60sn sabit (ADR-003 §13). Phase 2'de exponential backoff değerlendirilecekse ek karar.
   - `attempts` counter `print_jobs.attempts` kolonunda artırılır (ADR-003 §13).
   - `dead_letter_at` set edilince Manager UI'da görünür liste (Phase 4+ UI).
   - Atomik state geçişi: `UPDATE ... WHERE status='pending' RETURNING ...` — race condition yok (single Agent per tenant Phase 1-3, multi-Agent isolation Phase 5+).

4. **ESC/POS render katmanı — Cloud-side render, Agent dumb-client:**
   - Template parametreleri (sipariş kalemleri, tutar, KDV, tarih, tenant başlığı) **cloud'da** render edilir.
   - Cloud → Agent payload: hazır ESC/POS byte stream (base64 encoded, `print_jobs.payload` JSONB içinde).
   - Agent yalnız transport: byte stream alır, hedef yazıcıya yazar (USB write veya TCP 9100 socket).
   - Gerekçe:
     - Template değişikliği Agent deploy'u gerektirmez (multi-tenant farklı şablon)
     - Multi-tenant template per `tenant_id` cloud DB'de tutulur
     - Agent versiyonlama yükü düşer; Agent yıllarca aynı kalabilir
     - Test edilebilirlik: render fonksiyonu pure (input → byte stream), unit test kolay
   - **Risk:** payload boyutu büyük olabilir (uzun adisyon = ~5-10 KB byte stream). Phase 2'de boyut sınırı belirlenecek (örn. 64 KB job limit).

5. **Yazıcı bağlantısı (Agent tarafı):**
   - **USB öncelikli** (v3'teki ana yol; ESC/POS USB driver veya raw write)
   - **TCP 9100 fallback** (network printer, sabit local IP)
   - Konfigürasyon: Agent'ın local config dosyasında (`%PROGRAMDATA%/restoran-pos/print-agent.json`) — yazıcı tipi, USB device ID veya IP:port, encoding (sabit CP857 v5 MVP).
   - Config dosyası ilk kurulumda elle veya kurulum sihirbazıyla doldurulur (kurulum paketi seçimi açık soru #3).

6. **Auth (Agent ↔ Cloud):**
   - **Per-tenant API key** (Manager UI'dan üretilir, Agent kurulumu sırasında elle girilir) + **per-device installation token** (Agent ilk boot'ta `POST /print/agent/register` çağrısıyla cloud'a kaydolur, JWT alır).
   - JWT short-lived (örn. 1 saat); Agent expire öncesi yeniler (`/print/agent/refresh`).
   - Polling header: `Authorization: Bearer <agent-jwt>`.
   - Rate limit per Agent (DDoS koruması): Phase 2'de detaylanacak.
   - Detaylı protokol şeması (request/response zod schemas) Phase 2'de `packages/shared-types/print-agent.ts` içinde.

7. **Türkçe karakter encoding:**
   - **CP857 (Latin-5 Türkçe)** — v3'te de bu kullanıldı, ESC/POS Türk yazıcılarda standart.
   - Cloud render byte stream'inde encoding sabit; Agent dönüşüm yapmaz.
   - **ASCII fallback yok** — "ş→s, ı→i" gibi degraded mode yasak (ürün adı bozulması KVKK/işletme dokümanı için kabul edilemez).
   - Yazıcı CP857 desteklemiyorsa (eski model) → kullanıcı yazıcı değiştirmeli; bu kapsam dışı.

### Alternatifler (kısaca)

- **Socket.IO (WebSocket) transport:** Real-time düşük latency, ama restoran NAT/firewall reset'lerinde reconnect mantığı karmaşık. Phase 5+ multi-restoran ölçeklenmesinde gerekirse upgrade düşünülür. **Reddedildi (Draft):** MVP için fazla mühendislik; HTTP polling yeterli.
- **Lokal API (Agent server, cloud çağırır):** Cloud → restoran direct call, restoran public IP gerektirir, port-forward + dynamic DNS, KVKK/güvenlik riski (saldırı yüzeyi büyür). **Reddedildi:** restoran ağı topolojisiyle uyumsuz.
- **Direkt cloud → yazıcı:** Yazıcı internete direkt bağlı değil, fiziksel olarak imkânsız. **Reddedildi.**
- **Render Agent-side (template Agent'da):** Agent karmaşıklaşır, multi-tenant şablon dağıtımı zor, Agent deploy frekansı artar. **Reddedildi:** dumb-client ilkesi tercih edildi.
- **Print Agent yerine v3 Electron yeniden kullanma:** CLAUDE.md "Electron yok. Lokal SQLite yok." kuralıyla çelişir. **Reddedildi by constitution.**

### Sonuçlar

- **(+)** Cloud'da render: template değişikliği Agent deploy gerektirmez. Multi-tenant per-tenant şablon doğal olarak desteklenir.
- **(+)** HTTP polling: NAT/firewall problemi minimum, Agent kodu basit, debugging kolay (HTTP log).
- **(+)** Multi-tenant kuyruk: `print_jobs.tenant_id` partition. Phase 5'te per-tenant queue isolation kolay.
- **(+)** Network kesintisi davranışı netleşmiş: Agent offline iken job'lar cloud'da birikir; Agent online olunca FIFO sıralı işler (kuyruk doğal recovery).
- **(+)** Yazıcı hatası izlenebilir: 3 deneme + dead-letter → Manager UI'da "yazdırılamadı" listesi (Phase 4+).
- **(+)** v3 pain-point'i (elle kurulum) kurulum paketi kararıyla (açık soru #3) çözülecek.
- **(−)** Latency 3-5sn (polling interval): real-time değil. Mutfak fişi gecikme tolere edilir, ancak yoğun saatte 5sn × 10 sipariş = algılanan yavaşlık olabilir; Phase 2'de yük testi gerekli.
- **(−)** Dumb-client render: payload boyutu büyük (byte stream). Cloud bant genişliği yükü Agent'a kıyasla artar; tek tenant için ihmal edilebilir, Phase 5+ multi-tenant'ta izlenmeli.
- **(−)** CP857 sabit: yeni yazıcı modeli UTF-8 destekliyorsa bile encoding upgrade yapmıyoruz (v5.1+ kararı).
- **(−)** Single-Agent assumption (Phase 1-3): aynı tenant'ta 2 Agent çalıştırılırsa job duplicate riski. Phase 5+ multi-Agent için ayrı ADR gerekli.
- **KVKK:** print job içeriğinde müşteri adı/telefon olabilir → `audit_logs`'a job içeriği YAZILMAZ (sadece "job-id X printed" event'i), job tamamlanınca payload soft delete + 90 gün retention (`dead_letter_at` veya `processed_at` + 90gün cron temizler — birleşik cron ADR-003 §16). Detay job retention politikası Phase 2'de.
- **Audit:** print job state geçişleri `audit_logs`'a `print_job.state_change` event'i olarak yazılır (Audit Event Taxonomy ADR'sinde format kesinleşecek). Payload özeti (job-id, status, attempts) — müşteri PII **hariç**.

### Yanıtlandı (Phase 2 başı, Session 25, 2026-04-25)

8 açık soru `architect` sub-agent tarafından kullanıcı (İlhan) öncelik hiyerarşisi ("operasyonel güvenirlik > teknik zarafet") + CLAUDE.md kapsam kilidiyle uyumlu yanıtlandı. Her yanıt Karar bölümünün ilgili maddesine bağlanır; "v5.1 backlog" işareti olan kalemler ayrıca **`docs/v3-reference/pain-points.md` v5.1 backlog** dosyasına yansıtılacak (ayrı görev — bu pass dışı, takip için aşağıda flag'lendi).

**Soru #1 yanıtı (Karar §2 onay): HTTP long-polling.** Onaylandı; gerekçe Draft'ta zaten yazılı (NAT/firewall outbound TLS güvenirliği, Bearer JWT basitliği, mutfak fişi 3sn latency tolerable). Socket.IO **reddedildi**: NAT reset reconnect karmaşıklığı + Phase 5+'a kadar hibrid transport gerek yok. **Kapsam kilidi:** tek transport — hibrid yok.

**Soru #2 yanıtı (Karar §2 detay): Polling interval = 5 saniye sabit.** 3sn agresif (cloud request rate × tenant sayısı + Hetzner CX22 bant genişliği baskısı, mutfak fişi için algılanan kazanç marjinal — kasiyer gönder→bas arası zaten 1-2sn ek), 10sn yoğun saatte yavaşlık hissi (`5sn × N sipariş` kuyruk birikmesi). 5sn = restoran operasyonu için "neredeyse anlık" + sunucu yükü makul orta nokta. **Adaptive polling REDDEDİLDİ** (kapsam genişlemesi — sabit değer Phase 2-4 boyunca geçerli, v5.1+'da yük metrikleri varsa revize ADR).

**Soru #3 yanıtı (Karar §1 + §5 detay): MSI installer + `nssm` Windows servisi.** v3 pain-point #3 (`pain-points.md` §3 elle kurulum, "cmd ile kayıt" hatası) bu kararla kapanır. Kombinasyon: **`@vercel/pkg` ile Node.js binary → MSI (WiX Toolset) içinde `nssm install` post-install script + config dosyası şablonu (`%PROGRAMDATA%\restoran-pos\print-agent.json`)**. Gerekçe: (a) `node-windows` programatik kayıt yapar ama elle update path zayıf; (b) `nssm` v3-bilinen güvenilir tool, recovery action native destek; (c) MSI auto-update için MS Installer infrastructure hazır, Phase 5+ otomatik update kararı için zemin var. **Tool kilidi: `pkg` + `nssm` + WiX**. Phase 4+ Agent kod sprint'inde paketleme detayı (icon, signing certificate, update channel) ayrı bir Phase 4 brief'inde belirlenir.

**Soru #4 yanıtı — kısmen Phase 2-3, kısmen v5.1 backlog:**
- **MVP (Phase 2-3): Yalnız mutfak fişi şablonu render edilir.** Şablon parametreleri: `{ tenant_header, order_no, table_label, server_name, items: [{name, qty, modifiers[], note?}], created_at_local, kitchen_dest_label }`. ESC/POS render `apps/api/src/print/templates/kitchen-receipt.ts` (Phase 2 görev başlığında). Mutfak fişi sipariş akışını kilitler, bu olmadan Phase 2 sipariş gönderme çalışmaz.
- **Açık soru #4 yanıtı (v5.1 backlog): Müşteri fişi / adisyon şablonu MVP'de yok.** Gerekçe: v3'te Manager UI üzerinden seçimliydi, restoranda her zaman basılmıyordu (kapanışta isteğe bağlı). v5.1'de Manager UI ayarına bağlı eklenir. **Phase 2-3 yalnız mutfak fişi şablonu render edilir.**
- **Açık soru #4 yanıtı (Phase 5+ backlog): X/Z raporu şablonu MVP'de yok.** Gerekçe: gün-kapanış raporu Phase 5 finansal-raporlama sprint'iyle birlikte gelir; mutfak fişinden bağımsız bir akış (şablon değil, batch summary). v5'te yazılırken ayrı ADR (X/Z mali rapor + KVKK arşivlenmesi konuşulur).
- **Detay zod schema:** Mutfak fişi parametre schema'sı `packages/shared-types/print-agent.ts` içinde **Phase 4+ Agent kod sprint'inde** yaratılacak; bu ADR'de yalnız parametre listesi iskeleti (yukarıdaki alanlar) sabit. Şu an dosya yaratılmıyor (kapsam kilidi).

**Soru #5 yanıtı (Karar §5 detay onay): MVP 1:1 Agent ↔ printer.** Onaylandı; gerekçe Draft'ta yazılı. Secondary printer (mutfak + bar ayrı, v3'teki override) **v5.1 backlog**: ayrı ADR'de yazıcı routing kuralları (sipariş kategorisi → hedef yazıcı eşleme tablosu, fallback davranışı) ele alınır. **Kapsam kilidi:** MVP ihlal edilmedi — tek Agent, tek yazıcı, tek hedef.

**Soru #6 yanıtı (Karar §6 detay): Auth protokolü iskeleti — endpoint listesi + JWT TTL + revoke akışı.**
- **Endpoint'ler (Phase 4+ Agent kod sprint'inde implement edilecek, isim ve sözleşme bu ADR'de kilit):**
  - `POST /print/agent/register` — body: `{ apiKey, deviceFingerprint }` (apiKey Manager UI'dan Phase 4+ üretilir; `deviceFingerprint` Agent ilk boot'ta üretir: hostname + MAC hash). response: `{ agentId, accessToken, refreshToken }`.
  - `POST /print/agent/refresh` — body: `{ refreshToken }`. response: `{ accessToken, refreshToken }` (rotated).
  - `GET /print/jobs/next?wait=25` — header `Authorization: Bearer <agent-jwt>`. long-poll (max 25sn server-side), response `{ job }` veya 204 No Content.
  - `POST /print/jobs/:id/result` — body: `{ status: 'printed'|'failed', errorText? }`. Idempotent (aynı `jobId` + aynı `status` ikinci kez gelirse 200, no-op).
- **JWT TTL: 1 saat.** Refresh TTL 30 gün (ADR-002 cookie refresh ile aynı pattern; ama Agent JWT body'de değil DB'de — Agent'ın HttpOnly cookie kavramı yok, lokal config dosyasında plain text restricted ACL).
- **Revoke akışı:** Manager UI (Phase 4+) `agents` tablosunda `revoked_at` set eder → bir sonraki refresh isteği 401 + `AGENT_REVOKED` error code → Agent local config dosyasını siler, manuel re-register ister. Aktif JWT TTL 1 saat olduğu için worst-case 1 saat zombie-Agent (kabul; sıralı state machine + idempotency duplicate basım riskini absorbe eder).
- **`agents` tablosu:** Phase 4+ Agent kod sprint'inde ADR-003 §13'e bitişik yeni tablo (`id, tenant_id, device_fingerprint, api_key_hash, created_at, last_seen_at, revoked_at, revoke_reason`). Şema detayı **bu ADR kapsamı dışı** — Phase 4+ schema migration ADR'sinde tanımlanır.
- **zod schema iskeleti yeter, kod yok:** `packages/shared-types/print-agent.ts` Phase 4+ Agent kod sprint'inde yaratılacak. **Bu pass'ta dosya oluşturulmuyor.**

**Soru #7 yanıtı (Karar §4 detay): Payload size limit = 64 KB.** Onaylandı. Aşıldığında davranış:
- API katmanı (job INSERT eden endpoint) `payload` boyutu kontrol eder; > 64 KB ise **400 Bad Request + `error.code = 'PRINT_PAYLOAD_TOO_LARGE'`** döner, job INSERT yapılmaz.
- Mutfak fişi 64 KB'a yaklaşırsa → mimari bug; tipik fiş 2-8 KB. 64 KB sınırı template render bug'larını erken yakalama amaçlı (sonsuz döngü, recursive render).
- DB seviye savunma: `print_jobs.payload` kolonunda `CHECK (octet_length(payload::text) <= 65536)` constraint **Phase 4+ migration'da** eklenir (bu ADR'de tek satır karar; ADR-003 §13 eke `CHECK` constraint forward-ref kaydı).

**Soru #8 yanıtı (Karar §6 detay): Versiyonlama = semver + URL path version (breaking change'da `/print/v2/...`) + 6 ay deprecation paralel destek.**
- API contract semver: `/print/v1/jobs/next`, `/print/v1/agent/register`, ... — tüm Agent endpoint'leri **`/print/v1/`** prefix'iyle başlar (mevcut Cloud API `/auth/...` gibi versionsuz; print-agent ayrı sub-API).
- Breaking change (response şema değişikliği, auth flow değişikliği, job schema breaking) → `/print/v2/...` paralel açılır. **v1 + v2 6 ay paralel destekli;** 6 ay sonra v1 410 Gone döner.
- Non-breaking değişiklik (yeni opsiyonel field, yeni status değeri) → v1 içinde, Agent backward-compat client (bilmediği field'ı görmezden gelir).
- 6 ay seçimi: tek-tenant + 1-3 işletme ölçeğinde Agent versiyonunu el ile güncellemek için bol süre. Multi-tenant ölçeklenmesinde (Phase 5+) bu süre revize edilebilir, ayrı ADR.
- **Kapsam kilidi:** v2 path'i şu an açılmıyor — yalnız "breaking change geldiğinde böyle açacağız" sözleşmesi.

#### v5.1 / Phase 5+ backlog flag'leri (sessiz atlanmasın)
- **v5.1 backlog:** Müşteri fişi/adisyon şablonu (Soru #4)
- **v5.1 backlog:** Secondary printer routing (mutfak + bar ayrı yazıcı, Soru #5)
- **Phase 5+ backlog:** X/Z raporu şablonu (Soru #4)
- **Phase 5+ backlog:** Multi-Agent per tenant (Karar Sonuçları "single-Agent assumption")
- **Phase 5+ backlog:** Adaptive polling interval revize (Soru #2; 5sn sabit MVP)
- **Phase 5+ backlog:** Versiyonlama 6 ay deprecation süresi revize (Soru #8)
- **Takip:** Bu liste `docs/v3-reference/pain-points.md` "v5.1 backlog" bölümüne yansıtılacak (ayrı görev — bu pass dışı, kullanıcı onayıyla ayrı commit'te).

#### Cross-reference

- **ADR-002 (auth):** Agent JWT şeması ADR-002 §3'teki kullanıcı JWT pattern'ine paralel (HS256, kid, iat/exp/jti) — ama farklı secret + farklı `type` claim (`type=agent`). Authentication middleware Phase 4+ `apps/api/src/middleware/authenticate-agent.ts` ayrılır.
- **ADR-003 §13 (`print_jobs` tablosu):** state machine + retention 7g/30g + cron task forward-ref bu ADR'yle bağlandı. Karar §4 payload 64 KB sınırı **Phase 4+ migration'da** `CHECK (octet_length(payload::text) <= 65536)` constraint olarak eklenecek (ADR-003 §13 ek-borç).
- **ADR-003 §14.8 (`print_jobs` index):** retention cron index pattern ADR-003'te lock'lu; bu ADR yalnız retention süresini onaylar (7g success / 30g failed).

### Status

**Accepted** — 2026-04-25 (Session 25, Phase 2 başı). `architect` sub-agent 8 açık soruyu kullanıcı (İlhan) öncelik hiyerarşisine ("operasyonel güvenirlik > teknik zarafet") + CLAUDE.md kapsam kilidine uygun yanıtladı. **Phase 2 sipariş + masa + menü API katmanı `print_jobs` tablosuna mutfak fişi job INSERT etmeye başlayabilir.** Agent kodu (`apps/print-agent/`) hâlâ Phase 4+ — bu ADR yalnız protokol/karar sınırını kilitler. Yeni paket (`packages/shared-types/print-agent.ts`) bu pass'ta yaratılmadı, Phase 4+ Agent kod sprint'ine ertelendi (kapsam kilidi).

<!-- ADR-004 Accepted (Session 25, 2026-04-25) — architect sub-agent; Phase 2 başı gate; HTTP long-polling 5sn + MSI/nssm + cloud render + CP857 + 1:1 Agent-printer + JWT 1h/refresh 30d + 64 KB payload + semver /print/v1/ + 6ay deprecation; v5.1 backlog: müşteri fişi + secondary printer routing; Phase 5+ backlog: X/Z + multi-Agent + adaptive polling; v3 StoreBridge kod taşıma yasağı korundu -->

---

## ADR-006 — API Error Taxonomy + Error Envelope Contract

- **Durum**: Accepted
- **Tarih**: 2026-04-26

### §1 — Bağlam

Phase 2 Sprint 1 endpoint'leri (POST /tables, POST /menu/categories, POST /orders, vb.) için tutarlı bir hata yanıtı sözleşmesi gerekiyor. Şu an:

- **ADR-002 §2** auth domain'inde 7 error code tanımlamış (`AUTH_INVALID_CREDENTIALS`, `AUTH_REFRESH_INVALID`, `AUTH_RATE_LIMITED`, `AUTH_CSRF_CHECK_FAILED`, `AUTH_TOKEN_INVALID`, `AUTH_BAD_REQUEST`, `INTERNAL_ERROR`). Bu kodlar **korunur** — bu ADR yalnız genişletir, rename veya silme yapmaz.
- **ADR-003 §10.5 C6** DB `RAISE EXCEPTION` çıktısının UI'a ham sızdırılmaması kuralını forward-ref bırakmıştı.
- **ADR-003 §11.10 (db-migration-guard checklist)** `23505 unique_violation` mapping ve `40001 serialization_failure` retry pattern'ı forward-ref bırakmıştı.
- **`apps/api/src/auth/auth.ts`** içinde inline `try/catch + console.error` blokları var (login, refresh, logout, me) — `errorHandler` middleware'i yok.
- **Phase 2 Sprint 0** active-plan'da bu ADR'yi "🔴 zorunlu" olarak ilk endpoint öncesi gate'i ediyor.

API contract kararlılığı: hata kodları bir kez yayınlandıktan sonra minor version'da (v5.x) değişmez — backend + istemci (web, mobile, print-agent) entegrasyonlarını korur.

### §2 — Error Envelope Format

Tüm hata yanıtlarının (4xx + 5xx) standart JSON şekli:

```typescript
interface ErrorEnvelope {
  error: {
    code: string;          // SCREAMING_SNAKE_CASE, makine-okunabilir, stable contract
    message_key: string;   // 'error.<domain>.<camelCase>', UI t() için i18n key
    details?: unknown;     // validation: per-field map; conflict: çakışan alan adı; vb.
  }
}
```

Örnek:
```json
{ "error": { "code": "AUTH_INVALID_CREDENTIALS", "message_key": "error.auth.invalidCredentials" } }
```

```json
{ "error": { "code": "VALIDATION_ERROR", "message_key": "error.validation.failed",
  "details": { "fields": { "email": "invalid_format", "password": "too_short" } } } }
```

**i18n boundary:** `message_key` naming convention (`error.<domain>.<camelCase>`) bu ADR'de tanımlanır. Key dosya yapısı (`packages/shared-i18n/...`?), UI tüketim paterni (`t(envelope.message_key, envelope.details)`?) ve fallback davranışı **Phase 2 UI ADR'sine** bırakılır — bu ADR yalnız contract sınırını çeker.

**Stack trace yasağı:** Production'da `error.message`, stack trace, raw SQL veya raw PG error metni envelope'a girmez. Dev ortamında opsiyonel `error.debug` field'ı eklenebilir (Sprint 0 errorHandler kararı; bu ADR'de zorunlu değil).

### §3 — HTTP Status Conventions

| HTTP Status | Error code sınıfı |
|-------------|-------------------|
| 400 Bad Request | `VALIDATION_ERROR`, `AUTH_BAD_REQUEST` (zod parse fail, eksik field, type uyumsuzluğu) |
| 401 Unauthorized | `AUTH_*` ailesi (credentials geçersiz, token expired/invalid, refresh invalid) |
| 403 Forbidden | `ACCESS_DENIED` (authenticate OK, role/scope yetersiz — ADR-002 §6 role matrix) |
| 404 Not Found | `*_NOT_FOUND` (resource yok, soft-deleted) |
| 409 Conflict | `*_CONFLICT`, `RESOURCE_CONFLICT`, `ORDER_INVARIANT_VIOLATED`, `TABLE_ALREADY_OCCUPIED` (DB constraint, business invariant ihlali) |
| 422 Unprocessable Entity | (rezerv — şu an kullanılmıyor; semantic validation için Phase 2 sonrası değerlendirme) |
| 429 Too Many Requests | `AUTH_RATE_LIMITED` (rate limit aşımı) |
| 500 Internal Server Error | `INTERNAL_ERROR` (beklenmeyen hata; production'da stack trace yok) |
| 503 Service Unavailable | (rezerv — DB pool exhaustion / circuit breaker, v5.1+) |

**Kural:** Aynı `error.code` her zaman aynı HTTP status ile döner. `error.code` + HTTP status çiftinin değişmezliği §6'da contract olarak kilitlenir.

### §4 — DB Error → Domain Error Mapping

PG error code → repository exception → HTTP status eşlemeleri (kesin kararlar):

| PG ERRCODE | Repository Exception | HTTP | error.code | Notlar |
|------------|---------------------|------|------------|--------|
| `23505 unique_violation` | `ConflictError` | 409 | `RESOURCE_CONFLICT` | Çakışan alan adı `details.field` içinde döner. (ADR-003 §11.10 resolve.) |
| `40001 serialization_failure` | (yutulur, retry) | — | — | Server-side şeffaf retry **maks 3 deneme**, exponential backoff yok (sabit 50ms). 3 başarısız → 500 `INTERNAL_ERROR`. order_no counter ve payment sequence için kritik (ADR-003 §11.5 + §11.10 resolve). |
| `23502 not_null_violation` | `ValidationError` | 400 | `VALIDATION_ERROR` | DB-side son savunma; bu noktaya gelmesi normalde zod schema bug'ı işareti. Log'a WARN yazılır. |
| `23514 check_violation` | `DomainConstraintError` | 409 | `ORDER_INVARIANT_VIOLATED` | ADR-003 §10 CHECK constraint'leri (ör. `amount_cents > 0`, `is_comp = false OR comp_reason IS NOT NULL`). Constraint adı `details.constraint`'te döner. |

**Açık karar — İlhan'ın seçimi (ADR Accepted ama bu iki noktada karar boş; yanıt geldikten sonra implementer Sprint 0 Madde 2'de bu eşlemeyi koda alır):**

**P0001 RAISE EXCEPTION mapping:**
- **Alternatif A** — DB `RAISE EXCEPTION USING MESSAGE = 'order.invariant.violated'` formatında **sabit İngilizce key** taşır. Service katmanı `err.message`'ı doğrudan `message_key` olarak envelope'a koyar.
  - (+) Tek kaynak (key değişikliği DB migration ile gelir, kod değişmez)
  - (+) Yeni invariant eklenirken yalnız trigger + i18n dosyası güncellenir, service kodu intact
  - (−) DB'ye string format bağımlılığı (i18n kuralı DB layer'a sızar)
  - (−) Migration'da typo riski runtime'da yakalanır, lint zor
- **Alternatif B** — DB `RAISE EXCEPTION` mesajını insan-okunur Türkçe bırakır; **service katmanı pg error mesajını pattern-match** ederek (regex veya tablo lookup) `message_key`'e map eder.
  - (+) DB layer i18n'den tamamen bağımsız (saf SQL), code-style temiz ayrım
  - (+) Eşleme tablosu service'te → unit test ile coverage kolay
  - (−) Eşleme tablosu drift riski (DB'de mesaj değişir, service tablosu güncellenmez → 500)
  - (−) Pattern-match brittle (regex/locale)
- **[x] İlhan kararı (2026-04-26): Alt A — DB `RAISE EXCEPTION USING MESSAGE = '<i18n-key>'` formatında sabit İngilizce key taşır. Service katmanı `err.message`'ı doğrudan `message_key` olarak envelope'a koyar.**

**`23503 foreign_key_violation` mapping:**
- **Alternatif A** — Yeni `ReferenceError extends RepositoryError` sınıfı. errorHandler `ReferenceError` → 409 `REFERENCE_INVALID` mapping yapar.
  - (+) Semantik ayrım net (`ConflictError` = unique çakışma, `ReferenceError` = orphan FK)
  - (+) HTTP 409 vs 500 ayrımı kolaylaşır (FK ihlali genellikle client bug = 409, race condition = 500 ayrımı log'tan yapılır)
  - (−) Hata sınıfı patlaması (her PG error kategorisi için yeni sınıf riski)
  - (−) Repository layer büyür
- **Alternatif B** — Mevcut `RepositoryError` içinde `cause: 'foreign_key' | 'unique' | 'check'` discriminator field'ı taşı. errorHandler `cause`'a göre mapping yapar.
  - (+) Sınıf patlaması yok, repository API kompakt
  - (+) Yeni cause eklemek tek satır
  - (−) Type narrowing daha az ergonomik (instanceof yerine string check)
  - (−) Phase 2 sonrası geri dönmek gerekirse refactor maliyeti
- **[x] İlhan kararı (2026-04-26): Alt B — `RepositoryError` içinde `cause` discriminator. TypeScript discriminated union ile type-safe yapılır:**
```typescript
type RepositoryErrorCause = 'unique' | 'foreign_key' | 'check' | 'not_null' | 'unknown';
interface RepositoryError extends Error { cause: RepositoryErrorCause; }
```

### §5 — Error Code Registry

#### §5.1 — ADR-002 §2 mevcut auth kodları (KORUNUR — rename yok, silme yok)

```
AUTH_INVALID_CREDENTIALS    AUTH_REFRESH_INVALID    AUTH_RATE_LIMITED
AUTH_CSRF_CHECK_FAILED      AUTH_TOKEN_INVALID      AUTH_BAD_REQUEST
INTERNAL_ERROR
```

#### §5.2 — Phase 2 Sprint 0-1 yeni kodlar

**Naming convention:** Domain-specific tercih edilir (ör. `MENU_PRODUCT_NOT_FOUND` vs generic `RESOURCE_NOT_FOUND`). Gerekçe: i18n-key 1:1 eşleme okunabilirliği — `error.menu.productNotFound` UI tarafında doğrudan domain-bağlamlı çeviri verir, generic key'lerin context-aware yorumu zorlaşır. Architect aksini gerekçeli önerebilir; gerekçesiz drift yasak.

Sprint 1 endpoint setine göre **gerçekten kullanılacak** kodlar (active-plan §169-225 Sprint 0 + Sprint 1 brief'leri taranarak; Sprint 1 endpoint'leri henüz brief edilmediği için POST /tables, POST /menu/categories, POST /orders ana hedef alındı):

| Kod | HTTP | Ne zaman fırlatılır | Sprint |
|-----|------|---------------------|--------|
| `VALIDATION_ERROR` | 400 | Request body zod schema parse'ı başarısız — eksik field, tip uyumsuzluğu, format hatası. `details.fields` per-field hata haritası içerir. | Sprint 0 |
| `ACCESS_DENIED` | 403 | JWT geçerli (authenticate OK) ama kullanıcının rolü bu endpoint için ADR-002 §6 role matrix'te yetkisiz. | Sprint 0 |
| `RESOURCE_CONFLICT` | 409 | **Fallback — domain-specific çakışma kodu tanımlıysa O kullanılır, bu kod kullanılmaz.** PG `23505 unique_violation` geldiğinde hangi tabloya/alana ait olduğu belirlenemiyor ise generic fallback. `details.field` çakışan sütun adını içerir (mümkünse). | Sprint 0 |
| `RESOURCE_NOT_FOUND` | 404 | **Fallback — domain-specific 404 kodu tanımlıysa O kullanılır, bu kod kullanılmaz.** `GET /:id` rotasında hangi resource'a ait olduğu belirlenemiyor ise generic fallback. `RepositoryError('not_found')` → bu kod. | Sprint 0 |
| `TABLE_NOT_FOUND` | 404 | `GET /tables/:id` veya `PATCH /tables/:id` — belirtilen `id` o tenant'ta mevcut değil veya soft-deleted. | Sprint 1 |
| `TABLE_ALREADY_EXISTS` | 409 | `POST /tables` — aynı tenant'ta aynı `label` (masa adı, ör. "Masa 3") zaten var. `(tenant_id, label)` UNIQUE constraint çakışması. Yeni masa oluşturma sırasında fırlatılır. | Sprint 1 |
| `TABLE_ALREADY_OCCUPIED` | 409 | `POST /orders` — hedef masada zaten açık bir sipariş var (`orders.status` = 'open' olan satır mevcut — ADR-003 §14.2.B partial UNIQUE). Masa fiziksel olarak meşgul olduğu için yeni sipariş açılamaz. | Sprint 1 |
| `MENU_CATEGORY_NOT_FOUND` | 404 | `GET /menu/categories/:id`, `PATCH /menu/categories/:id` veya bir ürünün `category_id` resolve'u başarısız — o tenant'ta kategori yok veya soft-deleted. | Sprint 1 |
| `MENU_CATEGORY_ALREADY_EXISTS` | 409 | `POST /menu/categories` — aynı tenant'ta aynı isimde kategori zaten var. `(tenant_id, name)` UNIQUE constraint çakışması. | Sprint 1 |
| `MENU_CATEGORY_HAS_PRODUCTS` | 409 | `DELETE /menu/categories/:id` — kategori altında aktif (`deleted_at IS NULL`) `products` satırı var. Cascade soft delete YAPILMAZ (ADR-003 §8.6 Amendment 2026-04-28b — Seçenek A). Admin önce ürünleri başka kategoriye taşımalı veya soft delete etmeli. | Sprint 4 |
| `AREA_NOT_FOUND` | 404 | `PATCH /areas/:id`, `DELETE /areas/:id` veya `PATCH /tables/:id/area` (`area_id` non-null) — belirtilen `id` o tenant'ta mevcut değil veya soft-deleted. Cross-tenant id de aynı kod (no enumeration). ADR-009 Karar 4. | Sprint 5 |
| `AREA_NAME_ALREADY_EXISTS` | 409 | `POST /areas` veya `PATCH /areas/:id` — aynı tenant'ta aynı (case-insensitive, trimmed) isimde aktif bölge var. Migration 007 partial UNIQUE `(tenant_id, lower(trim(name))) WHERE deleted_at IS NULL` ihlali. | Sprint 5 |
| `ATTRIBUTE_GROUP_NOT_FOUND` | 404 | `POST/GET/PATCH/DELETE /attribute-groups/:id` — o tenant'ta yok veya soft-deleted. ADR-012 Karar 12. | Sprint 8c |
| `ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS` | 409 | `POST /attribute-groups` veya `PATCH /attribute-groups/:id` — aynı tenant'ta aynı (case-insensitive trimmed) isimde aktif grup var. Migration 008 partial UNIQUE ihlali. | Sprint 8c |
| `ATTRIBUTE_OPTION_NOT_FOUND` | 404 | `PATCH/DELETE /attribute-groups/:id/options/:optId` — option o tenant'ta veya o grupta yok. | Sprint 8c |
| `ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS` | 409 | `POST/PATCH /attribute-groups/:id/options` — aynı grupta aynı isimde aktif option. Migration 009 partial UNIQUE ihlali. | Sprint 8c |
| `ATTRIBUTE_OPTION_DEFAULT_INVALID` | 422 | `POST/PATCH /attribute-groups/:id/options` — tekli (selection_type='single') grup içinde 2. is_default=true atanması. ADR-012 Karar 7 application-level enforcement. | Sprint 8c |
| `SETTINGS_NOT_FOUND` | 404 | `GET /settings` veya `PATCH /settings` — `tenant_settings` satırı yok. Defansif kod (seed `tenant_settings` satırını garanti eder); bootstrap drift veya manuel DELETE durumunda fırlatılır. | Sprint 6 |
| `SETTINGS_INVALID_TIMEZONE` | 400 | `PATCH /settings` — `timezone` alanı zod IANA regex'i geçtikten sonra DB trigger `validate_timezone` `pg_timezone_names` lookup'ında reddetti (örn. `"Mars/Olympus"` regex pass ama gerçek bir tz değil). Çift savunma: zod erken yakalar, DB trigger son hat. | Sprint 6 |
| `MENU_PRODUCT_NOT_FOUND` | 404 | `POST /orders` — item listesindeki `product_id` o tenant'ta mevcut değil veya soft-deleted. | Sprint 1 |
| `ORDER_NOT_FOUND` | 404 | `GET /orders/:id`, `PATCH /orders/:id` veya sipariş üzerindeki alt işlem — belirtilen `id` o tenant'ta mevcut değil veya hard-deleted. | Sprint 1 |
| `ORDER_INVARIANT_VIOLATED` | 409 | Sipariş iş kuralı DB seviyesinde ihlal edildi — örn. kapalı siparişe ikram ekleme, sıfır item ile sipariş açma (ADR-003 §10.5 C6 resolve). DB `RAISE EXCEPTION` fırlatır; P0001 → Alt A kararına göre `err.message` doğrudan `message_key` olarak kullanılır. | Sprint 1 |
| `ORDER_ITEM_INVALID_STATUS_TRANSITION` | 422 | `PATCH /orders/:orderId/items/:itemId/status` — geçersiz state transition. ADR-020 K3 state machine: `sent → preparing → ready` izinli; `new → preparing/ready` direkt geçiş yasak (POST handler `'sent'` set eder); `served \| cancelled` terminal state'lerden geçiş yok; aynı status idempotent (200 no-op, fail değil). Kitchen rolü PATCH yapar. | Sprint 12 |
| `USER_LAST_ADMIN_PROTECTED` | 409 | `DELETE /users/:id` — silinmek istenen kullanıcı tenant'ın **son aktif admin'i**. Tenant invariant'ı "en az bir admin" — RFC 9110 §15.5.10 state conflict (kaynak state'i isteği reddediyor). ADR-002 §10.3 + §10.4 atomicity kontratı (FOR UPDATE) tarafından fırlatılır. | Sprint 3b |
| `USER_CANNOT_DELETE_SELF`   | 403 | `DELETE /users/:id` — `req.user.sub === id`. Kendini silme reddi RFC 9110 §15.5.4 (actor=target ABAC kuralı); 422 değil çünkü body parse hatası yok, 409 değil çünkü state conflict değil ilişki kuralı. ADR-002 §10.2 tarafından fırlatılır. | Sprint 3b |
| `USER_USERNAME_ALREADY_EXISTS` | 409 | `POST /users` veya `PATCH /users/:id` — aynı tenant'ta aynı (case-insensitive) `username` ile aktif user var. Migration 033 `users_tenant_username_ci_idx` UNIQUE ihlali. ADR-002 §10.11 amendment. | Sprint 0/1 borç (2026-05-08 kapatıldı) |
| `USER_EMAIL_ALREADY_EXISTS` | 409 | `POST /users` veya `PATCH /users/:id` — aynı tenant'ta aynı (case-insensitive) `email` ile aktif user var. Migration 003 `users_tenant_email_ci_idx` UNIQUE ihlali (önceden runtime'da silent 500 → bu amendment application-level handler ekledi). ADR-002 §10.11 amendment. | Sprint 0/1 borç (2026-05-08 kapatıldı) |
| `MENU_CATEGORY_INVALID_ICON` | 400 | `POST /menu/categories` veya `PATCH /menu/categories/:id` — `icon` alanı ADR-011 Amendment 2026-05-01 Karar 2 whitelist'inde (`Pizza`, `UtensilsCrossed`, `Beef`, `Salad`, `Coffee`, `Cake`, `Wine`, `Beer`, `Cookie`, `IceCreamBowl`, `Soup`, `Sandwich`, `Croissant`, `Egg`, `Apple`, `Cherry`, `Fish`, `Drumstick`) yok. zod katmanında pre-DB enforcement; DB'ye string string geçer, CHECK constraint kullanılmaz (whitelist genişlemesi migration'sız ADR amendment ile yapılır). | Sprint 8c |
| `MENU_CATEGORY_INVALID_COLOR` | 400 | `POST /menu/categories` veya `PATCH /menu/categories/:id` — `color` alanı ADR-011 Amendment 2026-05-01 Karar 3 paletinde (`#dc2626`, `#ea580c`, `#d97706`, `#16a34a`, `#0891b2`, `#2563eb`, `#7c3aed`, `#db2777`) yok veya HEX format ihlali. Çift savunma: zod (palet whitelist, 8 renk) + DB CHECK constraint `categories_color_format_check` (HEX format `^#[0-9a-f]{6}$`). zod hatası → 400 burası; DB CHECK ihlali → fallback 400 yine bu kod (palet drift erken yakalanır). | Sprint 8c |

**[x] İlhan onayı (2026-04-26):** Registry §5.2 tamamı onaylandı (naming convention domain-specific tercihi, table/menu/order için 11 kod listesi).

#### §5.3 — Phase 2 Sprint 2+ rezervi (YAGNI — bu ADR'de Accepted DEĞİL, kullanılacağı sprint başında tek satır ekleme ile kilitlenir)

| Kod (öneri) | HTTP (öneri) | Sprint |
|-------------|--------------|--------|
| `ORDER_ITEM_NOT_FOUND` | 404 | Sprint 2 (item-level edit) |
| `ORDER_ALREADY_PAID` | 409 | Sprint 2 (payment guard) |
| `PAYMENT_AMOUNT_MISMATCH` | 409 | Sprint 3 (split payment validation) |
| `PAYMENT_TYPE_INVALID` | 400 | Sprint 3 |
| `PRINT_JOB_NOT_FOUND` | 404 | Phase 4 Sprint 1 (print job lookup) |
| `PRINT_PAYLOAD_TOO_LARGE` | 400 | Phase 4 Sprint 1 (ADR-004 Soru #7 — 64 KB sınır) |

Bu tablo **referans amaçlıdır**; her kod ait olduğu sprint başında bu ADR'ye eklenir (rename değil ekleme — §6 stability guarantee).

### §6 — Error Code Stability Guarantee

> **`error.code` + HTTP status çifti API contract'ının parçasıdır. Minor version'da (v5.x) değişmez.** Mevcut bir durumun davranışı değişse bile mevcut kod silinmez veya yeniden atanmaz — yeni davranış yeni bir kod gerektirir. Bu kural backend + istemci (web, mobile, print-agent) entegrasyonlarını korur.

Pratik sonuçlar:
- Bir kod yanlış HTTP status ile yayınlandıysa: yeni kod açılır + eskisi deprecated marker ile en az 1 minor cycle korunur.
- `message_key` değişebilir (UI sahibidir, çeviri sahibidir — i18n key rename minor change). `error.code` değişemez.
- Major version (v6.x) bump'ında envelope format değişebilir; v5.x içinde değişmez.

### §7 — Auth Endpoint Migration Notu

`apps/api/src/auth/auth.ts` içindeki inline `try/catch + console.error` blokları (login, refresh, logout, me — Phase 1 Görev 12'de yazıldı, commit `e3c4a7f`) Sprint 0 Madde 2 brief'inde yazılacak `errorHandler` (`apps/api/src/errors.ts` + `app.use(errorHandler)` 4-arg signature) tarafından devralınır. Geçiş sırasında:

- ADR-002 §2'deki 7 error code envelope'a `code` + `message_key` formunda taşınır (mevcut response'lar `{ error: { code: '...' } }` formundaydı; envelope'a `message_key` eklenir).
- Inline `console.error` çağrıları logger (Sprint 0 Madde 5 — pino) altyapısına devredilir.
- Mevcut auth.test.ts integration testleri (login → me → refresh → logout zinciri, smoke 6/6) **kırılmadan** geçişin tamamlanması gerekir. Bu Sprint 0 DoD'unun parçasıdır (active-plan L218-223).

Detaylı uygulama haritası (hangi try/catch nereye gidecek, hangi error sınıfı throw edilecek) **Sprint 0 Madde 2 brief'inde** yazılır — bu ADR yalnız sözleşme sınırını çeker.

### §8 — Kapsam Dışı (YAGNI — bu ADR'de tanımlanmaz)

- **i18n key dosya yapısı + UI tüketim paterni** — Phase 2 UI ADR (key dosyaları nerede yaşar, fallback davranışı, `t()` API)
- **Socket.IO error events** — Phase 2 ilk realtime endpoint'inde (KDS / order push); WebSocket error envelope HTTP envelope'tan farklı semantik gerektirebilir, ayrı karar
- **Print Agent hata kodları** — Phase 4 Agent kod sprint'inde (ADR-004 §6 endpoint'leri için: `AGENT_REVOKED`, `PRINT_PAYLOAD_TOO_LARGE` zaten ADR-004'te flag'lendi, taxonomy'ye Phase 4 Sprint 1'de eklenir)
- **Daily-closeout error codes** — Phase 4 daily-closeout ADR
- **Refund error codes** — v5.1 refund ADR
- **Rate limit per-user / per-endpoint matrix** — şu an yalnız login'de `AUTH_RATE_LIMITED`; genel matrix Phase 2 ortası (active-plan L228 erteleme)
- **Circuit breaker / 503 davranışı** — v5.1 (DB pool exhaustion senaryosu)
- **JTI denylist (token revoke before expiry)** — ADR-002 v5.1 backlog
- **KVKK / DSAR error codes** — v5.1 KVKK veri haritası ADR
- **GraphQL / gRPC contract** — REST-only v5.0 (kapsam kilidi; charter)

### §9 — Sonuçlar

- (+) Phase 2 Sprint 1 endpoint'leri tutarlı envelope ile yazılır; her endpoint kendi error format'ını icat etmez.
- (+) ADR-002 §2 + ADR-003 §10.5 C6 + §11.10 forward-ref'leri tek noktada resolve edildi.
- (+) Stability guarantee (§6) backend + 3 istemci (web, mobile, print-agent) sözleşmesini koruyor.
- (+) i18n boundary net: API `message_key` yayınlar, UI çevirir — backend Türkçe metin üretmez (CLAUDE.md "API katmanı `error.code` döner, çeviri UI'da" kuralıyla uyumlu).
- (−) `message_key` API'den geliyor olması, key rename'in iki tarafı koordine etmesini gerektirir (UI key dosyası + API). Mitigation: §6 `message_key` değişebilir kuralı + Phase 2 UI ADR'sinde versioning.
- (−) Domain-specific naming (`MENU_PRODUCT_NOT_FOUND` vs generic) error code sayısını şişirir; Sprint 5+ otomasyon (codegen veya enum üretimi) gerekebilir. Şimdilik manuel registry kabul.
- (+) §4'teki iki açık karar (P0001 Alt A + 23503 Alt B) 2026-04-26'da İlhan kararıyla kilitlendi. Blok kalkmadı.

### §10 — Cross-reference

- **ADR-002 §2**: 7 auth error code korundu, envelope formatı bu ADR'de standartlaştırıldı.
- **ADR-003 §10.5 C6**: DB `RAISE EXCEPTION` → i18n key forward-ref bu ADR §4 (P0001 mapping kararı)'nde resolve.
- **ADR-003 §11.10**: `23505` + `40001` retry pattern forward-ref bu ADR §4 tablosunda resolve.
- **ADR-004 §4 + Soru #7**: `PRINT_PAYLOAD_TOO_LARGE` 400 kodu Phase 4 Sprint 1'de §5.3 rezerv listesinden taxonomy'ye geçecek.
- **CLAUDE.md**: "API katmanı `error.code` döner, çeviri UI'da" kuralı bu ADR'de envelope contract olarak somutlaştı.
- **`active-plan.md` Phase 2 Sprint 0**: Madde 1 bu ADR'nin yazımı; Madde 2 bu ADR'nin implementasyonu (`errors.ts` + `errorHandler`); Madde 4 (`validateBody`) bu ADR §3 `VALIDATION_ERROR` üreticisi.

<!-- ADR-006 Accepted (2026-04-26) — architect sub-agent; envelope { code, message_key, details? } + HTTP status conventions + DB→Domain error mapping (23505/40001/23502/23514 kilit + P0001 Alt A + 23503 Alt B Accepted 2026-04-26) + 7 auth code korundu + 11 Sprint 1 yeni code + 6 Sprint 2+ rezerv + stability guarantee + auth.ts errorHandler migration notu; numbering collision çözüldü (otomasyon ADR-005 olarak kaldı, Error Taxonomy ADR-006). -->

## ADR-008 — GET /orders ABAC Ertelemesi + Sprint 3 Prerequisite

- **Durum**: Accepted
- **Tarih**: 2026-04-26

### §1 — Bağlam

Sprint 1'de `apps/api/src/routes/orders.ts` POST /orders handler'ı sipariş eklerken `waiter_user_id` alanını ele almıyor. `OrderRowSchema` (zod, shared-types) `waiterUserId: string | null` içeriyor — ancak `orders.waiter_user_id` DB'de henüz yok, sadece zod schema'sında tanımlı (**schema-DB drift**). Kolonu açmak için ayrı bir migration gerekiyor (`005_orders_add_waiter_user_id.sql` rezerv).

Permission matrix `orders.read` action'ı için ABAC kuralı: "waiter only for own orders (req.user.sub === order.waiter_user_id)". DB kolonu yok ve route handler veriyi yazmıyor — bu filtre **çalışamaz**.

### §2 — Karar

GET /orders endpoint'inde **ABAC ertelemesi**: MVP'de tüm 4 rol (admin, cashier, waiter, kitchen) tüm aktif siparişleri görür. RBAC yeterli, ABAC kapalı.

### §3 — Gerekçe

1. **25 masalı tek restoran UX:** Waiter'ın diğer waiter'ların siparişlerini görmesi vekalet/yardım pratiğinde mantıklı (kasiyer yardımı, vardiya devri).
2. **Drift bağımlılığı:** ABAC'ı açmak için önce `waiter_user_id` doldurulmalı — Sprint 2'de POST /orders hotfix'i ile yapılır.
3. **Kitchen ABAC ayrı:** "kitchen-routed items only" kuralı `order_items.station` bazlı, Phase 3 Sprint 1'de KDS endpoint'leriyle birlikte gelir.

### §4 — Sprint 3 öncesi prerequisite'ler

ABAC açılmadan önce tamamlanması gereken işler:

1. **Sprint 3a başında:** Migration `005_orders_add_waiter_user_id.sql`:
   - Kolon: `waiter_user_id UUID NULL`
   - **Composite FK:** `FOREIGN KEY (waiter_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE SET NULL ON UPDATE NO ACTION`
     - Composite hedef ADR-003 §6.5 (UNIQUE `(id, tenant_id)`) kuralına dayanır — orders satır-bazlı tenant izolasyonu garanti edilir.
     - `ON DELETE SET NULL` davranışı ADR-003 §12 audit_logs FK tanımıyla hizalı (`audit_logs.actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`). Audit single-column, orders composite — ON DELETE davranışı aynı; FK boyutu farklı (gerekçe: orders multi-tenant business-record, audit cross-tenant log). Davranış kararı: kullanıcı silinince order kaydı korunur, attribusyon kaybolur — sipariş geçmişi business-record (ADR-003 §13 retention), waiter kim silinmişse boş kalır.
     - `ON UPDATE NO ACTION` UUID immutable olduğundan teorik koruma.
   - **Partial index:** `CREATE INDEX orders_waiter_user_id_idx ON orders(tenant_id, waiter_user_id) WHERE waiter_user_id IS NOT NULL` — ABAC waiter filter query'sinin baseline'ı; NULL satırları index dışı (kasiyer/admin POST'ları + Sprint 1 mevcut satırlar).
   - + `pnpm codegen` + POST /orders handler hotfix (`waiter_user_id = req.user.userId`). Migration ve hotfix tamamlanmadan ABAC açılmaz.
2. **Phase 3 Sprint 1 (KDS):** `order_items.station` kolonu kullanılarak kitchen ABAC tanımlanır. Ayrı ADR (rezerv) — Phase 3 Sprint 1 başında architect yazar. **Rezerv kapanışı 2026-05-08:** ADR-020 K7 ile kitchen ABAC kararı kilitlendi. `kds.read` + `kds.itemStatusUpdate` permission'ları admin + kitchen rolüne tanımlandı; cashier + waiter `/kds`'e erişmez (KDS işyükü onlar için noise). `orders.read` "kitchen-routed items only" filtresi ABAC olarak `order_items.station` üzerinden Sprint 12 PR-2 (Görev 40) backend route'unda enforce edilir.

### §5 — Sonuç

- Sprint 2: POST /orders hotfix uygulanır, GET /orders açılır (ABAC kapalı).
- ABAC enable: ayrı PR + ABAC enforcement testi sonrası.
- `permissions.ts` ABAC yorum satırı korunur (dökümantasyon, runtime'da etkisi yok).

### §6 — Bağımlılıklar

- ADR-002 §6 permission matrix (`orders.read` action mevcut)
- Sprint 1 `orders.ts` repo + route handler'ı (POST hotfix burada güncellenecek)
- Phase 3 Sprint 1 KDS ADR (rezerv) — KDS endpoint'leri + station mapping + kitchen ABAC

### Amendment History

> ADR amendment paterni: bu altbölüme tek satır eklenir, inline (Amendment ...) notları kullanılmaz. Sonraki ADR amendment'leri kendi ADR'lerinde aynı altbölüm ile takip edilir.

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-04-27 | FK semantiği netleştirme + Sprint 3→4 KDS drift cleanup | §3.3, §4.1, §4.2, §6 | (1) §4.1 orijinal "REFERENCES users(id, tenant_id)" yazıyordu ama ON DELETE/UPDATE davranışı + partial index belirsizdi → Görev 14 öncesi netleştirildi (ON DELETE SET NULL, audit pattern hizalı; partial index waiter filter baseline). (2) Sprint 3 boyutu (~1500 satır) nedeniyle Sprint 3a (ABAC unblock) + Sprint 3b (admin CRUD) + Sprint 4 (KDS) bölündü → §3.3 + §4.2 + §6 referansları "Sprint 3 KDS" → "Sprint 4 KDS" güncellendi. |
| 2026-04-28 | Sprint numaralandırma drift cleanup (charter Phase 3'e hizalama) | §3.3, §4.2, §6, §5.2/§5.3 (PRINT* hata kodları) | active-plan vs charter Phase 2 drift düzeltmesi: charter'da KDS+POST /payments **Phase 3 Sprint 1** kapsamı, active-plan'de yanlışlıkla "Sprint 4" yazılıydı. 7 satır güncellendi: KDS+kitchen ABAC referansları "Sprint 4" → **"Phase 3 Sprint 1"**; Print Agent hata kodları (`PRINT_JOB_NOT_FOUND`, `PRINT_PAYLOAD_TOO_LARGE`) "Sprint 4" → **"Phase 4 Sprint 1"** (charter'da Print Agent Phase 4). Charter referans sabit (23 hafta toplam hedef korunur), Phase 2 takvim sapması (~10 hafta) retrospektif belgelerinde görünür. PR `chore/phase-2-drift-cleanup-sprint-4-9-plan` 2026-04-28. |
| 2026-05-08 | §4.2 kitchen ABAC rezerv kapanışı (Sprint 12 PR-1, Görev 39) | §4.2 | ADR-020 K7 ile kitchen ABAC kararı kilitlendi. `kds.read` + `kds.itemStatusUpdate` permission'ları admin + kitchen rolüne tanımlandı (`packages/shared-types/src/permissions.ts`); cashier + waiter `/kds`'e erişmez (noise filter). `orders.read` "kitchen-routed items only" filtresi `order_items.station` üzerinden Sprint 12 PR-2 backend route'unda enforce edilecek. Cross-ref: ADR-020 K7. |

<!-- ADR-008 Accepted (2026-04-26). GET /orders ABAC ertelemesi + waiter_user_id prerequisite. Amendment 2026-04-27 (Amendment History bölümünde detay). ADR-007 rezerv. -->

---

## ADR-009 — Salon Bölgeleri (Areas) Domain

**Statü:** Accepted, 2026-04-29
**İlgili sprint:** Phase 2 Sprint 5, Görev 21 (active-plan §397-414)
**Cross-ref:** ADR-002 §6 (RBAC matrix amendment), ADR-003 §6.5 (composite UNIQUE), §8 (soft delete `deleted_at`), §10.2.3 (domain service authoritative)

### Bağlam

Charter Phase 2 (`docs/project-charter.md:163`) "Web UI — salon bölgeleri" maddesi var; Sprint 8c'de UI yapılacak. Backend domain (Sprint 5 Görev 21) ve şema (Görev 22 migration `007_add_areas.sql`) UI'dan önce hazır olmalı. v3'te `dining_areas` tablosu mevcut (`D:\dev\restoran-pos-v3\server\migrations\run.js:73`) — davranışsal kapsam korunur, kod kopyalanmaz.

### Karar 1 — Schema: ayrı `areas` tablosu (Seçenek A)

PostgreSQL'de `areas` tablosu:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- `name TEXT NOT NULL` (CHECK length 1..40)
- `sort_order SMALLINT NOT NULL DEFAULT 0`
- `deleted_at TIMESTAMPTZ NULL` (ADR-003 §8 soft delete)
- `created_at`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `UNIQUE (id, tenant_id)` (ADR-003 §6.5 composite FK hedefi zorunlu)
- `UNIQUE (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL` (v3 case-insensitive uniqueness davranışı korunur, partial index aktif satırlar için)

`tables` tablosuna `area_id UUID NULL` kolonu eklenir; composite FK:

```sql
ALTER TABLE tables ADD COLUMN area_id UUID NULL;
ALTER TABLE tables ADD CONSTRAINT fk_tables_area
  FOREIGN KEY (area_id, tenant_id) REFERENCES areas (id, tenant_id) ON DELETE SET NULL;
CREATE INDEX idx_tables_area_id ON tables(area_id) WHERE deleted_at IS NULL;
```

- **NULL kararı (İlhan onay 2026-04-29):** v3 NOT NULL idi; v5 MVP'de NULL kabul (geçiş kolaylığı + bölgesiz masa edge-case). Domain service `AreaService.assignTableToArea` çağrısıyla setlenir; "Atanmamış" UI bucket'ı v5.1'e ertelendi (Sprint 8c kapsam dışı).
- **`target_table_count` reddedildi (İlhan onay 2026-04-29):** v3'te UI hint amaçlı; v5 MVP'de gereksiz, v5.1 backlog.

**Reddedilenler:**

- **B (`tables.area_label TEXT` denormalize):** Bölge yönetimi UI (rename, sort) imkânsız; aynı bölge isminde tipo varyantı çoğalır; v3 davranışı kaybolur. **Red.**
- **C (hibrit: hem tablo hem label):** ADR-003 §8 "tek-yol" doktrinine aykırı; iki yazı kaynağı sync sorunu üretir. **Red.**

### Karar 2 — Masa-bölge ilişkisi: 1:N (Seçenek A)

Masa tek bölgede. v3 davranışıyla uyumlu (`dining_area_id NOT NULL` 1:N, `D:\dev\restoran-pos-v3\server\migrations\run.js:88`). N:M junction tablosu MVP scope dışı.

**Reddedilen:** N:M (`area_tables` junction) — v5.1 backlog. Charter MVP "v3 kapsamını koru" kuralı (CLAUDE.md "Ürün sınırı") ile çelişir.

### Karar 3 — Çoklu salon (multi-floor) senaryosu: Flat (parent yok)

v3'te hierarchy yok (kodda tespit: `parent_area_id` veya benzer kolon yok, `D:\dev\restoran-pos-v3\server\migrations\run.js:73-82`). v5 MVP de flat. "Üst kat / Alt kat" gibi senaryolar isim üzerinden ifade edilir ("Bahçe Üst", "Bahçe Alt").

**Reddedilen:** `parent_area_id` self-FK — v5.1 backlog; gerekirse ayrı amendment (ADR-009 amendment §1).

### Karar 4 — RBAC: yeni `areas.manage` action (admin only)

ADR-002 §6 RBAC matrix'e action eklenir: `areas.manage` admin-only (`tables.manage` ile aynı seviye). Cashier/waiter/kitchen okuma için ayrı permission gerekmez — `GET /areas` `tables.read` permission'ına bağlanır (masa listesinin doğal parçası, UI'da masa grupları için lazım).

### Domain service (ADR-003 §10.2.3 authoritative pattern)

`AreaService` (`apps/api/src/domain/areas/AreaService.ts`):

- `create(input)`, `update(id, patch)`, `softDelete(id)`, `restore(id)` (restore v5.1)
- `list({ includeDeleted })` — sort_order ASC, name ASC tiebreaker
- `assignTable(tableId, areaId | null)` — composite tenant_id propagation, `tables` UPDATE
- `softDelete` davranışı (İlhan onay 2026-04-29 service-level): aktif `tables.area_id` referansları **otomatik NULL'a düşer** — service transaction içinde manuel UPDATE yapar. FK `ON DELETE SET NULL` soft delete'te tetiklenmez. Trigger gereksiz; tek-yol service.

### REST endpoint'ler (Sprint 5 Görev 23 DoD)

- `GET    /areas` — sort_order'a göre, deleted hariç
- `POST   /areas` — `{ name, sort_order? }`
- `PATCH  /areas/:id` — name, sort_order
- `DELETE /areas/:id` — soft delete (deleted_at set, masalar NULL'a düşer)
- ~~`POST   /areas/:id/restore`~~ — **v5.1'e ertelendi (İlhan onay 2026-04-29)**
- `PATCH  /tables/:id/area` — `{ area_id: UUID | null }`

Yazma endpoint'leri `areas.manage` permission gerektirir (Karar 4); `GET /areas` `tables.read` ile açık.

### Sonuçlar

- (+) v3 davranış paritesi (bölge yönetimi UI yapılabilir)
- (+) v5.1 area-bazlı raporlama (saatlik ciro × bölge) için normalize zemin hazır
- (+) ADR-003 §6.5 composite FK pattern korunur
- (−) Migration 007 (`007_add_areas.sql`): yeni tablo + `tables.area_id` ALTER + composite FK + index
- (−) ADR-002 §6 amendment (areas.manage action — Karar 4 metni cross-ref olarak yeterli, ayrı amendment paragrafı yazılmaz)
- (−) Görev 22 migration prerequisite: bu ADR onaylanmadan migration yazılmaz

### Migration prerequisite (Görev 22)

`packages/db/migrations/007_add_areas.sql` bu ADR şemasına göre yazılır. Existing `tables` satırları için `area_id NULL` default — geçiş güvenli (Sprint 5 öncesi prod yok).

### Amendments

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-05-05 | **Karar 5 amendment — soft delete → hard delete + snapshot pattern** (PR #103, commit `6c2dd00`). `areas.delete` artık DELETE FROM (soft delete kaldırıldı). Cascade: `areas.unlinkTablesFromArea` (Karar 5'te zaten vardı, koruma altında) → `tables.area_id = NULL` set, sonra `DELETE FROM areas WHERE id = ?`. Tables.delete benzer (DELETE FROM, soft delete yok). Veri korunması ADR-003 §7 invariant snapshot pattern: `orders.table_code_snapshot`/`orders.area_name_snapshot` (Migration 032). | Karar 5 (areas.delete service flow), `repositories/areas.ts.softDelete → hardDelete`, `repositories/tables.ts.softDelete → hardDelete`, route DELETE handler'lar (areas.ts + tables.ts) | Soft delete'in `deleted_at IS NOT NULL` filtresi tüm okuma path'lerinde tekrar tekrar uygulandığında accumulated dead row + index bloat sorun yaratıyordu. Snapshot pattern (zaten `order_items.product_name_snapshot` ile kanıtlanmış) referans bütünlüğü sağlar — silinmiş bir masa/alanın geçmiş siparişlerde adı kaybolmaz. Restore v5.1+ için audit_logs `area.deleted` event payload'undan geri yüklenebilir. |

<!-- ADR-009 Accepted (2026-04-29). Salon bölgeleri (areas) domain — ayrı tablo, 1:N ilişki, flat hierarchy, areas.manage admin-only. İlhan onay (5/5 açık soru): NULL area_id, target_table_count reddedildi, service-level soft delete cascade, restore v5.1, UI mockup yeterli. Amendment 2026-05-05: hard delete + snapshot pattern (PR #103). -->

---

## ADR-010 — Socket.IO Realtime Strategy

- **Statü:** Accepted
- **Tarih:** 2026-04-28
- **İlgili sprint:** Phase 2 Sprint 7, Görev 25 (active-plan); Görev 26 + 27 implementer DoD
- **Cross-ref:** ADR-002 §2 (token taşıma), §3 (access TTL 30 dk), §4 (RTR), §6 (RBAC matrix), §9 (JWT payload); ADR-003 §6 (tenant_id ilkesi), §6.5 (composite UNIQUE/FK), §13 (retention); ADR-006 §2 (error envelope), §4 (DB→Domain mapping), §5 (error code registry), §6 (stability guarantee), §8 (Socket.IO error events kapsam dışı bırakılmıştı — bu ADR'de **resolve**); ADR-009 (areas event ismi pattern); Charter Phase 2 madde 2 (per-tenant room, role-based subscription)

### §1 — Bağlam ve İlkeler

Phase 3 KDS (mutfak ekranı) ve Phase 4 mobil garson uygulaması Socket.IO üzerinden push event'lere bağlı (`orders.created`, `orderItems.statusChanged`, `tables.statusChanged`, `payments.recorded` vb.). Charter Phase 2 madde 2 "WebSocket altyapısı: per-tenant room, role-based subscription" Sprint 7'de unblock edilir.

ADR-006 §8 "Socket.IO error events" kalemini Phase 2 ilk realtime endpoint'ine bırakmıştı. **Bu ADR §6'da resolve edilir** (forward-ref kapatıldı).

Çekirdek ilkeler:

1. **Tek tenant MVP, multi-tenant'a hazır:** ADR-003 §6 `tenant_id` zorunluluğu realtime layer'a da uygulanır. **Cross-tenant event leak kabul edilemez** (KVKK + multi-tenant izolasyon).
2. **Auth ADR-002'ye paralel:** JWT access token (30 dk) realtime handshake'in **tek** auth mekanizması. Refresh akışı REST tarafında (`POST /auth/refresh`) — socket-level refresh **yok**.
3. **i18n-key zorunlu:** Realtime payload'larında Türkçe metin yok. Status değerleri enum (`'preparing' | 'ready'`), hata mesajları `message_key` (ADR-006 §2 envelope formuna paralel).
4. **YAGNI / kapsam kilidi:** Single-instance MVP. Redis adapter, message queue, persisted event log **bu sprint dahil değil** — phase trigger §5'te.
5. **Defansif default'lar:** Socket.IO sane defaults korunur (heartbeat, reconnect backoff); customization yalnız restoran ortamına özgü gerekçeyle.

---

### §2 — Karar 1: Transport stratejisi

**Karar:** **Socket.IO default transport — WebSocket öncelikli, HTTP long-polling fallback aktif.**

- Server: `transports` listesi default (`['polling', 'websocket']`); upgrade WebSocket'e açık.
- Client (web + Expo): default config; `transports` override **yok**.

**Gerekçe:**

- Restoran lokal LAN modern tarayıcı + iOS/Android Expo Dev Client — WebSocket büyük ihtimalle her zaman çalışır.
- Polling fallback **sıfır maliyet**: Socket.IO upgrade önce polling ile handshake yapar, başarılı olursa WebSocket'e yükselir. WebSocket-only (`transports: ['websocket']`) konfigürasyonu sticky-session sorununu öne çeker (Phase 4+ Redis adapter eşiğinde) ve mobil ağ flakiness'inde reconnect süresini uzatır.
- Phase 4'te restoran dışı (3G/4G) veya kurumsal proxy senaryosu doğarsa polling savunma katmanı olur. Çıkarmanın gerekçesi yok.

**Reddedilen alternatifler:**

- **WebSocket-only (`transports: ['websocket']`):** Marjinal RTT iyileştirmesi karşılığında reconnect ve bazı proxy senaryolarında brittle. Reddedildi.
- **Polling-only:** WebSocket'i kapatmak modern istemcilerde anlamsız bandwidth/latency cezası. Reddedildi.

---

### §3 — Karar 2: JWT auth handshake

**Karar:** **JWT access token Socket.IO `auth` payload üzerinden taşınır; handshake middleware'inde verify edilir.**

#### §3.1 Token taşıma

- **Web + Mobile:** Connect sırasında `io(url, { auth: { token: <accessToken> } })` (Socket.IO standart `auth` field'ı).
- Cookie kullanılmaz: ADR-002 §2 web'de cookie sadece `/auth/refresh` `Path` scope'unda; realtime için ayrı cookie genişletmek auth surface'i şişirir. **Bearer-equivalent `auth` payload tek standart**.
- Server tarafı middleware: `io.use((socket, next) => { ... })` içinde `socket.handshake.auth.token` parse edilir, `verifyAccessToken()` (ADR-002 §9 HS256 + `kid: "v1"`) çağrılır, claim'ler `socket.data.user = { sub, tenant_id, role, jti }` olarak attach edilir.

#### §3.2 Reconnect ve token expiry

- **Access token süresi 30 dk (ADR-002 §3).** Reconnect sırasında token süresi dolmuşsa handshake middleware **`AUTH_TOKEN_INVALID`** (ADR-006 §5.1) ile reddeder (`next(new Error(...))` + structured payload — §6).
- **Client davranışı:** Disconnect reason `AUTH_TOKEN_INVALID` ise client önce REST `POST /auth/refresh` çağırır (ADR-002 §4.3 RTR), yeni access token alır, ardından socket'i yeni token ile reconnect eder. **Socket-level refresh akışı yok** (auth surface tek REST'te tutulur — ADR-002 hizalaması).
- **Proaktif refresh:** Client `exp - 60s` kala socket'i `disconnect()` + REST refresh + `connect()` yapar (ADR-002 §3 axios interceptor pattern realtime'a uyarlanır). Implementer bu davranışı `apps/api/src/realtime/client.ts` (Phase 3 brief — bu ADR kapsamı dışı) içinde belirler; **server-side bu davranışı varsayar, push etmez**.

#### §3.3 Tenant claim doğrulama

- Tenant claim **handshake'te bir kez** doğrulanır (`socket.data.user.tenant_id` set edildikten sonra). Her event'te tekrar verify yapılmaz — `socket.data.user` immutable, `socket.disconnect()` olana kadar geçerli.
- Ancak emit/subscribe path'lerinde **room ismi `socket.data.user.tenant_id`'den türetilir** (§4) — payload'daki `tenant_id` field'ı **ignore edilir**, server otoriter.

#### §3.4 Makine istemcileri (Print Agent, KDS) kapsam dışı

- ADR-002 §7 `device_credentials` API key tabanı — Print Agent + Kitchen Display realtime'a katılırsa ayrı handshake stratejisi (örn. API key → kısa ömürlü machine JWT) gerekecek. **Bu ADR insan istemcileri için**; makine realtime ihtiyacı doğduğunda ADR-010 amendment veya ayrı ADR.
- KDS web tarayıcıdan kullanılıyorsa: kitchen rolünde insan kullanıcı login → standart JWT akışı. Tablet'i kim kullanıyorsa o kullanıcının session'ı.

**Reddedilen alternatifler:**

- **HTTP cookie-based auth (refresh cookie WS handshake'te taşınsın):** Cookie scope `/auth/refresh` ile sınırlı (ADR-002 §2); WS handshake için ayrı cookie path açmak auth surface'i çoğaltır. Reddedildi.
- **Socket-level refresh (custom `auth.refresh` event):** İki refresh path (REST + socket) drift riski. ADR-002 §4 RTR akışı tek noktada kalmalı. Reddedildi.
- **Query string token (`?token=...`):** Token URL'de loglanır (proxy, access log) — ADR-002 §2 "localStorage yasak" risk profilinin paraleli. Reddedildi.

---

### §4 — Karar 3: Namespace ve room stratejisi

**Karar:** **Tek namespace `/realtime`; per-tenant zorunlu room + per-role opsiyonel room + per-user opsiyonel room. Default namespace `/` kullanılmaz.**

#### §4.1 Namespace

- **`/realtime` ayrı namespace.** Default namespace `/` kullanılmaz.
- **Gerekçe:** Default namespace'te yanlışlıkla `socket.broadcast.emit()` çağrısı tüm bağlı client'lara gidebilir (room dışı). Ayrı namespace + zorunlu room pattern'i ile **"namespace'e bağlı her socket bir room'a join olmuş olmalı"** invariant'ı server-side enforce edilir (handshake middleware'inde `socket.join(...)` çağrılır, eksikse disconnect).

#### §4.2 Room hiyerarşisi

Handshake'te otomatik join:

1. **`tenant:${tenantId}`** — zorunlu, **her socket bu room'a join olur**. Cross-tenant izolasyon temel garantisi.
2. **`tenant:${tenantId}:role:${role}`** — zorunlu, role-bazlı broadcast için (örn. KDS event'i sadece `kitchen` ve `admin` rolüne).
3. **`tenant:${tenantId}:user:${userId}`** — zorunlu, per-user routing için (örn. waiter'a kendi siparişinin payment confirmation'ı, admin force-logout sinyali).

Server tarafında broadcast pattern'leri:

- `io.of('/realtime').to(\`tenant:${tenantId}:role:kitchen\`).emit('orderItems.statusChanged', payload)` — sadece o tenant'ın mutfağı.
- `io.of('/realtime').to(\`tenant:${tenantId}:user:${userId}\`).emit('auth.forceLogout', payload)` — admin force-logout (ADR-002 §5 senaryosu).
- **`io.emit(...)` veya `socket.broadcast.emit(...)` doğrudan yasak** — code review + lint kuralı: tüm emit çağrıları `to(...)` ile room'a kısıtlı (Görev 26 implementer DoD; ESLint custom rule veya `apps/api/src/realtime/emit.ts` wrapper helper).

#### §4.3 Cross-tenant izolasyon enforcement

- Handshake middleware'inde `socket.join(\`tenant:${tenantId}\`)` deterministic. Client `socket.emit('join', { tenantId: 'X' })` gibi bir custom join yapamaz — server otoriter, client room'a manuel join etmez.
- Test stratejisi (Görev 26 DoD): cross-tenant leak integration test — tenant A user'ı tenant B room'una hiçbir koşulda join olamaz; tenant B'ye broadcast edilen event tenant A socket'ine gelmez.

**Reddedilen alternatifler:**

- **Sadece per-tenant room (rolesüz):** Mutfağa ödeme event'i, kasiyere KDS detay event'i sızar — gereksiz bandwidth + UI noise + permission skew. Reddedildi.
- **Per-tenant namespace (`/tenant-${id}`):** Dynamic namespace pattern Socket.IO'da destekli ama her tenant için ayrı middleware lifecycle = operational karmaşıklık + Redis adapter Phase 4'te dynamic namespace × room kombinasyonu daha pahalı. Statik tek namespace + room hiyerarşisi tercih. Reddedildi.
- **Default namespace `/`:** §4.1 gerekçe — invariant zayıf. Reddedildi.

---

### §5 — Karar 4: Reconnect davranışı + missed event recovery

**Karar:** **Socket.IO default reconnect (exponential backoff 1s → 5s, infinite attempts) korunur. Missed event recovery client-side `since` timestamp ile REST refetch (Phase 3 KDS + Phase 4 mobile brief'inde detay).**

#### §5.1 Reconnect

- Server: default `pingInterval=25s, pingTimeout=20s` (§7 — bu ADR'de değiştirilmez; restoran LAN için yeterli).
- Client: default `reconnection=true, reconnectionDelay=1000, reconnectionDelayMax=5000, reconnectionAttempts=Infinity`.
- **Gerekçe:** 1s → 5s pencere restoran "kısa ağ flapping" senaryosunda hızlı recovery; Infinity attempts gece-gündüz çalışan KDS ekranı için doğru (manuel reload gerekmez).

#### §5.2 Missed event recovery

- **Server-side queue / persisted event log YOK** (MVP YAGNI — kapsam dışı).
- **Client-side recovery pattern:** Reconnect başarılı olduğunda client REST endpoint'ine `?since=<lastEventTimestamp>` query ile delta refetch yapar (örn. KDS reconnect → `GET /orders?status=open&since=...` → eksik order item'ları çeker).
- Bu pattern Phase 3 KDS endpoint brief'i ve Phase 4 mobile brief'inde detaylanır — bu ADR yalnız "server-side queue yok, client refetch sorumlu" kuralını kilitler.
- **Trade-off kabul:** ~1-5s reconnect penceresinde gelen 1-2 event'ı client kaçırabilir; reconnect sonrası refetch ile kapanır. Sipariş/ödeme **kritik** path'lerde event'a güvenilmez — ack ve REST GET tek doğruluk kaynağı (§8).

#### §5.3 Phase 4+ Redis adapter trigger

`@socket.io/redis-adapter` ne zaman tetiklenir:

- **Trigger 1 (ölçek):** Concurrent socket sayısı > **500** veya birden fazla API instance (PM2 cluster mode > 1 worker veya horizontal scale).
- **Trigger 2 (phase):** Phase 5 multi-tenant pilot (2-3 tenant aktif) + 1 instance darboğaz.
- **MVP durum:** Tek tenant, ~30 concurrent socket (25 masa + KDS + admin), tek PM2 worker. **Redis adapter dep eklenmez bu sprint.**
- Trigger karşılandığında: ayrı ADR (ADR-XXX Redis adapter + sticky session + cross-instance broadcast contract). Bu ADR'de dep listesi açılmaz.

**Reddedilen alternatifler:**

- **Custom backoff (500ms → 30s):** Default 1-5s pencereyi daha agresif yapmak server'a reconnect storm yükler (network outage senaryosunda); 30s max kullanıcıyı uzun süre offline bırakır. Default sane. Reddedildi.
- **Server-side persisted event log (Redis Streams / DB tabanlı):** YAGNI — MVP single-instance. Phase 4+ Redis trigger ile birlikte değerlendirilir. Reddedildi.

---

### §6 — Karar 5: Error event envelope (ADR-006 §8 forward-ref kapatıldı)

**Karar:** **Realtime hataları iki kanaldan döner: (a) handshake disconnect → `connect_error` event ile structured payload; (b) event ack callback → `{ ok: false, error: { code, message_key, details? } }`. Envelope ADR-006 §2 ile uyumlu.**

#### §6.1 Handshake hataları (auth fail vb.)

Server middleware'inde:

```ts
io.of('/realtime').use((socket, next) => {
  try {
    const claims = verifyAccessToken(socket.handshake.auth.token);
    socket.data.user = claims;
    next();
  } catch (e) {
    const err = new Error('AUTH_TOKEN_INVALID');
    // @ts-expect-error Socket.IO accepts data on Error
    err.data = { code: 'AUTH_TOKEN_INVALID', message_key: 'error.auth.tokenInvalid' };
    next(err);
  }
});
```

Client tarafı `socket.on('connect_error', (err) => { /* err.data = { code, message_key } */ })` yakalar. ADR-006 §2 envelope ile **shape-uyumlu** (`code` + `message_key`); HTTP envelope `{ error: { code, ... } }` wrap'i Socket.IO `Error.data` mekanizmasına paralel.

Disconnect reason kullanılmaz (Socket.IO disconnect reason'ları transport-level: `'io server disconnect'`, `'transport close'` vb.) — bunlar **structured error code değil**. Auth fail senaryosunda client `connect_error` event'inden `err.data.code`'u okur.

#### §6.2 Event ack hataları

Bir event server tarafında reddedilirse (örn. permission yetersiz, validation fail), ack callback ile:

```ts
socket.on('orders.update', (payload, ack) => {
  const parsed = OrderUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return ack({ ok: false, error: { code: 'VALIDATION_ERROR', message_key: 'error.validation.failed', details: { fields: ... } } });
  }
  // ...
  ack({ ok: true, data: result });
});
```

Ack envelope contract:

```ts
type RealtimeAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message_key: string; details?: unknown } };
```

ADR-006 §5 error code registry **paylaşılır**: `VALIDATION_ERROR`, `ACCESS_DENIED`, `RESOURCE_NOT_FOUND`, vb. realtime ack'lerde **aynı kodlar** kullanılır. **Yeni realtime-spesifik kod yok** bu ADR'de — gerektikçe ADR-006 §5.2'ye eklenir (stability guarantee §6).

#### §6.3 Server-initiated push'lar hata taşımaz

`io.to(...).emit('orders.created', payload)` gibi server push'ları **hata vehicle değil**. Hata yalnız (a) handshake `connect_error` veya (b) client→server event'in ack callback'iyle döner.

**Reddedilen alternatifler:**

- **Custom `error` event (`socket.emit('error', envelope)`):** Socket.IO'da `error` event ismi reserved'a yakın; default ack mekanizması daha idiyomatik. Reddedildi.
- **Disconnect reason'a code gömme (`socket.disconnect('AUTH_TOKEN_INVALID')`):** Reason field string limit + transport-level reason'larla karışır. Reddedildi.

**Resolve:** ADR-006 §8 "Socket.IO error events — Phase 2 ilk realtime endpoint'inde, ayrı karar" forward-ref **bu §6'da kapatıldı**. ADR-006 amendment satırı (Sprint 7 implementer Görev 26 DoD'da): "ADR-010 §6 ADR-006 §8 forward-ref'i resolve etti."

---

### §7 — Karar 6: Heartbeat / timeout

**Karar:** **Socket.IO default `pingInterval=25000, pingTimeout=20000` korunur.**

- Restoran LAN ortamında yeterli.
- Mobil 3G/4G senaryosunda (Phase 4) 25s ping aralığı NAT timeout'larından (~30s) güvenle önde — connection alive kalır.
- Reverse proxy (Nginx vb.) tarafında WebSocket idle timeout `> 60s` olmalı; bu ADR'nin gerektirdiği konfigürasyon Phase 2 deploy ADR'sinde (forward-ref) belgelenir.

**Reddedilen alternatifler:**

- **Daha agresif (`pingInterval=10s`):** Bandwidth + battery (mobil) maliyeti gereksiz. Reddedildi.
- **Daha gevşek (`pingInterval=60s`):** NAT timeout riski. Reddedildi.

---

### §8 — Karar 7: Event ack stratejisi

**Karar:** **Server→client broadcast push: fire-and-forget (no ack). Client→server kritik event'ler (`orders.*`, `payments.*`, `tables.*` mutation): ack zorunlu — ama gerçek doğruluk kaynağı REST. Realtime UI optimizasyonu için, persistence için değil.**

#### §8.1 Server→client broadcast

- `io.to(...).emit('orders.created', payload)`, `'orderItems.statusChanged'`, vb. — **ack callback yok**.
- Client missed event'i §5.2 reconnect refetch ile telafi eder.

#### §8.2 Client→server kritik event'lerde ack

- Sipariş/ödeme/masa state değiştiren client→server event'lerde ack callback (`{ ok: true, data } | { ok: false, error }`) **zorunlu**.
- **Ama realtime mutation primary path DEĞİL.** Sipariş oluşturma, ödeme alma, vb. **REST endpoint'i ile** yapılır (ADR-006 envelope, audit, idempotency güvencesi). Realtime ack pattern'i sadece UI optimistic update doğrulaması için.
- **Slogan:** "Realtime push UI'yi günceller, REST DB'yi günceller. İki kanal birbirinin yedeği değil — her ikisinin de tek doğruluk kaynağı PostgreSQL."

#### §8.3 Idempotency

Realtime event'lerde idempotency key MVP'de yok (REST tarafında ADR-006 §5.3 rezerv). Reconnect refetch pattern'i (§5.2) yeterli — duplicate broadcast UI tarafında `event_id` (UUID) deduplication ile filtrelenir; `event_id` payload contract'ı §11.2'de.

**Reddedilen alternatifler:**

- **Tüm broadcast'ler ack ile (delivery guarantee):** Socket.IO ack broadcast destekli ama N client'a ack beklemek throughput'u öldürür. Reddedildi.
- **Realtime mutation primary (REST yedek):** State değiştiren akışın audit/transaction güvencesi REST'te. Reddedildi.

---

### §9 — Karar 8: Connection limits

**Karar:** **MVP'de hard limit yok; soft monitor + alert var. Per-tenant max 200 concurrent socket warning eşiği. Per-user concurrent connection limit yok (1 user multi-cihaz serbest).**

- 25 masa restoran, 200 eşiği rahat marj (~6× kapasite).
- Per-user limit yok: garson telefon + tablet + arka kasa eş zamanlı kullanabilir.
- Per-IP limit MVP'de yok — restoran tek IP'den (NAT) tüm cihazlar geliyor.
- DoS koruması: API gateway / reverse proxy seviyesinde (Phase 2 deploy ADR forward-ref); Socket.IO katmanında MVP'de yok.
- Monitoring: `socket.io.engine.clientsCount` Sentry breadcrumb veya pino log (ADR-003 §13.2.G observability ADR forward-ref) — eşik aşıldığında warning.

**Reddedilen alternatifler:**

- **Per-user max 1 connection:** Multi-cihaz UX'i kırar. Reddedildi.
- **Hard rate limit (WS message/s):** YAGNI — MVP'de ölçüm yok. Phase 4'te observability ADR sonrası değerlendirilir. Reddedildi.

---

### §10 — Karar 9: CORS / origin allowlist

**Karar:** **Socket.IO `cors.origin` REST `WEB_ORIGIN` env değişkeniyle aynı allowlist'e bağlı. Wildcard `*` yasak.**

```ts
const io = new Server(httpServer, {
  cors: {
    origin: process.env.WEB_ORIGIN!.split(','),  // explicit allowlist
    credentials: false,                           // realtime cookie kullanmıyor (§3)
    methods: ['GET', 'POST'],
  },
  path: '/realtime/socket.io',
});
```

- `credentials: false` çünkü §3 cookie kullanılmaz; Bearer-equivalent `auth` payload'a güvenir.
- ADR-002 §2 "CORS allowlist tek explicit web origin'e kilitlenir" kuralı realtime'a da uygulanır. **Wildcard hiçbir env'de açılmaz.**
- Path `/realtime/socket.io` (default `/socket.io` yerine) — reverse proxy routing ve mevcut REST `/auth/*`, `/orders/*` route'larıyla görsel ayrım.

**Reddedilen alternatifler:**

- **CORS açık (`origin: '*'`):** ADR-002 §2 paralel kuralı bozar. Reddedildi.
- **`credentials: true`:** Cookie kullanılmıyor; gereksiz CORS preflight overhead. Reddedildi.

---

### §11 — Karar 10: Event payload kontratı

**Karar:** **`packages/shared-types/src/realtime.ts` realtime event isimleri + zod schema'larını tek kaynak olarak yayınlar. Event ismi konvansiyonu: `<domain>.<verbPast>` camelCase. Payload zod ile server publish ÖNCE + client receive ÖNCE doğrulanır.**

#### §11.1 Event isim konvansiyonu

`<domain>.<verbPast>` camelCase. Domain ADR-009 (`areas`), ADR-006 §5.2 domain prefix'leriyle hizalı.

Forward-ref event isim listesi (Phase 3 + Phase 4 brief'lerinde detay; bu ADR'de **isim contract'ı** kilit):

| Event ismi | Yön | Kapsam | Phase |
|---|---|---|---|
| `orders.created` | server→client | tenant + role:kitchen, role:cashier, role:admin | Phase 3 |
| `orders.updated` | server→client | tenant + role:* | Phase 3 |
| `orders.closed` | server→client | tenant + role:* | Phase 3 |
| `orderItems.statusChanged` | server→client | tenant + role:kitchen, role:waiter (own), role:admin | Phase 3 |
| `payments.recorded` | server→client | tenant + role:cashier, role:admin | Phase 3 |
| `tables.statusChanged` | server→client | tenant + role:* | Phase 3 |
| `areas.created`/`updated`/`deleted` | server→client | tenant + role:admin (yöneticilik); role:* informational | Phase 3 (ADR-009 ref) |
| `auth.forceLogout` | server→client | tenant + user:${userId} (target only) | Phase 3 (ADR-002 §5) |

**Resmi liste Phase 3 KDS ADR'sinde / Phase 4 mobile ADR'sinde finalize edilir.** Bu ADR yalnız (a) isim konvansiyonu + (b) zod schema bridge + (c) i18n-key kuralı kilitler.

#### §11.2 Payload zorunlu alanlar

Her realtime event payload'ı en az:

```ts
{
  event_id: string;          // UUID v7 (ADR-003 §3) — client-side dedup
  tenant_id: string;         // server otoriter, room'dan türer; client doğrulama amaçlı
  emitted_at: string;        // ISO8601 TIMESTAMPTZ
  // ...domain-specific payload
}
```

- `tenant_id` payload'da bilgi amaçlı; **server room'dan türetir, client'tan gelen `tenant_id` ignore edilir** (§3.3 + §4.3).
- `event_id` reconnect refetch sonrası UI tarafında duplicate filtrelemek için.

#### §11.3 Zod doğrulama (iki taraflı)

- **Server publish öncesi:** `apps/api/src/realtime/emit.ts` wrapper helper payload'ı zod schema ile parse eder; fail → 500 `INTERNAL_ERROR` + log (event yayınlanmaz). Bu wrapper **tek emit path'i** — direkt `io.emit` çağrıları lint kuralıyla yasak (§4.2).
- **Client receive öncesi:** `apps/web/src/realtime/listen.ts` ve `apps/mobile/src/realtime/listen.ts` event handler'larından önce zod parse; fail → log + UI'ya hata göstermez (silent drop, event_id'yi son işlenen olarak markala — refetch tetiklenmez çünkü reconnect değil malformed payload).

#### §11.4 i18n-key kuralı

- Realtime payload'da Türkçe metin **yok**. Status enum (`'preparing' | 'ready' | 'served' | 'cancelled'`), kategori isimleri ID, kullanıcı görünür metin **yok**.
- Hata payload'larında (§6.2) `message_key` kullanılır — UI t() ile çevirir.
- KVKK: telefon last-4 kuralı ADR-002 §4.2 + ADR-003 §13 (call_logs retention 30g) realtime payload'a da uygulanır — `customer.phone_last4: '1234'` formatı; full phone yayınlanmaz.

#### §11.5 Stability guarantee (ADR-006 §6 paralel)

- **Event ismi + payload schema v5.x içinde değişmez.** Field eklemek geriye uyumlu (client ignore eder), field silmek/yeniden adlandırmak breaking — yeni event ismi gerektirir (örn. `orders.createdV2`).
- ADR-006 §6 error code stability ile aynı kural realtime contract'ına uygulanır.

**Reddedilen alternatifler:**

- **Event ismi `<domain>:<verb>` (kebab/colon):** Socket.IO docs noktayı önerir; toolchain (TypeScript event map) `.` ile daha rahat. Reddedildi.
- **Payload format JSON Schema (zod yerine):** Monorepo zaten zod (ADR-002, 003, 006) — toolchain birliği. Reddedildi.

---

### §12 — Test stratejisi (Görev 26 + 27 implementer DoD ipuçları)

Bu ADR test detayını yazmaz; implementer brief input olarak alır:

1. **Handshake auth:** Geçerli token → connect ✓. Expired token → `connect_error` `AUTH_TOKEN_INVALID`. Eksik token → `connect_error` `AUTH_BAD_REQUEST`.
2. **Tenant izolasyonu (KVKK kritik):** Tenant A kullanıcısı `tenant:B:*` room'una hiçbir koşulda join olamaz; tenant B'ye broadcast edilen event tenant A socket'ine **hiç** ulaşmaz. `socket.rooms` server-side inspect.
3. **Role room:** Kitchen rolündeki kullanıcı `tenant:X:role:cashier` event'ini almaz.
4. **Reconnect token expire:** Connect → 30 dk geç → REST refresh → reconnect new token → ✓ (client davranışı simülasyonu).
5. **Event payload zod:** Malformed payload server-side reddedilir (emit wrapper) ve client-side log'lanır.
6. **Ack envelope:** ADR-006 §2 envelope shape (`{ ok: false, error: { code, message_key } }`).
7. **Cross-namespace:** Default namespace `/`'a connect denemesi reddedilir (§4.1 invariant).

Stack: Vitest + `socket.io-client` + supertest (HTTP server bootstrap).

---

### §13 — Açık sorular ve YAGNI rezervi

| # | Konu | Karar | Trigger |
|---|---|---|---|
| 1 | Redis adapter | Bu sprint dep eklenmez | §5.3 trigger 1 (>500 socket veya cluster) veya trigger 2 (Phase 5 multi-tenant) |
| 2 | Server-side persisted event log | Yok | Phase 4+ Redis trigger ile birlikte |
| 3 | Print Agent / KDS makine handshake | Bu ADR insan istemcileri için | Makine realtime ihtiyacı doğunca ADR-010 amendment veya ayrı ADR |
| 4 | Per-IP / per-user hard rate limit | Yok (soft monitor) | API gateway katmanına push (Phase 2 deploy ADR) |
| 5 | Resmi event isim listesi | İsim **konvansiyonu** + bridge schema kilitlendi | Liste Phase 3 KDS ADR + Phase 4 mobile ADR'de finalize |
| 6 | Reverse proxy WS timeout konfigürasyonu | Bu ADR'de yazılmaz | Phase 2 deploy ADR (forward-ref §7) |

**Açık soru olarak kullanıcıya sorulacak: yok.** Tüm kararlar bu ADR'de defansif default + gerekçeyle kapatıldı.

---

### §14 — Sonuçlar

- (+) Phase 3 KDS + Phase 4 mobil unblock (Görev 26 + 27 implementer brief ready).
- (+) ADR-006 §8 forward-ref kapatıldı (§6); error envelope shape REST + realtime arasında tutarlı.
- (+) Cross-tenant izolasyon room-tabanlı + handshake-otoriter; KVKK + multi-tenant garantisi yapısal.
- (+) Auth surface tek REST'te (ADR-002 §4 RTR); socket-level refresh path'i yok = drift riski sıfır.
- (+) YAGNI: Redis adapter dep eklenmedi, scale trigger §5.3'te yazılı.
- (−) Reconnect penceresinde missed event riski client-side refetch'e bırakıldı; sipariş/ödeme path'leri zaten REST + audit primary olduğu için kabul edilebilir.
- (−) Resmi event isim listesi Phase 3/4 ADR'lerine bırakıldı — bu ADR konvansiyon + schema bridge'i kilitler, isim drift'i Phase 3 başında dikkat.
- (−) Reverse proxy WS timeout konfigürasyonu Phase 2 deploy ADR'sine forward-ref — Sprint 7 deployable yok, kabul.

---

### §15 — Cross-references

- **ADR-002 §2** (token taşıma): Realtime `auth` payload Bearer-equivalent paterni.
- **ADR-002 §3** (access TTL 30 dk): Reconnect token expiry akışı buradan türer (§3.2).
- **ADR-002 §4** (RTR): Refresh path realtime'a sızdırılmaz — REST tek noktada (§3.2).
- **ADR-002 §6** (RBAC matrix): Role-room broadcast §4.2 buraya dayanır.
- **ADR-002 §9** (JWT payload): `verifyAccessToken()` claim'leri handshake'te kullanılır.
- **ADR-003 §6** (`tenant_id` zorunluluğu): Realtime room hiyerarşisi temel (§4.2).
- **ADR-003 §13** (KVKK retention): Telefon last-4 kuralı realtime payload'a uygulanır (§11.4).
- **ADR-006 §2** (envelope): Realtime ack envelope shape uyumlu (§6.2).
- **ADR-006 §5** (error code registry): Aynı kodlar realtime ack'lerde paylaşılır (§6.2).
- **ADR-006 §6** (stability guarantee): Realtime event ismi + payload schema'ya paralel uygulanır (§11.5).
- **ADR-006 §8 (forward-ref)**: **Bu ADR §6'da kapatıldı.**
- **ADR-009** (areas): Event ismi konvansiyonu (`areas.created` vb.) §11.1 listesinde forward-ref.
- **Charter Phase 2 madde 2**: "WebSocket altyapısı: per-tenant room, role-based subscription" — bu ADR §4 ile çözüldü.

### §16 — Implementer brief (Görev 26 + 27 input — bu ADR'nin kararlarının dosya sözleşmesi)

> **Not (architect → implementer):** Aşağıdakiler Görev 26 + 27 brief'i için "ne yazılacak" özeti — bu ADR yalnız karar metnini taşır, dosyaları **oluşturmaz**.

**Görev 26 — `apps/api/src/realtime/`:**

- `apps/api/src/realtime/server.ts` — `Server` instance bootstrap (§10 cors config, §4.1 `/realtime` namespace, §7 default heartbeat).
- `apps/api/src/realtime/handshake.ts` — Auth middleware (§3.1 + §3.3). `socket.data.user` set + tenant/role/user room join (§4.2).
- `apps/api/src/realtime/emit.ts` — Tek emit path wrapper helper (§4.2 + §11.3): `emitToTenant`, `emitToRole`, `emitToUser` — payload zod parse + structured emit. Direct `io.emit` ESLint kuralıyla yasak.
- `apps/api/src/realtime/errors.ts` — `connect_error` payload helper'ı (§6.1) ve `RealtimeAck<T>` discriminated union tipi (§6.2).

**Görev 27 — `packages/shared-types/src/realtime.ts`:**

- Event isim konvansiyonu (§11.1) literal union: `'orders.created' | 'orders.updated' | ...` (Phase 3/4 listesi forward-ref; MVP yalnız placeholder + bridge tipler).
- Payload base schema: `RealtimeEventBase` (§11.2 — `event_id`, `tenant_id`, `emitted_at`).
- `RealtimeAck<T>` zod schema (§6.2 — `{ ok: true, data } | { ok: false, error: { code, message_key, details? } }`).
- TypeScript event map tipi (`ServerToClientEvents`, `ClientToServerEvents`) — `Server<>`/`Socket<>` generic'lerine bağlanır.

Test stratejisi §12 — implementer DoD'a bağlı (Vitest + socket.io-client).

---

### Amendments

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| - | - | - | - |

<!-- ADR-010 Accepted (2026-04-28). Socket.IO realtime strategy — /realtime namespace, JWT auth payload handshake, per-tenant + role + user room hiyerarşisi, default heartbeat + reconnect, REST primary + realtime UI accelerator, ADR-006 §8 forward-ref kapatıldı. Görev 26 + 27 implementer brief §16'da. Redis adapter §5.3 phase trigger; bu sprint dep eklenmedi. -->

---

## ADR-011 — Web UI Tasarım Kuralları

- **Durum**: Accepted
- **Tarih**: 2026-04-29
- **Bağlam**: Phase 2 Sprint 8 — backend (auth + CRUD + Socket.IO realtime) tamamlandı, web UI başlangıç. Bu ADR Sprint 8a-8d boyunca tüm ekranların uyacağı **kural kitabı**. 25 masalı pide/lokanta hedefli MVP; Adisyo killer **değil** — kapsam kilidi gereği "minimal viable POS UI", pixel-perfect Apple-tier polish değil.

### Karar (üst başlık — 6 stack kararı kullanıcı onaylı)

| # | Karar | Reddedilen alternatif |
|---|---|---|
| 1 | **shadcn/ui** (Tailwind v3 + Radix primitives, copy-paste pattern) | MUI (Google look POS'a yapay), Mantine (tema customization sınırlı), raw Tailwind (yavaş) |
| 2 | **TanStack Query v5** (server state + cache + refetch + invalidation) | useState+fetch (refetch/cache zor) |
| 3 | **Zustand v4** (client state — modal/filter/sidebar) | Redux Toolkit (overkill MVP), Context (karmaşık) |
| 4 | **react-hook-form + @hookform/resolvers/zod** — `@restoran-pos/shared-types` zod schema'ları DOĞRUDAN reuse | Formik (RHF performance daha iyi), kontrolsüz form (validation manuel) |
| 5 | **React Router v6 (data router)** — loader/action/error boundary pattern | TanStack Router (tip güvenli ama olgun değil), Next.js (overkill SPA için) |
| 6 | **react-i18next + i18next-browser-languagedetector** | FormatJS (Türkçe için fazla), i18next-react-light (olgun değil) |

### §1 — Stack lock + paket sürümleri

`apps/web/package.json` minimum sürümler:

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",
    "@tanstack/react-query": "^5.59.0",
    "zustand": "^4.5.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "zod": "^3.23.0",
    "react-i18next": "^15.1.0",
    "i18next": "^23.16.0",
    "i18next-browser-languagedetector": "^8.0.0",
    "axios": "^1.7.0",
    "socket.io-client": "^4.7.0",
    "sonner": "^1.7.0",
    "@restoran-pos/shared-types": "workspace:*"
  }
}
```

Tailwind CSS v3 (v4 alpha — production'a hazır değil). shadcn/ui CLI ile `components/ui/*` kopyalanır (npm package değil).

### §2 — Folder yapısı

**Feature-folders pattern** (CCN reddedildi — 7 ekran ölçeğinde feature izolasyonu daha okunabilir):

```
apps/web/
├── public/
│   └── fonts/             # Inter self-hosted (woff2)
├── src/
│   ├── App.tsx            # AuthProvider + QueryClient + RouterProvider + ErrorBoundary + Toaster
│   ├── main.tsx           # entry — i18n init + ReactDOM.render
│   ├── router.tsx         # createBrowserRouter, lazy-imported pages
│   ├── components/
│   │   ├── ui/            # shadcn/ui kopyaları (Button, Input, Dialog, Toast, Card, Skeleton, ...)
│   │   └── layout/        # AppShell (sidebar + topbar + outlet), AuthLayout (centered logo)
│   ├── features/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ForgotPasswordModal.tsx
│   │   │   ├── api.ts            # login/logout/refresh/me — TanStack Query mutations
│   │   │   ├── hooks.ts          # useAuth, useRequireAuth
│   │   │   └── types.ts
│   │   ├── tables/        # Sprint 8b
│   │   ├── menu/          # Sprint 8c (categories + products + variants)
│   │   ├── areas/         # Sprint 8c (salon bölgeleri)
│   │   ├── users/         # Sprint 8d
│   │   ├── settings/      # Sprint 8d
│   │   └── dashboard/     # Sprint 8a
│   ├── store/
│   │   └── auth.ts        # Zustand: { accessToken, user, setAuth, clearAuth }
│   ├── lib/
│   │   ├── api.ts         # axios instance + interceptors (Authorization + 401 retry)
│   │   ├── socket.ts      # Socket.IO singleton + useSocket / useSocketEvent
│   │   ├── error.ts       # API error → i18n key mapping (ADR-006 registry)
│   │   └── env.ts         # import.meta.env wrapper, zod parse
│   ├── i18n/
│   │   ├── init.ts        # i18next config — TR varsayılan, fallback EN yok (MVP)
│   │   └── locales/
│   │       └── tr.json    # Tüm UI metinleri tek dosya MVP
│   └── styles/
│       └── globals.css    # Tailwind base + tokens (CSS variables)
├── index.html
├── tailwind.config.ts
├── tsconfig.json          # extends ../../tsconfig.base.json (yoksa workspace base)
└── vite.config.ts
```

**Kural:** `features/{name}/` içinde **dış import yok** — sadece `lib/`, `components/ui/`, `store/`, `shared-types`. Cross-feature import yasak (Sprint 8b'de tables → menu lookup gerekirse `lib/api.ts` üzerinden).

### §3 — Auth flow + token lifecycle

| Token | Yer | TTL | Yenileme |
|---|---|---|---|
| **Access JWT** | Zustand `useAuthStore` (memory) | 30 dk (ADR-002 §3) | 401 interceptor → POST /auth/refresh |
| **Refresh JWT** | httpOnly cookie (server-set, browser otomatik) | 30 gün (sliding) | RTR (ADR-002 §4.2) — her refresh yeni access + yeni refresh |

**Axios interceptor flow:**
```
request → Authorization: Bearer {accessToken from store}
↓
response 401:
  → POST /auth/refresh (cookie otomatik gönderilir)
  → 200: store.setAuth(newAccess) → orijinal request retry
  → 401: store.clearAuth() → router.navigate('/login') → toast "Oturumunuz sona erdi"
```

**Store:**
```typescript
useAuthStore = zustand.create<AuthState>(set => ({
  accessToken: null, user: null,
  setAuth: (token, user) => set({ accessToken: token, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
```

**Bootstrap (App.tsx):** İlk yüklemede `GET /auth/me` çağrısı (cookie ile refresh otomatik) — başarılı ise `setAuth`, değilse `/login` yönlendirme.

**Logout flow:** POST /auth/logout → clearAuth → socket.disconnect → navigate('/login').

### §4 — Socket.IO client wrapper

`lib/socket.ts` — tek instance, AuthProvider içinde mount:

```typescript
let socket: Socket | null = null;

export function connectSocket(accessToken: string): Socket {
  if (socket?.connected) return socket;
  socket = io(env.SOCKET_URL + '/realtime', {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
```

**Declarative hook (kullanım pattern'i):**
```typescript
useSocketEvent('tables.statusChanged', (payload) => {
  queryClient.invalidateQueries(['tables']);
  // veya optimistic update
});
```

ADR-010 §11.3 enforcement: client'ta da direct `socket.emit` yasak — `useSocketEvent` ve `emitWithAck` helper'ları üzerinden.

### §5 — Color tokens (POS-spesifik!)

**Light mode only** (dark mode v5.1). CSS variables, Tailwind theme extend:

```css
:root {
  --primary: 220 90% 45%;          /* blue-600 — action butonları */
  --primary-foreground: 0 0% 100%;
  --destructive: 0 84% 50%;         /* red-600 — DELETE butonları */
  --destructive-foreground: 0 0% 100%;

  --table-available: 152 76% 40%;   /* emerald-500 — masa boş */
  --table-occupied: 350 89% 60%;    /* rose-500 — masa dolu */
  --table-cleaning: 38 92% 50%;     /* amber-500 — temizleniyor */

  --background: 0 0% 100%;
  --foreground: 222 47% 11%;        /* slate-900 — yüksek kontrast */
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --border: 214 32% 91%;
  --ring: 220 90% 45%;              /* primary ile aynı */
}
```

**Kontrast disiplini:** WCAG AA — 4.5:1 minimum (rush-hour HCI: kasiyer 1m mesafeden okumalı). Restoran ışığı varyasyonu: gri arka plan değil **beyaz** background, koyu metin.

**Anti-pattern:** Açık gri tonlarla "sofistike pastel" — POS rush-hour okunabilirliği bozar. v5.1 dark mode geldiğinde aynı disiplin: yüksek kontrast.

### §6 — Typography

**Inter** font, **self-hosted** (Google Fonts CDN reddedildi — KVKK + offline + restoran PC ağı). `apps/web/public/fonts/` altında woff2:
- Inter-Regular (400)
- Inter-Medium (500)
- Inter-SemiBold (600)
- Inter-Bold (700)

Latin Extended-A subset (Türkçe `ç ğ ı İ ö ş ü` tam destek). `@font-face` `globals.css`'te.

**Type scale (Tailwind):**
- `text-xs` 12px — meta info
- `text-sm` 14px — body, form labels
- `text-base` 16px — default
- `text-lg` 18px — section headers
- `text-2xl` 24px — page titles
- `text-3xl` 30px — login logo

**Line-height:** Tailwind defaults yeterli. Letter-spacing: default.

### §7 — Loading / Empty / Error / Skeleton state pattern

Her liste/detay ekranı **dört durum** zorunlu — ZORUNLU pattern:

| Durum | Pattern | Implementasyon |
|---|---|---|
| **Loading** | shadcn/ui `<Skeleton />` 3-5 row | TanStack Query `isPending` + 200ms gecikme (kısa req'lerde flash önle) |
| **Empty** | Ortada ikon + Türkçe mesaj + (varsa) CTA | Custom `<EmptyState icon="..." title="..." action={...} />` component |
| **Error** | Ortada uyarı ikonu + Türkçe açıklama + "Tekrar Dene" | Custom `<ErrorState onRetry={refetch} />` component |
| **Success** | Liste/form içerik | data render |

**API error flow:** TanStack Query `error` → `error.code` (ADR-006 registry) → `t('error.{code}')` lookup → toast (mutation hatası) veya inline (validation hatası).

### §8 — HCI ölçüleri

POS-spesifik (rush-hour kullanılabilirlik):

| Element | Min ölçü | Gerekçe |
|---|---|---|
| Touch target | 44x44px | Apple HIG, dokunmatik PC desteği |
| Primary button height | 48px | Fitts yasası — kasiyer hızlı bassın |
| Tablo satır yüksekliği | 56px | Rush-hour parmakla okuma + dokunma |
| Modal min width | 400px | Form alanları rahat |
| Form input height | 40px | Tarayıcı default'undan biraz büyük |
| Sidebar width | 240px | Nav metinleri "Kullanıcı Yönetimi" gibi sığsın |
| Renk kontrastı | WCAG AA (4.5:1) | Düşük ışık + uzaktan okuma |

### §9 — Toast + ErrorBoundary

- **Sonner** toast: top-right konum. Süreler: success 3s, error 5s, warning 4s, info 4s.
- **Global ErrorBoundary** (App.tsx): unhandled error → "Bir şeyler ters gitti, sayfayı yenileyin" + reload butonu.
- **Per-route error boundary** (React Router v6 `errorElement`): route-level error.

### §10 — Build + bundle + browser

- **Vite production build:** code-splitting per-route (lazy import in router.tsx).
- **Bundle size budget:** <300KB gzipped (ana bundle). Restoran PC ağı zayıf olabilir — ilk paint hızlı.
- **Source maps:** dev `inline`, prod `hidden` (browser DevTools'a açma).
- **Env değişkenleri** (`apps/web/.env`):
  - `VITE_API_BASE_URL=http://localhost:3001`
  - `VITE_SOCKET_URL=http://localhost:3001`
  - `VITE_SUPPORT_PHONE=0532 xxx xx xx` (§11 forgot-password modal'ı için)
- **Browser support:** Chrome/Edge/Firefox son 2 sürüm. IE11/Safari old YOK. ES2022 + CSS Grid + Flexbox native.

### §11 — Auth UX (Login + Şifremi Unuttum modal)

#### §11.1 — Login form layout

```
┌──────────────────────────────────┐
│            [Logo / Brand]         │
│         Restoran POS              │
│                                    │
│   ┌────────────────────────────┐  │
│   │  E-posta                    │  │
│   │  [_____________________]    │  │
│   │                              │  │
│   │  Şifre                       │  │
│   │  [_____________________]    │  │
│   │           Şifremi unuttum?  │ ← link, sağ hizalı, mavi
│   │                              │  │
│   │  [    Giriş Yap    ]        │  │ 48px primary button
│   └────────────────────────────┘  │
└──────────────────────────────────┘
```

- Form: `react-hook-form` + zod resolver — `LoginRequestSchema` `@restoran-pos/shared-types`'tan.
- Submit: `mutation.mutate({email, password})` → 200 `setAuth` + navigate('/dashboard'); 401 → toast `t('auth.error.invalidCredentials')`.
- Rate-limit hatası (`AUTH_RATE_LIMITED` 429): toast + button disabled 60s countdown.
- Loading state: button text "Giriş yapılıyor..." + disabled.

#### §11.2 — "Şifremi unuttum" — yönetici aracılı (Karar B, Sprint 8a)

**Karar:** Self-service email akışı yerine **yönetici aracılı bilgilendirme** (kapsam kilidi — backend endpoint yok, MVP scope dışı).

Login'de "Şifremi unuttum?" link → modal açar:

```
┌──────────────────────────────────────────┐
│  Şifrenizi unuttunuz mu?                  │
│                                            │
│  Lütfen restoran yöneticinize başvurun.   │
│  Yönetici, kullanıcı yönetimi ekranından  │
│  şifrenizi sıfırlayabilir.                 │
│                                            │
│  Yardım için: 0532 xxx xx xx               │
│                                            │
│                          [Anladım]         │
└──────────────────────────────────────────┘
```

**Implementasyon:**
- `<Dialog>` (shadcn/ui) — backdrop click + ESC ile kapanır.
- Telefon: `import.meta.env.VITE_SUPPORT_PHONE` (env, statik şimdilik).
- i18n keys: `auth.forgotPassword.title/body/phone/closeButton`.
- Backend: hiç değişmez. Admin zaten `PATCH /users/:id/password` ile reset yapabiliyor (Sprint 3b'de eklendi).

**Kapsam:** v5.1 backlog'a ADR-X (Password Reset Email Akışı) — SMTP altyapısı + reset token tablosu + 2 yeni endpoint. Şu an §14'te flagli.

### §12 — i18n key naming convention

**Format:** `feature.entity.action` veya `feature.field.label/placeholder/error`. **Örnekler:**

```json
{
  "auth": {
    "login": {
      "title": "Restoran POS — Giriş",
      "email": { "label": "E-posta", "placeholder": "ornek@restoran.com" },
      "password": { "label": "Şifre", "placeholder": "Şifreniz" },
      "submit": "Giriş Yap",
      "submitting": "Giriş yapılıyor..."
    },
    "forgotPassword": {
      "link": "Şifremi unuttum?",
      "title": "Şifrenizi unuttunuz mu?",
      "body": "Lütfen restoran yöneticinize başvurun. Yönetici, kullanıcı yönetimi ekranından şifrenizi sıfırlayabilir.",
      "phoneLabel": "Yardım için",
      "closeButton": "Anladım"
    },
    "error": {
      "invalidCredentials": "E-posta veya şifre hatalı",
      "rateLimited": "Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.",
      "tokenInvalid": "Oturumunuz sona erdi. Yeniden giriş yapın."
    }
  },
  "common": {
    "loading": "Yükleniyor...",
    "retry": "Tekrar Dene",
    "save": "Kaydet",
    "cancel": "İptal",
    "delete": "Sil",
    "confirmDelete": "Silmek istediğinizden emin misiniz?"
  },
  "tables": {
    "list": { "empty": "Henüz masa yok", "title": "Masalar" }
  },
  "error": {
    "USER_NOT_FOUND": "Kullanıcı bulunamadı",
    "TABLE_NOT_FOUND": "Masa bulunamadı",
    "VALIDATION_ERROR": "Lütfen formdaki hataları düzeltin",
    "_unknown": "Beklenmeyen hata oluştu"
  }
}
```

**Anti-pattern (yasak):**
- `loginPageHeader` (camelCase düz)
- `auth_login_title` (snake)
- Hardcoded `<h1>Giriş Yap</h1>` (CLAUDE.md core directive #4 ihlal)

**ADR-006 §5.2 error code → i18n key mapping:** `error.{CODE_NAME}` (üst case korunur, registry ile bire bir).

### §13 — Test stratejisi (Sprint 8 kapsam)

| Tip | Tool | Kapsam |
|---|---|---|
| Unit | Vitest | Hooks (useAuth, useSocketEvent), utils (formatlayıcılar, store logic) |
| Component | React Testing Library | Kritik UI (LoginForm, TableList) — smoke düzey |
| **E2E** | **Playwright** | **Sprint 9'a ertelendi** — Sprint 8 kapsamı dışı |

**Coverage hedefi:** util %80+, UI smoke. Hard cap yok — pixel-perfect snapshot test yasak (kırılgan).

### §14 — v5.1 backlog flag'leri

| # | Madde | Tetik |
|---|---|---|
| 1 | **Dark mode** | UX talebi, color tokens dark variant |
| 2 | **Password Reset email akışı (ADR-X)** | SMTP altyapısı + reset token tablosu + 2 endpoint (`/auth/forgot-password`, `/auth/reset-password`) — bu ADR §11.2 kararını supersede eder |
| 3 | **Tenant.contact_phone dinamik** | tenant_settings.support_phone kolonu — şu an static env |
| 4 | **i18n EN locale** | EN ülkeleri için ileride; şu an TR-only |
| 5 | **Snapshot testing (Storybook + Chromatic)** | Component visual regression — MVP overkill |
| 6 | **Animation library (Framer Motion)** | Mikro-etkileşimler — POS'un kapsamı dışı |
| 7 | **Offline mode (Service Worker)** | Restoran ağı zayıfsa — Phase 5+ |
| 8 | **PWA (installable)** | Tarayıcı yeterli MVP'de |
| 9 | **Theming/branding per-tenant** | Multi-tenant pivot sonrası |
| 10 | **Keyboard shortcuts** | Power user feature, MVP'de yok |

### Alternatifler (kısaca)

- **A:** Mantine UI v7 — hazır component zenginliği, ama tema customization Tailwind kadar esnek değil + ekstra runtime CSS-in-JS.
- **B:** MUI — Google look, POS estetiğine yapay; bundle size ağır.
- **C:** Tailwind raw (component yok) — tüm component sıfırdan, MVP için verimsiz.
- **D:** Remix/Next.js — overkill SPA için; SSR gerekmez (auth-gated app).

### Sonuçlar

- (+) Sprint 8a-8d boyunca tek standart — her ekranda re-decide yok
- (+) shadcn/ui kopyala-paste pattern: bağımlılık yok, kontrol tam
- (+) zod schema reuse `@restoran-pos/shared-types` ile backend↔frontend tek validation
- (+) Light-only + WCAG AA + POS color tokens: rush-hour kullanılabilirlik garantisi
- (+) "Şifremi unuttum" Karar B: backend dokunulmadan kullanıcı UX karşılandı
- (−) Self-service password reset yok — yönetici çağrısı gerekir; v5.1'de email akışı eklenir
- (−) E2E test Sprint 9'a ertelendi — Sprint 8 ekranları manuel smoke + component test ile kabul edilir
- (−) Bundle <300KB hedefi shadcn/ui + TanStack Query + Socket.IO ile sıkışık olabilir; tree-shaking + lazy route gerekir

### Referanslar

- ADR-001 — Monorepo yapısı (apps/web zaten boilerplate'te yarıldı)
- ADR-002 — Auth (JWT + RTR, access/refresh token taşıma)
- ADR-006 — Error envelope (error.code → i18n key mapping)
- ADR-009 — Areas domain (Sprint 8c UI'da kullanılır)
- ADR-010 — Socket.IO realtime (client wrapper §4)
- CLAUDE.md core directives 1-7
- docs/hci/pos-checklist.md (her UI PR'ında zorunlu)
- docs/engineering/code-style.md
- docs/domain/glossary.md (Türkçe terminoloji)

### §15 — Implementer brief (Görev 29 boilerplate)

**Hedef:** `apps/web/` ilk kurulum — Login + Dashboard placeholder çalışıyor + tüm altyapı kurulu.

**Yaratılacak/güncellenecek dosyalar:**

```
apps/web/package.json           # §1 deps + scripts (dev, build, test, lint, typecheck)
apps/web/tailwind.config.ts     # §5 token extend + content paths
apps/web/postcss.config.js      # tailwind + autoprefixer
apps/web/vite.config.ts         # alias, env prefix VITE_, proxy /api → 3001 dev
apps/web/tsconfig.json          # extends base, paths
apps/web/index.html             # lang="tr", meta theme-color, favicon
apps/web/.env.example           # VITE_API_BASE_URL, VITE_SOCKET_URL, VITE_SUPPORT_PHONE
apps/web/public/fonts/Inter-{Regular,Medium,SemiBold,Bold}.woff2

apps/web/src/main.tsx           # i18n init + ReactDOM.render
apps/web/src/App.tsx            # AuthProvider + QueryClient + RouterProvider + ErrorBoundary + Toaster
apps/web/src/router.tsx         # createBrowserRouter, lazy /login + /dashboard
apps/web/src/styles/globals.css # Tailwind base + tokens + Inter @font-face

apps/web/src/components/ui/     # shadcn/ui CLI ile init: button, input, label, dialog, toast, card, skeleton, form
apps/web/src/components/layout/AuthLayout.tsx       # Login/forgot-password için centered card
apps/web/src/components/layout/AppShell.tsx         # Sidebar + topbar + Outlet (Dashboard üzeri)
apps/web/src/components/EmptyState.tsx
apps/web/src/components/ErrorState.tsx
apps/web/src/components/LoadingSkeleton.tsx
apps/web/src/components/ProtectedRoute.tsx          # auth guard

apps/web/src/store/auth.ts       # Zustand authStore
apps/web/src/lib/api.ts          # axios + interceptors (Auth header + 401 retry)
apps/web/src/lib/socket.ts       # connectSocket / disconnectSocket / useSocketEvent
apps/web/src/lib/error.ts        # API error → i18n key
apps/web/src/lib/env.ts          # zod parse import.meta.env

apps/web/src/i18n/init.ts        # i18next config
apps/web/src/i18n/locales/tr.json # tüm UI metinleri (Login + Dashboard placeholder + common + error registry)

apps/web/src/features/auth/LoginPage.tsx
apps/web/src/features/auth/ForgotPasswordModal.tsx
apps/web/src/features/auth/api.ts       # useLogin, useLogout, useMe (TanStack mutations/queries)
apps/web/src/features/auth/hooks.ts     # useRequireAuth

apps/web/src/features/dashboard/DashboardPage.tsx  # placeholder: "Hoş geldin {user.name}" + nav cards
```

**DoD (Görev 29):**
- [ ] `pnpm --filter @restoran-pos/web dev` → `localhost:5173` açılır, /login sayfası
- [ ] /login → email/password girince → /dashboard'a yönlendirir (gerçek backend ile)
- [ ] Yanlış şifre → toast "E-posta veya şifre hatalı" (i18n)
- [ ] "Şifremi unuttum" linkine basınca modal açılır + telefon görünür
- [ ] /dashboard'da "Hoş geldin {user.email}" + logout butonu çalışır
- [ ] 401 interceptor: token expire → /auth/refresh otomatik → kullanıcı kesintisiz devam eder
- [ ] `pnpm --filter @restoran-pos/web typecheck` ✅
- [ ] `pnpm --filter @restoran-pos/web lint` ✅
- [ ] `pnpm --filter @restoran-pos/web build` → bundle <300KB gzipped
- [ ] `hci-reviewer` ✅ (Login form HCI ölçüleri, modal davranışı)
- [ ] `turkish-ux-reviewer` ✅ (tüm metinler Türkçe + i18n key + glossary uyumlu)
- [ ] CI yeşil

### Amendments

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-05-01 | Sprint 8c PR-D/E Menü Tanımları UI Revamp (7 karar) | İkon Sistemi (lucide-react TEK kaynak), Forms (drawer pattern kanonik), yeni §"Empty States" | V3 `MenuSettingsPage.jsx` paritesi + modern revamp; lucide cross-platform tutarlılığı; "0" badge ölü UI port edilmez; yazıcı atama Phase 3'e ertelenir (UI'da disabled görünür); kategori `icon`/`color` kolonları (Migration 012); ADR-006 §5.2 iki yeni kod (`MENU_CATEGORY_INVALID_ICON`, `MENU_CATEGORY_INVALID_COLOR`). |

#### Amendment 2026-05-01 — Sprint 8c PR-D/E Menü Tanımları UI Revamp

- **Durum:** Accepted
- **Tarih:** 2026-05-01
- **Tetikleyici:** Sprint 8c PR-D (kategori paneli + Yeni/Düzenle Kategori drawer) + PR-E (ürün grid + Yeni/Düzenle Ürün drawer). V3 `D:\dev\restoran-pos-v3\client\src\pages\MenuSettingsPage.jsx` paritesi + modern revamp ilkeleri.

##### Karar 1 — Lucide-react TEK ikon kaynağı (önceki "İkon Sistemi" amend)

**Karar:** ADR-011 §"Component Library / İkon Sistemi" Sidebar-only kapsamı **tüm web UI'a** genişletilir. `lucide-react` v5 web app'in **tek** ikon kaynağıdır. Emoji (Unicode pictograph) UI string literal'larında **yasak**. İstisna: kullanıcı içerik string'leri (örn. ürün adı "Pide 🍕"), pop-up notification system tray.

**Gerekçe:** (a) Cross-platform tutarlılık — Win/macOS/Android emoji rendering pixel-farklı, kasiyer ekranı + müdür ekranı + mobil garson tutarsız görünüyor. (b) Kategori rengi (Karar 3) ikona uygulanabilir → "renk seçimi" ölü UI olmaktan çıkar (V3'te modal'da seçilen renk emoji'ye uygulanmıyordu). (c) Tree-shake edilebilir, bundle impact ölçülebilir.

**Reddedilen alternatif:** (i) V3 emoji portu — cross-platform render farkı + renklendirme imkânsız. (ii) Heroicons — yemek/içecek ikon set'i yetersiz (`Pizza`, `Beef`, `Wine` yok). (iii) Custom SVG sprite — bakım yükü, kapsam dışı.

**Cross-ref:** ADR-011 §"Component Library", §"Sidebar". Yeni dependency yok (lucide-react zaten kurulu).

##### Karar 2 — Kategori ikon kanonik whitelist (18 ikon)

**Karar:** Kategori `icon` kolonu için kabul edilen lucide-react isim whitelist'i (PascalCase, alfabetik):
`Apple`, `Beef`, `Beer`, `Cake`, `Cherry`, `Coffee`, `Cookie`, `Croissant`, `Drumstick`, `Egg`, `Fish`, `IceCreamBowl`, `Pizza`, `Salad`, `Sandwich`, `Soup`, `UtensilsCrossed`, `Wine`. DB'de string saklanır. Default: `UtensilsCrossed`.

**Gerekçe:** Closed-set seçim → UI grid sabit (6 kolon × 3 satır). Genişleme talebi ADR amendment ile gelir → silent kapsam büyümesi engellenir. Whitelist `packages/shared-types/src/menu/category-icons.ts` üzerinden zod enum + UI grid kaynağı (single source of truth).

**Reddedilen alternatif:** (i) Tüm lucide set'i (1500+ ikon) — UX overload, picker kullanılamaz. (ii) DB CHECK constraint ile whitelist — Karar 4'te (Migration 012) detaylı; rigid bulundu.

**Cross-ref:** ADR-006 §5.2 yeni kod (Karar 8 aşağıda), Migration 012.

##### Karar 3 — Kategori renk paleti (8 koordineli HEX)

**Karar:** Kategori `color` kolonu için kabul edilen palet (Tailwind 600 tonu):
`#dc2626` (red), `#ea580c` (orange), `#d97706` (amber), `#16a34a` (green), `#0891b2` (cyan), `#2563eb` (blue), `#7c3aed` (violet), `#db2777` (pink). DB'de `#RRGGBB` lowercase. **Default: `#ea580c` (orange-600)** — login ekranı amber→orange-500 brand gradient'ı ile uyum (Migration 014 micro-amend 2026-05-01). Önceki default `#16a34a` mevcut kayıtlarda Migration 014 UPDATE ile turuncuya taşındı; kullanıcı palette'den manuel seçtiği diğer 7 renk korundu. Free hex input UI'da YOK — picker bu 8 swatch'a kilitli.

**Gerekçe:** (a) AA kontrast garantisi — 600 tonu beyaz arka planda WCAG AA geçer (kontrast ≥ 4.5). (b) Uyumlu palet → ekran "tatil renkleri" olmaz. (c) Kategori kart aksent + ikon tinting + ürün chip tek renk değişkeni (single source of truth).

**Reddedilen alternatif:** (i) V3 11-renk paleti — kontrast tutarsız (bazı ton açık), uyumsuz. (ii) Free hex input — kullanıcı yanlış kontrast seçebilir, UX kötü.

**Cross-ref:** Migration 012 CHECK constraint, ADR-011 §"POS Color Tokens".

##### Karar 4 — V3 ölü UI elementlerinin port edilmemesi (kapsam kilidi)

**Karar:** V3'ten port edilen ekranlarda **anlamı belirsiz / işlevsiz** UI elementi (örn. `MenuSettingsPage` ürün kartındaki "0" badge — V3 koddan teyit edilemiyor, tıklanmıyor, kullanıcı gözleminde de işlev yok) **port edilmez**. Şüphe halinde: (i) v3 koddan teyit denenir → bulamazsan kullanıcıya sor → cevap yoksa atla, (ii) `docs/v3-reference/<page>-port-notes.md` altına "atlandı: <sebep>" satırı yazılır.

**Gerekçe:** Sessiz kapsam büyümesi yasağı (CLAUDE.md core directive 6). V3 zaten 8 yıllık birikim — her satırı port etmek = teknik borç port etmek.

**Reddedilen alternatif:** "Görsel paritesi 1:1" — modern revamp ilkesiyle çelişir, ölü UI dondurur.

**Cross-ref:** CLAUDE.md "Kapsam kilidi", `docs/v3-reference/`.

##### Karar 5 — Yazıcı atama UI Phase 3'e ertelenir (görsel iskelet korunur)

**Karar:** Phase 2 (Sprint 8c PR-D/E) Kategori drawer'ında "Yazıcı" dropdown **görsel olarak yer alır** (V3 paritesi koruma sinyali) ama: (a) **disabled**, (b) helper text `t('menu.category.printerPhase3Notice')` = "Yazıcı katmanı Phase 3'te aktif olacak", (c) form submit payload'ında YOK, (d) DB'ye kolon eklenmez. Phase 3'te ADR-004 finalize sonrası **ayrı migration + ayrı ADR amendment** ile aktive edilir.

**Gerekçe:** (a) ADR-004 print agent kararı henüz finalize değil → kolon adı/tipi belirsiz. (b) Disabled görsel ipucu kasiyere "buraya gelecek" sinyali verir → UX continuity. (c) Migration kirliliği önlenir (eklenip kullanılmayan kolon yasağı, ADR-003).

**Reddedilen alternatif:** (i) Tamamen gizle — Phase 3'te kullanıcı şaşırır. (ii) Şimdi `printer_id` kolonu ekle — ADR-004 finalize değil, premature schema lock.

**Cross-ref:** ADR-004 (print agent, Phase 3), Charter line 166-170 (Phase 3: Print Agent + ESC/POS + 3 yazıcı routing + CP857 Türkçe).

##### Karar 6 — Drawer pattern modal'ı geçer (form-rich CRUD için kanonik)

**Karar:** Form alanı ≥ 3 olan tüm CRUD ekranları (kategori oluştur/düzenle, ürün oluştur/düzenle, attribute group, vb.) **drawer pattern** kullanır — Sprint 8c PR-F2bc "Yeni Grup" drawer paritesi: sağdan kayan 480px panel, semi-opaque backdrop, ESC kapat, focus trap, tab ile içeride döner, body scroll lock. Modal pattern (centered dialog) sadece **destructive confirm** ve **kısa bilgilendirme** için.

**Gerekçe:** (a) Drawer mobile-friendly (sağdan slide → tablet/mobil web'de full-height), modal centered tablet'te küçük. (b) Form uzun olduğunda modal scroll → ESC kayboluyor, drawer'da header sticky. (c) PR-F2bc'de pattern kabul edildi → tek pattern tek mental model.

**Reddedilen alternatif:** Modal koru — pattern parçalanması, mobil web'de UX bozuluyor.

**Cross-ref:** ADR-011 §"Forms", Sprint 8c PR-F2bc commit `2a2c082`.

##### Karar 7 — Empty state ipucu zorunlu (blank state yasak)

**Karar:** Veri listesi gösterilen her panelde (kategori listesi, ürün grid, arama sonucu, attribute group, attribute) `data.length === 0` durumunda **anlamlı ipucu kartı** render edilir: ikon + bir cümle açıklama + birincil CTA (örn. "İlk kategoriyi ekleyin" → `+ Ekle` btn focus). Boş `<div>` veya sadece "Veri yok" yasak. ADR-011'e yeni alt bölüm §"Empty States" eklenir.

**Gerekçe:** (a) Kasiyer/müdür ilk kurulumda "ne yapacağım" diye duraksamaz. (b) Arama sonucu sıfırsa "filtreyi temizle" CTA'sı 1 click recovery. (c) HCI checklist madde 11 ("hata durumu kullanıcıya yön verir") empty state'i kapsar.

**Reddedilen alternatif:** Boş ekran — kasiyer 5 saniye duraksıyor, support çağrısı.

**Cross-ref:** `docs/hci/pos-checklist.md` §11, ADR-011 yeni §"Empty States".

##### Karar 8 — ADR-006 §5.2 yeni hata kodları

**Karar:** ADR-006 §5.2 error code registry'ye **iki yeni kod** eklenir (bu amendment ile §5.2'ye satır olarak işlendi):

| Kod | HTTP | Tetikleyici | Sprint |
|---|---|---|---|
| `MENU_CATEGORY_INVALID_ICON` | 400 | `POST/PATCH /menu/categories` — `icon` whitelist (Karar 2, 18 ikon) dışında. zod katmanında üretilir. | Sprint 8c |
| `MENU_CATEGORY_INVALID_COLOR` | 400 | `POST/PATCH /menu/categories` — `color` palet (Karar 3, 8 HEX) dışında veya HEX format ihlali. zod enum + DB CHECK çift savunma. | Sprint 8c |

**Gerekçe:** Generic `VALIDATION_ERROR` mevcut, ama UI'da farklı i18n mesajı + farklı recovery (ikon dışı vs renk dışı) gerekiyor. ADR-006 §5 prefix konvansiyonu (`MENU_CATEGORY_*`) izlenir.

**Reddedilen alternatif:** Generic `VALIDATION_ERROR` + `details.field` — UI tarafında switch zorlaşır, i18n key matrix bulanır.

**Cross-ref:** ADR-006 §5.2 (registry — bu amendment ile güncellendi), Migration 012 CHECK constraint (color), `packages/shared-types/src/menu/category.ts` zod enum (icon).

##### ADR-002 §6 amendment kontrolü

**Sonuç:** ADR-002 §6 amendment **GEREK YOK**. `menu.read` (tüm authenticated roller) + `menu.write` (admin-only) kapsamı kategori CRUD + ürün CRUD için yeterli. Yeni RBAC action ekleme yasak (ADR-002 §6 minimal action surface ilkesi).

##### Sonuçlar (toplu)

- (+) Cross-platform pixel tutarlılığı (lucide).
- (+) Kategori renk seçimi anlam kazanır (ikon tinting).
- (+) V3 ölü UI elementleri sessizce port edilmez.
- (+) Phase 3 print readiness sinyali korunur, schema kirletilmez.
- (+) Empty state UX rahatlığı + HCI §11 paritesi.
- (−) Lucide ikon set'i kullanıcının tanımadığı bazı yemekler için yetersiz olabilir → whitelist amendment ile genişletilir (closed-set kuralı).
- (−) Renk palet kilidi: kullanıcı brand rengi isterse v5.1 amendment.

##### Cross-ref (toplu)

- ADR-002 §6: amendment **GEREK YOK** (gerekçe yukarıda).
- ADR-003: Migration 012 idempotent forward-only.
- ADR-004: Phase 3 printer kolonu (Karar 5).
- ADR-006 §5.2: iki yeni kod (Karar 8 — bu amendment ile §5.2 tablosuna satır olarak işlendi).
- ADR-011 §"İkon Sistemi" + §"Forms" + yeni §"Empty States".
- CLAUDE.md core directive 6 (kapsam kilidi).

<!-- ADR-011 Accepted (2026-04-29). Web UI tasarım kuralları — shadcn/ui + TanStack Query + Zustand + RHF/zod + RR v6 + react-i18next stack lock; feature-folders; auth flow access-memory + refresh-cookie; Socket.IO singleton + useSocketEvent hook; POS color tokens (light only, WCAG AA); Inter self-hosted; loading/empty/error/skeleton zorunlu pattern; HCI 44/48/56px; Sonner toast + ErrorBoundary; bundle <300KB; "Şifremi unuttum" Karar B (yönetici aracılı, Password Reset email akışı v5.1 backlog ADR-X). Implementer brief Görev 29 §15. Amendment 2026-05-01: Sprint 8c PR-D/E Menü Tanımları UI Revamp — 7 karar. -->

## ADR-012 — Attribute Groups Domain (v3 paritesi)

- **Durum**: Accepted
- **Tarih**: 2026-04-30 (İlhan onayı 2026-04-30, 3 açık soru çözüldü — bkz. "Açık sorular" bölümü)
- **İlgili sprint:** Sprint 8c PR-F (3 alt-PR'a bölünmüş; bkz. Implementation Plan)
- **Cross-ref:** ADR-002 §6 (RBAC matrix amendment gerekli — PR-F1'de), ADR-003 §6.5 (composite UNIQUE), §8 (soft delete), §8.6 (product_variants — superseded), §9 (enum konvansiyonu), ADR-006 §3-§4 (error envelope + DB→Domain mapping; §5 registry amendment gerekli — PR-F1'de), ADR-009 "Domain service" bölümü (service-level soft delete cascade pattern)

### Bağlam

İlhan v3 davranış paritesini Sprint 8c'de tam istiyor. v3 (`D:\dev\restoran-pos-v3\server\db\schema.sql`, READ-ONLY) "Özellikler" ekranı **reusable attribute groups** modeli kullanıyor: bir grup (örn. "Pizza Boyutu") oluşturulur, N kategoriye ve N ürüne atanır. Sipariş açılırken ürünün effective grupları (kendi atadıkları ∪ kategorisinin atadıkları, dedup) sorgulanır, zorunlu gruplar validate edilir, default ön-seçim yapılır, ekstra fiyat real-time toplama yansır.

v5'te şu an Migration 006 (ADR-003 §8.6 amendment 2026-04-27) ile **`product_variants`** (per-product, reusable değil) tablosu var ama hiçbir endpoint/UI tüketmiyor — drift. v3 reusable group davranışı bu modelle ifade edilemez (aynı "Pizza Boyutu" grubunu 12 ürün için 12 kez kopyalamak gerekir; rename tek noktadan yapılamaz; kategori atama imkânsız).

Sprint 8c PR-F başlangıçta "Özellikler UI" olarak kabaca planlanmıştı; bu ADR PR-F kapsamını yeniden tanımlar ve 3 alt-PR'a böler.

### Karar

13 karar noktası kilidi:

#### 1. Tablo isimleri

Onaylanan: `attribute_groups`, `attribute_options`, `category_attribute_groups`, `product_attribute_groups`. v5 snake_case + plural konvansiyonuna uygun, link tabloları "subject_object" pattern'iyle (areas, tables komşuluğunda tutarlı).

#### 2. Multi-tenant şeması

Her tablo `tenant_id UUID NOT NULL REFERENCES tenants(id)` (ADR-003 §6). Her parent tabloda `UNIQUE (id, tenant_id)` composite UNIQUE (ADR-003 §6.5 zorunlu kuralı). Tüm FK'lar composite. Tüm UNIQUE'ler `tenant_id` prefix'li.

```sql
-- attribute_groups
CREATE TABLE attribute_groups (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  selection_type TEXT NOT NULL CHECK (selection_type IN ('single', 'multiple')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL
);

-- attribute_options
CREATE TABLE attribute_options (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  group_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  extra_price_cents INTEGER NOT NULL DEFAULT 0
    CHECK (extra_price_cents BETWEEN -10000 AND 10000),
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (group_id, tenant_id) REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, group_id, lower(trim(name))) WHERE deleted_at IS NULL
);

-- category_attribute_groups (link)
CREATE TABLE category_attribute_groups (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category_id UUID NOT NULL,
  group_id UUID NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, tenant_id) REFERENCES categories (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, tenant_id) REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, category_id, group_id)
);

-- product_attribute_groups (link)
CREATE TABLE product_attribute_groups (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  product_id UUID NOT NULL,
  group_id UUID NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, tenant_id) REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, product_id, group_id)
);

CREATE INDEX idx_attribute_options_group ON attribute_options(group_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cag_category ON category_attribute_groups(category_id);
CREATE INDEX idx_cag_group ON category_attribute_groups(group_id);
CREATE INDEX idx_pag_product ON product_attribute_groups(product_id);
CREATE INDEX idx_pag_group ON product_attribute_groups(group_id);
```

#### 3. Selection type

CHECK constraint ile string `('single', 'multiple')` — ADR-003 §9.1 "az değerli, nadiren değişen kümeler için CHECK" rehberine uyar. Yeni enum tipi reddedildi.

#### 4. Para alanı: `extra_price_cents`

`INTEGER NOT NULL DEFAULT 0` + `CHECK BETWEEN -10000 AND 10000` (±100 TL). Signed (negatif izinli — "küçük porsiyon -5 TL" senaryosu). Cap ±100 TL koruyucu — v3 davranışında option ekstrası 5-25 TL aralığında, klavye hatasıyla yanlış girişe karşı kalkan (eski ±1000 TL cap onay sonrası daraltıldı, 2026-04-30 İlhan kararı). CLAUDE.md "para = cent" kuralı + "asla float" yasağı.

#### 5. Soft delete

`attribute_groups` ve `attribute_options`: `deleted_at TIMESTAMPTZ NULL`. Link tabloları (`category_attribute_groups`, `product_attribute_groups`): **hard delete** (link tablo istisnası).

#### 6. CASCADE davranışı

Tüm FK'lar `ON DELETE RESTRICT`. Service-level cascade transaction içinde:
- Group soft delete → options soft delete (aynı transaction).
- Parent (category, product, group) soft delete → link satırları hard DELETE.
- Categories ve products soft delete handler'larında cascade eklenir (PR-F1 scope).

#### 7. `is_default` validation (application-level)

Tek noktadan kontrol: `AttributeOptionService.create/update` superRefine zod ile:
- `selection_type='single'` ise: aynı `group_id` içinde `is_default=true` satır sayısı ≤ 1.
- `selection_type='multiple'` ise: birden fazla default izinli.

Conflict 422 `ATTRIBUTE_OPTION_DEFAULT_INVALID`.

#### 8. `/effective/:productId` semantiği

`GET /products/:productId/attribute-groups/effective` — ürünün effective grupları = product groups ∪ category groups, dedup product satırı kazanır (override semantiği). Cache: TanStack Query `staleTime: 5 dk`.

#### 9. RBAC (ADR-002 §6 amendment — PR-F1)

- `attributes.read` — admin, cashier, waiter, kitchen.
- `attributes.manage` — admin only.

#### 10. Migration 006 (`product_variants`) statüsü: **Karar A — Deprecated**

`product_variants` tablosu kalır (DROP migration borcu yok), ADR-003 §8.6'ya "Superseded by ADR-012" notu eklenir (PR-F1 amendment'ı). v5.1'de DROP migration backlog'a girer.

#### 11. Endpoint listesi (14 endpoint)

```
# Group CRUD
GET    /attribute-groups                  → attributes.read
POST   /attribute-groups                  → attributes.manage
GET    /attribute-groups/:id              → attributes.read
PATCH  /attribute-groups/:id              → attributes.manage
DELETE /attribute-groups/:id              → attributes.manage  (soft delete + service cascade options)

# Options nested under group
GET    /attribute-groups/:id/options      → attributes.read
POST   /attribute-groups/:id/options      → attributes.manage
PATCH  /attribute-groups/:id/options/:optId → attributes.manage
DELETE /attribute-groups/:id/options/:optId → attributes.manage  (soft delete)

# Category assignment (idempotent)
POST   /menu/categories/:id/attribute-groups/:groupId  → attributes.manage  (idempotent 200 OK no-op)
DELETE /menu/categories/:id/attribute-groups/:groupId  → attributes.manage  (idempotent 204)
GET    /menu/categories/:id/attribute-groups           → attributes.read

# Product assignment (idempotent)
POST   /products/:id/attribute-groups/:groupId  → attributes.manage  (idempotent 200 OK no-op)
DELETE /products/:id/attribute-groups/:groupId  → attributes.manage  (idempotent 204)
GET    /products/:id/attribute-groups           → attributes.read

# Effective view
GET    /products/:id/attribute-groups/effective → attributes.read
```

#### 12. Hata kodları (ADR-006 §5 registry amendment — PR-F1)

| Code | HTTP | message_key | Tetikleyici |
|---|---|---|---|
| `ATTRIBUTE_GROUP_NOT_FOUND` | 404 | `error.attribute.groupNotFound` | GET/PATCH/DELETE bulunamadı |
| `ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS` | 409 | `error.attribute.groupNameDuplicate` | UNIQUE ihlali — PG `23505` |
| `ATTRIBUTE_OPTION_NOT_FOUND` | 404 | `error.attribute.optionNotFound` | option lookup fail |
| `ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS` | 409 | `error.attribute.optionNameDuplicate` | grup içi unique ihlali |
| `ATTRIBUTE_OPTION_DEFAULT_INVALID` | 422 | `error.attribute.optionDefaultInvalid` | Tekli grup'ta birden fazla `is_default` |

İdempotent assign 200 OK semantiği: `ATTRIBUTE_GROUP_ASSIGNMENT_EXISTS` 409 kodu **kullanılmıyor**.

#### 13. Sprint 8c PR-F bölünmesi

Implementation Plan bölümünde detay.

### Alternatifler

- **A — `product_variants` ile devam:** v3 davranışı (reusable, kategori atama, override) ifade edilemez. **Reddedildi.**
- **B — V5.1'e ertele:** İlhan Sprint 8c'de v3 paritesi tam istiyor. **Reddedildi.**
- **C — Sadece admin UI, atama+sipariş v5.1:** Orphan admin sayfası. **Reddedildi.**
- **D — Polymorphic `attribute_assignments`:** ADR-003 §6.5 composite FK kuralı polymorphic ile çalışmaz. **Reddedildi.**

### Sonuçlar

- (+) v3 davranış paritesi tam.
- (+) ADR-003 §6.5 composite FK pattern korunur.
- (+) Migration 006 borç değil; "Superseded" notu yeterli.
- (+) Soft delete + service-level cascade ADR-009 areas pattern'iyle simetrik.
- (−) 4 yeni tablo + 14 endpoint + 3 alt-PR — Sprint 8c süresi 1.5-2 hafta uzar.
- (−) ADR-002 §6 + ADR-003 §8.6 + ADR-006 §5 amendment'lar PR-F1 kapsamında.
- (−) Categories ve products domain service'leri soft delete handler'ında attribute link cleanup eklenecek (PR-F1).
- (−) AttributePickerModal Phase 3 (PR-F3c) — sipariş entegrasyonu sipariş ekranıyla birlikte.

### Implementation Plan (Sprint 8c PR-F)

**PR-F1 — Backend Domain (~600-800 satır):**
- 4 migration: `008_attribute_groups`, `009_attribute_options`, `010_category_attribute_groups`, `011_product_attribute_groups` (db-migration-guard).
- ADR amendments: ADR-002 §6 (`attributes.*` actions), ADR-003 §8.6 (Superseded notu), ADR-006 §5 (5 yeni kod).
- `packages/shared-types`: zod schemas.
- `apps/api/src/domain/attributes/` — service'ler (transaction cascade).
- categories/products domain service'leri soft delete cascade.
- 14 endpoint + integration testler.

**PR-F2 — Admin UI (Özellikler sayfası):**
- `apps/web/src/features/admin/AttributeGroupsPage.tsx` — V3 paritesi.
- Drawer/Dialog edit (group + options inline, 3-way sync save).
- Sidebar "Özellikler" placeholder aktif.
- TanStack Query + HCI checklist + turkish-ux-reviewer.

**PR-F3 — Ürün atama + Snapshot:**
- **F3a (Sprint 8c):** Ürün editörü (Menü Tanımları PR-D/E) "Atanmış Özellik Grupları" bölümü.
- **F3b (Sprint 8c):** Migration 012 — `order_item_attributes` snapshot tablosu (group_name + option_name + extra_price_cents snapshot kolonları). MVP zorunlu (2026-04-30 onayı).
- **F3c (Phase 3):** `AttributePickerModal` sipariş ekranında. Sipariş ekranı Phase 3.

PR sırası: F1 → F2 → F3.

### Açık sorular — Resolved (2026-04-30 İlhan onayı)

1. **`extra_price_cents` cap:** ±10000 cent (±100 TL). ✅
2. **Idempotent link insert:** **200 OK no-op** (v3 paritesi). DELETE de idempotent (204). ✅
3. **PR-F3 snapshot:** **MVP zorunlu** — Migration 012 PR-F3b kapsamında. ✅

### Referanslar

- ADR-002 §6 (RBAC amendment PR-F1'de)
- ADR-003 §6.5, §8, §8.6 (superseded notu PR-F1'de), §9
- ADR-006 §3, §4, §5 (registry amendment PR-F1'de)
- ADR-009 "Domain service" bölümü
- v3 referans: `D:\dev\restoran-pos-v3\server\db\schema.sql` (READ-ONLY)

<!-- ADR-012 Accepted (2026-04-30). Attribute groups domain — v3 paritesi. 4 tablo + 14 endpoint + 3 alt-PR. 13 karar; 3 İlhan onayı uygulandı: cap ±100 TL, idempotent assign 200 OK / DELETE 204, snapshot MVP zorunlu. -->

---

## ADR-013 — Sipariş Alma UI Mimarisi (Phase 2 Order Screen)

**Bağlam:** v3'ün `OrderScreen.jsx` ~1400 satır tek component; v5 web tarafı sıfırdan. v3 davranışsal paritesi (Sub-agent v3-reference raporu, Session 49 2026-05-01 keşfi) baz alınır. 5 ekran görüntüsü referans.

### Karar 1 — Pending changes saf local state

`Kaydet` basılmamış kalemler React state'inde (`useCart` hook); sunucuda "draft order" YOK. F5 = pending kayıp.

**Gerekçe:** v3 paritesi; sunucu state karmaşası önlenir; idempotency POST /orders ile zaten korunuyor. Restoran pratiğinde Kaydet sonrası başka iş yapılır, F5 risk düşük.

**v5.1 forward-ref:** localStorage auto-save opsiyonu.

### Karar 2 — Snapshot zamanı = Kaydet anında server-side

`Kaydet` → POST /orders/:id/items. Sunucu o anki `unit_price_cents`, `vat_rate_snapshot`, `name_snapshot`, `extra_price_cents_snapshot` değerlerini hesaplar ve order_items satırına yazar. UI hesabı (cart total) yalnız ön-gösterim; otorite sunucu.

**Gerekçe:** Tampering önleme, idempotent replay safety, audit kanıt.

### Karar 3 — Concurrency: Socket warning (B varyantı)

Aynı masaya 2+ kullanıcı eş zamanlı girerse Socket.IO emit `order:edit_session_started` event'i diğer açık session'lara duyurur. UI banner: "X kullanıcısı bu masada da yazıyor". Blokaj YOK; sunucu append-only kabul eder.

**Reddedilen alternatifler:** Optimistic locking (paralel masaya yazma neredeyse olmuyor — kullanıcı gözlemi); pessimistic lock (UX yıkıcı).

### Karar 4 — Component yapısı

```
OrderScreenLayout (3-pane: header / catalog+adisyon / sticky bottom)
├─ ProductCatalog       — kategori sekmeleri + arama + ürün kartları grid
├─ AdisyonPanel         — sağ panel: empty / pending / persisted modları
├─ BottomActionBar      — sticky: Ara toplam + Toplam + state-based buttons
└─ Modals (PR-6+)       — AttributePicker, OrderProductDetail, QuickPayment

Hook'lar:
- useCart()             — pending kalem state (lokal)
- useOrder(orderId)     — sunucu state (react-query)
- useCatalog()          — kategori + ürün listesi
```

### Karar 5 — Adisyon panel: persisted üstte, pending altta

Sağ panel layout (top→bottom):
1. Header: "Adisyon" + "X kayıtlı ürün" + Taşı + ×
2. **MEVCUT ÜRÜNLER** (varsa) — persisted satırlar, her birinde actor rozeti (`username · HH:mm`)
3. **YENİ ÜRÜNLER** (varsa) — pending satırlar, üst sınırda mor border-left accent
4. Empty state: clipboard ikonu + "Ürün ekleyin"

Actor = `users.username + order_items.created_at`. Username artık doğru değer (Görev 35 backend bug fix).

### Karar 6 — Quantity 0 davranışı

- **Pending kalem qty 0:** lokal state'ten çıkar (filter), UI'dan kaybolur.
- **Persisted kalem qty 0 girilemez** (min=1); silmek için **void aksiyonu** = `PATCH /orders/:orderId/items/:itemId { status: 'cancelled' }`. Soft delete, audit korunur.

**Yetki (v3 paritesi):**
- `status='new'` → her rol cancel
- `status !== 'new'` (mutfağa gönderilmiş) → admin/cashier

### Karar 7 — Routing

- `/tables` — masalar listesi (PR-11 genişler)
- `/tables/:tableId/order` — masa detay (PR-1)
- Geri butonu `/tables` (NavLink, deep link)
- `/tables/:tableId/order/payment` — split ödeme (PR-7)
- Paket sipariş routing PR-12'de netleşir

### Karar 8 — i18n key namespace

- `order.*` — sipariş alma genel
- `order.cart.*` — pending sepet (qty stepper, Kaydet)
- `order.adisyon.*` — sağ panel (MEVCUT ÜRÜNLER, empty state, actor format)
- `order.attributes.*` — varyant + özellik modal (PR-6)
- `order.takeaway.*` — paket siparişler (PR-12)
- `payment.*` — ödeme akışı (ADR-014)

### Cross-ref

- ADR-003 §7 (snapshot), §8 (soft delete), §10 (orders/payments invariant)
- ADR-002 §10.4 (audit transaction atomicity)
- ADR-004 (Print Agent — mutfak ticket routing)
- ADR-009 (Areas — masa listesi bölge sekmesi)
- ADR-010 (Socket.IO — concurrency banner)
- ADR-012 (Attribute Groups — varyant + özellik modal datası)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\orders\OrderScreen.jsx`, `useCart.js`, `orderActionPolicy.js`

<!-- ADR-013 Accepted (2026-05-01, Session 49). 8 karar onaylandı: pending local, snapshot server, concurrency=B socket warn, component yapısı, persisted üstte, qty0 pending-vs-persisted ayrımı, /tables/:id/order routing, i18n namespace. -->

#### §9 — Amendment 2026-05-02 (PR-4 öncesi netleştirmeler)

v3 backend deep-dive (Session 49+, `docs/v3-reference/order-backend-deep.md`) sonrası kullanıcı 4 karar onaylandı:

**Karar 9.1 — `orders.status` default = `'open'` (v3 `'saved'` yerine)**

Yeni sipariş `INSERT` anında `status='open'`. v3'ün `'saved'` etiketi tarihsel yamadan kalma; mimari değer üretmiyor. Türkçe karşılığı "açık" — kasiyerlerin sözlü dili ile eşleşiyor. Status FSM (ADR-013/v3 paritesi):

```
open → in_kitchen → preparing → ready → served → closed
open → cancelled
served → closed | cancelled
closed/cancelled → terminal
```

Backend `POST /orders` handler `status='open'` insert eder.

**Karar 9.2 — Comp (ikram) toggle yetkisi: admin + cashier (kitchen HARIÇ)**

v3'te `staffAndKitchen` (admin|cashier|waiter|kitchen) izinli; v5'te kitchen rolü hariç tutulur. İkram = parasal/ticari karar, mutfak personeli sözlü olarak söyler, kasiyer/yönetici onaylar. Suistimal yüzeyi daralır (mutfak kendi hatasını ikram edip gizleyemez).

Endpoint: `PATCH /orders/:orderId/items/:itemId { is_comped: true }` — `authorize(['admin','cashier'])`.

**Karar 9.3 — `orders.comped_amount_cents` kolonu YOK (v5.1 backlog)**

İkram tutarı raporda gerekirse runtime SUM hesaplanır (`SUM(unit_price_cents * quantity) WHERE is_comped=true`). v5.0 MVP'de gün sonu raporu basit; ayrı kolon "ölü kod" riski. Performans sorunu çıkarsa v5.1 amendment ile eklenir.

**Karar 9.4 — `pricing_policy_version` mekanizması YOK (v5.1+ backlog)**

İndirim/kampanya/promosyon altyapısı v5.0 MVP scope'u dışı (anchor: "Adisyo değil, küçük restoran"). Bu kolon eklemek = ölü kod. İndirim sistemi ayrı ADR (v5.1+) ile geleceğin işi.

**Cross-ref:** `docs/v3-reference/order-backend-deep.md` "Kritik v3↔v5 Uyumsuzluklar" tablosu güncellenir; PR-4 (`POST /orders` schema + service) bu kararları implement eder.

<!-- ADR-013 §9 Amendment Accepted (2026-05-02, Session 49 devamı). 4 karar: status='open' default, comp admin/cashier only, comped_amount kolonu v5.1, pricing_policy_version v5.1. -->

#### §10 — Amendment 2026-05-02 (PR-6 öncesi: özellik/varyant modal kapsamı)

v3 OrderScreen + AttributePickerModal + OrderProductDetailModal kaynak okumasından çıkan davranış paritesi. PR-6 öncesi 5 karar onaylandı:

**Karar 10.1 — Ürün kartı tıklaması: modal AÇMAZ (v3 paritesi)**

Ürün katalogundaki karta tıklamak → `quickAdd(product)` → sepete `+1`, default porsiyon (varsa `is_default=1`, yoksa ilk), boş özellik. Zorunlu özellik olsa bile modal açılmaz; kasiyer/garson sonra **sepetteki satıra tıklayıp** düzenler.

**Gerekçe:** v3 davranışı; rush-hour'da hızlı ekleme (parmakla "tık-tık-tık" 5 ürün); zorunlu özellik validasyonu Kaydet anında (POST `/orders/:id/items`) sunucu tarafında zaten yapılıyor (Karar 10.4).

**Karar 10.2 — Satır tıklaması: `OrderProductDetailModal` (porsiyon + özellik + not)**

Sepetteki pending kalem veya persisted kalem satırına tıklama → `OrderProductDetailModal` açılır. Tek modal hem porsiyon, hem özellik grupları, hem note düzenler. Persisted + comp olmayan kalemde de düzenleme açık (qty/portion düzenleme = void+yeniden ekle değil; note serbest, porsiyon kısıtı `canEditOrderItem` ADR-013 §6 kuralı).

**Reddedilen alternatif:** Ayrı `AttributePickerModal` — v3'te kodda var ama hiçbir yerden çağrılmıyor (ölü kod). v5'e taşımıyoruz; v5.1 backlog'a gönderilebilir, MVP'de YOK.

**Karar 10.3 — Özellik UI: kart-buton grid (v3 görsel paritesi)**

Modal içinde her özellik grubu için seçenekler **180px+ minmax grid** ile kart-buton olarak çıkar. Seçili → mor border + arka plan tonu + sağ üstte ✓ daire. Her butonun içinde: özellik adı (üst, fw 600), fiyat alt satır ("Ücretsiz" yeşil veya "+25,00 ₺" gri).

**Reddedilen alternatifler:** Checkbox listesi (sıkışık, dokunmatikte zor), küçük çip (fiyat sığmaz). v3 kart-buton zaten kanıtlı dokunmatik UI.

`is_required` zorunlu grup seçilmezse: grup başlığı kırmızı border-bottom + altında hata yazısı. Hata Kaydet anında değil, modal `Onayla` anında.

**Karar 10.4 — Composite row key: 4-tuple (modifiers v3 legacy → v5'te yok)**

Sepette aynı ürünün ikinci kez eklenebilmesi `(product_id, portion_id, attributes_hash, note)` 4-tuple eşleşmesine bağlı. v3 `modifiers` (legacy mod_groups) v5'te attribute_groups'a sıkıştırıldı (ADR-012); ayrı `modifiers_hash` slot'u YOK.

`attributes_hash` = `selected_attributes` array'inin `(group_id, option_id)` çiftlerinin sıralı JSON serializasyonunun hash'i (deterministik karşılaştırma için sıralama gerek). Frontend `useCart` hook'unda hesaplanır.

**Karar 10.5 — Sunucu otoritesi: `resolveAttributes()` POST `/orders/:id/items` içinde**

Frontend payload: `selected_attributes: [{ group_id, option_id }]`. Sunucu:

1. Ürünün attribute_groups + options ilişkisini DB'den çek (tenant-scoped).
2. `is_required=true` her grup için `selected_attributes`'ta en az 1 option olmalı; yoksa `400 MISSING_REQUIRED_ATTRIBUTE { group_id, group_name }`.
3. `selection_type='single'` grup için >1 option seçimi → `400 INVALID_ATTRIBUTE_SELECTION`.
4. Her seçili option için `extra_price_cents`'i DB'den oku, snapshot'la `order_item_attributes` satırlarına insert (Migration 017 tablosu).
5. `unit_price_cents = base_price + portion.delta_cents + Σ option.extra_price_cents` — sunucu hesaplar, frontend cart total yalnız ön-gösterim.

**Cross-ref:** ADR-012 (Attribute Groups Domain — selection_type, is_required, options), ADR-013 §2 (snapshot otoritesi sunucu), Migration 017 (`order_item_attributes` snapshot tablosu); v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\orders\AttributePickerModal.jsx` (UI deseni referansı), `OrderProductDetailModal.jsx` (modal düzeni), `OrderScreen.jsx:1340-1395` (modal callback yolu); `docs/v3-reference/order-flow-deep.md:42-46` (composite key v3 5-tuple → v5 4-tuple uyarı).

<!-- ADR-013 §10 Amendment Accepted (2026-05-02, Session 51 PR-6 önü). 5 karar: kart→quickAdd modal yok, satır→OrderProductDetailModal, özellik UI kart-buton grid, 4-tuple row key (modifiers v5 yok), resolveAttributes sunucu otoritesi. -->

#### §11 — Amendment 2026-05-02 (PR-6 manuel test sonrası: porsiyon MVP)

§10.4 Karar 4 (4-tuple row key) ve §10.2 Karar 2 (modal kapsamı) "porsiyon UI v5.1 backlog" dedi; manuel test sonrası kullanıcı **v3 paritesi koruma** gerekçesiyle porsiyonu MVP'ye geri çekti. 3 karar onaylandı:

**Karar 11.1 — Porsiyon (variant) MVP'ye dahil**

`product_variants` (Migration 006) DB hazır; `ApiProduct.variants[]` zaten frontend'e geliyor. v3'te modal'da porsiyon seçici; pide gibi 1+ varyantlı ürünlerde **zorunlu**. Atlama = pratik kullanılamazlık.

OrderProductDetailModal'da **Adet ↔ Not arasında** porsiyon picker satırı (variants.length ≥ 1 ise). Kart-buton grid (özelliklerle aynı pattern), label + delta fiyat. Default = `is_default=true` veya ilk variant.

**Karar 11.2 — Composite row key 5-tuple'a yükseldi**

`rowId = productId|variantId|attributesHash(sorted)|note` — 5-tuple (variantId NULL yoksa boş string). v3 paritesi: aynı ürün farklı porsiyonla ayrı satır. Backend `resolveItemSnapshots` `variantId` opsiyonel parametresini alır, `product_variants.price_delta_cents` ile `unit_price_cents`'i ayarlar.

**Karar 11.3 — Snapshot kolonu order_items üstünde (3 yeni alan)**

Migration 021 `order_items` tablosuna ekler:
- `variant_id_snapshot UUID NULL` — FK YOK (variant soft-deleted olsa snapshot kalır, ADR-003 §7 paritesi)
- `variant_name_snapshot VARCHAR(80) NULL` — variant ad anlık kopyası
- `variant_price_delta_cents_snapshot INTEGER NULL` — fiyat farkı kopyası (audit + recalc bağımsızlığı)

`order_item_attributes` benzeri ayrı tablo değil; tek varyant satırı, kolon yeterli. Cross-ref: ADR-003 §7 snapshot invariant.

**Cross-ref:** §10 amendment row key 4-tuple → 5-tuple'a override; v3 `OrderProductDetailModal.jsx` portion picker görsel paritesi; `D:\dev\restoran-pos-v3\client\src\components\orders\OrderProductDetailModal.jsx:285-309` (showPortionPicker).

<!-- ADR-013 §11 Amendment Accepted (2026-05-02, Session 51 PR-6 manuel test). 3 karar: porsiyon MVP, 5-tuple row key, Migration 021 variant snapshot kolonları. -->

---

## ADR-014 — Ödeme Akışı (Quick Pay + Split + Idempotency)

**Bağlam:** Ödeme POS'un kalbi. v3'te `QuickPaymentModal` (4-op + Nakit/Kart) + `SplitPaymentModal` (kalem/tutar/eşit pay) + idempotent replay. v5'te aynı mental model, modern revamp + zod schema sıkılaştırması. Ekran görüntüleri 6-7 doğruluyor.

### Karar 1 — Hızlı Öde 4-operation modal

"Hızlı Öde" butonu modal açar:
- Big display: ÖDENECEK TOPLAM
- 4 operation radio (default `Öde`):
  - **Öde** — masa açık kalır
  - **Öde & Kapat** — ödeme + masa boşalt (`order_status='closed'`)
  - **Öde & Yazdır** — ödeme + receipt print, masa açık
  - **Öde, Yazdır ve Kapat** — hepsi
- 2 büyük buton: 💵 Nakit / 💳 Kredi Kartı

Buton tıklanınca seçili operation + payment_type ile POST /payments.

### Karar 2 — MVP ödeme tipleri: Nakit + Kredi Kartı

- **Nakit** (`payment_type='cash'`)
- **Kredi Kartı** (`payment_type='card'`) — POS terminali manuel; yazılım entegrasyonu YOK MVP'de

**v5.1 forward-ref:** havale (`transfer`), multinet/sodexo (`meal_card`), online (`online`).

### Karar 3 — Masa ⋮ menü 4 aksiyon + İptal

Dolu masa kartı ⋮ menü buton seti:
- **Öde** (primary, full-width, mor) — split ödeme ekranını açar
- **Hızlı Öde** — Karar 1 modal'ı
- **Masayı Taşı** — masa transfer (PR-9)
- **Yazdır** — manuel print (kasiyer fişi)
- **İptal** (kırmızı) — yalnız bu menü kapanır (sipariş iptal DEĞİL)

### Karar 4 — Idempotency key

Modal açılışında UI `idempotency_key = uuid v4` üretir, `POST /payments` body veya `Idempotency-Key` header ile gönderir. Sunucu aynı key'i ikinci kez görürse aynı yanıtı döner. Modal kapanıp tekrar açılırsa yeni key.

**Gerekçe:** Network kesintisi / double-click / kart terminali gecikme → çift ödeme önleme. v3'te zaten var.

### Karar 5 — Split (Bölünmüş) Ödeme = ayrı ekran

"Öde" butonu → full-route ekran `/tables/:tableId/order/payment`. Modlar (v3 paritesi):
- **Eşit pay** (`split_equal`)
- **Tutar bazlı** (`split_amount`)
- **Kalem bazlı** (`split_items`)

Detay PR-7'de. MVP scope.

### Karar 6 — "Öde + Kapat" tek transaction

`POST /payments` operation=`pay_and_close` ise:
1. INSERT payments (idempotency check)
2. UPDATE orders SET status='closed', closed_at=now() (full payment ise; partial → 409)
3. INSERT audit_logs (`event_type='order.closed'`)
4. Socket.IO emit `order:closed` (TablesScreen realtime update)

Tek transaction, atomicity garantisi.

### Karar 7 — "Öde + Yazdır" Print Agent kuyruğu

operation=`pay_and_print` ise sunucu ek olarak `INSERT print_jobs (job_type='receipt')`. Print Agent (Windows hizmeti, ADR-004) kuyruğu izler, ESC/POS yazıcıya basar. UI fire-and-forget.

### Karar 8 — Mutfak ticket otomatik (Kaydet anında)

`POST /orders/:id/items` (Kaydet) handler'ı her satır için kategori-printer routing kuralına göre `print_jobs` kuyruklar (`job_type='kitchen_ticket'`). Yalnız `category.kitchen_print=true` kategoriler tetikler. Kasiyer kararı yok.

**v3 paritesi:** `printerAutoPrintPolicy.js`.

### Cross-ref

- ADR-003 §10 (orders/payments invariant)
- ADR-004 (Print Agent)
- ADR-006 §5 (error registry — ödeme kodları)
- ADR-010 (Socket.IO — `order:closed` realtime)
- ADR-012 (Attribute Groups — extra_price snapshot)
- ADR-013 §8 (i18n `payment.*`)
- v3 READ-ONLY: `client/src/components/payments/QuickPaymentModal.jsx`, `SplitPaymentModal.jsx`, `server/routes/payments.js`

<!-- ADR-014 Accepted (2026-05-01, Session 49). 8 karar onaylandı: 4-op modal, MVP nakit+kart, masa ⋮ menü, idempotency UI üretir, Öde=split ayrı ekran, kapat tek transaction, yazdır Print Agent, mutfak ticket auto. Caller ID müşteri atama PR-8'de. -->

#### §9 — Amendment 2026-05-02 (PR-7b öncesi v3 derinlemesine inceleme + manuel ekran teyidi)

`docs/v3-reference/payment-deep.md` + v3 `SplitPaymentModal.jsx` + `migrations/run.js:255-286` + `routes/payments.js` okuması sonrası kullanıcı 7 karar onaylandı:

**Karar 9.1 — UI v3 birebir paritesi**

`SplitPaymentScreen` route (`/tables/:tableId/order/payment`) **modal değil, full-screen page** (ADR-013 §7). Layout v3 ekran 2/3/4 birebir: sol Kalemler + sağ Sipariş Toplamı/Ödenen kart trio + İşlem Aksiyonu 4-grid + Ödeme Tipi 2-buton + footer "Ödeme Ekranını Kapat" / "✓ Kaydet". Tipografi, padding, mor tonlar v3 ile aynı (PR-6c'deki `--v3-bg-app` + `--v3-purple-bg` paleti).

**Karar 9.2 — "KALAN" sayacı kaldırıldı**

v3'te 4 sayaç (Sipariş Toplamı / Ödenen / Kalan / Dağıtımda). v5'te **3 sayaç**: Sipariş Toplamı + Ödenen + Dağıtımda (sadece Ayrı Ayrı Öde'de). KALAN derived (Sipariş - Ödenen), kullanıcı zaten Sipariş Toplamı'nı görüyor; ekstra kart UI gürültüsü.

**Karar 9.3 — Bahşiş YOK (MVP dışı)**

v3'te `payments.tip_amount REAL` + ayrı `tips` tablo + UI bahşiş input. v5 MVP'de **kolon eklenmez** (Migration yok), UI'da bahşiş alanı yok. v5.1 backlog. v3 `tips` tablosu da MVP'de yok.

**Karar 9.4 — Partial-quantity kalem bölme MVP'de (v3 paritesi)**

**v3 davranışı (teyitli):** `payment_allocations.quantity INTEGER` (yarım kalem YOK, sadece integer adet). 4 adet çay siparişi `order_items.quantity=4` tek satır; split akışında allocations: `[{order_item_id, qty=2, payer_no=1}, {order_item_id, qty=2, payer_no=2}]` — aynı `order_item_id` için **birden fazla payment_items** satırı.

**v5 değişiklikleri (Migration 023):**
- `payment_items.quantity INTEGER NOT NULL DEFAULT 1` kolonu eklenir (CHECK > 0)
- `payment_items.unit_price_cents_snapshot INTEGER NOT NULL` (audit + recalc bağımsızlığı, ADR-003 §7 paritesi)
- `payment_items.line_total_cents INTEGER NOT NULL` (qty × unit; CHECK = qty × unit)
- `UNIQUE (tenant_id, order_item_id)` constraint **kaldırılır** (000_init §10.5.2 C2 yeniden değerlendirilir)
- Yeni invariant: `SUM(payment_items.quantity) per order_item_id ≤ order_items.quantity` — service katmanında validate (DB CHECK karmaşık çünkü cross-row)

**Reddedilen alternatif:** REAL quantity (yarım kalem). v3'te de yok, küçük restoran pratiğinde gerek yok; integer adet yeterli.

**Karar 9.5 — Hızlı Öde her zaman tam tutar**

v3 paritesi. `amount = order.total_cents - SUM(existing_payments.amount)` yani kalan tam tutar. Kısmi Hızlı Öde YOK; kısmi ödeme yalnız Detaylı Öde'den.

**Karar 9.6 — Masa kart 3-nokta "İptal" semantiği: SİPARİŞ İPTALİ**

v5 ADR-014 §3 önceki yorum hatalı. Kullanıcı teyidi: kırmızı "İptal" buton **siparişi cancel edip masayı boşaltıyor**. Davranış:
1. `PATCH /orders/:id { status: 'cancelled' }` (yeni endpoint — mevcut `/items/:itemId` cancel kalemde)
2. Tüm `order_items` aynı transaction'da `status='cancelled'` olur
3. `audit_logs` `event_type='order.cancelled'` insert (ADR-002 §10.4)
4. Socket.IO `order:cancelled` emit
5. Confirm dialog ZORUNLU: "Bu siparişi iptal etmek istediğinizden emin misiniz? Geri alınamaz."

RBAC: `admin/cashier only` (waiter+kitchen 403). Sipariş `status='paid'` ise reddedilir (409 ORDER_INVARIANT_VIOLATED).

UI metni: kırmızı buton **"Siparişi İptal Et"** (önceki "İptal" belirsizdi; modal kapatma X ikonu zaten var).

**Karar 9.7 — "Geri Al" stack-tabanlı (v3 paritesi)**

v3 `SplitPaymentModal.jsx` `history: useState([])` snapshot stack. Her `addItem`/`removeItem`/`addPayer`/`removePayer` action öncesinde mevcut state push edilir. "Geri Al" → pop, state restore. "Bölmeyi Sıfırla" → history clear + initial state. "Geri Al" disabled when `history.length === 0`.

v5'te aynı pattern: React `useReducer` + history middleware veya `useState<{ payers, history }>`.

**Cross-ref:**
- ADR-003 §10.1.b (payment_items invariant — Migration 023 ile UNIQUE drop revision)
- ADR-013 §7 (route `/tables/:tableId/order/payment`)
- `docs/v3-reference/payment-deep.md` (davranış raporu)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\payments\SplitPaymentModal.jsx`, `server/migrations/run.js:255-286`, `server/routes/payments.js`

<!-- ADR-014 §9 Amendment Accepted (2026-05-02, Session 51 PR-7b öncesi). 7 karar: v3 birebir UI, KALAN kart yok, bahşiş yok, partial-qty integer (Migration 023), Hızlı Öde tam tutar, 3-nokta İptal=sipariş cancel, Undo stack-tabanlı. -->

#### §10 — Amendment 2026-05-03 (PR-7-revamp: v3 dosya-düzeyi tam analiz sonrası)

PR-7b manuel test sonrası kullanıcı kapsamı genişletti. Hem v3 davranış paritesi hem v3 görsel/ölçü paritesi hem de v3 backend zenginliği isteniyor. v3 `QuickPaymentModal.jsx` (4 bölüm), `SplitPaymentModal.jsx` (755 satır), `server/routes/payments.js`, `server/services/paymentService.js`, `server/migrations/run.js:255-326` dosyalarının tam okuması sonrası 10 karar:

**Karar 10.1 — `PaymentScreenPage` (full-screen route) silinir**

v3'te "Detaylı Öde" diye 3. modal YOK. Sadece 2 akış:
- Hızlı Öde modal — tek-payment full scope
- Ayrı Ayrı Öde modal — kişi-bazlı kalem dağıtımı

v5'te eklediğim `PaymentScreenPage` v3 paritesi DEĞİL (orta-yol uydurma). Silinir; route `/tables/:tableId/order/payment` kaldırılır. 3-nokta menü "Öde" tıklaması → doğrudan `SplitPaymentModal` aç. "Hızlı Öde" → `QuickPaymentModal`.

**Karar 10.2 — `GET /payments/orders/:orderId/split-state` endpoint (v3 paritesi)**

Tek-call response (split-state DTO):
```
{
  order: { id, status, table_id, total_cents, ... },
  items: [{ id, product_name, total_quantity, remaining_quantity,
            unit_price_cents_snapshot, line_total_cents,
            variant_name_snapshot, attributes }],
  allocations: [{ payment_id, payer_no, payer_label, payment_type,
                  amount_cents, items: [{ order_item_id, quantity }] }],
  totals: { order_total_cents, paid_total_cents, remaining_total_cents,
            has_unallocated_payments }
}
```

`remaining_quantity` = `order_items.quantity - SUM(payment_items.quantity per item)`.
`has_unallocated_payments` = `EXISTS payments WHERE payment_scope='full' AND order_id=?`. RBAC: admin/cashier.

Frontend bu tek endpoint'le hem mevcut allocations panelini hem de "kalan ürünler" listesini eş zamanlı render eder. PR-7a `usePaymentsForOrder` + ek client-side hesap pattern'i bu endpoint ile değişir.

**Karar 10.3 — Migration 024: payments + payment_items extension (v3 paritesi)**

`payments` tablosuna ek kolonlar (NULL allowed, mevcut satırlar etkilenmez):
- `payer_no SMALLINT NULL` — Ayrı Ayrı Öde'de kişi sıra no (1-999)
- `payer_label VARCHAR(80) NULL` — "Kişi 1" gibi etiket; kullanıcı düzenleyebilir
- `cash_received_cents INTEGER NULL CHECK (cash_received_cents >= 0)` — nakit alındı
- `change_amount_cents INTEGER NULL CHECK (change_amount_cents >= 0)` — para üstü
- `note VARCHAR(500) NULL` — kasiyer notu (rapor için)

`tip_amount_cents` **eklenmez** — Karar 9.3 v5.1 backlog.

`payment_items` tablosunda `payer_no SMALLINT NULL`, `payer_label VARCHAR(80) NULL` (allocation grupları render için redundant ama performans amaçlı denormalize — `payments` ile JOIN eden split-state query'sini basitleştirir; v3 paritesi).

**Karar 10.4 — `OrderUpdateSchema` genişletilir: `'cancelled' | 'paid'`**

v5 `OrderUpdateSchema` PR-7-amend'de yalnız `'cancelled'` literal. v3'te tamamen ödenmiş sipariş `PATCH /orders/:id` ile `'paid'` (v3'te 'closed' ama v5 enum 'paid' kullanır) statüsüne geçirilebilir — `QuickPaymentModal` Mod B "Masayı Kapat" akışı için zorunlu.

`'paid'` transition guard:
- `SUM(payments.amount_cents) >= orders.total_cents` (eksik ödeme → 400 `PAYMENT_INSUFFICIENT_FOR_CLOSE`)
- order.status !=  paid|cancelled|void (terminal reddi)
- RBAC admin/cashier

`'cancelled'` davranışı PR-7-amend'deki gibi devam eder (kalemleri de cancelled, total=0).

**Karar 10.5 — `PaymentCreateRequestSchema` genişletme**

Yeni opsiyonel alanlar:
- `cashReceivedCents` — Mod B "Nakit" Hızlı Öde'de = `amountCents` (otomatik); Ayrı Ayrı Öde'de kullanıcı girer + "Tam" buton
- `payerNo`, `payerLabel` — yalnız `paymentScope='item'` için
- `note` — kasiyer notu

Backend: `change_amount_cents = max(0, cash_received_cents - amount_cents)` server hesabı (Karar 10.3 kolon).

`itemAllocations` body parametresi PR-7-amend'den korunur. `payerNo`/`payerLabel` `payment_items` denormalize kolonlarına yazılır (Karar 10.3).

**Karar 10.6 — `QuickPaymentModal` Mod B (`isFullyPaid`) eklenir**

v3 paritesi: sipariş tamamen ödenmiş ise modal **4-op grid + Nakit/Kart YOK**, tek **full-width primary buton**:
- `table_id` varsa: **"Masayı Kapat"** (PATCH /orders/:id `{status:'paid'}`)
- Yoksa: **"Siparişi Kapat"**

Modal açılışında `isFullyPaid = totals.remaining_total_cents <= 0` (split-state'den) hesaplanır. Mod B akışı: tek POST DEĞİL → PATCH /orders/:id `{ status: 'paid' }`.

**Karar 10.7 — `SplitPaymentModal` v3 görsel/ölçü paritesi BİREBİR**

CSS class isimleri ve değerleri v3'ten birebir port edilir (TS cinsinden inline style veya Tailwind eşleşmesi):
- Modal max-height `92vh`, max-width `modal-md` (~720px)
- Header: `<h2>Ayrı Ayrı Öde</h2>` 18px font, alt subtitle "M{table_code} · Ürünleri kişilere paylaştırın" 12px muted
- Üst sayaç bar: 4-grid (Sipariş Toplamı / Ödenen / Kalan / Dağıtımda) — KALAN burada **sayaç olarak** kalır (v3 paritesi); Karar 9.2'deki "KALAN kart yok" kuralı eski PaymentScreenPage'in büyük sarı KART'ı içindi, küçük üst sayaç farklı; bu nokta açıklığa kavuştu
- `has_unallocated_payments` ise sayaç bar altında **uyarı banner** (kırmızı tonlu): "Bu siparişte kalem bazlı olmayan ödeme kaydı var. Yeni ayrı ödeme güvenlik için engellenebilir."
- Body 2-pane: sol `split-items-panel` (kalan ürünler) + sağ `split-payers-panel` (toolbar + paid groups + draft payers)
- Sol her satır: `total_quantityx product_name` üst, `Kalan {available}` alt, sağda `unit_price` + line_total (small), en sağda mor `+` buton (disabled: `available<=0 || remainingTotal<=0.02`)
- Sağ üst toolbar: Geri Al (ghost, Undo2) | Bölmeyi Sıfırla (ghost, RotateCcw) | Kişi Ekle (primary, UserPlus)
- Sağ paid groups paneli: mevcut allocations gösterir — "Kişi 2 — ₺350 (kart)" başlık + altında satırlar
- Sağ draft payer kartları: aktif kart border-mor, başlık + ₺total + (>1 ise) X kapat
  - Allocated items list (qty x ad)
  - Bahşiş input YOK (Karar 9.3)
  - Nakit/Kart 2 buton (active=primary, others=ghost)
  - Nakit seçili + total>0 ise: cashReceived input + "Tam" buton + "Para üstü: ₺X"
  - Yeşil full-width "✓ Bu kişiden ödemeyi al" buton (disabled: isProcessing || total<=0)

**Karar 10.8 — Frontend state: history max 24, JSON deep clone**

`history.slice(-24)` — son 24 hareket undo edilebilir (v3 paritesi). Push: `JSON.parse(JSON.stringify(payers))` deep clone (referans güvenliği). Pop: state replace + history kısaltma.

**Bu kişi ödedi** (POST /payments başarı) sonrası `history = []` (irreversible commit; v3 paritesi `setHistory([])`).

**Karar 10.9 — Socket.IO `order:updated` emit**

Backend POST /payments + PATCH /orders/:id (status değişikliği) sonrası `emitToTenant('order:updated', { orderId, totals })` emit. Frontend masalar listesi `useSocketEvent('order:updated')` ile invalidate eder. Mevcut `tables.statusChanged` tamamlayıcı kalır (masa status transition).

v3 paritesi: `emitToRoom(businessId, 'order:updated', { order })`. v5 multi-tenant'ta tenant room'una emit.

**Karar 10.10 — Idempotency-Key header desteği (HTTP standart)**

v5 PR-7a `idempotencyKey` body'de. v3'te HEM body HEM `Idempotency-Key` header. v5 backend her iki yolu kabul eder (`normalizeIdempotencyKey(body, header)` helper). HTTP standart paritesi + retry-friendly.

**Cross-ref:**
- ADR-014 §9 (7 karar — partial-qty Migration 023, sipariş iptali, undo stack)
- ADR-013 §7 — route `/tables/:id/order/payment` SİLİNİR
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\payments\{QuickPaymentModal,SplitPaymentModal}.jsx`, `server/routes/payments.js`, `server/services/paymentService.js`, `server/migrations/run.js:255-326`
- Migration 024 (yeni) — payments + payment_items extension

<!-- ADR-014 §10 Amendment Accepted (2026-05-03, Session 52 PR-7-revamp). 10 karar: PaymentScreenPage sil, GET split-state endpoint, Migration 024 (cash_received/change/payer_no/label/note), OrderUpdateSchema 'paid' eklendi (PAYMENT_INSUFFICIENT_FOR_CLOSE guard), QuickPaymentModal Mod B (isFullyPaid → Masayı Kapat), v3 birebir görsel paritesi (SplitPaymentModal CSS class+ölçüler verbatim), history max 24 deep-clone, Socket.IO order:updated emit, Idempotency-Key header desteği. -->

#### §11 — Amendment 2026-05-03 (PR-7-revamp v2: v3 PaymentScreen.jsx tam keşif sonrası)

§10'da v3'te 2 modal var (QuickPay + SplitPayment) varsayıldı; **YANLIŞ**. v3 `client/src/components/payments/` altında üç dosya var (Glob teyitli):
- `QuickPaymentModal.jsx` (4-op + Nakit/Kart, masa kart 3-nokta "Hızlı Öde")
- **`PaymentScreen.jsx`** (DETAYLI ÖDEME modal, ~720 satır, 3-nokta "Öde" + OrderScreen "Ödeme" tetik)
- `SplitPaymentModal.jsx` (PaymentScreen "Ayrı ayrı öde" butonundan tetik)

PaymentScreen.jsx'in tam keşfi sonrası 8 karar:

**Karar 11.1 — `DetailedPaymentModal` yeni component (v3 PaymentScreen birebir)**

`apps/web/src/features/payment/components/DetailedPaymentModal.tsx` — modal (route DEĞİL). Layout (v3 ekran 1+2):
- Header: "DETAYLI ÖDEME" small-caps + Masa N büyük + Garson + N kalem chip + X
- 2-pane body:
  * **Sol panel**: Kalemler kart — header "Kalemler" + "Ayrı ayrı öde" butonu sağ üstte (`disabled={isFullyPaid}`); kalem listesi (qty + ad + porsiyon + line_total); footer "Ayrı ödeme gerektiğinde kalemleri kişilere paylaştırın..."
  * **Sağ panel** (üstten alta):
    1. Sayaç bloğu (border + bg-secondary): 2-grid Sipariş Toplamı + Ödenen üstte; **büyük KALAN/Hesap Tamamlandı kart** altta (38px font, success/warning border+bg)
    2. 4 İşlem Aksiyonu grid (Kaydet primary, Öde ve Kapat success, Öde ve Yazdır + Hepsi secondary)
    3. Ödeme Tipi 2-buton (Nakit/Kart)
    4. **ALINACAK TUTAR** input (number) + "Kalanı Al" buton (totalDue) + "Tümünü Al" buton (orderTotal) + "İşlenecek tutar: ₺X" muted alt yazı (sadece `!isFullyPaid`)
    5. **BAHŞIŞ** input (number) + "Toplam tahsilat: ₺X" muted (sadece `!isFullyPaid`)
- Footer:
  * Sol: "Ödeme Ekranını Kapat" ghost
  * Sağ: tek BÜYÜK selectedAction butonu (tone'a göre `btn-primary` veya `btn-success`, `min-width 240px`)
  * `isFullyPaid` → footer butonu **YOK** (Mod B; tamamen ödenmiş, sadece kapatma akışı `closePaidOrder` üzerinden seçili "Öde ve Kapat" gibi action ile tetiklenir)

**Karar 11.2 — Tetik düzeni (route YOK)**

- 3-nokta menü "Öde" → DetailedPaymentModal
- OrderScreen "Ödeme" buton → DetailedPaymentModal
- 3-nokta menü "Hızlı Öde" → QuickPaymentModal (mevcut, korunur)
- DetailedPaymentModal "Ayrı ayrı öde" → SplitPaymentModal aç

§10 Karar 10.1'in "3-nokta Öde → SplitPaymentModal direkt" kısmı **revize**: SplitPaymentModal asla doğrudan tetiklenmez, hep DetailedPaymentModal üzerinden açılır.

**Karar 11.3 — Migration 025: `payments.tip_amount_cents` (Karar 9.3 revizyonu)**

§9.3 "bahşiş v5.1 backlog" **revize**: v3'te DetailedPaymentModal'da BAHŞIŞ input gösterilir (ekran 2 teyitli). MVP'ye dahil:

```sql
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tip_amount_cents INTEGER NULL;
ALTER TABLE payments ADD CONSTRAINT payments_tip_amount_nonneg
  CHECK (tip_amount_cents IS NULL OR tip_amount_cents >= 0);
```

shared-types `PaymentCreateRequestSchema.tipAmountCents` opsiyonel. Repo `create` insert'e ekler. v3 `tips` ayrı tablosu MVP'de YOK (rapor için ek detay v5.1).

**Karar 11.4 — payAmount + tipAmount + cashReceived semantiği (v3 paritesi)**

v3 `executePayment` payload:
```
amount = payAmount                       // ALINACAK TUTAR input
tip_amount = tipAmount                   // BAHŞIŞ input
cash_received = payAmount + tipAmount    // server change_amount auto-calc
```

v5 backend `PaymentCreateRequestSchema`:
- `amountCents` = parsed payAmount
- `tipAmountCents` = parsed tipAmount (opsiyonel)
- `cashReceivedCents` = `amountCents + (tipAmountCents ?? 0)` (otomatik)
- Backend `change_amount_cents` = `max(0, cashReceivedCents - amountCents)` (zaten Karar 10.5'te server hesabı var)

**Karar 11.5 — Aksiyon validasyonu (v3 paritesi guards)**

Frontend `handlePayment` öncesi:
1. `payAmount <= 0` → "Ödeme tutarı sıfırdan büyük olmalıdır" toast
2. `selectedAction.closeOrder && payAmount + 0.02 < totalDue` → "Masa kapatmak için kalan tutarın tamamı ödenmelidir" toast (cent toleransı: 2¢)
3. `isFullyPaid && (closeOrder || printReceipt)` → `closePaidOrder()` (PATCH /orders/:id `{status:'paid'}`)
4. `isFullyPaid && !closeOrder && !printReceipt` → "Bu siparişin ödenecek bakiyesi yok" toast.info

**Karar 11.6 — `payAmount` formülü ve clamp**

```
requestedAmount = amountInput parse veya totalDue (boşsa)
payAmount = roundMoney(min(max(0, requestedAmount), totalDue))
tipAmount = roundMoney(max(0, parseFloat(tipInput)))
```

Yani Alınacak Tutar input'u `[0, totalDue]` aralığına clamp'lenir (kullanıcı kalan tutardan fazla yazsa otomatik totalDue'ya düşer).

**Karar 11.7 — `closePaidOrder` akışı (Mod B + auto-close)**

v3 `closePaidOrder({ printReceipt, printerId })`:
1. `refreshOrder()` — taze veri çek
2. `currentDue > 0.02` → "Sipariş tamamen ödenmeden masa kapatılamaz" toast (race koruma)
3. `printReceipt` → `printOrderReceipt(id, {printer_id})` (PR-7d kapsamı, MVP'de skip)
4. `updateOrderStatus(id, 'closed')` → v5 `PATCH /orders/:id { status:'paid' }` (Karar 10.4)
5. `finishSuccess({order: updated}, printReceipt ? "Masa kapatıldı ve yazdırıldı" : "Masa kapatıldı")`

**Karar 11.8 — SplitPaymentModal "Paid groups" yeşil görünüm (v3 `is-paid` paritesi)**

Mevcut SplitPaymentModal'da `PaidGroup` component placeholder gri tonlu — v3 paritesi:
- `background: var(--success-muted)` (#1F9D68 transparent)
- `border: 1px solid var(--success)` (#1F9D68)
- Header: kişi label sol + "Ödendi · ₺X" badge sağ (success rengi tonu)
- Lines: her allocation `<span>{product_name} x {qty}</span>` + `<strong>{line_total}</strong>` sağda
- Cursor: `default` (tıklanmaz, payer kartı değil)

CSS class adı `.split-payer-card.is-paid` v3'te kullanılır; v5 inline style ile aynı görünüm.

**Cross-ref:**
- ADR-014 §9 Karar 9.3 ("bahşiş v5.1 backlog") REVIZE → §11.3 (MVP'ye eklendi)
- ADR-014 §10 Karar 10.1 ("3-nokta Öde → SplitPaymentModal direkt") REVIZE → §11.2 (DetailedPaymentModal aracılığıyla)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\payments\PaymentScreen.jsx` (~720 satır), `SplitPaymentModal.jsx` `is-paid` CSS, `utils/orderPaymentState.js`
- Migration 025 — `payments.tip_amount_cents`
- Yeni component: `apps/web/src/features/payment/components/DetailedPaymentModal.tsx`

<!-- ADR-014 §11 Amendment Accepted (2026-05-03, Session 52 PR-7-revamp v2). 8 karar: DetailedPaymentModal yeni (v3 PaymentScreen birebir), tetik düzeni (3-nokta Öde + OrderScreen Ödeme → Detailed; SplitPayment Detailed'den), Migration 025 tip_amount_cents (9.3 revizyon), payAmount+tipAmount+cashReceived v3 semantiği, validasyon guards (closeOrder kalan tutar +2¢ tolerans), payAmount [0,totalDue] clamp, closePaidOrder Mod B (PATCH 'paid'), SplitPayment paid-group yeşil success-muted görünüm. -->

---

## ADR-015 — Anasayfa Rapor Endpoint'leri (Dashboard Reporting API)

- **Durum**: Accepted
- **Tarih**: 2026-05-03
- **Supersedes**: Sprint 6 settings `business_day_cutoff_hour` kararı (Görev 24). Kolon Migration 026 ile DROP edilir.

### Bağlam

Phase 3 (sipariş + ödeme PR #92-#97) tamamlandı. `apps/web/src/features/dashboard/DashboardPage.tsx` v3 layout'unda 8 widget hazır ama `phaseLocked` placeholder. Widget'lar gerçek API'ye bağlanmalı.

v3'te benzer rapor ekranı `RaporScreen.jsx` + `server/routes/reports.js` mevcut; davranışsal referans olarak okundu (kod taşıma yok). v3'te tek toplu `GET /reports/dashboard` endpoint kullanılıyor — v5'te bilinçli olarak parçalanır (Karar 1).

Kullanıcı kararı: "Bugün" = takvim günü (00:00–23:59 local TZ), `order.created_at` filter; `business_day_cutoff_hour` (Sprint 6) konsept olarak terkediliyor — kasa kapanışı saat-tabanlı kayan iş günü ile değil, takvim günü ile yapılır. Bu küçük restoran pratiğine uyar; muğlak "iş günü" mantığı raporları zorlaştırıyordu.

Kapsam: v5.0 MVP içi (kullanıcı onayladı).

### Karar

#### Karar 1 — Endpoint topolojisi: PARÇALI (per-widget)

8 widget = 8 endpoint. Tek toplu `/reports/dashboard` YOK. Her widget kendi başına refresh olur, bağımsız stale-while-revalidate yapabilir, ağır query birinin yavaşlığı diğerini bloklamaz.

**Gerekçe:**
- Sipariş listesi (recent/closed) WebSocket invalidate ile sık refresh; KPI'lar 60s polling — farklı cache karakteristikleri.
- Bir widget hatası diğerlerini düşürmez (HTTP 500 izole).
- Endpoint başına RBAC + ABAC daha temiz.

**Karşı maliyet:** ilk paint'te 8 paralel HTTP request. Kabul: HTTP/2 multiplex + tek tenant + p95 < 200ms hedefi (NFR §3) ile sorun değil.

#### Karar 2 — "Bugün" tanımı: takvim günü, tenant timezone

Tüm endpoint'ler `tenant_settings.timezone` (IANA, örn. `Europe/Istanbul`) okur ve `[start_of_day_local, end_of_day_local)` aralığını UTC'ye çevirir. Filter: `orders.created_at >= ? AND orders.created_at < ?`.

`business_day_cutoff_hour` **kullanılmaz** (deprecate — Karar 7 + Migration 026).

`closed-orders` endpoint'inde "bugün kapanmış" = `payments.created_at` (en son `payment_scope='full'` veya `pay_and_close` operation) takvim günü içinde — orders tablosunda `closed_at` kolonu yok, payments aggregate ile türetilir. (Migration 027 backlog: `orders.closed_at TIMESTAMPTZ NULL` denormalize — v5.1.)

#### Karar 3 — 8 endpoint contract'ları

Tümü `Authorization: Bearer <jwt>` zorunlu. Tenant scoping mevcut auth middleware (`requireTenant`) ile RLS otomatik. Cache yok (her çağrı fresh DB query — Karar 6).

**Path konvansiyonu:** `/reports/<kategori>/<metrik>` veya `/reports/<liste-adı>`. Versioning yok (mevcut API genelinde unversioned; breaking change ADR ile ayrı ele alınır).

##### 3.1 — `GET /reports/kpi/today-revenue`

Bugünkü toplam ciro (kuruş integer).

**Query:** yok.

**Response (zod):**
```ts
TodayRevenueResponseSchema = z.object({
  totalRevenueCents: MoneyCentsSchema,           // SUM(orders.total_cents) bugün açılan paid (Amendment 2026-05-03)
  paidOrderCount: z.number().int().min(0),       // bugün açılan paid order sayısı
  asOf: z.string().datetime(),                   // server time (ISO UTC)
  windowStart: z.string().datetime(),            // bugün 00:00 local → UTC
  windowEnd: z.string().datetime(),              // bugün 23:59:59.999 local → UTC
});
```

**SQL özet (Amendment 2026-05-03):** `SELECT SUM(total_cents), COUNT(*) FROM orders WHERE tenant_id=? AND status='paid' AND created_at >= ? AND created_at < ?`.

**Notlar:** İptal/açık siparişler dahil değil. `tip_amount_cents` `orders.total_cents`'e dahil değil (Karar 8).

**Amendment 2026-05-03 (Seçenek A — KPI tutarlılığı):** ~~Önceki tasarım `payments.created_at` filter kullanıyordu... 3 KPI da `orders` tablosu ve `orders.created_at` filtresi kullanır.~~ **REVERTED — Amendment 2 aşağıda.**

**Amendment 3 (2026-05-03 — math tutarlılığı + iptal hariç):** Kullanıcı `Ciro / Sipariş = Ortalama` tutarlılığı istedi + iptal sipariş "Toplam Sipariş"e dahil edilmemeli kuralı. 3 KPI da aynı küme:
- §3.1 today-revenue: SUM(orders.total_cents) WHERE bugün AND status != 'cancelled' (v3 payments-based reverted)
- §3.2 order-count: totalOrders = open + paid (cancelled byStatus'ta gösterilir ama toplama dahil değil)
- §3.3 average-bill: SUM/COUNT WHERE bugün AND status != 'cancelled'

Sonuç: math tutarlı (Ciro = Ortalama × Sipariş). Açık masaların pending tutarı ciroya dahil (bugünkü iş hacmi). Dünden bugün ödenenler ciroya dahil değil. §3.4 (hourly), §3.5 (payment-distribution) hala payments-based — gerçek nakit akışı görünümü.

**Amendment 2 (2026-05-03 — v3 paritesi):** ~~Kullanıcı v3 davranışıyla karşılaştırma yaptıktan sonra v3 mantığını seçti. Üç widget v3'e çekildi~~ **PARTIALLY REVERTED — Amendment 3 yukarıda.** Sadece §3.7 (recent-orders, status filtresi yok) Amendment 2'den korundu.
- **§3.1 today-revenue:** SUM(payments.amount_cents) WHERE payments.created_at bugün — gerçek nakit akışı, dünden sarkıp bugün ödenenler dahil. Math tutarlılığı (Seçenek A) feda edildi; gerçek operasyonel ciro tercih edildi.
- **§3.3 average-bill:** SUM(orders.total_cents) / COUNT(*) WHERE created_at bugün — TÜM siparişler dahil (open + paid + cancelled). Açık masalar henüz para getirmediği için ortalamayı düşürür; v3'te işletmeci için daha gerçekçi sinyal olarak tercih edilmiş.
- **§3.7 recent-orders:** status filtresi kaldırıldı — tüm status'ler (open + paid + cancelled) akışta görünür. Operasyonel "şu an açık" görünümü yerine v3 tarihçe akışı.

`totalOpenCount` field adı (§3.7) legacy — değer artık tüm sipariş sayısı. Schema migration v5.1'e ertelendi (UI'da kullanılmıyor).

##### 3.2 — `GET /reports/kpi/order-count`

Bugünkü sipariş sayısı (açılan).

**Response:**
```ts
OrderCountResponseSchema = z.object({
  totalOrders: z.number().int().min(0),
  byStatus: z.object({
    open: z.number().int().min(0),
    paid: z.number().int().min(0),
    cancelled: z.number().int().min(0),
  }),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
```

**SQL:** `SELECT status, COUNT(*) FROM orders WHERE tenant_id=? AND created_at >= ? AND created_at < ? GROUP BY status`.

##### 3.3 — `GET /reports/kpi/average-bill`

Bugünkü ortalama adisyon tutarı.

**Response:**
```ts
AverageBillResponseSchema = z.object({
  averageBillCents: MoneyCentsSchema,            // round(SUM/COUNT)
  sampleSize: z.number().int().min(0),           // paid order count
  asOf: z.string().datetime(),
});
```

**Hesap:** `SUM(orders.total_cents) / COUNT(*)` `WHERE status='paid'` ve `created_at` bugün. `sampleSize=0` ise `averageBillCents=0` (NaN değil, frontend "—" gösterir). Banker's rounding değil, integer division (kuruş düzeyinde).

##### 3.4 — `GET /reports/hourly-revenue`

24 saatlik bucket array (saat 0-23 local TZ).

**Query:** yok (varsayılan: bugün).

**Response:**
```ts
HourlyRevenueResponseSchema = z.object({
  buckets: z.array(z.object({
    hour: z.number().int().min(0).max(23),       // local hour
    revenueCents: MoneyCentsSchema,
    orderCount: z.number().int().min(0),
  })).length(24),                                // her zaman 24 (boş saat 0)
  asOf: z.string().datetime(),
  timezone: z.string(),                          // tenant TZ — frontend tooltip için
});
```

**SQL:** `SELECT EXTRACT(HOUR FROM payments.created_at AT TIME ZONE ?) AS hr, SUM(amount_cents), COUNT(DISTINCT order_id) FROM payments WHERE tenant_id=? AND created_at >= ? AND created_at < ? GROUP BY hr`. Backend boş saatleri `revenueCents=0` ile doldurur (24-element guarantee).

##### 3.5 — `GET /reports/payment-distribution`

Ödeme tipine göre dağılım.

**Response:**
```ts
PaymentDistributionResponseSchema = z.object({
  segments: z.array(z.object({
    paymentType: PaymentTypeSchema,              // 'cash' | 'card' | 'transfer' (ADR-014)
    totalCents: MoneyCentsSchema,
    count: z.number().int().min(0),              // payment satır sayısı
    sharePct: z.number().min(0).max(100),        // toplam içindeki %, 1 ondalık
  })),
  totalCents: MoneyCentsSchema,                  // tüm tiplerin toplamı
  asOf: z.string().datetime(),
});
```

`sharePct` server tarafında `round(total*1000/grand)/10` ile hesaplanır (frontend float aritmetiği yapmaz). Toplam 100±0.1 olabilir (rounding); UI tolere eder. Toplam=0 ise `segments=[]`, `sharePct` hesaplanmaz.

##### 3.6 — `GET /reports/top-selling?limit=N`

Bugünün en çok satan ürünleri.

**Query:**
```ts
TopSellingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
```

**Response:**
```ts
TopSellingResponseSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    productNameSnapshot: z.string(),             // order_items snapshot (ADR-003 §7)
    totalQuantity: z.number().int().min(1),
    totalRevenueCents: MoneyCentsSchema,         // SUM(line_total_cents)
  })),
  asOf: z.string().datetime(),
});
```

**SQL:** `order_items` JOIN `orders` (status IN paid|open). `cancelled` order_items hariç (`oi.status != 'cancelled'`). `GROUP BY product_id, product_name_snapshot` (snapshot ile group — aynı ürün ismi değişmişse v3 paritesi olarak ayrı satır; %99 vakada problem değil).

##### 3.7 — `GET /reports/recent-orders?limit=N`

Şu an açık olan siparişler.

**Query:**
```ts
RecentOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
```

**Response:**
```ts
OpenOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),         // takeaway null
  tableCode: z.string().nullable(),              // 'M5' veya 'PAKET'
  totalCents: MoneyCentsSchema,
  itemCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  waiterName: z.string().nullable(),             // users.full_name JOIN
});

RecentOrdersResponseSchema = z.object({
  orders: z.array(OpenOrderSummarySchema),
  totalOpenCount: z.number().int().min(0),       // limit'ten bağımsız toplam
  asOf: z.string().datetime(),
});
```

**Filter:** `orders.status='open'` (takvim günü filtresi YOK — dünden açık sipariş olabilir, bilinçli). Sıralama: `created_at DESC`.

##### 3.8 — `GET /reports/closed-orders?limit=N`

Bugün kapanmış (status='paid') siparişler.

**Query:** Karar 3.7 ile aynı.

**Response:**
```ts
ClosedOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  tableCode: z.string().nullable(),
  totalCents: MoneyCentsSchema,
  paidAt: z.string().datetime(),                 // SUM-final payment.created_at
  paymentTypeMix: z.array(PaymentTypeSchema),    // distinct types ['cash','card']
});

ClosedOrdersResponseSchema = z.object({
  orders: z.array(ClosedOrderSummarySchema),
  totalClosedCount: z.number().int().min(0),
  asOf: z.string().datetime(),
});
```

**Filter:** `orders.status='paid'` AND son `payments.created_at` bugün takvim günü içinde. Backend hesabı: `MAX(payments.created_at)` per order. Sıralama: `paidAt DESC`.

#### Karar 4 — Klasör yapısı: `apps/api/src/routes/reports/` per-file

Tek `reports.routes.ts` ~600 satır olur, okunabilirliği zayıf. 8 endpoint = 8 dosya + bir `index.ts`:

```
apps/api/src/routes/reports/
├── index.ts                   (router compose)
├── today-revenue.ts
├── order-count.ts
├── average-bill.ts
├── hourly-revenue.ts
├── payment-distribution.ts
├── top-selling.ts
├── recent-orders.ts
└── closed-orders.ts
```

Mevcut `apps/api/src/routes/payments.ts` (tek dosya) konvansiyonundan sapma: yalnız reports için. Gerekçe: payments tek domain, reports 8 bağımsız metric. `apps/api/src/routes/index.ts`'e tek mount: `app.use('/reports', reportsRouter)`.

#### Karar 5 — Shared types: `packages/shared-types/src/reports.ts` tek dosya

Mevcut convention (her domain tek dosya: `payment.ts`, `order.ts`...) takip edilir. 8 schema tek dosyada (~250 satır beklentisi). `index.ts`'e `export * from './reports.js'` eklenir.

#### Karar 6 — Cache yok (her refresh fresh DB query)

**Gerekçe:**
- Tek tenant, küçük data volume (<1000 order/gün) — query süreleri p95 < 50ms hedefli (Karar 9 indexler).
- Cache invalidation karmaşıklığı (sipariş kapanışı → 5 farklı KPI etkilenir) yarardan fazla maliyet.
- Frontend zaten widget başına 30-60s polling yapacak (HCI checklist § "fresh data on dashboard").
- Stale data UX riski > performans kazancı (yoğun saatte kasiyer eski rakama bakar).

**v5.1 forward-ref:** Çok-tenant ölçek geldiğinde Redis (TTL 30s, key `reports:{tenant}:{endpoint}:{date}`) eklenir; o zaman ayrı ADR.

#### Karar 7 — Auth/RBAC: `reports.read` action (admin + cashier)

8 endpoint hepsi `requirePermission('reports.read')`. Mevcut PERMISSIONS matrix (ADR-002 §6):
- `admin` → ALLOW
- `cashier` → ALLOW (zaten 'reports.read' içerir)
- `waiter` → DENY (403)
- `kitchen` → DENY (403)

**Gerekçe:**
- Garson ciro/ortalama adisyon görmesin — başka garsonun performansı, müşteri masrafı bilgisi gizli kalır (insider risk + KVKK aile-restoran beklentisi).
- Mutfak finansal veri görmesin — operasyonel ihtiyaç yok.
- Kasiyer raporları kasa kapanışı için lazım — ALLOW.

`reports.run` (ağır rapor — v5.1) ayrı action; bu MVP'de kullanılmaz.

ABAC: yok (hepsi tenant-scoped, kişi-bazlı kısıt yok).

#### Karar 8 — Para semantiği: bahşiş ciro DEĞİL

`payments.amount_cents` = sipariş tutarı. `payments.tip_amount_cents` (ADR-014 §11.3) bahşiş — **rapor toplamlarına dahil edilmez**. Gerekçe: ciro = restoran geliri, bahşiş = personel geliri. v3 paritesi.

`changes_amount_cents` (para üstü) zaten `amount_cents` etkilemiyor — sorun yok.

İptal (`status='cancelled'`) siparişlerin `total_cents` rapor dışı — `orders.status='paid'` filter (3.3) veya `payments` JOIN (3.1, 3.4, 3.5) ile otomatik hariç.

#### Karar 9 — Index gereksinimleri

Mevcut `000_init.sql` zaten şunları içeriyor (varsayılan; doğrulama implementer'a):
- `idx_orders_tenant_status` `(tenant_id, status)` — yes
- `idx_payments_tenant_created` `(tenant_id, created_at)` — eğer yoksa Migration 028 olarak eklenir (implementer doğrular; bu ADR PRD-level, ek migration backlog kaydı)

**Bu ADR ile gereken index'ler (Migration 028 candidate, implementer karar verir):**
- `orders (tenant_id, created_at DESC)` — KPI today-revenue/order-count/recent-orders
- `orders (tenant_id, status, created_at DESC)` — recent-orders + closed-orders (partial index `WHERE status IN ('open','paid')` opsiyonel)
- `payments (tenant_id, created_at DESC)` — today-revenue, hourly-revenue, payment-distribution
- `order_items (tenant_id, product_id, status)` — top-selling (partial `WHERE status != 'cancelled'`)

`EXPLAIN ANALYZE` ile p95 doğrulaması QA gate (DoD §performance).

#### Karar 10 — Migration 026: `tenant_settings.business_day_cutoff_hour` DROP

`packages/db/migrations/026_drop_business_day_cutoff_hour.sql`:

```sql
-- 026_drop_business_day_cutoff_hour.sql
-- ADR-015 — anasayfa raporları takvim günü kullanır; cutoff_hour terk edildi.
-- Sprint 6 Görev 24'teki `business_day_cutoff_hour SMALLINT NOT NULL DEFAULT 6`
-- kolonu kaldırılır. Yerine: orders.created_at + tenant timezone.
--
-- Forward-only (ADR-003 §15). DROP COLUMN destructive — backup gerekli (deploy hook).

ALTER TABLE tenant_settings
  DROP COLUMN IF EXISTS business_day_cutoff_hour;
```

**shared-types değişiklikleri (eş zamanlı PR):**
- `TenantSettingsSchema.businessDayCutoffHour` field SİLİNİR
- `TenantSettingsUpdateSchema.businessDayCutoffHour` SİLİNİR
- `apps/api/src/routes/settings.ts` PATCH handler ilgili dal kaldırılır
- `apps/web/src/features/admin/settings/api.ts` ilgili input + form alanı kaldırılır
- `apps/api/src/__tests__/settings.test.ts` cutoff_hour case'leri silinir

**i18n:** `settings.cutoffHour.label`, `settings.cutoffHour.help` key'leri silinir (`i18n-key-checker` orphan tarar).

**Audit kaydı:** Migration 026 deploy öncesi mevcut tenant'ın `business_day_cutoff_hour` değeri (default 6) `audit_logs` event_type='tenant_settings.cutoff_deprecated' ile snapshot'lanır (forensic).

### Alternatifler

- **A: Tek toplu `GET /reports/dashboard` endpoint**
  - Artıları: Tek HTTP roundtrip, atomic snapshot (tüm KPI'lar aynı anlık görüntüden).
  - Eksileri: Bir widget hata/yavaş diğerlerini bloklar; widget başına refresh yok; cache stratejisi heterojen veriler için zor; payload büyür (~10-30 KB).
  - Neden reddedildi: Kullanıcı kararı (parçalı). Atomic snapshot küçük restoranda zorunluluk değil — saniye-içi tutarsızlık tolere edilebilir.

- **B: GraphQL endpoint `/reports/graphql`**
  - Artıları: Frontend gerektiği kadarını çeker, over-fetching yok.
  - Eksileri: Yeni teknoloji (CLAUDE.md stack lock değil), öğrenme + tooling maliyeti; auth/RBAC field-level karmaşıklığı; debug zorlaşır.
  - Neden reddedildi: Stack drift. REST 8 endpoint zaten yeterli granülerlik veriyor.

- **C: `business_day_cutoff_hour` tutarak rapor pencerelerini ona göre hesaplamak**
  - Artıları: "Gece yarısından sonra gelen sipariş hangi güne sayılır?" muğlaklığı çözer (saat 03:00 sipariş = dünkü iş günü).
  - Eksileri: Pidemiz/lokantamız 23:00'te kapanır — gece servisi yok; cutoff_hour pratikte gereksiz; iki farklı "gün" kavramı (raporlar vs. UI takvimi) mental yük; muhasebe takvim günü ile uyumlu olmalı.
  - Neden reddedildi: Kullanıcı kararı; küçük restoran pratiğine uymuyor. v5.1'de gece-servisi olan restoran gelirse yeniden ele alınır (ayrı ADR).

- **D: Cache + invalidation event'leri (Redis + Socket.IO trigger)**
  - Artıları: p95 daha düşük (DB query başına 50ms değil, cache hit 1ms).
  - Eksileri: Invalidation bug riski (eski rakam gösterimi → yanlış kasa kapanışı); altyapı ekleme; tek tenant ölçekte gereksiz.
  - Neden reddedildi: Karar 6 gerekçeleri. v5.1 ölçek geldiğinde tekrar değerlendir.

- **E: `business_day_cutoff_hour`'u korumak ve sadece deprecate olarak işaretlemek (DROP COLUMN değil)**
  - Artıları: Olası rollback'te veri kaybı yok.
  - Eksileri: Dead column, maintenance yükü, schema noise; audit/migration testleri yıllarca taşımak; "neden duruyor" sorusu 6 ay sonra muğlak.
  - Neden reddedildi: ADR-003 §15 forward-only; kararlı silme tercih edilir. Audit snapshot (Karar 10 son maddesi) forensic ihtiyacı karşılar.

### Sonuçlar

- (+) Anasayfa widget'ları gerçek veri gösterir; phaseLocked kalkar.
- (+) Settings tablosu sadeleşir; "iş günü vs. takvim günü" mental yükü yok olur.
- (+) Endpoint başına izolasyon — bir metric çökse diğeri ayakta.
- (+) RBAC matrix mevcut `reports.read` action ile temiz çözüldü; yeni permission eklenmedi.
- (+) Para semantiği (bahşiş ciro değil; iptal hariç) açıkça belgelendi — gelecekteki "ciro neden tutmuyor" soruları için referans.
- (−) İlk paint'te 8 paralel HTTP request — HTTP/2 multiplex zorunlu (mevcut Hetzner reverse proxy nginx ile OK).
- (−) Cache yok → her widget refresh DB query — index hijyeni kritik (Karar 9 mandatory).
- (−) `business_day_cutoff_hour` DROP destructive — gece-servisi senaryosu gelirse yeni ADR + migration gerekir.
- (−) `closed-orders` `paidAt` türetilmiş (MAX payment.created_at) — `orders.closed_at` denormalize kolon (v5.1) eklenince query basitleşir.

### Referanslar

- ADR-002 §6 (RBAC matrix — `reports.read`)
- ADR-003 §7 (snapshot invariant — order_items.product_name_snapshot top-selling için)
- ADR-003 §15 (forward-only migration)
- ADR-006 §5 (error taxonomy — generic 400/403 yeterli, yeni kod yok)
- ADR-013 (sipariş alma — order/items domain)
- ADR-014 (ödeme — payment_type, payment_scope, tip_amount_cents semantiği)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\reports\RaporScreen.jsx`, `server\routes\reports.js` (davranışsal referans, kod taşıma yok)
- Migration 026 (yeni) — `packages/db/migrations/026_drop_business_day_cutoff_hour.sql`
- Yeni dosyalar: `apps/api/src/routes/reports/{8 file}.ts`, `packages/shared-types/src/reports.ts`
- Sprint 6 Görev 24 (superseded — settings cutoff_hour kaldırıldı)

<!-- ADR-015 Accepted (2026-05-03, Session 52). 10 karar: parçalı 8 endpoint, takvim günü TZ-aware, 8 contract zod schema'sı, routes/reports/ klasör, shared-types/reports.ts tek dosya, no-cache (v5.1 Redis backlog), reports.read RBAC (admin+cashier), bahşiş ciro değil, index gereksinimleri (Migration 028 candidate), Migration 026 cutoff_hour DROP (Sprint 6 supersede). -->

---

## ADR-016 — Caller ID + Müşteri Yönetimi (Inbound Call Pipeline + Customer Domain)

- **Durum**: Proposed
- **Tarih**: 2026-05-03

### Bağlam

v3'te (`D:\dev\restoran-pos-v3\server\callerid\`, `client\src\components\callerid\`) çalışan caller-id + müşteri kartı + adres defteri sistemi paket-servisli pide/lokanta operasyonunun temelidir: telefon çaldığında numara ekrana düşer, müşteriyse adres + son sipariş geçmişi prefill, değilse "yeni müşteri" akışı. v3 davranışı `docs/v3-reference/caller-id-and-customer.md`'de özetlendi (3 tablo: customers/customer_phones/customer_addresses, paralel polling bridge'leri, KVKK boşlukları, regex maske bypass eksikliği).

v5'te bu pipeline **push tabanlı** (Socket.IO, ADR-010) ve **KVKK-uyumlu** (retention + minimization + bypass) yeniden inşa edilir. Donanım kullanıcı tarafından **CIDShow C812A** (1 hat USB, `cid.dll` SDK) olarak sabitlendi (Mimari A; Whozz/Twilio reddedildi). Restoran tek bilgisayarlı/tek-station MVP'dir; popup yalnız "ana bilgisayar" (primary station) kullanıcısına gider — broadcast yok.

KVKK riski: telefon = PII. Ham numara minimal süre (30 gün) tutulur, maskeli platform numaraları (Yemeksepeti/Getir/Trendyol Yemek) call_log'a hiç yazılmaz. Kara liste (`is_blacklisted`) operasyonel risk yönetimi (sahte sipariş, taciz) için tutulur — UI'da kırmızı uyarı zorunlu.

Kapsam kilidi: v5.0 MVP içi (CRUD + popup + KVKK retention). v5.1 backlog: çoklu hat (4/8 portlu CIDShow), arama geçmişi raporu, müşteri segmentasyonu, kampanya SMS, sadakat puanı.

### Mimari Diyagramı

```
[PSTN telefon hattı]
        │
        ▼
[CIDShow C812A USB] ── cid.dll (Win32 native)
        │
        ▼
[Restoran PC — Windows]
   ┌──────────────────────────────────────┐
   │  Print Agent (Node.js, mevcut)       │  ← print job pull (ayrı kanal)
   │                                      │
   │  Caller Bridge (.NET 8 Worker Svc)   │  ← YENİ — cid.dll wrapper
   │   • cid.dll event subscribe          │
   │   • normalize TR phone               │
   │   • HTTP POST → Cloud API            │
   │     (X-Bridge-Token header)          │
   └──────────────────────────────────────┘
        │ HTTPS
        ▼
[Cloud API — Hetzner / Express 5]
   POST /bridge/caller-id/incoming
        │
        ├─ 1. Normalize (re-validate)
        ├─ 2. Mask bypass filter (regex array, tenant_settings)
        │       └─ match → 200 { accepted:false, reason:'masked' } EXIT
        ├─ 3. Customer lookup (customer_phones.normalized_phone UNIQUE)
        ├─ 4. INSERT call_logs
        └─ 5. Socket.IO emit → room `tenant:{id}:caller-station`
                                    │
                                    ▼
                          [Web UI — primary station]
                          IncomingCallPopup
                            • bilinen → info + "Sipariş Aç"
                            • bilinmeyen → "Yeni Müşteri Ekle" prefill
                            • is_blacklisted → KIRMIZI + "KARA LİSTE"
```

### Karar

#### Karar 1 — Caller Bridge: Ayrı .NET 8 Windows Service

Bridge **Print Agent'ın PARÇASI DEĞİL**, ayrı Windows Service olarak deploy edilir. Service adı: `restoran-pos-caller-bridge`, binary `CallerBridge.exe`. Repo konumu: `apps/caller-bridge/` (yeni).

Trade-off:
- **A) Print Agent içinde Node.js + node-ffi-napi:** ✗ Reddedildi. node-ffi-napi Windows arm64'te kararsız; Node 22 + native binding ABI rebuild zorunluluğu deployment'ı kırılganlaştırır; Print Agent'ın tek sorumluluk prensibini bozar.
- **B) Ayrı .NET 8 Windows Service + cid.dll P/Invoke:** ✓ **SEÇİLDİ.** CIDShow SDK örnekleri zaten C# (`/tmp/caller-id-sdk/cidshow_CSharp_x64_x86/`); .NET 8 self-contained publish (`dotnet publish -r win-x64 --self-contained`) tek `.exe` üretir; Windows Service host (`Microsoft.Extensions.Hosting.WindowsServices`) battle-tested. 2. servis = 2. update path eksisi var ama ikisi de aynı installer'a paketlenebilir (v5.1: WiX bundle).
- **C) edge-js (Node ↔ .NET hibrit):** ✗ Reddedildi. CLR-in-Node hosting kompleks, debug zor, Print Agent crash → caller bridge ölür.

Yapı: Worker `BackgroundService`, `ICallerIdDevice` abstraction (mock + real), `IBridgeApiClient` (HTTP). Config: `appsettings.json` (`BridgeToken`, `ApiBaseUrl`, `LineCount=1`).

#### Karar 2 — DB Şeması (Migration 027)

Tek migration 4 yeni tablo + 3 ALTER. Tüm tablolar `tenant_id UUID NOT NULL` (ADR-002 multi-tenant RLS).

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  full_name VARCHAR(120) NOT NULL,
  is_blacklisted BOOLEAN NOT NULL DEFAULT false,
  blacklist_reason TEXT,                   -- KVKK: kara listeye alma gerekçesi (zorunlu UI'da)
  notes TEXT,
  total_orders INT NOT NULL DEFAULT 0,     -- denormalize counter, sipariş paid'e geçince ++
  last_order_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_tenant_name ON customers(tenant_id, full_name);
CREATE INDEX idx_customers_tenant_blacklist ON customers(tenant_id) WHERE is_blacklisted = true;

CREATE TABLE customer_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  normalized_phone VARCHAR(20) NOT NULL,   -- '05xxxxxxxxx' canonical
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, normalized_phone)     -- aynı tenant'ta 1 numara → 1 müşteri
);
CREATE INDEX idx_customer_phones_lookup ON customer_phones(tenant_id, normalized_phone);

CREATE TABLE customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  label VARCHAR(50),                       -- "Ev", "İş"
  address_line TEXT NOT NULL,
  district VARCHAR(80),
  neighborhood VARCHAR(80),
  delivery_note TEXT,                      -- "kapı şifresi 1234"
  is_default BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,                  -- soft delete (Karar 6)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_addresses_active ON customer_addresses(customer_id) WHERE deleted_at IS NULL;

CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  raw_phone VARCHAR(30),
  normalized_phone VARCHAR(20),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ringing','dismissed','opened_order','completed','blacklisted')),
  opened_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  station_user_id UUID REFERENCES users(id),  -- popup hangi user'a gitti
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_logs_retention ON call_logs(received_at);  -- cron DELETE için
CREATE INDEX idx_call_logs_tenant_recent ON call_logs(tenant_id, received_at DESC);

-- ALTERs
ALTER TABLE orders ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX idx_orders_customer ON orders(customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE tenant_settings ADD COLUMN caller_id_station_user_id UUID REFERENCES users(id);
ALTER TABLE tenant_settings ADD COLUMN caller_id_bypass_patterns TEXT[] NOT NULL DEFAULT ARRAY[
  '^08502\d+',   -- Yemeksepeti
  '^08503\d+',   -- Getir
  '^08504\d+',   -- Trendyol Yemek
  '^03129\d+'    -- platform geri arama (örnek)
]::TEXT[];
```

`call_logs.raw_phone` 30 gün sonra silineceği için "data minimization" prensibi karşılanır (debug/trace için kısa süreli kabul edilebilir).

#### Karar 3 — Telefon Normalize (TR)

Helper: `packages/shared-domain/src/phone.ts` → `normalizeTrPhone(raw: string): string | null`.

Kurallar:
- Tüm boşluk/dash/parantez strip → digit-only
- `+90` veya `0090` prefix → strip → `0` ekle
- 10 hane + `5` ile başlıyor → `0` prefix ekle (`5xxxxxxxxx` → `05xxxxxxxxx`)
- Sonuç regex `^0[2-5]\d{9}$` match ediyorsa döndür, değilse `null`
- Boş/çok kısa/çok uzun → `null`

Test paritesi: `+90 555 123 45 67`, `0(555) 123-4567`, `5551234567`, `00905551234567`, `905551234567`, `0212 555 12 34` → hepsi normalize. Geçersizler: `123`, `+1 555 123 4567` (US), `0900...` (premium).

Bridge ham telefonu API'ye gönderir; API normalize eder (bridge'e güvenmeyiz). Mismatch durumunda raw_phone log'lanır, normalize null ise call_log status `dismissed` + reason `invalid_format`.

#### Karar 4 — Maskeli Numara Bypass (Erken Filtre)

`tenant_settings.caller_id_bypass_patterns TEXT[]` regex array'i (default seed Karar 2). Pipeline:

1. `normalizeTrPhone(raw)` → `normalized` (null ise dismiss)
2. **`if patterns.some(p => new RegExp(p).test(normalized || raw))` → 200 `{ accepted: false, reason: 'masked' }` EXIT** (call_log YAZMA, popup yok)
3. Customer lookup
4. call_logs INSERT
5. Socket.IO emit

Pattern editor UI (admin) v5.1 backlog; MVP'de seed default + manuel SQL UPDATE yeterli.

#### Karar 5 — Primary Station Seçimi: tenant_settings.caller_id_station_user_id

Şema: `tenant_settings.caller_id_station_user_id UUID NULLABLE FK users(id)` (Karar 2).

Gerekçe: Tek tenant + tek station MVP. Kolon `users` tablosuna boolean koymaktan daha temiz çünkü "kim alıcı?" tenant-level karar (admin değiştirir), user-level değil. Multi-station genişlemesi v5.1'de `caller_id_stations UUID[]` ile yapılır (additive).

Frontend: `IncomingCallProvider` mount olduğunda `GET /settings` → `caller_id_station_user_id === currentUser.id` ise Socket.IO `tenant:{tenantId}:caller-station` room'una join eder. Diğer kullanıcılar bu room'a girmez → Socket.IO emit broadcast etmez (ADR-010 §3 namespace+room kuralı).

NULL ise (admin atamamış) hiçbir popup gösterilmez; admin Settings sayfasında uyarı görür ("Caller ID alıcı atanmamış").

#### Karar 6 — Backend Endpoint'leri (10 yeni)

| # | Method + Path | RBAC | Notes |
|---|---|---|---|
| 1 | `POST /bridge/caller-id/incoming` | X-Bridge-Token (env `BRIDGE_TOKEN`, Print Agent ile aynı pattern; `bridgeAuth` middleware reuse) | Body `{ rawPhone, lineNumber?, receivedAt }`. 200 `{ accepted, reason?, callLogId? }`. Tenant ID token'dan resolve edilir (Print Agent gibi tenant-bound token). |
| 2 | `GET /customers?search=&limit=20` | admin, cashier, waiter | `search` telefon prefix VEYA isim ILIKE. Limit max 50. |
| 3 | `POST /customers` | admin, cashier | Body: `{ fullName, phones: [{ normalizedPhone, isPrimary? }], addresses?: [...] }`. Telefon zorunlu (en az 1), `fullName` zorunlu, addresses opsiyonel. |
| 4 | `GET /customers/:id` | admin, cashier, waiter | Detay + son 10 sipariş + adresler (deleted_at IS NULL). |
| 5 | `PATCH /customers/:id` | admin (blacklist), cashier (notes/name) | `is_blacklisted` set ederken `blacklist_reason` zorunlu. |
| 6 | `POST /customers/:id/addresses` | admin, cashier | Adres ekle. is_default true ise diğerleri auto false. |
| 7 | `PATCH /customers/:id/addresses/:addressId` | admin, cashier | Default toggle + alan güncelleme. |
| 8 | `DELETE /customers/:id/addresses/:addressId` | admin, cashier | **Soft delete** (`deleted_at = now()`). Geçmiş siparişler `delivery_address` snapshot tuttuğu için hard delete gereksiz; ama referansiyel temizlik gelecekte. |
| 9 | `GET /call-logs?limit=50&since=ISO` | admin, cashier | Çağrı geçmişi (max 30 gün). Pagination cursor v5.1. |
| 10 | `POST /orders` | (mevcut) — body'ye `customerId?: UUID` eklenir | Migration 027 FK ile bağ. Snapshot için `delivery_address?: string` da kabul (paket servisinde). |

Tüm zod şemaları: `packages/shared-types/src/customers.ts` + `packages/shared-types/src/call-logs.ts` + `packages/shared-types/src/bridge.ts` (caller-id incoming contract).

Error envelope ADR-006 §5 ile uyumlu (generic 400/403/404, yeni kod yok).

#### Karar 7 — Frontend Mimari

- **`IncomingCallProvider`** (`apps/web/src/features/caller-id/IncomingCallProvider.tsx`) — React context, root level mount. Socket.IO subscribe (yalnız primary station). Audio cue (ringtone mp3 `apps/web/public/sounds/ringtone.mp3`, kullanıcı ilk etkileşim sonrası autoplay unlock). Browser Notification API permission (opsiyonel).
- **`IncomingCallPopup`** — `<Dialog>` modal. State'ler:
  - **Bilinen müşteri:** isim + son sipariş tarihi + default adres + butonlar `Sipariş Aç` (POST /orders prefill `customerId` + `deliveryAddress`) | `Reddet`
  - **Bilinmeyen:** "Yeni müşteri ekle" CTA → `CustomerForm` modal prefill `phone`
  - **Kara liste:** `bg-red-600 text-white`, ikon `⚠️`, başlık "KARA LİSTE — `{reason}`", tek buton `Reddet` (sipariş açma butonu yok)
- **`CustomersPage`** (`/customers`) — MVP içi: liste (search input + tablo) + "Yeni Ekle" buton + satıra tıkla → detay. Pagination v5.1.
- **`CustomerDetailPage`** (`/customers/:id`) — bilgi kartı + adresler grid + son siparişler + blacklist toggle (admin only) + sil yok (KVKK silme talebi v5.1, manuel SQL şimdilik).
- **i18n keys (yeni):** `caller.incoming.title`, `caller.incoming.unknownCta`, `caller.blacklist.title`, `caller.blacklist.reject`, `customer.form.fullName`, `customer.form.phoneRequired`, `customer.list.search`, `customer.list.empty`, `customer.detail.blacklistToggle`, `customer.address.label`, `customer.address.default`, `customer.address.delete`, `customer.address.deliveryNote`. Türkçe glossary'ye ekle: "arayan numara", "müşteri", "kara liste", "teslimat notu".

#### Karar 8 — KVKK + Retention

- **Retention cron:** `apps/api/src/jobs/call-logs-retention.ts` — günde 1 kez (03:00 TR), `DELETE FROM call_logs WHERE received_at < NOW() - INTERVAL '30 days'`. node-cron (lightweight) — pg_cron extension Hetzner managed PG'de yok varsayımı. Job log'u `app_logs` (varsa) veya stdout.
- **Data inventory:** `docs/compliance/kvkk-data-inventory.md` (yeni, MVP içi minimum tablo) — customers (PII: ad+telefon+adres, retention: account-life), call_logs (PII: telefon, retention: 30 gün), customer_addresses (PII: adres, retention: account-life veya soft delete).
- **Minimization tartışması:** `raw_phone` saklamak gerekli mi? Karar: **EVET (30 gün)** — bridge bug'ı debug + maske bypass yanlış pozitif tespit için. 30 gün sonra silinir → kabul edilebilir.
- **Blacklist `blacklist_reason` zorunlu** (Karar 6 #5) — KVKK işleme amacı belgelemesi.
- **Silme talebi (KVKK madde 11):** v5.1 backlog (admin "müşteri sil" → cascade soft delete + call_logs anonymize).
- **Ham telefon log'lama yasağı (CLAUDE.md):** Application log'larına `console.log(rawPhone)` YASAK; sadece DB'ye yazılır.

#### Karar 9 — Test Stratejisi

- **Caller Bridge unit (.NET):** `ICallerIdDevice` mock (event simulator) → `IBridgeApiClient` HTTP recorder → end-to-end "ring → POST" smoke. Gerçek `cid.dll` integration testi manual (donanım gerektirir, CI'da çalışmaz).
- **Backend integration (Vitest + supertest):**
  - 10 endpoint happy path
  - Multi-tenant isolation (tenant A müşterisi tenant B'den görünmez)
  - RBAC matrix (waiter PATCH `is_blacklisted` → 403)
  - Bypass pattern: maskeli numara → 200 `{accepted:false}`, call_log YOK
  - UNIQUE constraint: aynı tenant'ta aynı normalized_phone 2. INSERT → 409
  - Telefon normalize 15+ format
- **Frontend (Vitest + RTL):** `CustomerForm` validation, `IncomingCallPopup` 3 state render, blacklist kırmızı bg snapshot.
- **E2E (Playwright):** Mock Socket.IO emit `caller:incoming` → popup görünür → "Yeni Müşteri Ekle" → kayıt → liste'de görünür.

#### Karar 10 — Migration ve PR Sırası

PR-8 mini-sprint sırası (önerilen):
1. **PR-8a:** Migration 027 + shared-types (customers, call-logs, bridge) + `phone.ts` helper + unit testleri
2. **PR-8b:** Backend — `POST /bridge/caller-id/incoming` + Socket.IO emit + bypass + 10 endpoint backend + integration test
3. **PR-8c:** Frontend — `IncomingCallProvider` + `IncomingCallPopup` + `CustomersPage` + `CustomerDetailPage` + i18n
4. **PR-8d:** `apps/caller-bridge/` — .NET 8 Worker Service + cid.dll wrapper + HTTP client + appsettings + Windows Service install script
5. **PR-8e:** Retention cron job + KVKK data inventory dokümanı

Her PR bağımsız mergeable; PR-8d donanım gerektirdiği için manuel kabul testi (kullanıcı restoranda).

### Alternatifler

- **A) v3 polling pattern (file-based bridge → DB poll):** ✗ Reddedildi. Push (Socket.IO, ADR-010) zaten mevcut altyapı; polling latency + DB yükü gereksiz.
- **B) Whozz Looker Ethernet caller-id (network appliance):** ✗ Reddedildi. Kullanıcı CIDShow donanımını zaten satın aldı; ek maliyet + mimari kompleksite gereksiz.
- **C) Twilio cloud caller-id (PSTN forward → cloud webhook):** ✗ Reddedildi. KVKK (yurtdışı veri transferi) + aylık maliyet (~$30/ay) + telefon hattı port riski.
- **D) Print Agent içinde node-ffi-napi ile cid.dll:** ✗ Reddedildi (Karar 1).
- **E) edge-js hibrit (Node ↔ .NET):** ✗ Reddedildi (Karar 1).
- **F) Tek toplu `/customers/full` GraphQL benzeri endpoint:** ✗ Reddedildi. ADR-001 REST convention; widget bağımsızlığı (ADR-015 paritesi).
- **G) `users.is_caller_id_receiver BOOLEAN`:** ✗ Reddedildi. Tenant-level karar (Karar 5), user-level değil.
- **H) call_logs sonsuz retention:** ✗ Reddedildi. KVKK minimization ihlali; 30 gün yeterli.
- **I) Maskeli numara için call_log YAZ ama popup gösterme:** ✗ Reddedildi. PII minimization → hiç yazma daha temiz.
- **J) Blacklist'i ayrı tablo (`blocked_phones`):** ✗ Reddedildi. Müşteri-level davranış (kişi kara listede, numara değil); customer.is_blacklisted yeterli.

### Sonuçlar

- (+) KVKK uyumlu (30 gün retention, minimization, bypass, blacklist gerekçe zorunlu)
- (+) Push tabanlı (ADR-010 ile uyumlu, latency düşük, DB yükü yok)
- (+) Primary station room → broadcast yok, gereksiz UI gürültüsü minimal
- (+) Maskeli numara bypass → platform spam'i temizlenir, gerçek müşteri trafiği görünür
- (+) Kara liste UI'da agresif (kırmızı bg) → kasiyer hata yapamaz
- (+) `customer_addresses.deleted_at` soft delete → geçmiş sipariş referans bütünlüğü korunur
- (+) `tenant_settings.caller_id_bypass_patterns TEXT[]` → yeni platform numaraları seed güncellemesiyle eklenir, kod deploy gerektirmez
- (−) **2. native servis (Caller Bridge .NET)** deployment + güncelleme yükü; v5.1'de WiX bundle ile Print Agent + Caller Bridge tek installer
- (−) **cid.dll Windows-only** → Linux dev makinede integration test edilemez; mock device + CI'da Windows runner
- (−) `raw_phone` 30 gün saklanması "minimal minimization" eleştirisine açık — kabul: debug için gerekli, kısa süre
- (−) Multi-station MVP'de yok → restoran 2. PC eklerse v5.1 bekler (kabul: kullanıcı tek-PC operasyonunu doğruladı)
- (−) Browser autoplay policy → ringtone ilk kullanıcı etkileşimi sonrası açılır; cold-start ilk çağrıda sessiz olabilir (workaround: login sonrası "test ses" buton)

### Referanslar

- ADR-001 (monorepo — `apps/caller-bridge/` yeni paket)
- ADR-002 §3 (multi-tenant tenant_id RLS — tüm yeni tablolar)
- ADR-003 §7 (snapshot invariant — orders.delivery_address snapshot)
- ADR-004 (Print Agent — bridge token pattern reuse, ayrı servis ayrımı)
- ADR-006 §5 (error taxonomy — generic 400/403/404/409 yeterli)
- ADR-010 §3 (Socket.IO room scoping — `tenant:{id}:caller-station`)
- ADR-014 (orders — `orders.customer_id` FK Migration 027)
- ADR-015 (dashboard — RBAC matrix paritesi)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\server\callerid\`, `client\src\components\callerid\`, `server\routes\customers.js`
- `docs/v3-reference/caller-id-and-customer.md` (davranış özeti)
- `docs/research/caller-id-pos-best-practices.md` (sektör pratikleri)
- CIDShow SDK: `/tmp/caller-id-sdk/cidshow_CSharp_x64_x86/` (C# referans örnekleri)
- Migration 027 (yeni) — `packages/db/migrations/027_caller_id_customers.sql`
- Yeni paketler: `apps/caller-bridge/` (.NET 8), `apps/web/src/features/caller-id/`, `apps/web/src/features/customers/`
- Yeni shared-types: `packages/shared-types/src/{customers,call-logs,bridge}.ts`
- Yeni shared-domain: `packages/shared-domain/src/phone.ts`
- KVKK: `docs/compliance/kvkk-data-inventory.md` (yeni)

#### §11 — Amendment 1 (2026-05-03 — Excel veri analizi + v3 phone normalize)

**Bağlam:** Kullanıcı v3 müşteri Excel listesini (1398 kayıt) sağladı. Analiz: telefon %74, mahalle %2, adres %9 doluluk. Bakiye/total_amount/discount kolonları Excel'de var ama v3 migration 0007 ile DROP edilmiş — v3 kendisi bu counter'ları kaldırmış.

**Karar 11.1 — Bakiye/cari hesap MVP dışı**
`customers.balance_cents` EKLENMEZ. Veresiye iş akışı v5.1 backlog. Excel'deki Bakiye kolonu import sırasında okunur ama yazılmaz (silently dropped).

**Karar 11.2 — total_amount_cents / total_discount_cents EKLENMEZ**
v3 migration 0007'de DROP edilmiş counter'lar; v5'te de eklenmiyor. Sadece `total_orders` + `last_order_at` denormalized. "Yaşam boyu ciro" ileride raporlar üzerinden hesaplanır (gerçek-zaman, denormalize edilmez).

**Karar 11.3 — Telefon normalize v3 paritesi**
`packages/shared-domain/src/phone.ts` (yeni) — `normalizePhoneTr(input): string`:
- 12 hane `905...` → `0` + slice(2)
- 11 hane `05...` → kalır
- 10 hane `5...` → `0` + input
- 13+ hane `90...` → 90 strip et + 5'le başlıyor + 10 hane → `0` + slice
- Sabit hat / kısa / yabancı (5-9 hane veya 5 ile başlamayan) → rakamlar aynen
- Boş/geçersiz → ""

`isTurkishMobile(input): boolean` — regex `^05\d{9}$`.

Test paritesi: 15+ farklı format input (Excel verisinden örnek alınmalı).

`customer_phones`:
- `raw_phone VARCHAR(30) NOT NULL` (girilen orijinal — debug/trace için)
- `normalized_phone VARCHAR(20) NOT NULL` (canonical)
- `is_mobile BOOLEAN GENERATED` (Postgres) veya app-side türet — `isTurkishMobile(normalized_phone)`
- `UNIQUE (tenant_id, normalized_phone)` — sabit hat + cep aynı normalize ise unique tutar (sabit hat normalize=rakam aynen olduğu için collision riski düşük; pratikte 7-9 hane vs 11 hane çakışmaz)

**Karar 11.4 — Müşteri formu zorunlu alanlar**
- ZORUNLU: full_name (min 2 char), en az 1 telefon (normalize sonrası boş değil)
- OPSİYONEL: notlar, adresler (0+), blacklist (admin only)
- Adres formu (opsiyonel; eklenirse zorunlu alanlar):
  - ZORUNLU: address_line (TEXT, min 5 char)
  - OPSİYONEL: title (default 'Ev'), district, neighborhood, address_note, is_default

**Karar 11.5 — V3 import scripti (yeni alt-PR 8f)**
`apps/api/scripts/import-v3-customers.ts` (yeni dosya):
- Excel okur (`xlsx` veya `exceljs` kütüphanesi — Node.js)
- Her satır:
  1. `full_name` boş veya `<2 char` → SKIP + log
  2. `Telefon` normalize → boş ise customer_phones EKLENMEZ ama customer kaydı yapılır (telefonsuz müşteri)
  3. `Adres` dolu ise customer_addresses INSERT (default true)
  4. `legacy_v3_no` (Excel'in `No` kolonu) → customers tablosuna yazılır, UNIQUE constraint ile idempotent
- Çakışma stratejisi: `INSERT ... ON CONFLICT (tenant_id, legacy_v3_no) DO NOTHING` (idempotent)
- Çıktı raporu: toplam, başarı, skip (sebepleriyle), telefonsuz, adressiz
- CLI: `pnpm --filter @restoran-pos/api exec tsx scripts/import-v3-customers.ts --tenant <uuid> --file <path.xlsx>`
- Parse hata toleransı: telefon float64 (Excel sayıya çevirmiş) → `String(value).split('.')[0]` ile fix

**Karar 11.6 — Migration 027 final şema**
4 yeni tablo (önceki Karar 2'deki şemaya ek):
- `customers.legacy_v3_no BIGINT NULLABLE UNIQUE (tenant_id, legacy_v3_no)` ← import için
- `customer_phones.raw_phone VARCHAR(30) NOT NULL` ← girilen orijinal
- `customer_phones.is_mobile BOOLEAN` (app-side türet veya generated column)
- `customer_addresses.is_deleted BOOLEAN DEFAULT false` ← soft delete (sipariş geçmişi için)

3 ALTER:
- `orders.customer_id UUID NULLABLE FK customers(id)` (CASCADE NULL on customer delete)
- `tenant_settings.caller_id_station_user_id UUID NULLABLE FK users(id)` (primary station)
- `tenant_settings.caller_id_bypass_patterns TEXT[] DEFAULT ARRAY['^0850\d+', '^0440\d+']` (Yemeksepeti/Getir/Trendyol seed)

**Karar 11.7 — 6 alt-PR sırası** (önceki 5'ten 6'ya çıktı):
- 8a: Migration 027 + phone normalize util + shared-types
- 8b: Backend (9 endpoint + RBAC + zod + bypass filter pipeline)
- 8c: Frontend (IncomingCallProvider + Popup + CustomersPage + CustomerDetail + i18n)
- 8d: .NET 8 Caller Bridge servisi (apps/caller-bridge/, cid.dll P/Invoke, HTTP POST + X-Bridge-Token)
- 8e: KVKK retention cron (`call_logs` 30 gün) + docs/compliance/kvkk-data-inventory.md
- 8f: V3 import scripti + 1398 kayıt verify (manuel test sonra)


---

## ADR-017 — Paket (Takeaway) Sipariş Akışı

- **Durum**: Accepted
- **Tarih**: 2026-05-04

### Bağlam

v3'te paket sipariş akışı, salon (dine_in) akışından **ayrı bir ekran** üzerinden yürür: Masalar üst-orta yeşil "Paket" butonu → "Paket Sipariş" sayfası (sol arama+kategori+ürün grid, sağ adisyon, alt "Kaydet") → müşteri zorunlu (modal) → ödeme tipi (nakit/kart) seçimi (modal) → sipariş kaydı + Masalar ekranına dönüş + sağ panelde "Paket siparişler" kartları (timer, status badge, "Teslimata Çıkarıldı"/"Teslim Edildi" butonları). v3 davranışı kullanıcı tarafından ekran görüntüleriyle teyit edildi; v3 koduna bakıldı (`D:\dev\restoran-pos-v3\server\services\orderService.js:354+` `createOrder`, `:817+` `updateTakeawayDelivery`, `:156+` `recordTakeawayDeliveryPaymentIfNeeded`).

<<<<<<< HEAD
v3'teki şema bilgileri:
- `orders.order_type IN ('dine_in','takeaway')`, `takeaway_out_at`, `takeaway_delivered_at`, `takeaway_planned_payment_type ('cash'|'card')`, `delivery_address`, `delivery_note` kolonları (`server/migrations/run.js:205, 217, 670–673`)
- Teslim anında `recordTakeawayDeliveryPaymentIfNeeded` çağrılıyor; planlanan ödeme tipi ile **`payments` satırı atomik insert** ediliyor (idempotency key: `takeaway-delivery:${orderId}`)
- `updateTakeawayDelivery` action ∈ {`out_for_delivery`, `delivered`}; ileri-dönüş yok, geri dönüş kuralları sıkı (delivered olduktan sonra out_for_delivery hata)
=======
| Endpoint | Eski | Yeni |
|---|---|---|
| `GET /reports/kpi/today-revenue` | `SUM(orders.total_cents)` WHERE `status != 'cancelled'` (open dahil) | WHERE `status = 'paid'` (Amendment v2: kullanıcı şikayeti — kısmi ödeme/açık masa ciroya girmesin) |
| `GET /reports/kpi/order-count` | `totalOrders = open + paid` | `totalOrders = paid` (semantik: "kapanmış sipariş sayısı"). `byStatus.{open, paid, cancelled}` breakdown korunur (forensic). |
| `GET /reports/kpi/average-bill` | `SUM(orders.total) / COUNT(*)` WHERE `status != 'cancelled'` | WHERE `status = 'paid'` (open hariç) |
| `GET /reports/closed-orders` | WHERE `status = 'paid'` ✅ | DEĞİŞMEZ ✅ |
| `GET /reports/recent-orders` | tüm status'ler | WHERE `status = 'paid'` (anasayfa "Son Siparişler" artık "Son Kapanan Siparişler") |
| `GET /reports/top-selling` | `oi.status != 'cancelled' AND o.status != 'cancelled'` (open dahil) | `o.status = 'paid'` AND `oi.status != 'cancelled'` (cancel'lanmış kalemler hariç tutulur) |
| `GET /reports/hourly-revenue` | payments-based, status filter YOK | payments JOIN orders + WHERE `o.status = 'paid'` (Amendment v2) |
| `GET /reports/payment-distribution` | payments-based, status filter YOK | payments JOIN orders + WHERE `o.status = 'paid'` (Amendment v2) |
>>>>>>> 7e4be00 (feat(reports): paid-only ciro endpoint'leri (Session 53c Amendment v2))

v5 mevcut durum (`packages/db/migrations/000_init.sql`):
- `order_type` ENUM **zaten** `('dine_in','takeaway','delivery')` içeriyor (sat 105) — yeni tip eklenmeyecek
- `order_status` ENUM `('open','sent_to_kitchen','served','paid','cancelled','partially_served','billed','void')` (000_init + 001_fix)
- `orders.customer_id` FK var (sat 251), `orders.table_id` NULL paket için (sat 250)
- `payments` + `payment_items` + idempotency (mig 022) + split (024) + tip (025) **zaten mevcut**
- `order_items` snapshot pattern + status enum (mig 020) hazır
- `orders` repo (`packages/db/src/repositories/orders.ts`) ve `payments` repo mevcut

Sipariş alma mini-sprint (PR-5/12) salon (dine_in) akışını sürüyor. Bu sprint **takeaway-only** subset'i kapatır; salon flow'u Phase 3'e bırakılır. ADR-013 (sipariş ekran mimarisi) ve ADR-014 (ödeme akışı) ortak prensiplerini takip eder.

### Karar

**1. Tip ve Status modeli (kod EN, UI TR i18n).**

Takeaway için iki ayrık eksen: `orders.status` (yaşam döngüsü) + yeni `orders.takeaway_stage` (teslimat alt-fazı).

- `status` (mevcut enum'dan):
  - `open` → yeni oluşturulduğunda
  - `paid` → teslim anında otomatik (planlanan ödeme tipi ile payment row insert)
  - `cancelled` → iptal (audit)
  - `void` → tam comp (bu sprint kapsam dışı; Phase 3)
- `takeaway_stage` ENUM (yeni): `('preparing','out_for_delivery','delivered')`
  - UI label: "HAZIRLANIYOR" / "TESLİMATA ÇIKARILDI" / "TESLİM EDİLDİ" (i18n keys `takeaway.stage.*`)
  - Geçiş matrisi (yalnız ileri):
    - `preparing` → `out_for_delivery` ✓
    - `preparing` → `delivered` ✓ (kuryesiz direkt teslim)
    - `out_for_delivery` → `delivered` ✓
    - Diğer tüm geçişler → 409 `state_transition_invalid`
  - `delivered` set edildiğinde aynı transaction içinde:
    - `orders.status = 'paid'`
    - `payments` row insert (idempotency_key=`takeaway:${orderId}`, type=planned_payment_method, scope='full', amount=order.total_cents)
    - `payment_items` tüm order_items ile bağlanır (mevcut split-payment kontratıyla uyum)

**Gerekçe:** v3'teki `takeaway_out_at`/`takeaway_delivered_at` timestamp ikilisi yerine açık enum kullanılıyor — sorgulanabilirlik (filter `WHERE takeaway_stage='out_for_delivery'`) ve tip güvencesi. Timestamp'ler audit kaydından zaten elde edilebilir.

**2. Migration 028 (`028_orders_takeaway_stage.sql`).**

```sql
CREATE TYPE takeaway_stage AS ENUM ('preparing','out_for_delivery','delivered');

ALTER TABLE orders
  ADD COLUMN takeaway_stage takeaway_stage,
  ADD COLUMN planned_payment_type payment_type,
  ADD COLUMN delivery_address_snapshot TEXT,
  ADD COLUMN delivery_note TEXT;

-- CHECK: takeaway tipindeki siparişlerde stage zorunlu, dine_in'de NULL
ALTER TABLE orders ADD CONSTRAINT orders_takeaway_stage_check
  CHECK (
    (order_type = 'takeaway' AND takeaway_stage IS NOT NULL AND planned_payment_type IS NOT NULL)
    OR (order_type <> 'takeaway' AND takeaway_stage IS NULL AND planned_payment_type IS NULL)
  );

-- Takeaway için customer_id zorunlu (delivery için de geçerli, ileride)
ALTER TABLE orders ADD CONSTRAINT orders_takeaway_customer_required
  CHECK (order_type <> 'takeaway' OR customer_id IS NOT NULL);

CREATE INDEX idx_orders_takeaway_open
  ON orders (tenant_id, takeaway_stage, created_at DESC)
  WHERE order_type = 'takeaway' AND status NOT IN ('paid','cancelled','void');
```

**3. Endpoint'ler.**

`POST /orders` (takeaway path bu sprintte aktif; dine_in 400/501 değil — Phase 3'e kadar zod ayrımıyla discriminated union):

```ts
// shared-types/src/orders.ts
const CreateTakeawayOrderInput = z.object({
  type: z.literal('takeaway'),
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
    note: z.string().max(200).optional(),
  })).min(1).max(50),
  plannedPaymentType: z.enum(['cash','card']),
  deliveryAddressSnapshot: z.string().max(500).optional(),
  deliveryNote: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});
```

Validation hataları:
- `customerId` eksik → 400 `customer_required` (UI'de modal tetikler)
- `plannedPaymentType` eksik → 400 `payment_method_required`
- `items.length === 0` → 400 `items_required`
- Multi-tenant: tüm `productId` ve `customerId` aynı tenant doğrulaması (`tenant_id` filter ile JOIN)

Server tarafı (`apps/api/src/routes/orders.ts`):
- Tek transaction:
  1. `products` JOIN → `unit_price_cents`, `product_name`, `category_name` snapshot al (mevcut shared-domain `calculateOrderTotal` ile total hesapla)
  2. `orders` insert (`order_type='takeaway'`, `status='open'`, `takeaway_stage='preparing'`, `customer_id`, `planned_payment_type`, snapshots)
  3. `order_items` batch insert (snapshot kolonları doldur)
  4. `audit.append('order.created', { orderId, type:'takeaway', customerId, totalCents })`
  5. Socket.IO emit `order:created` namespace tenant
- Response: `{ id, orderNo, status:'open', takeawayStage:'preparing', totalCents, items, customer }`

`GET /orders?type=takeaway&status=open` — Masalar sağ paneli için açık paket listesi. Filter: `order_type='takeaway' AND status NOT IN ('paid','cancelled','void')`. Response sırası: `created_at DESC`. Pagination cursor-based (mevcut pattern, limit 100). Customer adı + telefon ek alanlarda (left join).

`PATCH /orders/:id/takeaway-stage` — body `{ stage: 'out_for_delivery'|'delivered' }`:
- Transition validation (yukarıdaki matris)
- `delivered` ise transaction içinde payment + payment_items + status='paid'
- Idempotency: aynı stage tekrar set → 200 no-op (response identical)
- Audit: `order.takeaway_stage_changed { from, to }`, `delivered`'da ek `order.paid { paymentId, type, amountCents }`
- Socket.IO emit `order:status_changed`

`POST /orders/:id/cancel` — sadece `takeaway_stage='preparing'` iken izinli; `out_for_delivery` ve sonrası → 409. `status='cancelled'`, audit `order.cancelled { reason }`. (v3'te paket iptali nadirdi; safety-first: sadece henüz çıkmamış.)

**4. Audit allowedKeys whitelist eklenecekler.**

`order.created`, `order.takeaway_stage_changed`, `order.paid` (existing), `order.cancelled` (existing). Payload sabit shape, PII (telefon/adres) audit'e yazılmaz — sadece `customerId` ve `addressSnapshotHash`.

**5. Customer denormalize.**

`orders.customer_id` FK zaten var. Adres KVKK uyumlu snapshot:
- `delivery_address_snapshot TEXT` — sipariş anındaki adresin **string snapshot**'ı (`customer.addresses[0]` formatlı)
- Müşteri sonradan adres değişirse veya silerse, sipariş satırı korunur
- Snapshot zorunlu **değil** (gel-al paket olabilir); NULL ise UI "Müşteri kendi alacak" gösterir
- Audit'e snapshot **yazılmaz** (yalnız hash); KVKK retention DSAR sırasında order tarafından değil customer tarafından silinmez (yasal saklama)

**6. Frontend (apps/web).**

Yeni route: `/takeaway/new` (tek ekran, full-screen). v3 piksel paritesi hedefi — v3 ekran görüntüsü temel referans, Tailwind class'larıyla **sıfırdan** yazılır (kopya-yapıştır yok).

Komponentler (yeni):
- `apps/web/src/features/takeaway/pages/NewTakeawayPage.tsx` — root layout
- `apps/web/src/features/takeaway/components/ProductCatalog.tsx` — sol panel (arama input + kategori tab + ürün grid card). Mevcut `apps/web/src/features/orders/components/*` (sipariş alma sprint'inden) ortak ise re-use; ayrımı net olmalı (takeaway'a özel davranış: gramaj/varyant minimal).
- `apps/web/src/features/takeaway/components/AdisyonPanel.tsx` — sağ panel (item list + qty − / + / sil + ara toplam + toplam + mor "Kaydet")
- `apps/web/src/features/takeaway/components/CustomerPickerModal.tsx` — müşteri eksikse zorunlu modal (mevcut `customers` arama API'sini reuse: `GET /customers?q=`)
- `apps/web/src/features/takeaway/components/PaymentMethodModal.tsx` — nakit / kredi kartı iki büyük kart + Vazgeç
- `apps/web/src/features/takeaway/components/OpenTakeawayOrdersPanel.tsx` — Masalar sağ paneline mount edilir
- `apps/web/src/features/takeaway/components/TakeawayOrderCard.tsx` — timer (live tick `Math.floor((now-createdAt)/1000)`), status badge, action butonları
- `apps/web/src/features/tables/components/TakeawayQuickButton.tsx` — Masalar üst yeşil "Paket" butonu

State management:
- Sepet (cart): `useReducer` (mevcut sipariş alma sprint'inden pattern); Zustand kullanılmıyor (proje kararı)
- Server state: TanStack Query (`useTakeawayOrders`, `useCreateTakeawayOrder`, `useUpdateTakeawayStage`)
- Socket.IO subscribe: `OpenTakeawayOrdersPanel` mount'ta `order:created` ve `order:status_changed` event'lerinde `queryClient.invalidateQueries(['orders','takeaway','open'])`

i18n: `apps/web/src/i18n/tr.json` `takeaway.*` namespace:
- `takeaway.title`, `takeaway.subtotal`, `takeaway.total`, `takeaway.save`, `takeaway.customerRequired.toast`, `takeaway.customerRequired.modalTitle`, `takeaway.searchCustomer`, `takeaway.newCustomer`, `takeaway.paymentTitle`, `takeaway.paymentSubtitle`, `takeaway.paymentCash`, `takeaway.paymentCard`, `takeaway.cancel`, `takeaway.savedToast`, `takeaway.openOrdersTitle`, `takeaway.stage.preparing` ("HAZIRLANIYOR"), `takeaway.stage.outForDelivery` ("TESLİMATA ÇIKARILDI"), `takeaway.stage.delivered` ("TESLİM EDİLDİ"), `takeaway.action.outForDelivery` ("Teslimata Çıkarıldı"), `takeaway.action.delivered` ("Teslim Edildi")

**7. shared-types ve shared-domain.**

`packages/shared-types/src/orders.ts`:
- `CreateTakeawayOrderInput` zod schema (yukarıda)
- `UpdateTakeawayStageInput` zod schema
- `TakeawayStage` type union

`packages/shared-domain/src/order-totals.ts`:
- Mevcut `calculateOrderTotal(items)` fonksiyonu reuse edilir
- KDV mevcut tax module ile (kategori bazlı; bu sprintte değişiklik yok)

### Alternatifler

- **A: Tek `status` enum'una stage değerleri eklemek (`preparing`,`out_for_delivery`,`delivered`).**
  - Artıları: tek enum.
  - Eksileri: `paid` ve `delivered` aynı anda doğru olamıyor; status semantiği bulanıklaşıyor; salon ile takeaway durum graph'ı karışıyor.
  - Reddedildi: yaşam-döngüsü ile teslimat-fazı ortogonal eksenler — ayrı tutmak daha temiz.

- **B: v3'teki gibi `takeaway_out_at` + `takeaway_delivered_at` timestamp kolonları.**
  - Artıları: v3 paritesi.
  - Eksileri: state implicit (üç farklı NULL kombinasyonu); query karmaşık; tip güvencesi yok.
  - Reddedildi: explicit enum daha sürdürülebilir; timestamp'ler audit'ten elde edilebilir.

- **C: Ödeme ayrı endpoint (`POST /orders/:id/payments`) — order create ödemeden bağımsız.**
  - Artıları: salon flow ile simetri (ADR-014 split payment endpoint'i var).
  - Eksileri: v3 davranışı "delivered olduğunda otomatik payment" — kullanıcı için tek tıkla bitmesi kritik; ayrı endpoint eklenirse UI iki ardışık call yapmak zorunda, hata yönetimi karmaşıklaşır.
  - Reddedildi (kısmen): order CREATE'de payment oluşmaz (planned_payment_type kaydedilir); ama `delivered` PATCH'inde server tarafı atomik insert eder. Mevcut `POST /orders/:id/payments` endpoint'i salon flow'u için açık kalır.

- **D: Salon ve takeaway tek `POST /orders` endpoint'inde discriminated union (zod) yerine ayrı endpoint (`POST /takeaway-orders`).**
  - Artıları: route ayrımı net.
  - Eksileri: gelecekteki delivery / dine_in için aynı pattern üç route'a çıkar.
  - Reddedildi: discriminated union daha sürdürülebilir; OpenAPI/zod'da otomatik validation.

- **E: Modifier/options sipariş anında zorunlu.**
  - Reddedildi: bu sprint kapsam dışı — `note` alanı yeterli MVP'de.

### Sonuçlar

- (+) v3 paritesi davranış olarak sağlanır; piksel paritesi UI ekran görüntüleriyle hedeflendi.
- (+) Atomik teslim+ödeme (tek transaction) — kasiyer tek tıkla bitirir.
- (+) Multi-tenant izolasyon DB CHECK + repo filter ile garantili.
- (+) KVKK: adres snapshot, audit'te PII yok.
- (+) Mevcut payments + audit + Socket.IO altyapısı reuse edildi (ADR-010, ADR-014).
- (−) `orders` tablosuna 4 yeni kolon + 2 CHECK eklendi — paket-spesifik şişme; ileride normalize edilebilir (`takeaway_orders_meta` tablosu) ama bu sprintte gereksiz.
- (−) Salon flow'u henüz hazır değil; aynı `POST /orders` route'unu Phase 3'te genişletmek gerekecek (zod union'u büyür).
- (−) Frontend'de `OpenTakeawayOrdersPanel` Masalar sayfasına entegre olur — mevcut `TablesListPage` layout'una bir yan panel daha eklemek gerekir.

### Out of Scope (v5.1 backlog)

- Modifiers / options / variants seçim akışı (sipariş alma sprint'inde Phase 3)
- İndirim / ikram (comp) takeaway'da
- Adres düzenleme sipariş içinde (snapshot değişmez; yeni sipariş gerekir)
- Print agent integration (fiş + mutfak fişi basımı — ayrı PR)
- Çoklu paket sipariş tek müşteriye batch (basitçe ayrı kayıtlar; UI batch yok)
- Salon (dine_in) akışı — Phase 3
- Delivery (kuryeli, takeaway'dan farklı) — Phase 3+
- Takeaway için hazırlama süresi tahmini (timer dışı)
- Müşteri "telefonda söylediği toplam" / pre-auth tutarsızlık akışı

### Test stratejisi

Backend integration (Vitest + supertest), `apps/api/src/routes/__tests__/orders.takeaway.test.ts`:
1. POST happy path → 201, audit row, socket emit
2. POST `customerId` eksik → 400 `customer_required`
3. POST `plannedPaymentType` eksik → 400 `payment_method_required`
4. POST farklı tenant'ın `productId`'si → 404 (tenant isolation)
5. PATCH stage `preparing→out_for_delivery` → 200
6. PATCH stage `preparing→delivered` (skip out_for_delivery) → 200, payment + payment_items + status='paid' transaction'da
7. PATCH stage `delivered→preparing` → 409 `state_transition_invalid`
8. PATCH stage idempotent (aynı stage tekrar) → 200 no-op
9. POST cancel `out_for_delivery` aşamasında → 409
10. GET takeaway open list → tenant filter + status filter doğru

Frontend (Vitest + RTL):
- Cart reducer (add, remove, qty change, clear)
- CustomerPickerModal "müşteri seçilmeden Kaydet" → toast + modal aç
- PaymentMethodModal flow → useCreateTakeawayOrder.mutate

E2E (Playwright, sonraki sprint): tam akış Masalar → Paket → ürün ekle → müşteri seç → ödeme → Masalar dönüş.

### Implementer teslim listesi (file-level)

**Backend:**
- `packages/db/migrations/028_orders_takeaway_stage.sql` (yeni)
- `packages/db/src/generated.ts` (regen)
- `packages/db/src/repositories/orders.ts` (createTakeaway, updateStage, listOpenTakeaway methodları)
- `packages/shared-types/src/orders.ts` (CreateTakeawayOrderInput, UpdateTakeawayStageInput, TakeawayStage)
- `apps/api/src/routes/orders.ts` (POST takeaway path, PATCH /:id/takeaway-stage, GET filter, POST /:id/cancel guard)
- `apps/api/src/services/audit.ts` allowedKeys whitelist ekleme
- `apps/api/src/realtime/orders.ts` socket emit (varsa pattern reuse)
- `apps/api/src/routes/__tests__/orders.takeaway.test.ts`

**Frontend:**
- `apps/web/src/features/takeaway/pages/NewTakeawayPage.tsx`
- `apps/web/src/features/takeaway/components/{ProductCatalog,AdisyonPanel,CustomerPickerModal,PaymentMethodModal,OpenTakeawayOrdersPanel,TakeawayOrderCard}.tsx`
- `apps/web/src/features/takeaway/hooks/{useTakeawayCart,useCreateTakeawayOrder,useUpdateTakeawayStage,useOpenTakeawayOrders}.ts`
- `apps/web/src/features/tables/components/TakeawayQuickButton.tsx`
- `apps/web/src/features/tables/pages/TablesListPage.tsx` (yan panel mount)
- `apps/web/src/i18n/tr.json` `takeaway.*` keys
- `apps/web/src/router.tsx` `/takeaway/new` route
- Vitest spec'leri reducer + modal için


## ADR-018 — Sipariş Ekranı Birleştirme (OrderPage Unification, dine_in + takeaway)

- **Durum**: Accepted
- **Tarih**: 2026-05-04
- **İlgili**: ADR-013 (Phase 2 dine_in OrderScreen), ADR-017 (Takeaway flow)

### Bağlam

v5'te sipariş alma iki ayrı sayfaya bölünmüş durumda:

- `apps/web/src/features/orders/OrderScreenPage.tsx` (455 satır) — dine_in tam özellikli (persisted+pending kalemler, AdisyonPanel, edit/void/save/payment), ADR-013 kapsamı.
- `apps/web/src/features/orders/TakeawayOrderPage.tsx` (303 satır) — takeaway basit (müşteri picker + ödeme modal + status state machine), ADR-017 kapsamı.

İki sayfa arasında kategori tab + arama + ürün grid + sepet (qty +/−, sil, subtotal/total, save) görsel ve davranış olarak büyük oranda aynı; sadece çevresel akış farklı (masa header vs müşteri picker, persisted order load vs yok, edit/void modal vs payment method modal).

v3 referansı: `D:\dev\restoran-pos-v3\client\src\components\orders\OrderScreen.jsx` (1758 satır) **tek dosya, tek bileşen** olarak `orderType` prop'uyla iki akışı yönetir. 24 yerde `orderType === 'takeaway'` / `=== 'dine_in'` branching mevcut (ör. L129 existing order delivery_address load, L140-155 customer effect, L259 customer required guard, L287 planned payment field, L331/L367 cancel-redirect, L435 takeaway arama gate, L474/L486/L508 save akışı). v3 davranışı kullanıcı tarafından "tek ekran" olarak biliniyor; v5'te iki sayfa olması kullanıcı zihnindeki modeli bozuyor ve bakım borcu yaratıyor (iki sepet hook'u, iki ürün grid'i, iki kategori tab'ı).

Kapsam kilidi: ADR-013 dine_in özellikleri **regresyonsuz korunur**, ADR-017 takeaway akışı **birebir aynı**, kullanıcıya görünen davranış değişmez. Yalnız iç organizasyon değişir.

### Karar

**1. Tek orchestration page + paylaşılan alt-component'ler.**

Yeni `apps/web/src/features/orders/OrderPage.tsx` tek orchestrator olarak yazılır. URL query parametresi `orderType`'ı belirler:

- `/orders/new?type=takeaway` → `orderType = 'takeaway'`
- `/orders/new?tableId=<uuid>` → `orderType = 'dine_in'`
- Geriye dönük: `/tables/:tableId/order` → 301 redirect to `/orders/new?tableId=:tableId` (route alias, eski linkler kırılmaz).

OrderPage state ownership:
- Sepet state (items, qty, notes) — OrderPage local; shared CartPanel'a prop drill.
- Müşteri state — OrderPage local, sadece `orderType==='takeaway'` iken anlamlı; dine_in'de daima null.
- Persisted order load (open order fetch + pending items merge) — OrderPage `useEffect`, sadece `orderType==='dine_in' && tableId` iken tetiklenir.
- Modal state'leri (CustomerPickerModal, PaymentMethodModal, EditItemModal, VoidModal) — OrderPage local; `orderType`-conditional render.

**2. Yeni dosya yapısı.**

```
apps/web/src/features/orders/
├── OrderPage.tsx                        (yeni, orchestrator)
├── api.ts                               (mevcut, genişletilir — dine_in + takeaway endpoints)
├── useOrderCart.ts                      (yeni, useTakeawayCart genişletilmiş orderType-aware)
├── components/
│   ├── shared/
│   │   ├── ProductCatalogSection.tsx    (kategori tab + arama + ürün grid)
│   │   ├── CartPanel.tsx                (TakeawayCartPanel + dine_in AdisyonPanel birleşim)
│   │   └── OrderScreenHeader.tsx        (back arrow + title + customer/table info conditional)
│   ├── takeaway/
│   │   ├── CustomerPickerModal.tsx      (mevcut, taşınır)
│   │   └── PaymentMethodModal.tsx       (mevcut, taşınır)
│   ├── dine-in/
│   │   ├── EditItemModal.tsx            (OrderScreenPage'den çıkarılır)
│   │   └── VoidModal.tsx                (mevcut varsa taşınır)
│   └── panels/
│       ├── OpenTakeawayOrdersPanel.tsx  (mevcut, taşınır)
│       └── TakeawayOrderCard.tsx        (mevcut, taşınır)
└── (eski OrderScreenPage.tsx + TakeawayOrderPage.tsx silinir)
```

**3. Shared CartPanel kontratı.**

CartPanel orderType-agnostic olur; davranış prop'lar üzerinden enjekte edilir:

```ts
interface CartPanelProps {
  items: CartItem[];                          // pending items
  persistedItems?: PersistedOrderItem[];      // sadece dine_in
  onQtyChange(itemId: string, qty: number): void;
  onRemove(itemId: string): void;
  onEditPersisted?(item: PersistedOrderItem): void;  // dine_in only
  onVoidPersisted?(item: PersistedOrderItem): void;  // dine_in only
  onSave(): void;
  saveLabel: string;                          // 'Mutfağa Gönder' | 'Kaydet'
  totals: { subtotalCents: number; totalCents: number };
}
```

dine_in'de `persistedItems` + `onEditPersisted/onVoidPersisted` dolu; takeaway'de `undefined`. CartPanel internal'da conditional render yapar (persistedItems varsa "Adisyon" başlığı + edit/void aksiyonları, yoksa düz sepet).

**4. ProductCatalogSection kontratı.**

Tamamen orderType-agnostic; aynı arama + kategori + grid davranışı. Tek fark: takeaway'de v3'teki `q.length < 2` arama gate (L435) **MVP'de uygulanmaz** — dine_in ile birebir aynı UX, MVP sadelik için. Bu davranış sapması kullanıcı görünür değil (her iki akışta tüm kategori grid mevcut).

**5. Geriye dönük uyumluluk + regresyon kontrolü.**

- ADR-013 tanımlı dine_in özellikleri **KORUNUR**: persisted+pending kalemler, AdisyonPanel görsel hiyerarşisi, save+payment butonları, edit/void modalları, kategori tab davranışı, masa header.
- ADR-017 takeaway akışı **AYNEN**: müşteri picker zorunlu, ödeme tipi modal, status state machine (preparing→out_for_delivery→delivered).
- Kullanıcıya görünen davranış birebir aynı; sadece dosya organizasyonu değişir.
- Smoke test (manuel): dine_in masaya sipariş gönderme + takeaway müşteri+ödeme akışı, her ikisi de Phase 2/Phase 1 işlevini sürdürmeli.

### Alternatifler

**A) Kozmetik rename only** — iki dosyayı `OrderPageDineIn.tsx` ve `OrderPageTakeaway.tsx` olarak yeniden adlandırmak.
- (−) Gerçek unification yok, kod duplikasyonu sürer (kategori tab, ürün grid, sepet hook'u iki kere).
- (−) Kullanıcının zihinsel modeli (tek ekran) ile kod modeli (iki ekran) ayrışmaya devam eder.
- **Reddedildi.**

**B) Tek dosya 1700+ satır v3 paritesi** — v3'teki gibi tek `OrderPage.tsx` içinde tüm state + tüm branching.
- (−) Bakım borcu: 24 conditional branch tek bileşende, test edilmesi zor.
- (−) v5 zaten React 18 + hooks; v3 class component biçimi bizim için anti-pattern.
- (−) HCI checklist gate (component < 300 satır hedefi) ihlal edilir.
- **Reddedildi.**

**C) Shared sub-component + tek orchestration page** — yukarıdaki karar.
- (+) State ownership tek yerde (OrderPage), shared component'ler stateless/dump.
- (+) ProductCatalogSection ve CartPanel başka akışlarda (ileride masa transfer, split bill) reuse edilebilir.
- (+) Her shared component < 200 satır → HCI + test kolaylığı.
- (+) URL kontratı tek noktadan (`/orders/new?...`) → router temizliği.
- (−) Implementer için 5 adımlı sıralı iş; ara state'te (Phase 2'de) iki page bir arada yaşamak mümkün değil — tek atomic PR önerilir.
- **Seçilen.**

### Sonuçlar

- (+) Kullanıcı zihin modeli ile kod modeli hizalanır (tek "Sipariş Ekranı" konsepti).
- (+) Ortak iyileştirmeler (örn. ürün grid sanal scroll, sepet animasyonu) tek yerde.
- (+) Phase 3'te delivery (`order_type='delivery'`) eklenince üçüncü branch küçük: aynı OrderPage + delivery-specific modal/header.
- (+) Test yüzeyi azalır: ProductCatalogSection + CartPanel için RTL unit; OrderPage için integration smoke.
- (−) Geçiş PR'ı atomic ve büyük (yeni 6-7 dosya + 2 silme + router değişimi). Tek session'da bitirilmeli, ara state instabil.
- (−) Eski dosya yollarına dış referans varsa (bookmark, log, doc) güncellenmeli.

### Implementer teslim listesi (file-level, sıralı)

**Faz 1 — Shared component'leri çıkar:**
1. `apps/web/src/features/orders/components/shared/ProductCatalogSection.tsx` (yeni; dine_in'in kategori+arama+grid bloğu + takeaway'in aynı bloğu birleşim).
2. `apps/web/src/features/orders/components/shared/CartPanel.tsx` (yeni; TakeawayCartPanel + OrderScreenPage AdisyonPanel birleşim, persistedItems opsiyonel).
3. `apps/web/src/features/orders/components/shared/OrderScreenHeader.tsx` (yeni; back arrow + title + table/customer info conditional).
4. `apps/web/src/features/orders/useOrderCart.ts` (yeni; useTakeawayCart genelleştirme — persistedItems desteği).

**Faz 2 — Modal'ları taşı:**
5. `apps/web/src/features/orders/components/takeaway/CustomerPickerModal.tsx` (mevcut path'ten taşı).
6. `apps/web/src/features/orders/components/takeaway/PaymentMethodModal.tsx` (mevcut path'ten taşı).
7. `apps/web/src/features/orders/components/dine-in/EditItemModal.tsx` (OrderScreenPage'den çıkar, ADR-013 davranışı korunur).
8. `apps/web/src/features/orders/components/dine-in/VoidModal.tsx` (mevcut varsa taşı).
9. `apps/web/src/features/orders/components/panels/{OpenTakeawayOrdersPanel,TakeawayOrderCard}.tsx` (mevcut path'ten taşı).

**Faz 3 — Orchestrator yaz:**
10. `apps/web/src/features/orders/OrderPage.tsx` (yeni; URL parse → orderType → conditional state + render).

**Faz 4 — Routing:**
11. `apps/web/src/router.tsx` — `/orders/new` route OrderPage'e bağla; `/tables/:tableId/order` 301 redirect ekle.

**Faz 5 — Eski dosyaları sil:**
12. `apps/web/src/features/orders/OrderScreenPage.tsx` (sil).
13. `apps/web/src/features/orders/TakeawayOrderPage.tsx` (sil).

**Faz 6 — Test + smoke:**
14. Mevcut OrderScreenPage testleri varsa OrderPage'e port (regresyon kontrolü).
15. ProductCatalogSection + CartPanel için RTL unit test (kalem ekle/sil, kategori filtre, arama).
16. Manuel smoke: dine_in (masa→sipariş→mutfağa gönder) + takeaway (müşteri→ödeme→masalar dönüş) — her iki akış birebir aynı çalışmalı.

### Out of scope (v5.1+)

- Dine_in'e müşteri ekleme (v3'te de yok).
- Takeaway'e masa atama.
- Modifiers / options / comp UI (Phase 3+).
- Delivery (`order_type='delivery'`) — şema hazır, UI Phase 3'te eklenecek (aynı OrderPage'e üçüncü branch olarak).


## ADR-019 — E2E Smoke Suite Stratejisi (Sprint 9)

- **Durum**: Accepted (2026-05-08)
- **Tarih**: 2026-05-08
- **İlgili**: ADR-001 §6.1 (postgres test container), ADR-011 (Web UI), test-strategy.md, ADR-002 (Auth)

### Bağlam

Sprint 9 Playwright E2E smoke suite'i devreye alacak. Mevcut docs şunları **kararlaştırmamış**:

1. **Smoke kapsam tanımı**: test-strategy.md sat. 86-92 "PR'da smoke / nightly full" diyor ama smoke'un neyi kapsadığı yazılı değil. Sprint 9 görev 38 beş senaryo öneriyor (login, masa CRUD, menü CRUD, kullanıcı soft-delete, KDV update) — bu liste ADR ile lock'lanmazsa scope creep riski var.
2. **DB infrastructure reuse**: ADR-001 §6.1 amendment integration test için postgres:17 service container tanımlar; E2E aynı container'ı reuse mu eder, ayrı mı çalışır belirsiz. İki ayrı container CI süresini artırır + drift riski.
3. **Seed/fixture stratejisi**: E2E senaryoları "bilinen" admin user, bilinen tenant_id, baseline menü gerektirir. Migration seed'i mi, test öncesi setup script'i mi, yoksa programmatic API call'mu kullanılacak — karar yok.
4. **Auth fixture (storageState)**: Her test login UI'dan mı geçecek (yavaş, kırılgan), yoksa global setup'ta token/storageState önceden mi yaratılacak?
5. **CI job topolojisi**: PR-time smoke (bloklayıcı) vs nightly full suite (rapor); browser matrix (sadece Chromium MVP mı, üçü mü); paralelizm.
6. **Baseline screenshot policy**: test-strategy.md `toHaveScreenshot` zikretmiş ama hangi ekranların baseline'a alınacağı, OS-spesifik diff toleransı, baseline güncelleme policy'si yok.
7. **Klasör konvansiyonu**: `apps/web/e2e/` mı `apps/web/tests/e2e/` mi; spec naming; helper paylaşımı.

### Karar

**1. Smoke suite kapsamı kilidi (5 senaryo, MVP):**
- S1: Login → dashboard render
- S2: Admin masa oluştur → düzenle → sil
- S3: Menü editörü kategori + ürün + variant CRUD
- S4: Admin kullanıcı oluştur → **hard delete** → login fail (ADR-009 amendment 2026-05-05 hard delete pattern)
- S5: İşletme ayarları **timezone** güncelle

**S2/S4/S5 amendment (2026-05-08, scope-aligned)**:
- S2 orijinal "Admin masa oluştur → düzenle → sil" → UI bireysel masa CRUD sunmuyor (v3 paritesi mimari kararı: `DiningAreasPage` bölge altında "Hedef masa sayısı + Uygula" sync mekanizması). Senaryo eşdeğer CRUD smoke'a uyarlandı: **bölge oluştur → masa sync (N adet) → bölge adı düzenle → bölge sil**. Ana niyet (CRUD smoke + admin yetki + persistence) korunur. Bireysel masa CRUD Sprint 10+'a borç (UI veya API genişlemesi).
- S4 orijinal "soft delete" → ADR-009 hard-delete amendment (2026-05-05) ile uyumlu olarak `hard delete` (Migration 018 users hard delete).
- S5 orijinal "KDV güncelle" → KDV alanı **v5.1 backlog**, Sprint 6 settings endpoint sadece `timezone` ve (Migration 026 ile DROP'tan önce) `business_day_cutoff_hour` taşıyordu. PATCH /settings'de mevcut tek alan `timezone` (apps/api/src/routes/settings.ts:124). Senaryo onun üzerinde test edilir.

**Sprint 9 / 9b ayrımı amendment (2026-05-08, ikinci amendment)**:

PR #108 CI 4. koşumunda S2-S5 senaryolarının 9/9 testi locator timeout ile fail oldu (`getByRole(/Yeni|Ekle/)`, `#tenant-name`, `expect.toBeDisabled` self-delete). Sebep: qa-engineer subagent S2-S5 spec'lerini lokal UI keşfi olmadan, sadece dosya isimlerinden çıkarsayarak yazdı; gerçek UI element id/role'leri farklı. **S1 (login UI) tüm 4 CI koşumunda PASS** — Vite preview SPA fallback + preview proxy + auth flow + storageState altyapısı doğrulandı.

Bu nedenle Sprint 9 ikiye bölündü:
- **Sprint 9 (PR #108)**: Görev 37 altyapısı + S1 senaryosu. Phase 2 exit kriteri için yeterli (5/5 senaryo gerekmez; smoke suite altyapısı + 1 yeşil senaryo + CI workflow bloklayıcı).
- **Sprint 9b (yeni PR, qa-engineer lokal UI keşfi sonrası)**: S2-S5 senaryolarını gerçek DOM'a göre yeniden yaz. Lokal `pos_e2e` DB kurulumu + Playwright UI mode + Inspector ile locator çıkarma şart. ADR-019 §1 5-senaryo lock'u Sprint 9b kapanışında tamamlanır.

S2-S5 spec dosyaları PR #108'den silindi (commit `XXXXXXX`); ham senaryo metinleri ADR-019 §1'de kayıtlı, Sprint 9b implementer brief'inde referans olarak kullanılır.

**Phase 2 exit kriterine etkisi**: Sprint 9 5/5 yeşil koşulu **Sprint 9b'ye taşındı**. Phase 2 mührü Sprint 9b kapanışında atılır. Sprint 9 (PR #108) altyapı + S1 ile geçici olarak Phase 2'nin "E2E framework hazır + 1 senaryo yeşil" alt-kriterini karşılar.

Yeni senaryo eklemesi → ADR amendment + Sprint planında satır.

**2. DB infrastructure**: `apps/api`'yi E2E için ayrı bir test instance olarak `127.0.0.1:4001`'de ayağa kaldırılır; **ADR-001 §6.1'deki aynı postgres:17 service container reuse edilir** (yeni job DB ayağa kaldırmaz). Migration `migrate up` + E2E seed script suite başında bir kez çalışır.

**3. Seed stratejisi**: `apps/web/e2e/fixtures/seed.ts` doğrudan `kysely` (veya `pg`) ile DB'ye yazar — **HTTP endpoint kullanılmaz**. Test runner zaten Node.js process; production'a test-only endpoint sızma riski sıfır (KVKK + güvenlik). Migration seed de kullanılmaz (prod migration'a test data sızmasın). Her suite başlangıcında deterministic state: ilgili tabloları truncate + seed (admin user + cashier user + 1 tenant + minimum kategori/ürün).

**3.1 Lokal vs CI DB ayrımı (Amendment 2026-05-08)**: Lokal koşumda **ayrı DB zorunlu**: `pos_e2e` (default). `pos_dev`'e truncate çalıştırmak geliştiricinin dev verisini siler — kabul edilemez risk. `seed.ts` guard: `process.env.CI !== 'true'` + DB ismi `pos_dev`/`pos_main` ise fail-fast. CI'de postgres service container ephemeral (her job'da yeniden başlar); `pos_dev` ismi reuse edilir, sorun yok. İlk lokal kurulum: `createdb pos_e2e` + `DATABASE_URL=...pos_e2e pnpm --filter @restoran-pos/db migrate` (talimat `apps/web/e2e/README.md`).

**4. Auth fixture**: Playwright `globalSetup` + `storageState.json`. Tek admin user + bir cashier user pre-login; her test storageState'i import eder. Login akışı sadece S1'de UI'dan test edilir.

**5. CI topolojisi**:
- **PR-time**: Sadece smoke suite (5 senaryo), **Chromium-only** (MVP), ~2-3 dk hedef. Bloklayıcı.
- **Nightly**: Full suite (genişledikçe), Chromium + WebKit. Rapor-only başta. Sprint 10+ devreye alınır.
- **Browser matrix**: WebKit/Firefox **Sprint 10+**'a ertelendi (5 senaryo × 3 browser CI süresini 3× uzatır; restoran web UI Chromium-tabanlı kullanılır).
- **Parallel worker**: **1** başlangıçta (smoke seri çalışır; senaryolar shared DB state — S2 masa CRUD, S4 user CRUD race condition riski). Gerçek CI ölçümü 3 dk üzerine çıkarsa, per-worker tenant isolation tasarımıyla 2'ye çıkarma değerlendirilir (Sprint 10+).

**6. Baseline screenshot**: MVP'de visual regression **devre dışı**. Sprint 9 sadece behavioral assertion (text/role/click). `toHaveScreenshot` Sprint 10+'a ertelenir (cross-OS rendering çakışması nedeniyle erken etkinleştirme flaky risk).

**7. Klasör**: `apps/web/e2e/` (Playwright config + tests + fixtures + helpers); `apps/web/playwright.config.ts` root'ta.

### Alternatifler

- (A) **Visual regression Sprint 9'da etkinleştir** → reddedildi: cross-OS pixel diff drift erken aşamada flaky test fabrikası yaratır; baseline güncelleme policy'si yok.
- (B) **Her test login UI'dan geçsin** → reddedildi: 5 senaryo × ~2 sn login = ~10 sn ölü süre, kırılganlık.
- (C) **Ayrı E2E postgres container** → reddedildi: §6.1 reuse daha az drift + daha hızlı CI.
- (D) **Migration seed** → reddedildi: prod schema_migrations'a test data sızması KVKK riski.

### Sonuçlar

- (+) Smoke kapsam kilidi: scope creep önlenir.
- (+) §6.1 reuse: CI hızı + drift azalır.
- (+) StorageState: test süresi düşer, login flake'i izole.
- (+) Visual regression ertelemesi: Sprint 9 stable çıkar.
- (+) Kysely direct seed: HTTP roundtrip yok, prod endpoint sızma riski sıfır, Sprint 9 önkoşulu yok (hemen başlanabilir).
- (+) Worker 1 başlangıç: shared DB state race condition önlenir; ölçüm sonrası ölçeklendirilir.
- (−) S1 dışındaki senaryolar UI login akışını test etmez (S1 yeterli kabulü).
- (−) Visual regression ertelemesi: UI regresyon sadece manuel smoke + component test ile kabul edilir.
- (−) Worker 1: ileride senaryo sayısı artarsa CI süresi lineer büyür; Sprint 10+ tenant isolation refactor borcu.

### Çözülmüş sorular (2026-05-08, ilhan onayı)

1. **Test-seed endpoint**: Mevcut DEĞİL ve **eklenmeyecek**. `apps/web/e2e/fixtures/seed.ts` doğrudan kysely ile DB'ye yazar.
2. **Browser matrix**: Chromium-only MVP. WebKit/Firefox Sprint 10+ değerlendirilir.
3. **Parallel worker**: 1 başlangıç. Sprint 10+ ölçüm sonrası tenant isolation tasarımıyla 2'ye çıkarma değerlendirilir.

### Cross-ref

- ADR-001 §6.1 (postgres service container)
- ADR-002 (auth — storageState için JWT yapısı)
- ADR-011 (Web UI — test'lerin assert ettiği DOM yapısı)
- test-strategy.md (genel piramit + flaky policy)


## ADR-020 — KDS UI + Kitchen Routing (Phase 3 Sprint 12)

- **Durum**: Accepted (2026-05-08)
- **Tarih**: 2026-05-08
- **İlgili**: ADR-014 §8 (mutfak ticket auto print), ADR-008 §4.2 (kitchen ABAC rezerv), ADR-010 §4.2 (per-role room), ADR-011 (Web UI), Migration 020 (`order_items.status` enum), charter Phase 3
- **Kapsam kilidi**: KDS UI + minimum routing. Multi-station, sound, ürün-bazlı kategorizasyon, color theming v5.1 backlog'a düşer.

### §1 — Bağlam

Phase 2 KAPANDI (Session 54, 333/333 PASS). Charter Phase 3 kapsamı: **KDS + POST /payments**. Bu ADR yalnız KDS UI + kitchen routing'i kilitler; ödeme akışı ayrı ADR'dir (ADR-014 zaten ödeme tarafını detaylar; Phase 3'te yalnız UI hattı kalmıştır).

Mevcut backend hazırlığı:
- **Migration 020**: `order_items.status` enum (`new | sent | preparing | ready | served | cancelled`) DEFAULT `'new'`. `'sent'/'preparing'/'ready'/'served'` Phase 3 için rezervli (Migration 020 başlığında belgeli).
- **ADR-014 §8**: Kaydet anında `print_jobs (job_type='kitchen_ticket')` kuyruklanıyor — fiziksel mutfak yazıcısı yolu hazır. KDS dijital ekran bu yolla **paralel** çalışır (yedeklilik), birbirini iptal etmez.
- **ADR-008 §4.2**: "kitchen-routed items only" ABAC kuralı bu sprint'te (Phase 3 Sprint 1) tanımlanır — rezerv kapanır.
- **ADR-010 §4.2**: `tenant:${id}:role:kitchen` room hazır; `orderItems.statusChanged` event ismi pattern'i belirlendi.
- **ADR-011**: Web UI design tokens, v3 paritesi.

UI eksik: `/kds` route + sipariş kart grid + status butonları + realtime auto-refresh. Bu ADR onu kilitler.

### §2 — Kararlar

**K1 — Single kitchen station MVP.** Tek kuyruk, tek ekran. `order_items.station` kolonu açılmaz. Multi-station (ızgara/pide/içecek) v5.1 backlog. Tek mutfak istasyonlu hedef restoran (kendi restoranım) için yeterli.

**K2 — Routing kuralı: kategori `kitchen_print=true` filtresi.** ADR-014 §8 ile birebir hizalı — KDS, mutfak ticket'ı tetikleyen aynı kalemleri gösterir. İçecek/sıcak içecek (kitchen_print=false) KDS'e düşmez (bar/kasa hattı). `dine_in` ve `takeaway` aynı kuyrukta görünür; takeaway'de visual cue (ikon/etiket) ile ayırt edilir, kuyruk ayrılmaz.

**K3 — Status workflow (item-level).** `new → sent → preparing → ready → served → cancelled`. `sent`: order Kaydet anında otomatik; `preparing/ready`: KDS aksiyonu; `served`: cashier/waiter aksiyonu (KDS'in dışında, masa ekranı/garson app); `cancelled`: per-item void (mevcut PR-5 akışı).

**K4 — UI route + sayfa.** `/kds` (Türkçe yol: `/mutfak` reddedildi — kasiyer/admin'in URL'i hatırlaması için kısa İngilizce yol; UI metni Türkçe). Tek sayfa, full-screen, tablet-first 1280×800 hedef. `App.tsx` route eklenir, sidebar'da "Mutfak" link `kitchen/admin` rolünde görünür.

**K5 — Layout: kart grid + FIFO.** Sipariş bütünü (order) bazlı kart, kart içinde kalemler listesi. Sıralama: `created_at ASC` (ilk gelen sola/üste). Öncelik (rush, VIP) MVP dışı. Grid 3-4 kolon (ekran genişliğine göre auto-flow). Kart üstünde masa/paket etiketi + bekleme süresi (mm:ss). Kart aksiyonları: kalem-bazlı **"Hazırlanıyor"** (sent→preparing) ve **"Hazır"** (preparing→ready); kart-bazlı toplu aksiyon yok MVP'de.

**K6 — Realtime: ADR-010 §4.2 mevcut kanalı.** `tenant:${id}:role:kitchen` room dinlenir. Yeni event'ler: `kitchen.orderSent` (tüm `sent` kalemler dahil order payload), `kitchen.itemStatusChanged` (item-level). Reconnect → `GET /kds/orders` REST refetch (ADR-010 §5.2 pattern).

**K7 — ABAC role: `kitchen` + `admin`.** ADR-008 §4.2 rezervi açılır. Kitchen rolü yalnız `/kds` görür (sipariş alma ekranlarına 403). Admin geliştirme + denetim için dahil. Cashier/waiter okumayabilir — KDS işyükü onlar için noise. Yeni `kds.read` + `kds.itemStatusUpdate` permission'ları `permissions.ts`'e eklenir.

**K8 — HCI prensipleri.** Rush-hour usability ana hedef. Buton min 64×64 px (Fitts), kart içinde 2 büyük buton (Hick: çok seçenek yok). Dokunmatik öncelik (eldivenli el dahil), hover state'i optional. Renk-bağımsız status (ikon + metin) — daltonik dostu. Bekleme süresi 5dk üstü kart kenarına soft uyarı (ADR-011 design tokens'tan `--warn` rengi). HCI checklist gate `pos-checklist.md`.

**K9 — Visual cues: minimum.** Status geçiş animasyonu (250ms fade), bekleme süresi (mm:ss) live counter, takeaway/dine_in ikon. Color theming (kategori bazlı renk, masa kart rengi) v5.1 backlog. Kart border `--neutral` → `--warn` (>5dk) → `--danger` (>10dk) — sadece bekleme süresi sinyali.

**K10 — Sound notification: MVP DIŞI.** Yeni sipariş bip sesi v5.1 backlog. Gerekçe: tarayıcı autoplay policy (user gesture şart), iOS sessize alma davranışı, restoran ortamında zaten yüksek arka plan gürültüsü → güvenilir UX değil. Görsel uyarı (kart girişi animasyonu + bekleme süresi) yeterli MVP'de.

**K11 — Item-level state, order-level görsel.** Status değişimi item bazlı (K3). UI kart order-level toplama gösterir ("3/5 hazır" gibi mini-progress). Tüm kalemler `ready` olunca kart "Hazır kuyruk"a görsel olarak ayrılır (CSS class değişimi, ayrı sayfa değil). Bu, ADR-014 §9 paritesi: order kalemlerin sum'ı, business invariant level.

**K12 — API endpoint'leri (yeni).**
- `GET /kds/orders` — aktif (status `sent`/`preparing`/`ready`) order'ları döner; nested kalemler ile. Pagination yok (aktif kuyruk sınırlı, FIFO bütün).
- `PATCH /orders/:orderId/items/:itemId/status` — body: `{ status: 'preparing'|'ready' }`. Idempotent (aynı status → 200 no-op). Audit: `event_type='order_item.status_changed'`. Realtime: `kitchen.itemStatusChanged` emit. ABAC: `kitchen` + `admin` only.
- POST /orders Kaydet handler (mevcut) → kitchen_print=true kalemler için item.status = `'sent'` set eder + `kitchen.orderSent` emit. Bu davranış yeni; ADR-014 §8 print_jobs ile paralel çalışır.

### §3 — Reddedilen alternatifler

- **Multi-station kitchen routing**: `order_items.station` kolonu + per-station ekran. Hedef restoranda tek mutfak; v5.1'de 2-3 işletme eklendiğinde yeniden değerlendirilir. Şimdi açmak: migration + UI complexity + scope creep.
- **Ürün bazlı kitchen tag (`product.kitchen_category`)**: K2'de kategori-level `kitchen_print` zaten var. Ürün granülerliği MVP'de gerek yok.
- **Paralel kuyruk (dine_in vs takeaway ayrı sayfa)**: Aynı mutfak hattında pratikte birlikte hazırlanır; K2 visual cue yeterli.
- **Order-level toplu "Hazır" butonu (kart-bazlı)**: Kalem-bazlı doğru kayıt için (kısmi servis senaryosu). MVP'de fazla buton karmaşıklığı yaratır; toplu aksiyon v5.1.

### §4 — Sonuçlar

- (+) v3 KDS pratiğine yakın iş akışı (item-level transition); rush-hour'da güvenli.
- (+) Mevcut altyapı reuse: ADR-010 room hazır, Migration 020 enum hazır, kitchen_print kategori filtresi hazır.
- (+) Print Agent + KDS paralel = yedeklilik (ekran arızası → yazıcı, yazıcı arızası → ekran).
- (+) Single-station kapsam kilidi: 1-2 hafta sprint hedefi gerçekçi.
- (−) Kitchen rolü yeni permission setine ihtiyaç duyar (`kds.read`, `kds.itemStatusUpdate`); migration yok ama `permissions.ts` + test güncellenir.
- (−) Sound notification eksikliği bazı senaryolarda dikkat kaybı yaratabilir (kabul edilen trade-off, K10).
- (−) `'served'` durumu KDS dışında set edilir (cashier/waiter app); bu ADR onu kilitlemez, Phase 4 mobile veya masa ekranı amendment.

### §5 — Çözülmüş sorular (2026-05-08, ilhan onayı)

1. **K2 routing — takeaway aynı kuyrukta**: ✅ Tek kuyruk + visual cue (paket ikonu/etiketi). Mutfak hattı pratikte birleşik; ayrı kuyruk ekstra UI iş yaratır. Filtre toggle v5.1.
2. **K7 ABAC — kitchen-only**: ✅ Sadece kitchen rolü `/kds`'e erişir. Admin için ayrı ekran/raporlar zaten var; KDS operasyonel ekran. Admin "denetim modu" v5.1.
3. **K10 sound — v5.1 backlog**: ✅ MVP'de ses yok. Tarayıcı autoplay policy + iOS sessize alma + restoran arka plan gürültüsü → güvenilir UX değil. Görsel uyarı (kart girişi animasyonu + bekleme süresi border) yeter.
4. **K9 bekleme eşikleri — sabit 5dk/10dk**: ✅ Tüm sipariş tipleri için aynı eşik. Kategori bazlı süre (pide 15dk vs içecek 2dk) v5.1 backlog (her kategoriye `prep_time_seconds` kolonu + UI ayar gerekir).
5. **K12 endpoint adı — `/kds/orders` + `/orders/.../items/.../status`**: ✅ KDS spesifik aggregation endpoint `/kds/orders` (UI namespace, role-bağımsız okuma); item status update `/orders/:orderId/items/:itemId/status` domain-level (cashier/waiter de "served" işaretleyebilir, role-spesifik değil). `/kitchen/...` reddedildi: role-bazlı isimlendirme item endpoint için yanıltıcı (cashier de yazar).

### §6 — Cross-ref

- ADR-014 §8 (mutfak ticket print — paralel hat)
- ADR-008 §4.2 (kitchen ABAC rezerv kapanır)
- ADR-010 §4.2 (per-role room), §5.2 (reconnect refetch pattern), §6 (error envelope)
- ADR-011 (Web UI design tokens, v3 paritesi)
- Migration 020 (`order_items.status` enum)
- charter Phase 3 (KDS + POST /payments)
- `docs/hci/pos-checklist.md` (rush-hour gate)
- v3 READ-ONLY: `D:\dev\restoran-pos-v3\client\src\components\kitchen\` (varsa) — davranış notu, kod kopyalama yasak


