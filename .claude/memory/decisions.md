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

**Deploy checklist maddesi** ~~(`docs/engineering/deploy-checklist.md`'ye eklenecek)~~ *(ADR-031 K3 ile kapandı: deploy-checklist.md hiç yazılmadı; madde `docs/ops/deploy.md` §6'ya taşındı ve prod'da doğrulandı — Session 81)*:
- [x] `psql -c "SELECT has_table_privilege('migrator', 'pgmigrations', 'DELETE');"` → `f` döner.

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

> **ADR-031 K3 pilot sapması (Session 81, 2026-07-04):** `rotate-migrator.yml` hiç implemente edilmedi ve bu tasarım GitHub Actions→prod PG bağlantısı varsayar — pilot topolojisinde (tek box, PG yalnız localhost, manuel SSH deploy) uygulanamaz. Pilotta rotasyon **sunucu-taraflı manuel runbook adımına** indirildi (`docs/ops/deploy.md` §7: `ALTER ROLE migrator PASSWORD` + `/root/pos-secrets.env` güncelle). Bu bölümün otomasyon tasarımı CI/CD ile birlikte (v5.1) geçerliliğini korur.

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

#### §2.1 — Amendment (2026-06-28) — Mobil body-refresh implementasyonu (ADR-025 K6 ön-koşulu)

**Bağlam:** Yukarıda tasarlanan `req.cookies.refresh_token ?? req.body.refresh_token` ikili-okuma **karara bağlıydı ama implement edilmemişti**: `/auth/login` refresh'i yalnız HttpOnly cookie'de dönüyordu (body'de yok), `/auth/refresh` ise cookie-only okuyordu. React Native cookie-jar tutmadığından mobil garson app (ADR-025) refresh'i alamıyordu. ADR-025 K6 bu amendment'ı ön-koşul olarak işaretledi. Bu amendment §2 tasarımını **uygular**; tasarımı değiştirmez.

**Karar:**

1. **`POST /auth/login` — body-return gate (header-based):** İstek `X-Client: mobile` header'ı taşırsa response body'ye `refreshToken` (plain) eklenir → `{ accessToken, expiresIn, user, refreshToken }`. Header yoksa (web) body'de refresh **yer almaz** — mevcut davranış birebir korunur. `setRefreshCookie` her iki akışta da çağrılır (web kullanır, mobil yok sayar). Header-gate login'de **yeterlidir**: login email+şifre ister; saldırgan kimlik bilgisi olmadan login olamaz.

2. **`POST /auth/refresh` — token-source gate (KRİTİK güvenlik):** Token kaynağı `cookie ?? body` (cookie öncelikli). `X-Refresh-Request: 1` zorunluluğu **korunur** (mobil de gönderir; yoksa 403). Yeni rotated refresh-token'ı response body'de döndürme koşulu **token'ın BODY'den gelmesidir** (`isBodySourced = !cookieTok && !!bodyTok`), `X-Client` header'ı **DEĞİL**:
   - **body-kaynaklı (mobil):** `{ accessToken, expiresIn, refreshToken: <yeniRotatedPlain> }`; cookie SET EDİLMEZ.
   - **cookie-kaynaklı (web):** `setRefreshCookie(res, yeniRefresh)` + body `{ accessToken, expiresIn }` (refresh body'de YOK — mevcut davranış).

3. **Neden token-source, header değil (XSS HttpOnly-bypass önlemi):** Eğer body-return yalnız `X-Client: mobile` header'ına bağlansaydı, tarayıcıdaki XSS HttpOnly cookie'yi `credentials:include` ile otomatik göndertip `X-Client: mobile` header'ı ekleyerek yeni refresh'i JSON yanıtından okuyabilir → HttpOnly korumasını **delerdi**. Token-source gate bunu kapatır: cookie-kaynaklı refresh **ASLA** body'de dönmez; saldırgan body token'ı sağlayamaz (HttpOnly cookie'yi JS okuyamaz).

4. **Değişmeyenler:** Web cookie-only HttpOnly + SameSite=Strict davranışı aynı. `rotateRefreshToken` (RTR + reuse detection) **transport-agnostiktir, dokunulmadı** — reuse detection body-yolunda da çalışır (aynı mobil refresh token 2. kez → family revoke → 401, test ile kanıtlı). Para/DB şeması dokunulmadı. Hata kodları (`AUTH_REFRESH_INVALID` 401, `AUTH_CSRF_CHECK_FAILED` 403) değişmedi.

5. **shared-types drift kapanışı (cerrahi):** `LoginResponseSchema`'ya `expiresIn` (route zaten dönüyordu, şemada eksikti) + `refreshToken?` eklendi; yeni `RefreshResponseSchema` (`{ accessToken, expiresIn, refreshToken? }`) tanımlandı; `RefreshRequestSchema` (`{ refreshToken? }`) route'ta `validateBody` ile tüketildi.

**Cross-ref:** ADR-025 K6, `apps/api/src/routes/auth.ts` (login + refresh handler), `apps/api/src/auth/cookie.ts` (değişmedi), `packages/shared-types/src/auth.ts`, `apps/api/src/__tests__/auth.test.ts` (+9 test). PIN giriş + cihaz fingerprint = v5.1 (ADR-025 K6). İş Kalemi 2b (ABAC/orders) **bu PR kapsamı dışı**.

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

### §Phase 3 PR-1 — Scope Kilidi (Session 62, 2026-05-13)

Phase 3'ün ilk PR'ı (branch: `feat/print-agent-phase3-pr1`). Bu alt bölüm ADR-004 ana §1-§8 kararlarını DEĞİŞTİRMEZ — yalnız PR-1'in dosya kapsamını, mock auth kontratını ve enum drift sinyalini kayda alır.

**Yaratılan/değişen dosyalar (whitelist):**
- `apps/print-agent/` — Node 22 + TS strict skeleton; `package.json` + `tsconfig.json` + `src/index.ts` (long-poll loop iskeleti). Windows servisi paketlemesi (nssm/MSI) **YOK** — dev mode `npm run dev` (tsx watch) tek hedef.
- `packages/shared-types/print-agent.ts` — 4 endpoint zod schema (`GET /print/v1/jobs/next`, `POST /print/v1/jobs/:id/result`, `POST /print/v1/agent/register`, `POST /print/v1/agent/refresh`). **Sadece schema**, route handler değil.
- `apps/api/src/routes/print/jobs.ts` (yeni) + route mount — **yalnız** `GET /print/v1/jobs/next?wait=N` implementasyonu.
- Integration test: `apps/api/test/print/jobs-next.test.ts` — DB'ye 1 `queued` job INSERT, endpoint GET, `printing` status atomik geçiş assert.

**4 endpoint kapsam:** Schema 4'ü için (`GET jobs/next`, `POST jobs/:id/result`, `POST agent/register`, `POST agent/refresh`); implementasyon **yalnız 1'i** (`GET /print/v1/jobs/next?wait=N`, ADR §6 Soru #6). Diğer 3 endpoint route handler'ı sonraki PR'lara bırakılır.

**Mock auth kontratı (Phase 4+ migration'a kadar geçici):**
- Header: `X-Tenant-Id: <uuid>` (zorunlu). Eksik/geçersizse 401 `AGENT_AUTH_REQUIRED`.
- Gerçek `agents` tablosu + JWT akışı **DOKUNULMAZ** — ADR §6 Phase 4+ kararı (Agent JWT 1h access + refresh 30d, `agents.revoked_at`, `POST /agent/register` device fingerprint) sabit kalır.
- Test fixture seed: tenant_id `00000000-0000-0000-0000-000000000001` (mevcut test-utils default).

**`print_job_status` enum drift kararı (RISKLI KARAR — kullanıcı onayı gerek):**
- **Mevcut DB enum (000_init.sql:108):** `'queued','printing','success','failed','cancelled','retry'` — esas alınır.
- **ADR-004 §3'teki terminoloji:** `pending/printed/dead_letter` — drift'li, üstüne yazılmaz.
- **PR-1 kararı:** Mevcut enum aynen kullanılır; ADR §3 terminolojisi sonraki bir amendment'ta revize edilir (bu PR'da değil).
- **Forward-ref:** `cancelled`/`retry` state'lerinin lifecycle'ı (ne zaman set edilir, kim set eder) Phase 4+ ADR amendment ile netleşir.

**State transition kuralı (PR-1 dar kapsam):**
- **Bu PR'da yalnız:** `queued → printing` (atomik `UPDATE ... SET status='printing' WHERE id = (SELECT id FROM print_jobs WHERE tenant_id=$1 AND status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ...`).
- **Sonraki PR (job result endpoint):** `printing → success/failed`.
- **Backlog:** `failed → retry`, `* → cancelled` lifecycle.

**64 KB payload sınırı:**
- Bu PR **read-side** (GET jobs/next). Validation YOK — okur ve döner.
- Insert-side CHECK constraint (`octet_length(payload::text) <= 65536`) Phase 2 backend'inde `print_jobs` INSERT eden yerlerde eklenecek (ADR-003 §13 ek-borç, ADR §4 cross-ref).

**Phase 4+ DEFERRED kalemler (PR-1 kapsamı DIŞINDA, dokunulmaz):**
- Gerçek auth: `POST /agent/register`, `POST /agent/refresh`, `agents` tablosu, JWT secret rotasyonu, device fingerprint.
- Printer transport: USB/TCP ESC/POS, node-thermal-printer entegrasyonu, CP857 encode pipeline.
- MSI installer + nssm Windows servisi paketlemesi.
- Cloud render: mutfak fişi template (handlebars/eta), thermal width math.
- v5.1 backlog: müşteri fişi, secondary printer routing, X/Z raporları, multi-Agent, adaptive polling.

<!-- ADR-004 Accepted (Session 25, 2026-04-25) — architect sub-agent; Phase 2 başı gate; HTTP long-polling 5sn + MSI/nssm + cloud render + CP857 + 1:1 Agent-printer + JWT 1h/refresh 30d + 64 KB payload + semver /print/v1/ + 6ay deprecation; v5.1 backlog: müşteri fişi + secondary printer routing; Phase 5+ backlog: X/Z + multi-Agent + adaptive polling; v3 StoreBridge kod taşıma yasağı korundu -->
<!-- ADR-004 §Phase 3 PR-1 scope kilidi (Session 62, 2026-05-13) — architect sub-agent; branch feat/print-agent-phase3-pr1; apps/print-agent skeleton + shared-types/print-agent.ts schema + GET /print/v1/jobs/next implementasyonu; mock auth X-Tenant-Id header; print_job_status enum drift (mevcut 6-state esas, ADR §3 terminoloji revize sonraki amendment); state transition yalnız queued→printing FOR UPDATE SKIP LOCKED; 64 KB read-side validation YOK; gerçek auth + printer transport + MSI Phase 4+ deferred -->

### §Amendment 1 — §3 State Machine Revize + `attempts` Kolonu (Phase 3 PR-2, Session 63, 2026-05-13)

Bu amendment ADR-004 ana §1-§8 kararlarını DEĞİŞTİRMEZ. §3 paragrafının orijinal metnine DOKUNULMAZ — yalnız §3'e delta (revize + ek) olarak okunur. Tetikleyici: PR-1'de tespit edilen enum drift (kullanıcı onayı X, mevcut DB enum esas). Bu PR'ın hedefi: `POST /print/v1/jobs/:id/result` endpoint'i + `print_jobs.attempts` kolonu (Migration 036).

**§3 State Machine — DB enum diline revize:**

```
queued → printing → success                                          (mutlu yol; terminal)
                 → failed (transient hata) → retry (attempts < 3)    (transient state)
                                          → cancelled (attempts ≥ 3) (dead-letter; terminal)
queued → cancelled  (manuel iptal, admin UI Phase 4+)                (terminal)
```

**Terminoloji eşleme (eski ADR §3 → DB enum):**
- `printed` → `success` (terminal, mutlu yol)
- `dead_letter` → `cancelled` (terminal, ≥3 deneme aşıldı VEYA manuel iptal)
- `pending` → `queued` (start state, agent poll bekliyor)
- Yeni state'ler: `retry` (transient transition), `cancelled` (dead-letter + manuel iptal birleşik)

**State semantiği:**
- `queued`: Agent poll'lemek için bekliyor. Start state.
- `printing`: Agent bir kez aldı, sonuç bekliyor. Transient.
- `success`: Terminal. Agent başarılı dönüş POST'ladı. `attempts` son hâlde donar (audit için korunur).
- `failed`: **Transient kapı** — backend bu state'i hiçbir zaman kalıcı bırakmaz; result POST handler içinde `attempts++` sonrası ATOMİK olarak `retry` (attempts < 3) veya `cancelled` (attempts ≥ 3) yapılır.
- `retry`: Transient. Backoff penceresi (60sn, ADR §3 sabit) sonrası cron task `retry → queued` transition'ı yapar. Cron Phase 4+.
- `cancelled`: Terminal. Hem dead-letter (≥3 deneme) hem manuel iptal (admin UI, Phase 4+) için ortak.

**Server-driven transition kuralı:** Tüm state geçişleri backend'de atomik UPDATE. Agent yalnız sonuç bildirir (`success` veya `failed`), `retry`/`cancelled` kararını backend verir.

**`print_jobs.attempts` kolonu (Migration 036 sözleşmesi):**
- **Tip:** `INT NOT NULL DEFAULT 0`
- **Constraint:** `CHECK (attempts >= 0 AND attempts <= 100)` — sonsuz retry'a karşı savunma (operasyonel sanity bound).
- **Davranış:**
  - `queued → printing`: DEĞİŞMEZ (sayıcı denemenin başında değil sonunda artar; agent crash durumunda sahte sayım önlenir)
  - `printing → failed` POST'u: `attempts = attempts + 1` ATOMİK; sonra karar — `attempts < 3` ise `retry`, `attempts ≥ 3` ise `cancelled`
  - `printing → success` POST'u: DEĞİŞMEZ (audit için son hâl korunur)
  - `retry → queued` (cron, Phase 4+): DEĞİŞMEZ
- **Migration 036 forward-ref:** `db-migration-guard` agent'ı ayrı pass'te SQL yazar. Bu PR'da yalnız sözleşme kayıt altında.

**`POST /print/v1/jobs/:id/result` kontrat:**
- **Auth:** PR-1 ile aynı mock (`X-Tenant-Id` header zorunlu). Gerçek JWT + `agents` tablosu PR-3.
- **Body (zod):** `{ status: 'success' | 'failed', errorText?: string }`. `errorText` opsiyonel, max 500 char (DB constraint Phase 4+).
- **200 + `{ job: PrintJob }`:** Geçiş yapıldı; güncel `attempts` ve nihai `status` (success / retry / cancelled) döner.
- **200 idempotent no-op:** Aynı `jobId` + aynı terminal `status` (`success` veya `cancelled`) ikinci kez POST'lanırsa 200 + güncel hâli döndürülür; state DEĞİŞMEZ; `attempts` artmaz. Agent retry'ları için savunma.
- **400 `PRINT_JOB_NOT_IN_PRINTING_STATE`:** `jobId` mevcut, tenant eşleşiyor, ama status `printing` değil (ve idempotent no-op koşulunu karşılamıyor).
- **404 `PRINT_JOB_NOT_FOUND`:** `jobId` yok veya farklı tenant'a ait (tenant izolasyonu 404 ile maskelenir, info leak yok).
- **Atomik transition:** `UPDATE print_jobs SET status=$NEW, attempts=$CALC, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='printing' RETURNING *`. 0 row → idempotent no-op check (ayrı SELECT) → değilse 400/404.

**Bu PR'da NE YOK (deferred):**
- Agent skeleton'a result POST integration (PR-3'e ertelendi — şu an agent yalnız jobs/next çekiyor)
- `retry → queued` backoff cron task (Phase 4+)
- Audit log entry'leri (ADR-003 §13 `print_jobs.status_history` forward-ref) — Phase 4+
- Gerçek JWT auth, `agents` tablosu, refresh akışı (PR-3)
- Manuel iptal endpoint'i `POST /print/v1/jobs/:id/cancel` (admin UI ile, Phase 4+)
- `errorText` DB constraint (max length CHECK) — Phase 4+
- 64 KB payload validation (read-side PR'larda yok; insert-side CHECK constraint ayrı borç)

**Cross-ref:**
- ADR-003 §13 (`print_jobs.status_history` audit) — bu amendment state isimleriyle uyumlu (`success`, `cancelled`).
- ADR-003 §14.8 (`print_jobs` partial index `WHERE status IN ('queued','printing','retry')`) — `retry` state'i pending olarak sayılıyor, doğru.
- ADR-006 (error taxonomy) — yeni iki kod (`PRINT_JOB_NOT_IN_PRINTING_STATE`, `PRINT_JOB_NOT_FOUND`) Phase 4 Sprint 1 rezerv listesine eklenir.

<!-- ADR-004 §Amendment 1 (Session 63, 2026-05-13) — architect sub-agent; PR-2 (feat/print-agent-phase3-pr2); §3 state machine DB enum diline revize (printed→success, dead_letter→cancelled, retry+cancelled state semantik tanım); print_jobs.attempts INT NOT NULL DEFAULT 0 + CHECK 0-100 (Migration 036 sözleşme, SQL db-migration-guard ayrı pass); POST /jobs/:id/result kontrat (200/400 PRINT_JOB_NOT_IN_PRINTING_STATE/404 PRINT_JOB_NOT_FOUND + idempotent no-op aynı terminal status); agent integration + backoff cron + audit + JWT auth + manuel cancel Phase 4+ deferred -->

### §Amendment 2 — Auth Backbone (Phase 3 PR-3a, Session 62, 2026-05-13)

Bu amendment ADR-004 ana §1-§8 kararlarını DEĞİŞTİRMEZ — yalnız §6 (Soru #6 yanıtı) ve §4 (auth flow) için implementasyon detayını kilitler. Tetikleyici: PR-1+PR-2 mock auth (`X-Tenant-Id` header) borcunu kapatma; PR-3 ikiye bölündü (kullanıcı onayı, B seçeneği) → **PR-3a auth backbone**, **PR-3b agent integration ayrı PR**. Branch: `feat/print-agent-phase3-pr3a`. Migration 037 SQL ayrı `db-migration-guard` pass'inde yazılır.

**1. `agents` tablosu tam şema (Migration 037 sözleşmesi):**

```
agents (
  id                  UUID PRIMARY KEY                    -- UUIDv7 (yeni satır insert sırasında)
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  device_fingerprint  TEXT NOT NULL                       -- Agent ilk boot: hostname + MAC hash
  api_key_hash        TEXT NOT NULL                       -- bcrypt cost 12
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  last_seen_at        TIMESTAMPTZ                         -- nullable; refresh+polling güncellenir
  revoked_at          TIMESTAMPTZ                         -- nullable; revoke flow
  revoke_reason       TEXT                                -- nullable; admin notu (Phase 4+ UI)
)
```

- **UNIQUE constraint:** `(tenant_id, device_fingerprint)` — aynı cihazın çoklu register'ı engellenir. Re-register flow ayrı: revoke + yeni register (Phase 4+ admin UI).
- **Indexler:**
  - PK üzerinde otomatik (`agents_pkey`)
  - `agents_tenant_active_idx`: `(tenant_id) WHERE revoked_at IS NULL` partial — active agents listesi Phase 4+
  - `agents_tenant_lastseen_idx`: `(tenant_id, last_seen_at DESC)` — admin UI "son görülme" sıralaması Phase 4+
- **Migration 037 forward-ref:** `db-migration-guard` ayrı pass'te SQL yazar. Bu PR'da yalnız sözleşme kayıt altında.

**2. API key format ve saklama:**

- **Format:** `pk_${tenantIdShort}_${randomBase64url}` — örn. `pk_abc12345_3xJ8z...` (32 char random suffix)
  - `pk_` prefix: print key (user JWT'den ayırt etmek için)
  - `tenantIdShort`: tenant_id UUID'nin ilk 8 karakteri — register lookup için tenant disambig; güvenlik leak değil (tenant_id zaten URL'de değil ama JWT içinde var)
  - random suffix: `crypto.randomBytes(24).toString('base64url')` — cryptographically secure, 192-bit entropy
- **Hash:** bcrypt cost 12 (ADR-002 user password ile aynı; operasyonel parite). Plaintext DB'ye **asla** girmez.
- **Plaintext yaşam döngüsü:** Manager UI'dan üretildikten sonra **bir kere** kasiyere/admine gösterilir; kayıt edilmez. PR-3a'da Manager UI yok → **test fixture'da plaintext seed** edilir (`beforeAll` içinde hash hesaplanır, INSERT'lenir; cleanup cascade ile tenant DELETE).
- **Lookup pattern:** register sırasında body'deki `apiKey` prefix parse → `tenantIdShort` → `SELECT * FROM agents WHERE tenant_id::text LIKE '${tenantIdShort}%' AND revoked_at IS NULL` (dar arama, N=1 tenant adayı) → bcrypt.compare ile match.

**3. JWT payload yapısı (ADR-002 user JWT'den ayrı):**

- **Secret:** yeni env var `JWT_AGENT_SECRET` — user `JWT_ACCESS_SECRET`'ten ayrı. Compromise blast radius daraltılır.
- **Algorithm:** HS256 (user ile aynı, operasyonel parite).
- **Access token claims:**
  - `sub`: `agents.id` (UUID)
  - `tid`: tenant_id (mock `X-Tenant-Id` migrate; middleware claim'i `req.tenantId`'ye set eder)
  - `type`: `'agent'` (user JWT'den explicit ayrım; cross-token attack savunması)
  - `iat`, `exp` (1h TTL — ADR-004 §6 Soru #6 yanıtı korunur)
  - `jti`: UUID (Phase 4+ revoke list forward-ref; bu PR'da kullanılmaz)
- **Refresh token claims:** aynı yapı + `type: 'agent_refresh'`, 30d TTL. Body üzerinden gelir, **DB-backed değil** (stateless rotation).
- **Rotation stratejisi:** her refresh isteği `{ accessToken, refreshToken }` ikilisi döner; eski refresh token "burned" değil (stateless — Phase 4+ revoke list eklenirse stateful'a evrilir).
- **Güvenlik notu (flag):** Stateless rotation çalıntı refresh token'ı 30 gün boyunca geçerli bırakır. Mitigation: `revoked_at` set edilince DB lookup tüm tokenları öldürür (next refresh 401). Pure stateless rotation **kabul edilebilir risk** Phase 3'te — 1 tenant + 1 Agent, attack surface dar.

**4. JWT verify middleware (`requireAgentJwt`):**

- **Path:** `apps/api/src/middleware/print-agent-auth.ts` (yeni dosya, ADR-002 user auth `apps/api/src/auth/` ile ayrı).
- **Davranış:**
  1. `Authorization: Bearer <token>` header yoksa → 401 `AUTH_TOKEN_MISSING`
  2. JWT verify fail (expired, wrong signature, wrong `type` claim) → 401 `AUTH_TOKEN_INVALID`
  3. DB lookup: `SELECT id, tenant_id FROM agents WHERE id = $sub AND tenant_id = $tid AND revoked_at IS NULL` — 0 row → 401 `AGENT_REVOKED`
  4. `UPDATE agents SET last_seen_at = now() WHERE id = $sub` — fire-and-forget (await EDİLMEZ, response gecikmesin; hata sessizce log'lanır)
  5. `req.tenantId = tid`, `req.agentId = sub` set (mevcut `requireTenantHeader` interface ile uyumlu — handler kodu değişmez)
- **Mevcut endpoint geçişi:** `GET /print/v1/jobs/next` ve `POST /print/v1/jobs/:id/result` route'larında `requireTenantHeader()` → `requireAgentJwt()` ile **değiştirilir** (chain'lenmez, tek katman).

**5. Mock auth → real auth migration (X-Tenant-Id tamamen kaldırılır):**

- **Karar:** `X-Tenant-Id` header **TAMAMEN kaldırılır**, fallback yok. Hibrit auth (Bearer OR X-Tenant-Id) karmaşıklığı PR-3a'nın tek-katman hedefini bozar.
- **Test migration:** PR-1 + PR-2 integration testleri **bu PR'da güncellenir**:
  - `beforeAll`: tenant INSERT → apiKey üret → bcrypt hash → `agents` INSERT → register endpoint çağır → JWT al → suite scope'unda sakla
  - Test request'leri: `X-Tenant-Id: <uuid>` → `Authorization: Bearer <jwt>` ile değiştirilir
  - Cleanup: tenant DELETE (CASCADE agents'i siler)
- **Backward compat:** PR-3a merge sonrası eski `X-Tenant-Id` çağrıları **401 AUTH_TOKEN_MISSING** alır. Print Agent skeleton (PR-1'de mock register loop'u yok) PR-3b'de gerçek register'a geçer.

**6. Endpoint detayları:**

**`POST /print/v1/agent/register`** (public — apiKey kendisi auth):
- Body (zod, PR-1'de mevcut): `{ apiKey: string, deviceFingerprint: string }`
- Flow:
  1. apiKey prefix parse → tenantIdShort
  2. `SELECT * FROM agents WHERE tenant_id::text LIKE '${tenantIdShort}%' AND revoked_at IS NULL` (aday listesi)
  3. Her aday için `bcrypt.compare(apiKey, agent.api_key_hash)` — ilk match → success
  4. `deviceFingerprint` UNIQUE check:
     - Aynı `(tenant_id, device_fingerprint)` zaten varsa **mevcut agent row'u re-use** (idempotent register; Agent yeniden boot ettiğinde)
     - Farklı tenant'ta aynı fingerprint varsa **409 `AGENT_FINGERPRINT_CONFLICT`** (cross-tenant device collision)
     - Yoksa yeni `agents` row INSERT
  5. Access + refresh JWT issue → 200 `{ agentId, accessToken, refreshToken }`
- Errors:
  - 401 `AUTH_INVALID_CREDENTIALS`: apiKey hiçbir bcrypt hash'le match etmedi
  - 400 `VALIDATION_ERROR`: zod schema fail
  - 409 `AGENT_FINGERPRINT_CONFLICT`: cross-tenant fingerprint çakışması

**`POST /print/v1/agent/refresh`** (public — refresh token kendisi auth):
- Body (zod, PR-1'de mevcut): `{ refreshToken: string }`
- Flow:
  1. JWT verify (`type: 'agent_refresh'`, exp valid) → fail 401 `AUTH_REFRESH_INVALID`
  2. `SELECT id, tenant_id FROM agents WHERE id = $sub AND tenant_id = $tid AND revoked_at IS NULL` → 0 row → 401 `AGENT_REVOKED`
  3. Yeni access + refresh JWT issue → 200 `{ accessToken, refreshToken }`
- Errors: 401 `AUTH_REFRESH_INVALID`, 401 `AGENT_REVOKED`

**7. Bu PR'da NE YOK (deferred):**

- Agent skeleton register flow + refresh loop + JWT injection result POST (**PR-3b**)
- Manager UI API key generation form (Phase 4+)
- Manager UI agent listesi + revoke butonu (Phase 4+)
- Stateful refresh token revoke list (Phase 5+ multi-Agent için; bu PR'da `jti` claim forward-ref)
- Audit log entry'leri (`agent.created`, `agent.revoked`) — ADR-003 audit taxonomy ile uyumlu olmalı, **Phase 4+**
- Rate limit (Agent başına DDoS koruması) — Phase 4+
- `device_fingerprint` üretim algoritması (hostname + MAC SHA256) — agent skeleton'da, **PR-3b**

**Yeni error code'lar (ADR-006 forward-ref):**
- `AUTH_TOKEN_MISSING` (401) — Bearer header yok
- `AGENT_REVOKED` (401) — `agents.revoked_at IS NOT NULL`
- `AUTH_INVALID_CREDENTIALS` (401) — register apiKey match yok (mevcut ADR-002 §2 kodu reuse)
- `AUTH_REFRESH_INVALID` (401) — refresh JWT verify fail (mevcut ADR-002 §2 kodu reuse)
- `AGENT_FINGERPRINT_CONFLICT` (409) — cross-tenant device fingerprint çakışması (**yeni** — Phase 4 Sprint 1 taxonomy rezerv listesine eklenir)

**Cross-ref:**
- ADR-002 §2 (user auth error codes) — `AUTH_INVALID_CREDENTIALS`, `AUTH_REFRESH_INVALID`, `AUTH_TOKEN_INVALID` reuse; `AUTH_TOKEN_MISSING` user auth'ta da kullanılırsa shared.
- ADR-003 §13 (audit taxonomy) — `agent.created`, `agent.revoked` event'leri Phase 4+ eklenir; bu PR'da forward-ref.
- ADR-004 §6 Soru #6 yanıtı (per-tenant apiKey + per-device JWT + 1h/30d TTL) — kararlar korundu, yalnız implementasyon detayı kilitlendi.
- ADR-006 — yeni `AGENT_FINGERPRINT_CONFLICT` kodu Phase 4 Sprint 1 rezerv listesine eklenir.

<!-- ADR-004 §Amendment 2 (Session 62, 2026-05-13) — architect sub-agent; PR-3a (feat/print-agent-phase3-pr3a) auth backbone scope kilidi; PR-3b agent integration ayrı PR; Migration 037 agents tablosu (UUID PK + tenant_id FK + device_fingerprint + api_key_hash bcrypt12 + last_seen_at + revoked_at + revoke_reason + UNIQUE(tenant_id,device_fingerprint) + 2 partial index); API key format pk_${tenantIdShort}_${randomBase64url} 192-bit entropy; JWT_AGENT_SECRET ayrı env, type='agent'/'agent_refresh' claim, stateless rotation (Phase 5+ stateful revoke list); requireAgentJwt middleware apps/api/src/middleware/print-agent-auth.ts; X-Tenant-Id TAMAMEN kaldırılır (hibrit yok) PR-1+PR-2 testleri bu PR'da Bearer JWT'ye migrate; POST /agent/register + POST /agent/refresh endpoints; AGENT_FINGERPRINT_CONFLICT 409 yeni kod ADR-006 rezerv; Manager UI + audit log + rate limit + Agent skeleton register flow Phase 4+ deferred -->

### §Phase 3 PR-6 — Scope Kilidi (MSI Installer + nssm Windows Servisi, Session 67, 2026-05-14)

Phase 3'ün son PR'ı (branch: `feat/print-agent-phase3-pr6`). Bu alt bölüm ADR-004 ana §1-§8 kararlarını DEĞİŞTİRMEZ — yalnız §5 (Karar §1 + Soru #3 yanıtı: MSI installer + `nssm` Windows servisi, tool kilidi `pkg` + `nssm` + WiX) için uygulama detayını kilitler. Tetikleyici: PR-1 → PR-5a zincirinde Agent kod tarafı (skeleton + poll loop + auth + KDS enqueue + render primitives + TCP transport) hazır; Phase 3 kapanışı için Windows üzerinde "çift-tık kurulum + boot'ta otomatik başla" deneyimi gerek. PR-5b (USB transport) lokal donanıma bağlı kaldı → kullanıcı eşliğiyle ayrı PR olarak ileri tarihe ertelendi; PR-6 sandbox-tan tamamlanabilir.

**Önceki 5 PR ile uyum:**
- **PR-5a config loader 4-yol öncelik** zaten `%PROGRAMDATA%\restoran-pos\print-agent.json` okuyor (ADR-004 §5 Karar 5 + §6 hardcoded path). PR-6'nın görevi yalnız bu dosyayı **WiX `Component`** olarak `%PROGRAMDATA%` altına kopyalamak (`NeverOverwrite="yes"` flag ile re-install'da konfig korunur).
- **PR-3a auth backbone** apiKey format `pk_${tenantIdShort}_${random}`'i sabitledi → MSI **plaintext apiKey içermez**; kullanıcı kurulum sonrası Manager UI'dan apiKey üretir, config dosyasına manuel yapıştırır. Bu kural Türkçe README'de açıkça yazılır.
- **PR-5a TCP 9100** transport varsayılan `null` (config'de açıkça `printer.transport.type` set edilene kadar Agent fail-fast log'lar). MSI install sonrası ilk başlangıçta servis başlar ama "transport yok" uyarısı verir → bu **kasıtlı UX**, yanlış basım önler.

**Tool kilidi (§5'ten miras, YENİDEN TARTIŞILMAZ):** `@vercel/pkg` ile Node 22 → `dist/print-agent.exe`; `nssm` ile Windows Service registration; WiX Toolset ile `.msi` paketleme.

---

#### A) In-scope (dosya/aksiyon listesi)

Her madde için "neden bu PR'da" gerekçesi parantez içinde.

- **`apps/print-agent/package.json`** — `pkg` config + `scripts.build:exe` ekleme; `bin` field set (`"bin": "dist/index.js"`) ve `pkg` config bloğu (`assets`, `targets: ["node22-win-x64"]`, `outputPath: "dist/exe/"`). *(Tek `.exe`'ye paketlenmiş Node 22 binary olmadan nssm servis olarak başlatamaz; bu PR'ın gate adımı.)*
- **`apps/print-agent/pkg.config.json`** (yeni) — pkg için ayrı config (package.json'ı şişirmemek için). `targets`, `outputPath`, `assets` (CP857 encode tabloları, varsa template dosyaları). *(PR-4a/4b'de eklenen render primitive asset'leri runtime'da binary içine paketlenmeli.)*
- **`apps/print-agent/installer/print-agent.wxs`** (yeni) — WiX project file: `Product`, `Package`, `MediaTemplate`, `Feature`, `Component` (binary + nssm.exe + config template), `ServiceInstall`, `ServiceControl`, `RegistryValue` (Add/Remove Programs). *(MSI'ın deklaratif spesifikasyonu; manuel "cmd ile kayıt" v3 pain-point #3'ü tam burada kapanır.)*
- **`apps/print-agent/installer/print-agent.config.json.template`** (yeni) — `%PROGRAMDATA%\restoran-pos\print-agent.json`'a `NeverOverwrite="yes"` ile kopyalanır. Default değerler: `cloud.baseUrl`, `cloud.pollIntervalSec: 5`, `printer.transport: null`, `agent.apiKey: ""` (boş; kullanıcı doldurur). *(PR-5a config loader sözleşmesiyle birebir uyumlu olmalı; sapma drift yaratır.)*
- **`apps/print-agent/installer/build-msi.ps1`** (yeni) — lokal + CI ortak helper PowerShell script: `pnpm build:exe` → `candle.exe print-agent.wxs` → `light.exe -ext WixUtilExtension print-agent.wixobj -out print-agent.msi`. Version pinning `package.json`'dan okur. *(Tek komutla yeniden üretilebilir build; "ben şimdi nasıl build alıyordum" sorusunu öldürür.)*
- **`apps/print-agent/installer/README.md`** (yeni) — Türkçe kurulum/kaldırma talimatı (admin PowerShell → `msiexec /i print-agent.msi`, çift tık alternatifi, `nssm stop/start/edit`, Olay Görüntüleyici nereye bakılır, config dosyası nasıl düzenlenir). *(Operatör/kasiyer-tarafı belge; v3'te `installation-guide.md` v3'ten kalan kafa karışıklığını öldürür.)*
- **`apps/print-agent/installer/.gitignore`** (yeni) — `bin/`, `obj/`, `*.wixobj`, `*.wixpdb`, `*.msi`, `dist/exe/`. *(Build artifact'lerinin repo'ya sızması yasak; CI artifact'i ayrı yere upload eder.)*
- **`.github/workflows/print-agent-msi.yml`** (yeni — mevcut `ci.yml`'e ek **job** değil, ayrı workflow): `on: workflow_dispatch + push tags 'print-agent-v*'`; `runs-on: windows-latest`; adımlar: pnpm setup → `pnpm install` → `pnpm --filter @restoran-pos/print-agent build:exe` → WiX kurulum (`dotnet tool install --global wix`) → `pwsh apps/print-agent/installer/build-msi.ps1` → `actions/upload-artifact` ile `print-agent-${version}.msi` yükle. *(MSI üretimi nadir tetiklenir; her PR'da çalışmaz — CI dakika bütçesini sömürmez. Tag-based release-friendly.)*
- **`apps/print-agent/src/version.ts`** (yeni, tek satır) — `package.json` version'ı runtime'a expose eder (`/healthz` endpoint'i Phase 4+'da kullanır; bu PR'da yalnız WiX `ProductVersion` ve `nssm` `DisplayName`'inde tutarlı olması için sabit alıntı kaynağı). *(Version drift önleme; WiX manuel string yazmaz.)*

---

#### B) Out-of-scope (v5.1+ backlog — açıkça liste)

Her madde için "neden v5.1" gerekçesi.

- **Icon `.ico` dosyası** — varsayılan WiX `WixUIBannerBmp` yeterli; özel ikon brand/tasarım kararı, Phase 3 kapanışı için kritik değil. *(Tasarım hattı henüz hazır değil.)*
- **Authenticode code signing** — sertifika satın alma (~$300/yıl) + CI'da `AZURE_KEY_VAULT_SECRET` veya `SIGNTOOL` secret config gerek. Kullanıcı tek tenant ve admin kurulum yapacak → SmartScreen "publisher unknown" uyarısı kabul edilebilir. *(v5.1 multi-tenant pilot öncesi imzalanır.)*
- **Auto-update kanalı (Squirrel.Windows / MSI patch / OTA)** — MVP'de version bump = manuel `.msi` indir + üzerine çift-tık. Squirrel native Electron için optimize, bizim Node + nssm stack'ine fit etmiyor. *(v5.1: 2+ tenant olunca güncelleme akışı zorunlu olur.)*
- **Per-user install option** — per-machine (`InstallScope="perMachine"`) sabit; servis tüm kullanıcılar için boot'ta başlar. Per-user Windows Service kuramaz (UAC + service control manager). *(Mimari olarak değil, OS olarak imkansız.)*
- **Uninstaller'da config dosyası temizleme** — `%PROGRAMDATA%\restoran-pos\print-agent.json` uninstall sonrası **korunur**. Kullanıcı re-install ederse apiKey + IP'yi yeniden girmek zorunda kalmasın. Tam temizlik için README'de manuel komut verilir. *(Operatör için "yanlışlıkla kaldırdım, kayıt gitmesin" güvencesi.)*
- **Crash dump toplama, structured logging rotation** — şu an `nssm` `AppStdout`/`AppStderr` `%PROGRAMDATA%\restoran-pos\logs\` altına yönlendirilir; rotation Windows'a bırakılır. Sentry/log shipping observability ADR (henüz yok) içinde tartışılır. *(Observability ADR'siz erken karar tuzağı.)*
- **USB transport (PR-5b)** — node-thermal-printer USB binding lokal donanım test gerektirir; user eli erişince ayrı PR. *(Donanıma bağımlı.)*
- **Multi-printer routing** — 1:1 Agent-printer ana §3 kararı; multi-printer v5.1 backlog'unda zaten kayıtlı. *(ADR-004 ana karar.)*
- **MSI bundle (Print Agent + Caller Bridge tek installer)** — Caller Bridge `.NET 8 Windows Service` ayrı tool kilidi (ADR-XXX caller-id); WiX `Bundle` ile birleştirme operasyonel olgunluk gerek. *(v5.1 backlog, ADR-XXX caller-id §B referansı zaten not.)*

---

#### C) 4 zorunlu karar — net cevaplar

**Soru #1: `nssm.exe` nereden gelecek?**

→ **(a) MSI içine embed (binary ~850 KB)** — SEÇİLDİ.

Gerekçe: (i) Restoran PC'lerinin offline kurulum şartı var — kasiyerin "internet bağlantısı yok, installer bunu da indirsin" sürprizi yaşaması yasak. (ii) `nssm` Public Domain (CC0) lisansı — embed legal pürüzsüz. (iii) 850 KB MSI toplam boyutuna ihmal edilebilir katkı (Node binary `pkg` ile zaten ~40 MB). (iv) Build determinism: GitHub release link'i bir gün ölürse CI fail; embed ile bağımlılık kesilir. Reddedilen: (b) "kullanıcı ayrı kursun" → v3 pain-point #3 tam burada; (c) "build-time indir" → CI internet'e bağımlı + offline pilot kurulumda imkansız.

**Soru #2: MSI install dizini?**

→ **(a) `%PROGRAMFILES%\Restoran POS\Print Agent\`** — SEÇİLDİ.

Gerekçe: (i) 64-bit binary (`node22-win-x64`) → `Program Files` (x86 değil); WiX `Platform="x64"` + `InstallScope="perMachine"`. (ii) Admin elevation MSI kurulumunda zaten zorunlu (servis kayıt için) → `Program Files`'a yazma yetkisi sorun değil. (iii) Windows konvansiyonu: machine-wide service binary'leri Program Files'tadır; %LOCALAPPDATA% per-user (servis impossible) + Windows defender taranma kuralları farklı. Reddedilen: (b) Program Files (x86) → 32-bit changed olur, biz x64'üz; (c) %LOCALAPPDATA% → service install fail.

**Soru #3: CI'da MSI build platform?**

→ **(c) `windows-latest` runner + WiX v4 (`dotnet tool install --global wix`)** — SEÇİLDİ.

Gerekçe: (i) WiX v4 .NET 6+ tabanlı, cross-platform CLI (`wix build`); v3'ün `candle/light` arkaplanını kapsar ama daha temiz syntax. Microsoft official tool, 2024+ aktif geliştirme. (ii) `windows-latest` runner zaten projede mevcut (Playwright vb. henüz değil ama OS-level Windows-only adımlar için gerek). (iii) Ubuntu + cross-build mümkün ama WiX v4 Linux'ta da çalışırken Windows runner'da debug kolaylığı (servis kaydı test edilebilir, MSI install/uninstall manuel doğrulanabilir). (iv) CI dakika maliyeti: workflow `workflow_dispatch + tag push` ile nadir → windows runner pahalı dakikası bütçeye yük değil. Reddedilen: (a) WiX v3 → 2024'te legacy, .NET Framework 3.5 dependency Windows runner'da yavaş setup; (b) Ubuntu + WiX v4 → debug + manuel test imkanı dar.

**Soru #4: Windows servisi hangi kullanıcı altında çalışır?**

→ **(a) `LocalSystem`** — SEÇİLDİ (nssm default).

Gerekçe: (i) Print Agent **outbound HTTP** yapar (cloud API'ye polling) — `LocalSystem` outbound network izinli, ek firewall kuralı gerekmez. (ii) **TCP 9100 yazıcısına bağlanır** (PR-5a transport) — yazıcı LAN'da shared değil, IP:port direkt → `LocalSystem` yeterli. (iii) USB yazıcı (PR-5b) için `LocalSystem` USB device access izinli; `NetworkService` USB'ye yetki kısıtlı. (iv) `RestoranPosPrintAgent` lokal user yaratmak operasyonel karmaşıklık (password rotation, lokal user politikası) — 1 tenant + admin kurulum bağlamında over-engineering. Reddedilen: (b) NetworkService → USB transport (PR-5b) zorlaşır; (c) Yeni lokal user → şifre yönetimi + WiX'te `User`/`util:User` extension karmaşıklığı, faydadan büyük.

---

#### D) DoD (Definition of Done) checklist

PR-1/Amendment 1/Amendment 2 paterni — madde madde.

- [ ] `pnpm --filter @restoran-pos/print-agent build:exe` temiz çıkış kodu 0; `apps/print-agent/dist/exe/print-agent.exe` üretir; binary `--version` flag'ine `package.json` version'ı döner.
- [ ] `apps/print-agent/installer/build-msi.ps1` admin PowerShell'de temiz çıkış; `apps/print-agent/installer/dist/print-agent-${version}.msi` üretir; MSI boyutu < 60 MB (Node bundled binary + nssm + WiX overhead).
- [ ] WiX project file `light.exe` warning sayısı = 0 (`-pedantic` flag'siz default seviyede); `ICE` validation warning'leri açıklamalı `-sice:ICExxx` ile yalnız bilinçli olarak suppress edilir.
- [ ] CI `print-agent-msi.yml` workflow `windows-latest` runner'da yeşil; `workflow_dispatch` ile manuel tetikleme + `print-agent-v*` tag push otomatik tetikleme test edildi; artifact `.msi` dosyası 7 gün retention ile yüklendi.
- [ ] WiX `ServiceInstall` directives: `Name="RestoranPosPrintAgent"`, `DisplayName="Restoran POS Print Agent"`, `Description="Cloud kuyruğundan yazıcı işlerini alır ve ESC/POS yazıcıya gönderir."` (Türkçe), `Start="auto"`, `Account="LocalSystem"`.
- [ ] WiX `ServiceControl` directives: install sırasında `Start="install" Stop="both" Remove="uninstall"`; servis install sonrası otomatik başlar.
- [ ] Install sonrası: (a) servis `Running` durumda (`Get-Service RestoranPosPrintAgent`), (b) `%PROGRAMDATA%\restoran-pos\print-agent.json` mevcut, (c) `%PROGRAMFILES%\Restoran POS\Print Agent\print-agent.exe` mevcut, (d) Add/Remove Programs'ta "Restoran POS Print Agent" satırı görünür.
- [ ] Uninstall sonrası: (a) servis kaldırılmış (Service Control Manager'da yok), (b) `%PROGRAMFILES%\Restoran POS\Print Agent\` dizini silinmiş, (c) `%PROGRAMDATA%\restoran-pos\print-agent.json` **KORUNUR** (re-install dostu, README'de manuel temizlik talimatı var).
- [ ] `apps/print-agent/installer/README.md` Türkçe; 4 bölüm: (1) Sistem gereksinimi (Windows 10+ x64, admin yetki), (2) Kurulum (çift tık + admin PowerShell `msiexec` alternatifi), (3) Config dosyası nasıl düzenlenir (apiKey + TCP IP:port + cloud URL), (4) Kaldırma + log konumu (`%PROGRAMDATA%\restoran-pos\logs\`).
- [ ] **Smoke senaryo dökümante (`installer/README.md` ek bölüm "Doğrulama")**: admin PowerShell → `msiexec /i print-agent.msi /qb` → `Get-Service` running → config'de geçerli apiKey + cloud URL girildikten sonra servis restart → `%PROGRAMDATA%\restoran-pos\logs\stdout.log` içinde "cloud poll started" mesajı → `msiexec /x print-agent.msi /qb` → servis listede yok.
- [ ] Tool kilidi (§5) `pkg + nssm + WiX` korundu; alternatif tool (Inno Setup, NSIS, electron-builder, advinst) **eklenmedi**.
- [ ] **v5.1 backlog**: `docs/v5-roadmap.md` veya `.claude/memory/scratchpad.md` içinde "Print Agent MSI v5.1: icon, code signing, auto-update, MSI bundle (Caller Bridge birleşik)" satırı var.

---

#### E) Cross-ref

- **ADR-004 §5** (tool kilidi `pkg + nssm + WiX`) — bu amendment uygulama detayını kilitler, tool seçimi değişmez.
- **ADR-004 §6** (`%PROGRAMDATA%/restoran-pos/print-agent.json` config path) — WiX `Component` `NeverOverwrite="yes"` ile bu path'e template kopyalanır; PR-5a config loader sözleşmesi miras alınır.
- **PR-5a** (TCP transport + config loader 4-yol öncelik) — install sonrası default config'de `printer.transport: null` → Agent fail-fast log mesajı kullanıcıyı config dolduralım uyarır.
- **PR-3a auth backbone** — apiKey plaintext MSI'a embed edilmez; kurulum sonrası Manager UI'da üretilip config'e manuel girilir. README bu adımı net anlatır.
- **ADR-XXX caller-id §B** (`.NET 8 Windows Service` Caller Bridge) — v5.1 backlog'da WiX `Bundle` ile birleştirme not edildi; bu PR'da scope dışı.
- **v3 pain-point #3** (`docs/v3-reference/pain-points.md` §3 elle kurulum, "cmd ile kayıt" hatası) — PR-6 ile **kapanır** (çift tık MSI + servis otomatik kayıt).

---

#### F) Implementer brief özet (parent agent için)

1. **Branch:** `feat/print-agent-phase3-pr6` (worktree'den ayrılır; main'e direkt commit yasak — branch-first workflow MEMORY.md).
2. **Dosya whitelist:** `apps/print-agent/package.json` (pkg config + build:exe script), `apps/print-agent/pkg.config.json` (yeni), `apps/print-agent/src/version.ts` (yeni tek satır), `apps/print-agent/installer/print-agent.wxs` (yeni WiX), `apps/print-agent/installer/print-agent.config.json.template` (yeni), `apps/print-agent/installer/build-msi.ps1` (yeni), `apps/print-agent/installer/README.md` (yeni Türkçe), `apps/print-agent/installer/.gitignore` (yeni), `.github/workflows/print-agent-msi.yml` (yeni workflow — mevcut `ci.yml`'e ek değil).
3. **Karar matrisi (Soru #1–#4):** nssm embed, `%PROGRAMFILES%\Restoran POS\Print Agent\`, `windows-latest` + WiX v4 (`dotnet tool install --global wix`), `LocalSystem` account.
4. **DoD §D'deki 12 madde** — her birine ait commit message veya PR checklist satırı; smoke senaryo (`installer/README.md` "Doğrulama" bölümü) komut komut yazılır.
5. **Test stratejisi:** Pure unit test PR-6 için **yok** (MSI binary build, runtime kodu değişmez); doğrulama CI yeşil + manuel smoke (lokal Windows VM veya kullanıcı PC'sinde admin PowerShell). PR açıklamasında "manuel test gerek, CI sadece build doğrular" notu.
6. **Türkçe README zorunlu** (CLAUDE.md kullanıcıya görünen Türkçe kuralı); install/uninstall + config + log path + 4 numaralı doğrulama senaryosu.
7. **Tool kilidi koruma:** Inno Setup / NSIS / electron-builder gibi alternatif yasak; tartışılırsa ADR amendment gerek.

---

#### G) Risk + uyarılar

- **WiX v4 olgunluk:** v4 2024+ aktif ama bazı şirket runner'larında v3 default; `dotnet tool install --global wix` her CI run'da kurulum süresi ~30 sn ekler — kabul edilebilir.
- **`pkg` deprecated risk:** `@vercel/pkg` 2024'te "maintenance mode" duyuruldu; alternatif `node --experimental-sea-config` (Single Executable Apps) henüz olgun değil. Phase 4+ revize ihtiyacı doğarsa **ayrı amendment** ile tool migration tartışılır; PR-6 mevcut `pkg`'i kullanır (working tool > theoretical future).
- **Manuel test ihtiyacı:** CI sadece build doğrular; install/uninstall + servis start/stop manuel — Windows VM veya kullanıcı PC erişimi olmadan PR merge için "build green + dokümante smoke" yeterli sayılır. İlk pilot kurulumda fiziksel doğrulama (kullanıcı PC).
- **Config dosyası migration:** Phase 4+ config schema değişirse `NeverOverwrite="yes"` problemi olur (eski config kullanıcı PC'sinde kalır). Migration stratejisi (config versioning) **Phase 4+ amendment** olarak forward-ref edilir; PR-6 schema-stable varsayar.

<!-- ADR-004 §Phase 3 PR-6 scope kilidi (Session 67, 2026-05-14) — architect sub-agent; apps/print-agent/installer iskelet + WiX v4 + nssm + windows-latest CI job; tool kilidi §5 değişmedi (pkg + nssm + WiX); 4 karar (nssm embed / Program Files x64 perMachine / windows-latest WiX v4 dotnet tool / LocalSystem account); MSI install %PROGRAMFILES%\Restoran POS\Print Agent\ + config %PROGRAMDATA%\restoran-pos\print-agent.json NeverOverwrite; uninstall config korur; build-msi.ps1 + Türkçe README + workflow_dispatch+tag-push trigger; v5.1 backlog: icon/code signing/auto-update/MSI bundle Caller Bridge; PR-5b USB ertelendi; pkg deprecated risk Phase 4+ amendment forward-ref -->

---

### §Phase 3 PR-5b — Scope Kilidi (USB Transport, Session 69, 2026-05-14)

Phase 3'ün ertelenmiş tek sub-PR'ı (branch: `feat/print-agent-phase3-pr5b`). Bu alt bölüm ADR-004 ana §1-§8 kararlarını DEĞİŞTİRMEZ — yalnız §5 (Tool Kilidi: USB öncelikli + TCP fallback) için **USB transport library + config discriminator + dispatch** uygulama detayını kilitler. Tetikleyici: Session 66 PR-5a TCP transport `apps/print-agent/src/printer/tcp-transport.ts` mevcut (settle pattern, ECONNREFUSED/ETIMEDOUT/EPIPE error handling); kullanıcının USB ESC/POS yazıcısı eline geldi → lokal donanım eşliği artık mümkün. PR-6 (MSI) Session 67/68'de production-ready kapandı; PR-5b ile **Phase 3 9/9 ✅ closure mührü** atılır.

**Önceki PR'lar ile uyum:**
- **PR-5a config loader** `PrinterConfigSchema = z.object({ type: z.literal('tcp'), host, port, timeoutMs })` formatında — PR-5b bu schema'yı `z.discriminatedUnion('type', [TcpSchema, UsbSchema])` olarak migrate eder. Mevcut `config.json` dosyaları **BREAKING DEĞİL** (zaten `type: 'tcp'` set, schema parse PASS).
- **PR-5a `sendToTcpPrinter(bytes, config) → Promise<void>`** interface paritesi: USB transport aynı imzayı taşır (`sendToUsbPrinter(bytes, config) → Promise<void>`); Agent loop dispatch bir tek `if/switch` ile büyür.
- **PR-4a render primitives** (CP857 encode + ESC/POS init `\x1B@` + cut `\x1Di`) zaten byte array üretir → USB bulk-out endpoint'e aynı byte stream gider; transport-agnostic.
- **PR-6 MSI** `@yao-pkg/pkg` ile binary üretiyor — PR-5b'nin seçtiği USB library `pkg bundling` ile uyumlu olmalı (native `.node` binary için `pkg-fetch`+`assets` config gerek; Soru #1 cevabı).

**Tool kilidi (§5'ten miras, YENİDEN TARTIŞILMAZ):** USB transport library Soru #1'de net karar verilir; pkg + nssm + WiX dokunulmaz.

---

#### A) In-scope (dosya/aksiyon listesi)

Her madde için "neden bu PR'da" gerekçesi parantez içinde.

- **`apps/print-agent/package.json`** — `dependencies` ekleme: `usb` (node-usb, Soru #1 cevabı). `pkg.assets` config'ine native binary (`node_modules/usb/prebuilds/win32-x64/node.napi.node`) eklenir ki `@yao-pkg/pkg` bundle'da fail etmesin. *(PR-6 MSI build'i bu native binary olmadan runtime'da `Cannot find module 'usb'` patlar; pkg config kritik.)*
- **`apps/print-agent/src/printer/config.ts`** — `PrinterConfigSchema` migrate: `TcpSchema` (mevcut) + yeni `UsbSchema` (`type: z.literal('usb'), vendorId: z.number().int(), productId: z.number().int(), serialNumber: z.string().optional()` — Soru #2 cevabı). `PrinterConfigSchema = z.discriminatedUnion('type', [TcpSchema, UsbSchema])`. `PrinterConfig` type-export `z.infer`'dan otomatik union çıkar. *(Tek transport satırı yerine discriminated union; PR-5a config dosyaları geriye dönük uyumlu.)*
- **`apps/print-agent/src/printer/usb-transport.ts`** (yeni) — `sendToUsbPrinter(bytes: Uint8Array, config: UsbConfig): Promise<void>`. İçinde: (i) `usb.findByIds(vendorId, productId)` veya çoklu cihaz varsa `usb.getDeviceList().find(...)` + opsiyonel `serialNumber` disambiguator, (ii) `device.open()` + `device.interface(0).claim()` (kernel driver detach Windows'ta no-op), (iii) bulk-out endpoint auto-discovery: `iface.endpoints.find(ep => ep.direction === 'out' && ep.transferType === LIBUSB_TRANSFER_TYPE_BULK)` (Soru #3 cevabı), (iv) `endpoint.transfer(Buffer.from(bytes), cb)` Promise wrap + timeout (`config.timeoutMs` default 10000), (v) `device.close()` finally bloğunda. Error handling: cihaz bulunamadı (`LIBUSB_ERROR_NO_DEVICE`), erişim reddi (`LIBUSB_ERROR_ACCESS`), timeout (`LIBUSB_ERROR_TIMEOUT`) — anlamlı mesajla throw. *(TCP transport interface paritesi şart; dispatch bir tek discriminator switch.)*
- **`apps/print-agent/src/printer/usb-transport.test.ts`** (yeni) — `vitest` unit test, `vi.mock('usb', () => ({ ... }))` ile node-usb sahte (Soru #4 cevabı). 6-8 case: (a) happy path bulk write success, (b) device not found throws, (c) endpoint not found throws (no bulk-out), (d) timeout throws, (e) serialNumber disambiguator picks correct device, (f) `device.close()` finally'de hatada bile çağrılır, (g) interface claim fail throws, (h) byte stream içeriği `endpoint.transfer`'a aynen iletilir (CP857 byte dizisi doğrulama). *(Sandbox CI'da gerçek USB yok → mock şart; real printer smoke kullanıcı eşliğine kalır.)*
- **`apps/print-agent/src/index.ts`** — `pollOnce(cfg, session, printerConfig)` içinde dispatch: `const transport = printerConfig.type === 'usb' ? sendToUsbPrinter : sendToTcpPrinter; await transport(bytes, printerConfig);`. TypeScript discriminated union narrowing `printerConfig.type === 'usb'` branch'inde `UsbConfig` tipini otomatik çıkarır. *(Tek satır dispatch; mevcut PR-5a kod akışı korunur.)*
- **`apps/print-agent/installer/print-agent.config.json.template`** — `printer` section'ına USB örneği yorum bloğu olarak eklenir (`// USB örneği: { "type": "usb", "vendorId": 1305, "productId": 8211, "serialNumber": "ABC123" }` — vendorId+productId integer, Windows'ta Aygıt Yöneticisi'nden bulunabilir). Default şablon `type: null` veya `type: 'tcp'` kalır; kullanıcı USB seçerse manuel günceller. *(Operatör USB kurulum için "nereden bulurum" kafa karışıklığını öldürür.)*
- **`apps/print-agent/installer/README.md`** — Türkçe yapılandırma bölümüne **"USB Yazıcı Yapılandırması"** alt-başlığı: (1) Aygıt Yöneticisi → Yazıcı → Özellikler → Donanım Kimlikleri → `USB\VID_XXXX&PID_YYYY` formatından `vendorId` (hex → decimal: `XXXX`) ve `productId` decimal çıkarma, (2) `config.json`'a `type: "usb"` + ID'leri yazma, (3) servis restart (`nssm restart RestoranPosPrintAgent`), (4) smoke: log'da "USB printer found, bulk-out endpoint claimed" mesajı. *(Kullanıcı tek başına USB yapılandırması yapabilsin diye adım adım.)*

---

#### B) Out-of-scope (v5.1+ backlog veya hiç)

Her madde için "neden v5.1" gerekçesi.

- **Multi-printer routing** (kitchen + bar + receipt aynı Agent'ta birden çok USB cihaz aynı anda) — ADR-004 §3 1:1 Agent-printer ana karar; multi-printer ADR-022 v5.1 backlog'unda zaten kayıtlı. *(Ana mimari karar, PR-5b kapsamı değil.)*
- **USB hot-plug detection** (cihaz fişten çıkıp tekrar takılırsa otomatik recovery, `usb.on('attach' | 'detach')` event listener) — basit retry yeterli: cihaz bulunamazsa job FAIL → Agent next poll'da tekrar dener. Hot-plug event listener event loop'ta hayatta tutma + cleanup karmaşıklığı; restoran ortamında yazıcı fişi çıkma nadir → over-engineering. *(v5.1+ backlog, ADR-022 M-yeni olarak kayıt edilebilir.)*
- **ESC/POS protokol seviyesi ack** (`DLE EOT 1` printer status query → cevap byte parse: kağıt var/yok, kapak açık/kapalı, jam) — TCP transport'ta da yok; 1-yön byte stream pattern korunur. USB bidirectional iletişim mümkün ama PR-5b kapsamı transport-level send, protokol ack ayrı feature. *(v5.1+ "printer status integration" yeni feature, ayrı ADR gerek.)*
- **USB printer firmware update / config** (printer-side ESC/POS DIP switch, code page set komutu) — kullanıcı printer-side manuel yapar (yazıcının kendi config menüsü); Agent transport'u kapsam dışı. *(Cihaz spesifik, Agent generic değil.)*
- **WinUSB / WPD (Windows Portable Devices) alternatif transport** — libusb tabanlı `usb` paketi yeterli; WinUSB Windows-spesifik native API, cross-platform potansiyelini öldürür (Linux/macOS gelecek için kapatır). *(Library seçimi kapanmıştır; Soru #1'de tartışıldı.)*
- **USB device chooser UI** (Agent başlatıldığında bağlı USB cihazları listeleyip seçim modal) — Agent CLI/service mode'da çalışır, UI yok; config dosyası ile statik seçim yeterli. *(Manager UI'ya entegrasyon v5.1+ "Printer Discovery API" feature olarak ayrı.)*

---

#### C) 4 zorunlu karar — net cevaplar

**Soru #1: USB library seçimi**

→ **(a) `node-usb` (libusb tabanlı, npm `usb` paketi)** — SEÇİLDİ.

Gerekçe: (i) **Pre-built binary**: `usb` paketi `prebuildify` ile Windows x64 native binary (`node.napi.node`) shipler — kullanıcı PC'sinde MSVC build tools kurulu olması gerekmez (kritik: restoran PC'sinde dev toolchain yok). (ii) **`@yao-pkg/pkg` uyumu**: native `.node` binary `pkg.assets` config'ine eklenince bundle'a girer; PR-6 build pipeline'ı bozulmaz. (iii) **Lisans**: BSD-2-Clause — embed legal pürüzsüz. (iv) **Bakım**: 2024+ aktif (`node-usb/node-usb` GitHub), Node 22 desteği N-API ile garantili. (v) **Cross-platform potansiyeli**: libusb Linux/macOS'ta da çalışır (Phase 4+ multi-OS ihtimali açık kalır). Reddedilen: **(b) `escpos-usb-adapter`** → `node-escpos` ekosistemine bağımlılık ekler, biz render primitive'ları PR-4a'da kendi yazdık; ek abstract layer maintenance yükü; **(c) WinUSB direct** → Win32 API binding (`node-ffi-napi`) ölmüş paket, native build complexity ölçüde; **(d) USB-Serial adapter** → ESC/POS yazıcılar CDC ACM emülasyonu **bazı modellerde** var ama generic değil; vendor-specific bulk transfer endpoint pattern daha güvenli.

**Soru #2: USB device identification — config'de ne tutulur?**

→ **(c) `vendorId + productId` zorunlu + `serialNumber` opsiyonel disambiguator** — SEÇİLDİ.

Gerekçe: (i) **Production env (kullanıcının restoranı)**: tek USB ESC/POS yazıcı bağlı → vendorId+productId yeterli, `findByIds(vid, pid)` ilk eşleşeni döner. (ii) **Lab/test env veya çoklu cihaz pilot kurulum**: aynı model 2+ yazıcı (örn. 2x Epson TM-T20III) takılıysa vid+pid aynı → ayırt etmek için `serialNumber` (opsiyonel). USB descriptor'dan `device.getStringDescriptor(device.deviceDescriptor.iSerialNumber)` ile okunur, config'de set edildiyse filtre uygulanır. (iii) **UX**: kullanıcı Aygıt Yöneticisi'nden vid+pid'i tek hamlede çıkarır (README'de adım adım); serialNumber'ı yalnız "iki yazıcım var, hangisi?" sorduğunda doldurur. (iv) **Cihaz kimliği güvenirliği**: serialNumber USB descriptor'da **garanti değil** (ucuz Çin yazıcılarında boş veya hep `0` döner) → tek başına primary key yapmak kırılgan. Reddedilen: **(a) sadece vid+pid** → çoklu cihazda ayırt edilemez; **(b) sadece serialNumber** → her yazıcıda yok, üretici implementasyonuna bağımlı.

**Soru #3: Endpoint (USB bulk-out) keşfi — otomatik mi config'te mi?**

→ **(a) Otomatik (auto-discovery)** — SEÇİLDİ.

Gerekçe: (i) **ESC/POS USB printer pattern**: %99 cihaz `Interface 0`, tek `bulk-out endpoint` (`0x01` veya `0x02` adresinde) kullanır — Epson, Star, Bixolon, Citizen, generic Çin yazıcılar dahil. `iface.endpoints.find(ep => ep.direction === 'out' && ep.transferType === LIBUSB_TRANSFER_TYPE_BULK)` deterministik tek sonuç verir. (ii) **UX**: kullanıcı `vendorId + productId` zaten girmek zorunda; `interfaceNumber: 0, endpointAddress: 0x02` ekstra alan operatör kafa karıştırır + yanlış yazılırsa cryptic LIBUSB error. (iii) **Fallback**: ileride exotic cihaz çıkarsa amendment ile `endpointAddress` config override eklenebilir (Hibrit (c) gelecekte mümkün, ama PR-5b kapsamı dışı YAGNI). (iv) **Hata mesajı**: endpoint bulunamazsa Türkçe "USB yazıcı bulundu ama bulk-out endpoint yok; cihaz ESC/POS uyumlu olmayabilir" mesajı kullanıcıya. Reddedilen: **(b) explicit config** → kullanıcı yükü, yanlış adres = sessiz fail; **(c) hibrit** → şu an YAGNI, exotic cihaz ihtiyacı doğmadan eklenirse YAGNI ihlali.

**Soru #4: CI test strategy — USB transport sandbox'tan nasıl test edilir?**

→ **(c) Hibrit: unit test (vitest mock `usb` module) + integration test SKIP CI'da (`it.skipIf(process.env.CI)` lokal eşliği)** — SEÇİLDİ.

Gerekçe: (i) **Sandbox / CI gerçek USB yok** → unit test zorunlu mock layer (vitest `vi.mock('usb', () => ({ findByIds, getDeviceList, ... }))`). 6-8 case mock byte stream + error path coverage. (ii) **Real printer smoke** lokal donanım gerekir → `it.skipIf(process.env.CI)` ile lokal koşulda Türkçe CP857 (`Şişman pide`) + ESC/POS init/cut basım doğrulanır; CI'da skip. (iii) **TCP transport'taki settle pattern paritesi** unit test'lerde aynı pattern (Promise resolve/reject mock callback). (iv) **Coverage drift riski**: mock'lar gerçek libusb davranışını birebir taklit etmez; lokal smoke + kullanıcı eşliği bu boşluğu kapatır (DoD § §D'de explicit). Reddedilen: **(a) sadece mock** → real cihazla gerçek bulk transfer test edilmez, bug production'a sızar; **(b) sadece skip lokal** → unit coverage düşer, regression bot algılamaz.

---

#### D) DoD (Definition of Done) checklist

PR-1/Amendment 1/Amendment 2/PR-6 paterni — madde madde.

- [ ] Branch `feat/print-agent-phase3-pr5b` (worktree'den ayrılır; main'e direkt commit yasak — branch-first workflow MEMORY.md).
- [ ] `pnpm install` — `usb` paketi Windows x64 prebuilt binary kurulumu başarılı (`node_modules/usb/prebuilds/win32-x64/node.napi.node` mevcut); native MSVC build tetiklenmedi.
- [ ] `pnpm --filter @restoran-pos/print-agent typecheck` temiz; `z.discriminatedUnion` narrowing `printerConfig.type === 'usb'` branch'inde `UsbConfig` tipi otomatik çıkar.
- [ ] `pnpm --filter @restoran-pos/print-agent test` — mevcut 10 sandbox unit test + yeni 6-8 USB unit test (mock `vi.mock('usb')`) PASS; her test < 100ms.
- [ ] `pnpm --filter @restoran-pos/print-agent build:exe` (`@yao-pkg/pkg`) USB native binary (`node.napi.node`) `pkg.assets` config sayesinde bundle'a dahil; exe runtime'da `require('usb')` patlamaz.
- [ ] **Lokal MSI build** (`apps/print-agent/installer/build-msi.ps1`) — yeni `usb` library dahil binary kullanıcının PC'sinde install/uninstall PASS; MSI boyutu < 65 MB (PR-6 < 60 MB hedefine +5 MB tolerans).
- [ ] **Real printer smoke (kullanıcı eşliği ZORUNLU):** kullanıcının USB ESC/POS yazıcısı bağlı, config'de `type: usb` + vendorId/productId set; Agent servis restart → kuyruğa test job push → kağıtta çıktı: (a) Türkçe CP857 (`Şişman pide`, `Çorba`, `Içecek` karakterleri doğru), (b) ESC/POS init `\x1B@` reset, (c) cut `\x1Di` ile kağıt kesilir. Kullanıcı görsel doğrulama PASS verir.
- [ ] CI `ci.yml` + `Playwright Smoke` + `migration-check` + `print-agent-msi.yml` yeşil; integration smoke USB CI'da skip (`it.skipIf(process.env.CI)`), unit mock PASS.
- [ ] `apps/print-agent/installer/print-agent.config.json.template` USB section comment örneği eklendi (vendorId/productId/serialNumber).
- [ ] `apps/print-agent/installer/README.md` "USB Yazıcı Yapılandırması" alt-başlığı eklendi: Aygıt Yöneticisi'nden vid+pid bulma + config örnek + servis restart + smoke log mesajı.
- [ ] Tool kilidi (§5) `node-usb` library seçimi `escpos-usb-adapter` / WinUSB / USB-Serial alternatif yasak; tartışılırsa ADR amendment gerek.
- [ ] **Phase 3 9/9 ✅ closure mührü**: `docs/project-charter.md` §Phase 3 "Durum" satırı `8/9 PR (PR-5b ertelendi)` → `9/9 PR ✅ KAPANDI`; `.claude/memory/scratchpad.md` Phase 3 backlog kaldırıldı; Session 69 özetinde mühür satırı.

---

#### E) Cross-ref

- **ADR-004 §5** (tool kilidi USB öncelikli + TCP fallback) — bu amendment USB library seçimini (`node-usb`) kilitler; pkg + nssm + WiX dokunulmaz.
- **ADR-004 §3 1:1 Agent-printer** — PR-5b tek-cihaz varsayımını korur; multi-printer ADR-022 v5.1 backlog'unda zaten kayıtlı.
- **PR-5a TCP transport** (Session 66 PR #173) — `PrinterConfigSchema` `z.discriminatedUnion` migrate edilir; mevcut `type: 'tcp'` config'ler **geriye dönük uyumlu**.
- **PR-4a render primitives** (Session 65) — CP857 byte stream + ESC/POS init/cut transport-agnostic; USB bulk-out endpoint'e aynı byte dizisi gider.
- **PR-6 MSI** (Session 67/68) — `pkg.assets` config'ine `usb` native binary (`node.napi.node`) eklenir; build pipeline değişmez.
- **ADR-022 v5.1+ Backlog** — USB hot-plug detection + ESC/POS status query + multi-printer routing ileride M7-M9 olarak eklenebilir; PR-5b kapsamı dışı.
- **v3 referans** (`D:\dev\restoran-pos-v3\`) — StoreBridge USB binding **kod kopyalama yasak** (CLAUDE.md), davranışsal referans yalnız CP857 encoding ve ESC/POS init/cut komut domain bilgisi (zaten PR-4a'da v5'e temiz yazıldı).

---

#### F) Implementer brief özet (parent agent için)

1. **Branch:** `feat/print-agent-phase3-pr5b` (worktree'den ayrılır; main'e direkt commit yasak).
2. **Dosya whitelist:** `apps/print-agent/package.json` (`usb` dependency + `pkg.assets` native binary entry), `apps/print-agent/src/printer/config.ts` (discriminated union migrate), `apps/print-agent/src/printer/usb-transport.ts` (yeni), `apps/print-agent/src/printer/usb-transport.test.ts` (yeni, vitest mock `usb`), `apps/print-agent/src/index.ts` (pollOnce dispatch switch), `apps/print-agent/installer/print-agent.config.json.template` (USB comment section), `apps/print-agent/installer/README.md` (Türkçe USB yapılandırma alt-başlığı).
3. **Karar matrisi (Soru #1–#4):** `node-usb` (npm `usb`), `vendorId+productId` zorunlu + `serialNumber` opsiyonel, bulk-out endpoint **auto-discovery**, hibrit test (vitest mock + lokal skipIf integration).
4. **DoD §D'deki 12 madde** — her birine ait commit message veya PR checklist satırı; real printer smoke kullanıcı eşliğinde manuel doğrulama (CI bypass).
5. **Test stratejisi:** Yeni `usb-transport.test.ts` 6-8 case mock (happy path / device not found / endpoint not found / timeout / serialNumber disambiguator / cleanup finally / interface claim fail / byte stream content). Integration real-cihaz lokal skipIf. `pollOnce` dispatch testi mevcut TCP integration test paterni izler.
6. **Türkçe README zorunlu** (CLAUDE.md kullanıcıya görünen Türkçe kuralı); Aygıt Yöneticisi'nden vid+pid çıkarma adım adım + config örnek + smoke log mesajı.
7. **Tool kilidi koruma:** Library alternatifi (`escpos-usb-adapter` / WinUSB / `usb-detection`) yasak; ekleme talebi ADR amendment gerektirir. `node-thermal-printer` USB binding tartışılırsa: zaten v3 StoreBridge bağımlılığıydı, v5'te kod yasak (CLAUDE.md).

---

#### G) Risk + uyarılar

- **Real printer smoke gereksinimi:** CI mock unit test'i USB bulk transfer'ın gerçek davranışını tam yansıtmaz; libusb endpoint claim / kernel driver conflict Windows-spesifik edge case'ler ancak lokal yazıcıda görülür. PR merge için kullanıcı eşliğinde fiziksel doğrulama **zorunlu** — DoD §D'de explicit.
- **`usb` paketi native binary boyutu:** prebuilt `node.napi.node` ~2 MB; MSI'a eklenince toplam < 65 MB hedefi tutar ama Phase 4+ ek native paket (örn. encryption) gelirse bütçe daralır. PR-5b'de tek native dependency; sınır kontrolü ileride.
- **USB descriptor parse fail (ucuz Çin yazıcılar):** Bazı klon yazıcılar USB descriptor'larında bozuk string döndürür → `device.getStringDescriptor` patlayabilir. Hata yakalanır + Türkçe anlamlı mesaj ile log'lanır; servis crash yasak (Agent loop devam eder, next poll job FAIL döndürür).
- **Windows USB kernel driver conflict:** Generic USB printer driver kuruluysa libusb `LIBUSB_ERROR_ACCESS` döner. Çözüm: README'de "Zadig ile libusb-win32 driver kurma" alt-bölümü; **veya** WinUSB driver tercihi. PR-5b README'de bu opsiyon dokümante; otomatik kurulum MSI scope dışı (kullanıcı eli gerek).
- **Çoklu test cihaz farkı:** Soru #2 cevabı (`serialNumber` opsiyonel) lab'da test edildi mi? Şu an kullanıcının 1 USB yazıcısı var → `serialNumber` filtreleme **kod yolunda var ama runtime'da test edilmedi**. Mock unit test bu path'i kapsar; production'da bug çıkarsa ADR amendment + bug fix.

---

#### H) DoD §D Sonuç — Real-printer smoke (Session 70, 2026-06-27)

Kullanıcı eşliğinde gerçek USB ESC/POS yazıcıda smoke tamamlandı → **PASS**. Phase 3 9/9 closure mührü atıldı (`docs/project-charter.md` §Phase 3 `8/9` → `9/9 ✅`).

- **Donanım:** STM32-tabanlı POS-80 termal yazıcı, `vid=0x0483 pid=0x5743` (USB ID `0483:5743`).
- **Transport ✅:** `sendToUsbPrinter` 439 byte bulk-out transfer → kağıt çıktı, otomatik kesim (GS V 1) çalıştı. Settle pattern + cleanup gerçek libusb'de doğrulandı.
- **Driver engeli (§G tahmini doğrulandı, mesaj farklı):** Windows generic printer driver (`POS 80 Printer`) yüklüyken `device.open()` → **`LIBUSB_ERROR_NOT_SUPPORTED`** (§G `LIBUSB_ERROR_ACCESS` tahmin etmişti; aynı kök neden — kernel driver libusb erişimini bloklar). **Çözüm: Zadig 2.9 → WinUSB driver** (Options → List All Devices → "USB Yazdırma Desteği" `0483:5743` → Replace Driver). WinUSB sonrası `open()` OK. Pilot deploy PC'de kalıcı (yazıcı yalnız Print Agent için).
- **Codepage donanım-doğrulaması (ÖNEMLİ):** Smoke ilk denemede Türkçe `Ş Ğ İ` bozuk çıktı (`× Ž Ś`). Kök neden: smoke runner `ESC t 18` gönderiyordu — **Epson ESC/POS standardında 18 = CP852 (Latin-2), CP857 değil.** Codepage tarama (n=12..18, aynı CP857 byte'ları) ile yazıcının tam Epson standart tablosu kullandığı doğrulandı: **`ESC t 13` = CP857 ✅** (Ş Ğ İ Ö Ç Ü tam), 16=WPC1252, 18=CP852 elendi. **Üretim kodu (`packages/shared-domain/src/printer/esc-pos.ts` `CODEPAGE_CP857 = ESC t 13`) zaten doğru** — bu bug yalnız lokal smoke runner'daydı, üretime hiç sızmadı. `apps/api/.../templates/kitchen-receipt.ts` hattı (RESET → CODEPAGE_CP857 → içerik → CUT_FULL) smoke ile birebir aynı → gerçek mutfak fişi bu yazıcıda doğru Türkçe basacak.
- **Operasyonel öğreti:** Yeni bir POS-80 yazıcı pilotunda iki ön-koşul: (1) Zadig WinUSB driver, (2) codepage'in `ESC t 13` (CP857) olduğu firmware doğrulaması. Farklı firmware'de codepage numarası kayabilir → tarama yöntemi (`scripts/codepage-scan-smoke.ts`, gitignored lokal helper) reuse edilebilir.

<!-- ADR-004 §Phase 3 PR-5b scope kilidi (Session 69, 2026-05-14) — architect sub-agent; USB transport (node-usb library) + config discriminated union (TcpSchema|UsbSchema) + pollOnce dispatch + vitest mock unit + lokal real printer smoke kullanıcı eşliği; 4 karar (node-usb / vid+pid zorunlu serialNumber opsiyonel / bulk-out auto-discovery / hibrit test mock+skipIf); pkg.assets native binary entry MSI build korunur; tool kilidi §5 USB library node-usb seçimi kilitlendi; v5.1+ backlog: multi-printer routing / hot-plug detection / ESC/POS status query / WinUSB alternatif; Phase 3 9/9 closure mührü bu PR ile atılır -->

---

### §Amendment 3 — Print Job Retry Requeue + Stuck Reclaim (reliability defect fix, Session 70, 2026-06-27)

- **Durum**: Accepted
- **Tarih**: 2026-06-27

#### A3.1 — Önbilgi (reliability DEFECT, yeni özellik değil — scope-lock gerekçesi)

Session 70 kalite denetiminde 🔴 bulgu: cloud `print_jobs` kuyruğunda **iki sessiz mutfak-fişi kaybı vektörü** var. Bunlar `attempts` (§Amendment 1) tasarlanırken `retry→queued` geçişi "Phase 4+ cron"a ertelenmişti (`print-jobs.ts:38,127-128` yorumları). PR-5b USB transport prod'a çıktığı için (Session 66-68 MSI canlı) bu erteleme artık **production reliability defect**'i:

- **Vektör A — retry çıkışsız:** `printing+failed` → `status='retry'` (attempts<3) yazılır ama claim sorgusu (`print-jobs.ts:179`) YALNIZ `status='queued'` çeker; `retry→queued` cron YOK → yazıcı bir kez offline olunca (kağıt bitti/kapandı) fiş `retry`'de sonsuza kalır, asla basılmaz.
- **Vektör B — printing stuck:** agent claim (`status='printing'`) sonrası result POST'a ulaşamadan ölürse (process kill / restart) job kalıcı `printing`de kalır; reclaim mekanizması yok → fiş kaybı.

Kapsam-kilidi: bu Phase-4-ertelenmiş işi öne çekmek **CLAUDE.md §6 "ADR ile gerekçelendir"** yoluyla meşru — "güzel olur" değil, prod'da fiş kaybeden defect. Multi-agent / LISTEN-NOTIFY / manuel iptal UI hâlâ Phase 4+.

#### A3.2 — Karar: lazy reclaim/requeue (cron'suz), claim sorgusu içinde

Çok-ajanlı tasarım workflow'u (harita → 2 mimar paralel + hakem → 3 adversarial lens) sonucu. **Ayrı cron REDDEDİLDİ** (gerekçe: `index.ts:88` cron `NODE_ENV='test'`te koşmaz → integration-test kapsamı sıfır; ayrı writer + lock-id + dosya). retry-requeue ve stuck-reclaim mevcut `GET /jobs/next` atomik claim sorgusunun inner SELECT'ine gömülür (FOR UPDATE SKIP LOCKED ile tek atomik UPDATE, race-free):

```sql
SELECT id FROM print_jobs
 WHERE tenant_id = $1 AND (
   status = 'queued'
   OR (status = 'retry'    AND retry_at IS NOT NULL AND retry_at <= now())
   OR (status = 'printing' AND updated_at < now() - make_interval(secs => $stale))
 )
 ORDER BY (status = 'printing'), created_at   -- printing-reclaim EN SONA (anti-starvation)
 FOR UPDATE SKIP LOCKED LIMIT 1
```
Dış UPDATE **uniform `SET status='printing'`** — CASE yok, `attempts`'a DOKUNMAZ (tüm karmaşa buradan kalkıyor, aşağı). `printing→printing` reclaim'inde `updated_at` trigger (`print_jobs_set_updated_at`) ile tazelenir → 90s penceresi yeniden kurulur, ayrı `claimed_at` kolonu gerekmez.

**Backoff:** result handler `printing→retry` transition'ında `retry_at = now() + make_interval(secs => 10*2^(nextAttempts-1))` (JS'te 10s/20s hesaplanır; attempts ceiling=3 olduğu için yalnız 1.→10s, 2.→20s). `retry AND retry_at IS NOT NULL` defansif guard: elle/eski NULL-retry satır sonsuz claim edilmez. success/cancelled → `retry_at=NULL`.

**Reclaim eşiği:** `PRINT_AGENT_RECLAIM_STALE_SECONDS` env, default **90s**. Gerekçe: agent transport timeout (config `timeoutMs` ≤60s) + long-poll 25s'den büyük → sağlıklı in-flight job yanlış reclaim edilmez. (B'nin 5dk'sı reddedildi: rush'ta 5dk sessiz fiş kabul edilemez.)

#### A3.3 — Adversarial review'ın tasarımı nasıl SADELEŞTİRDİĞİ (3 lens, hepsi "sound-with-fixes")

İlk sentezlenmiş tasarım reclaim'de `attempts+1` + ceiling reuse + idempotency index içeriyordu. 3 doğrulama lens'i (concurrency / idempotency / backward-compat) bunlarda gerçek bug buldu → tasarım **çıkararak** sadeleştirildi:

- **`attempts` interleaving (R3/ISSUE-2):** reclaim-bump + result-handler read-then-write bump interleave → ceiling delinir / double-count. **Çözüm: reclaim attempts'a HİÇ dokunmaz.** Tek attempts writer result handler kalır (`WHERE status='printing'` guard'ı serialize eder). Interleaving tamamen yok olur.
- **attempts=3 stuck sonsuza kalır, sinyal yok (ISSUE-1):** ceiling'li reclaim self-defeating. **Çözüm: reclaim'de ceiling YOK** — stuck job her zaman reclaim-eligible ama `ORDER BY` ile EN SONA sıralı. Pathological "printer bozuk" job döngüde kalır ama bu GÖRÜNÜR sinyaldir (yazıcı tekrar tekrar deniyor), terminal-cancel'ın aksine sessiz kayıp değil.
- **Starvation (R4):** stuck-printing eski created_at ile taze fişlerin önüne geçer. **Çözüm: `ORDER BY (status='printing'), created_at`** → reclaim daima taze queued/retry'den SONRA.
- **False-positive double-print (R2/I4):** **1-agent deployment'ta pratikte imkansız** — agent yazdırırken (sendToUsbPrinter'da bloklu) poll etmiyor, kendi job'unu reclaim edemez; reclaim yalnız agent GERÇEKTEN öldüğünde (restart sonrası yeni instance) tetiklenir. ADR-004 §3 1:1 agent-printer; multi-agent lease semantiği out-of-scope.

#### A3.4 — Düşürülen (C) idempotent enqueue → v5.1 (adversarial gerekçe)

İlk tasarım `print_jobs.order_id` + `(tenant_id,order_id)` partial-unique + ON CONFLICT DO NOTHING içeriyordu. **3 lens de bunu çıkarmayı doğruladı:**
- `enqueueKitchenJob` her çağrıda tüm `status='sent'` item'ları reselect eder; order_id-only anahtar **aynı order'a meşru ikinci mutfak turunu** (item ekle + yeniden gönder, v3 davranışı) ilk job aktifken SESSİZCE düşürür → tam da önlemek istediğimiz silent-loss'u YENİDEN üretir.
- Bugün re-send route YOK, tek call-site (`orders.ts:504,865` order-create, tek atış) → guard'a ihtiyaç bile yok; index kalıcı yanlış-semantikli kontrat ekler.
- **Karar:** idempotent enqueue v5.1'e ertelenir; re-send/add-items route geldiğinde **per-send-round / item-set anahtarı** ile (çıplak order_id ile DEĞİL) çözülür. `enqueue-kitchen-job.ts:7-10` yorumundaki "v5.1 backlog" notu korunur.

#### A3.5 — Implementasyon + geriye uyum

- **Migration 039** (`039_print_jobs_retry_at.sql`): `ALTER TABLE print_jobs ADD COLUMN retry_at TIMESTAMPTZ;` (nullable, default'suz → instant, table-rewrite yok) + COMMENT. order_id/index YOK. `pnpm codegen` → `PrintJobs.retry_at: Timestamp|null`.
- **`apps/api/src/routes/print-jobs.ts`**: claim inner SELECT (A3.2) + result UPDATE'e `retry_at` CASE + `RECLAIM_STALE_SECONDS` const (env override). `PrintJobRow`/`rowToJobDto`/DTO **DEĞİŞMEZ** (retry_at SELECT'lenmiyor, agent kullanmıyor → `JobsNextResponseSchema` stabil).
- **Geriye uyum:** %100 cloud-side. Agent kontratları (`GET /jobs/next`, `POST result`) bit-aynı; transport/config/discriminated-union dokunulmaz. 11 mevcut print_jobs test additive kolon (NULL) + claim superset ile kırılmaz. Yeni testler: retry_at<=now claim / retry_at>now skip / stuck reclaim (INSERT'le updated_at=now()-200s — trigger BEFORE UPDATE, INSERT'i etkilemez) / queued-claim attempts değişmez / anti-starvation sıralama.
- **i18n:** agent UI yok, kullanıcı-string yok. **no-any:** açık union'lar.

<!-- ADR-004 §Amendment 3 (Session 70, 2026-06-27) — ana context (workflow design + adversarial verify); reliability defect: retry requeue + printing stuck reclaim cloud-side lazy (cron'suz, /jobs/next claim sorgusu içinde tek atomik UPDATE); Migration 039 retry_at TIMESTAMPTZ tek kolon; reclaim attempts'a DOKUNMAZ + ceiling YOK + ORDER BY (status='printing') anti-starvation; backoff 10s/20s retry_at; RECLAIM_STALE_SECONDS env=90; (C) idempotent enqueue order_id index DÜŞÜRÜLDÜ → v5.1 per-round key (adversarial: order_id-only meşru 2. turu sessiz düşürür); DTO/agent kontratı değişmez; 1-agent false-positive double-print pratikte imkansız; scope-lock CLAUDE.md §6 ADR-gerekçeli defect fix -->

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

- **Sprint 14 PR-4a (2026-05-11):** `REPORT_TOO_LARGE` (400) eklendi — ADR-021 100k row cap aşımı, CSV export `?format=csv` istemi limit dışına çıktığında. i18n key `error.report.tooLarge`. Domain-specific naming kuralına uygun (`RESOURCE_TOO_LARGE` jenerik fallback yerine raporlar için ayrı kod). HTTP 400 seçimi: response büyüklüğü problemi olduğu için 413 Payload Too Large semantik olarak yanlış (413 request body için), client'ın yapacağı düzeltme `range` daraltmak — RFC 9110 §15.5.1 client error.

- **ADR-014 §12 (2026-06-27, Session 70):** `PAYMENT_EXCEEDS_TOTAL` (400) eklendi — `/payments *_close` overpaid (close anında `SUM(amount_cents) > payable`). i18n key `error.payment.exceedsTotal`. Domain-specific naming (§5.3 rezervindeki generic `PAYMENT_AMOUNT_MISMATCH` yerine close-spesifik kod). underpaid karşılığı mevcut `PAYMENT_INSUFFICIENT_FOR_CLOSE` (Sprint 13, errors.ts). HTTP 400: client düzeltmesi tutarı tam toplama eşitlemek — RFC 9110 §15.5.1. **Drift notu:** Sprint 13 payment kodları registry tablosuna backfill edilmemişti — `apps/api/src/errors.ts` `AUTH_MESSAGE_KEYS` otoriter kaynak, bu tablo temsilî.

- **Sprint 13 backfill (2026-06-27, Session 70 hijyen):** aşağıdaki ADR-014 PR-7 payment kodları (errors.ts'te mevcuttu, tabloda yoktu) kayda geçti:
  - `COMP_ITEM_IN_PAYMENT` (409) — ikram (comped) kalem ödemeye eklenemez. DB trigger C1 (`block_comped_item_in_payment`, ADR-003 §10.5.2) + domain pre-check. `error.payment.compItemInPayment`.
  - `PAYMENT_QTY_EXCEEDS_ORDER_ITEM` (409) — partial-qty allocation `SUM(existing+new) > order_items.quantity` (Migration 023 cross-row guard). `error.payment.qtyExceedsOrderItem`.
  - `PAYMENT_INSUFFICIENT_FOR_CLOSE` (400) — Mod B "Masayı Kapat" (`payOrder`) + `/payments *_close` (ADR-014 §12) underpaid. `error.payment.insufficientForClose`.
  - (`ORDER_ITEM_ALREADY_PAID` errors.ts'te tanımlı ama runtime'da fırlatılmıyor — rezerv; backfill kapsamı dışı.)

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

### §7 — Amendment (2026-06-28) — Garson tenant-geneli açık adisyon (ADR-025 K4 uygulaması)

**Bağlam.** ADR-025 K4 (mobil garson) masa-devri/handoff gerçeğini açar: 25 masa, 2-4 garson, bir garson diğerinin masasına bakabilmeli/kalem ekleyebilmeli (charter §133). Phase 2 Görev 16'da kurulan own-only ABAC (`waiter_user_id === self`) bu akışı kırar. Ürün sahibi kararı = **güvenli default**: görünürlük + kalem-ekleme genişler, ama void/edit garson için **item-owner** ile sınırlı kalır.

**(a) Garson görünürlüğü + kalem-ekleme genişler.**
- `GET /orders` (list): waiter → tenant-geneli **AÇIK** (terminal olmayan) adisyonları görür. Eski own-only `waiterUserId === self` filtresi kaldırıldı; yerine açık-status kapsamı (`status NOT IN ('paid','cancelled','void')`, repo `OrderListFilters.openOnly`). Kapalı/ödenmiş/historical siparişler garsona görünmez (onlar rapor = admin/cashier).
- `GET /orders/:id`: waiter → herhangi **AÇIK** adisyon **VEYA** kendi adisyonu (her status). Açık olmayan + kendi olmayan → 404 (IDOR yüzeyi minimumda; kapalı sipariş garson için yok hükmünde).
- `POST /orders/:id/items`: waiter herhangi **AÇIK** adisyona kalem ekler. (Bu endpoint'te zaten own-only kısıt YOKTU; açık-adisyon sınırı repo `addItems` terminal-status guard'ı — `ORDER_INVARIANT_VIOLATED` — ile zaten enforce ediliyor.) Mutfağa otomatik gönderim (kitchen_print → status değişimi + print_job) **DEĞİŞMEZ**.
- admin/cashier/kitchen kapsamı **değişmez** (hepsi tenant-scoped tüm siparişleri görür).

**(b) Önbilgi düzeltme (architect varsayım-drift'i, code-implement'te doğrulandı).** K4 metni "garson yalnız kendi eklediğini void eder, **mevcut kural korunur**" diyordu — yani own-scoped void varsayıyordu. GERÇEK kod (`PATCH /orders/:orderId/items/:itemId`) **owner-check'siz**: void kuralı status-bazlıydı (`status='new'` → herhangi staff; `status!=='new'` → admin/cashier). Yani mevcut kural owner-scoped DEĞİLDİ. K4'ün niyetini onurlandırmak + genişletilmiş görünürlüğün IDOR yüzeyini kapatmak için **2b bu owner guard'ı EKLER**: waiter rolü için `targetItem.created_by_user_id !== self` ise void (`status='cancelled'`) **ve** note-edit → **403 AUTH_FORBIDDEN**. Net sonuç (garson): own item **AND** `status='new'` → void/edit OK. admin/cashier owner-check'siz (değişmez).

**(c) Değişmeyen sınırlar.** comp toggle (`isComped`) → admin/cashier (§9.2, mevcut); `status!=='new'` (mutfağa gönderilmiş) kalem void → admin/cashier (mevcut); `POST /payments`, sipariş iptali (`POST /orders/:id/cancel`, `PATCH /orders/:id` status), takeaway-stage → admin/cashier(+admin), garson 403 (mevcut). **Cross-tenant ASLA** — her sorgu `tenant_id` WHERE; tenant B garsonu tenant A adisyonunu göremez/değiştiremez (404/403).

**(d) Cross-ref.** ADR-025 K4 (~9887), Phase 2 Görev 16 own-only ABAC kökeni (bu ADR §2/§3 + §5 "ABAC enable" akışı), ADR-002 §6 RBAC permission matrix (`orders.read` + handler-içi ABAC notu ~3798). Kod: `apps/api/src/routes/orders.ts` (GET list + GET by-id + PATCH item owner guard), `packages/db/src/repositories/orders.ts` (`OrderListFilters.openOnly` + `TERMINAL_ORDER_STATUSES`), `apps/api/src/__tests__/orders.test.ts` (genişletilmiş ABAC testleri). Gate: security-reviewer (IDOR yüzeyi).

### Amendment History

> ADR amendment paterni: bu altbölüme tek satır eklenir, inline (Amendment ...) notları kullanılmaz. Sonraki ADR amendment'leri kendi ADR'lerinde aynı altbölüm ile takip edilir.

| Tarih | Amendment | Değişen bölümler | Gerekçe |
|---|---|---|---|
| 2026-04-27 | FK semantiği netleştirme + Sprint 3→4 KDS drift cleanup | §3.3, §4.1, §4.2, §6 | (1) §4.1 orijinal "REFERENCES users(id, tenant_id)" yazıyordu ama ON DELETE/UPDATE davranışı + partial index belirsizdi → Görev 14 öncesi netleştirildi (ON DELETE SET NULL, audit pattern hizalı; partial index waiter filter baseline). (2) Sprint 3 boyutu (~1500 satır) nedeniyle Sprint 3a (ABAC unblock) + Sprint 3b (admin CRUD) + Sprint 4 (KDS) bölündü → §3.3 + §4.2 + §6 referansları "Sprint 3 KDS" → "Sprint 4 KDS" güncellendi. |
| 2026-04-28 | Sprint numaralandırma drift cleanup (charter Phase 3'e hizalama) | §3.3, §4.2, §6, §5.2/§5.3 (PRINT* hata kodları) | active-plan vs charter Phase 2 drift düzeltmesi: charter'da KDS+POST /payments **Phase 3 Sprint 1** kapsamı, active-plan'de yanlışlıkla "Sprint 4" yazılıydı. 7 satır güncellendi: KDS+kitchen ABAC referansları "Sprint 4" → **"Phase 3 Sprint 1"**; Print Agent hata kodları (`PRINT_JOB_NOT_FOUND`, `PRINT_PAYLOAD_TOO_LARGE`) "Sprint 4" → **"Phase 4 Sprint 1"** (charter'da Print Agent Phase 4). Charter referans sabit (23 hafta toplam hedef korunur), Phase 2 takvim sapması (~10 hafta) retrospektif belgelerinde görünür. PR `chore/phase-2-drift-cleanup-sprint-4-9-plan` 2026-04-28. |
| 2026-05-08 | §4.2 kitchen ABAC rezerv kapanışı (Sprint 12 PR-1, Görev 39) | §4.2 | ADR-020 K7 ile kitchen ABAC kararı kilitlendi. `kds.read` + `kds.itemStatusUpdate` permission'ları admin + kitchen rolüne tanımlandı (`packages/shared-types/src/permissions.ts`); cashier + waiter `/kds`'e erişmez (noise filter). `orders.read` "kitchen-routed items only" filtresi `order_items.station` üzerinden Sprint 12 PR-2 backend route'unda enforce edilecek. Cross-ref: ADR-020 K7. |
| 2026-06-28 | §7 — Garson tenant-geneli açık adisyon (ADR-025 K4 uygulaması, İş Kalemi 2b) | §7 (yeni), §2/§3/§5 ABAC akışı yorumlanır | own-only ABAC (Görev 16) → tenant-geneli AÇIK adisyon: garson GET list + GET by-id + POST add-item açık-status kapsamı (masa-devri/handoff, charter §133). **Önbilgi düzeltme:** K4 "void mevcut owner-scoped kural korunur" varsayıyordu; gerçekte PATCH-item void status-bazlıydı (owner-check'siz) — 2b waiter void/edit'e `created_by_user_id === self` guard EKLER. comp/ödeme/iptal/`sent`-item-void DEĞİŞMEZ; cross-tenant ASLA. Cross-ref: ADR-025 K4, Görev 16, ADR-002 §6. Gate: security-reviewer (IDOR). |
| 2026-06-29 | §7e — Garson ödeme + masa-yönetimi ABAC (ADR-027 Faz A, mobil operasyonel terminal) | §7 (yeni §7e); ABAC akışı | `payments.create`/`payments.read` (`POST /payments` + `GET /payments` + split-state) garson dahil herkese **AÇILIR** (mobil 3-nokta Öde/Hızlı Öde, ADR-027). `tables.move`/`tables.merge`/`orders.transferBill` Faz B'de kendi ADR'leriyle (rezerv ADR-028/029/030). **comp/void/sipariş-iptali/müşteri-ata KAPALI kalır (§7c + §7b owner-guard değişmez); cross-tenant ASLA.** Gerekçe: charter §78 kısmi reversal (v3 paritesi + ürün sahibi). Gate: security-reviewer (parasal yetki + IDOR). Cross-ref: ADR-027 K2. |

<!-- ADR-008 Accepted (2026-04-26). GET /orders ABAC ertelemesi + waiter_user_id prerequisite. Amendment 2026-04-27 (Amendment History bölümünde detay). Amendment 2026-06-28 §7 garson tenant-geneli açık adisyon (ADR-025 K4 + Önbilgi düzeltme: void owner guard EKLENDİ). Amendment 2026-06-29 §7e garson ödeme + masa-yönetimi ABAC (ADR-027 mobil operasyonel terminal; payments.create/read +waiter, comp/void/iptal KAPALI). ADR-007 rezerv. -->

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
| 2026-06-30 | **Amendment 2026-06-30 (masa-etiket namespace + aktif-sipariş tanımı + orphan/bölge politikası)** — aşağıda tam metin. Derin masa-domain denetiminden çıkan 19 doğrulanmış bug'ı kapatan 5 grup karar (Session 75). | Karar 1 (yeni `tables.display_no` kalıcı etiket), Karar 5'e bölge-silme guard ekleme, repository `hasActiveOrders` + DB unique index hizalama, web/mobil parite, realtime kapsam. | Aşağıdaki "Amendment 2026-06-30 — tam metin" bölümünde. |

### Amendment 2026-06-30 — tam metin (masa-etiket namespace + aktif-sipariş + orphan/bölge)

**Durum:** Accepted (İlhan onayı 2026-06-30 — "tüm eksikleri doğru biçimde tamamla") · **Tarih:** 2026-06-30 · **Session 75**

**Bağlam.** Derin masa-domain denetimi 19 doğrulanmış bug çıkardı. Çoğu yapısal: masa etiketi için 4 ayrı isim uzayı, aktif-sipariş tanımının 3 yerde uyuşmaması, bölge silmenin dolu masayı tahtadan kaybetmesi, web/mobil parite kayması. Öncelik hiyerarşisi (CLAUDE.md): veri bütünlüğü (yanlış masaya servis = sipariş hatası) > UX (yoğun saatte masa kaybolması) > sürdürülebilirlik (tek-yol etiket).

---

#### Karar A — Tek kanonik masa-etiketi: kalıcı per-bölge `tables.display_no` (Grup 1, #1/#3/#4/#5/#6/#7/#16)

**Sorun.** Şu an 4 isim uzayı: (1) board + order-header **bölge-içi pozisyonel ordinal** (`buildTableLabelMap` / `masaLabelInArea`, peers `code.localeCompare(tr,numeric)` → index+1 → "Masa N"; kalıcı kimliğe bağlı DEĞİL — silme/ekleme/sync sıra kaydırır); (2) ödeme/aksiyon modalleri **ham `code`**; (3) mutfak fişi + KDS **`table_code_snapshot` (ham code)**; (4) adisyon fişi **canlı `tbl.code`** (`enqueue-bill-job.ts:64`). Senaryo: `code='26'` masa ekranda "Masa 4", mutfak fişi "Masa: 26" → garson yanlış masaya servis yapar (veri/operasyon hatası).

**Karar.** Kalıcı per-bölge `tables.display_no INTEGER NULL` kolonu eklenir; create + sync-tables sırasında `(bölge içinde) MAX(display_no)+1` ile atanır; **gap-preserving** — masa silinince/sync azalınca peers YENİDEN numaralanmaz (kalıcı kimlik). Bölgesiz (orphan) masa → `display_no` NULL → etiket ham `code`. TEK etiket-türetme util'i `packages/shared-domain` altına taşınır (`tableLabel(table) → area_id !== null && display_no !== null ? 'Masa ' + display_no : code`); web + mobil + backend snapshot aynı util'i çağırır. **Sipariş oluşturma anında snapshot bu kanonik etiketi yazar** (`orders.table_code_snapshot` = `tableLabel(...)`, raw code değil) → fiş/KDS board ile birebir.

**Gerekçe.** v3 paritesi "bölge-içi numaralandırma" davranışını korur (ham code göstermek pariteyi bozardı), ama pozisyonel ordinal'in kayma kusurunu kalıcı kolonla giderir. Fiziksel masa etiketi (üstündeki numara) tek sefer atanır, silme/sync ile değişmez. Snapshot stabilitesi: fiş basıldığı anki etiket sonradan değişmez.

**Çözdüğü bug:** #1 (board↔fiş etiket uyuşmazlığı, HIGH), #3/#4/#5/#6 (4 isim uzayı), #7 (orphan etiket), #16 (snapshot raw code).
**Migration:** EVET (forward-only). `tables.display_no INTEGER NULL` + backfill (mevcut masalara bölge-içi `code` numeric-collated sıraya göre 1..N ata, böylece v3 mevcut görünüm korunur) + create/sync atama mantığı.
**i18n/UI:** `tableLabel` util tek kaynak; "Masa {n}" key zaten var. Reddedilen: her yerde ham `code` (v3 paritesini bozar) ve mevcut runtime-ordinal'i korumak (kayma kusuru kalır).

---

#### Karar B — Aktif-sipariş tek tanım: `TERMINAL_ORDER_STATUSES` (Grup 2, #11/#12 + latent)

**Sorun.** 3 yer uyuşmuyor: `hasActiveOrders` (repo tables.ts:312, `status='open'` literal); board projection (tables.ts:161 `NOT IN ('paid','cancelled','void')` — doğru); DB unique partial index (000_init.sql:419, `WHERE status NOT IN ('paid','cancelled')` — **void HARİÇ DEĞİL**). Sonuç: void edilmiş sipariş DB index slot'unu tutar → masa "dolu" kabul edilir, yeniden açılamaz; ayrıca `hasActiveOrders='open'` sent_to_kitchen/served/billed durumundaki masanın silinmesine izin verir (board ile tutarsız).

**Karar.** Tek kanonik aktif tanımı = `status NOT IN ('paid','cancelled','void')` (shared-domain `TERMINAL_ORDER_STATUSES`, orders.ts:153 zaten import ediyor). (a) `hasActiveOrders` bu sete hizalanır (`status NOT IN TERMINAL_ORDER_STATUSES`). (b) Forward-only migration: `DROP INDEX orders_tenant_table_open_uq` + `CREATE UNIQUE INDEX ... WHERE status NOT IN ('paid','cancelled','void')` (void eklenir).

**Gerekçe.** Veri bütünlüğü: void sonrası masa yeniden açılabilmeli; tek tanım drift'i ortadan kaldırır. shared-domain sabiti zaten otorite — DB ve repo ona uyar.
**Çözdüğü bug:** #11 (void index slot → reopen engeli), #12 (hasActiveOrders drift) + latent silme-guard tutarsızlığı.
**Migration:** EVET (index DROP+CREATE, forward-only). **i18n/UI:** yok.

---

#### Karar C — Bölge silme guard + orphan masa görünürlüğü (Grup 3, #2/#7/#8/#9)

**Sorun.** `AreaService.hardDelete` guard'sız: dolu masası olan bölge silinince `area_id=NULL` cascade → o masanın açık adisyonu hem web (TablesListPage:67) hem mobil (TablesScreen:73) `area_id=null` masaları gizlediği için her iki tahtadan kaybolur → açık sipariş "yetim" + görünmez (veri kaybı görünümü). `DeleteAreaDialog` metni gerçek davranışla çelişiyor (doküman-kod drift).

**Karar.** (a) **Bölge-silme guard** (masa-silme guard'ı ile simetrik): bölgede aktif-siparişli (Karar B tanımı) masa varsa 409 `AREA_HAS_ACTIVE_TABLES` (yeni error code, ADR-006 §5 registry'ye eklenir). (b) **Orphan görünürlük:** board'da `area_id=null` masalar "Bölgesiz" fallback grubunda gösterilir; özellikle occupied orphan MUTLAKA görünür (filtre kaldırılır). (c) **Orphan reassign/sil UI** wire edilir (endpoint'ler hazır: `PATCH /tables/:id/area`, `DELETE /tables/:id`). (d) `DeleteAreaDialog` metni guard davranışına hizalanır.

**Gerekçe.** Açık adisyonun gözden kaybolması kabul edilemez (öncelik 2 veri bütünlüğü + 3 UX). Guard, masa-silme guard'ıyla simetri sağlar; orphan grubu kasıtlı `area_id=null` (örn. geçici masa) senaryosunu da kurtarır.
**Çözdüğü bug:** #2 (HIGH, bölge silme orphan adisyon), #7/#8/#9 (orphan görünürlük + reassign).
**Migration:** HAYIR (sadece guard + UI). **i18n/UI:** yeni key'ler `area.delete.hasActiveTables` (409 mesajı), `tables.group.unassigned` ("Bölgesiz"), DeleteAreaDialog metin revizyonu; hci-reviewer + turkish-ux-reviewer gate.

---

#### Karar D — Web/mobil parite: paylaşılan util (Grup 4, #10/#14/#18/#19)

**Karar.** Karar A'nın `tableLabel` util'i + yeni `selectVisibleTables` (orphan dahil, occupied önce) `packages/shared-domain`'e konur; web + mobil tek kaynaktan tüketir. Mobil masa kartına kısmi ödeme (`active_order_paid_total_cents`) eklenir; bölge-yok davranışı, bölge pill format (`occupied/total`) web ile eşitlenir; mobil Order ekranına silinmiş-masa guard'ı (web paritesi) eklenir.
**Çözdüğü bug:** #10/#14/#18/#19. **Migration:** HAYIR. **i18n/UI:** mevcut key'ler; hci + turkish-ux gate (mobil + web).

**Amendment (2026-06-30, PR-C hci gate) — occupied-first kapsam daralması.** İlk `selectVisibleTables` tasarımı occupied-first sıralamayı TÜM gruplara (gerçek bölgeler dahil) uyguluyordu. hci-reviewer BLOCKER: bu, Karar A'nın kazandırdığı **uzamsal/numerik kararlılığı** bozar — garson sabit grid'de "Masa N"i sabit konumda arar; doluluk değiştikçe kart konumu zıplarsa rush-hour bulunabilirliği düşer (web 3-kolon×180px, mobil `numColumns=3` sabit grid). **Düzeltilmiş karar:** occupied-first sıralama YALNIZ "Bölgesiz" (orphan, `UNASSIGNED_AREA`) grubuna uygulanır — orada kurtarılan açık adisyonun öne çıkması istenir; boş orphan'lar sonra. Gerçek bölgelerde sıralama **`display_no`-stabil** (asc, null-last, sonra `code` tr-numeric) kalır. `selectVisibleTables` sort'u `isOrphan` dalında occupied-first anahtarını uygular; diğer grupta uygulamaz. Unit test occupied-first senaryosu orphan grubuna taşınır + gerçek-bölge stabil-sıra testi eklenir.

**Amendment (2026-06-30, kullanıcı kararı) — mobil kısmi ödeme göstergesi geri alındı.** Karar D(C2) mobil masa kartına kısmi ödeme (`active_order_paid_total_cents` → "Kısmi: ₺X") satırı ekliyordu. İlhan kararı: **mobil garson app'te gösterilmez** — kalan borç garsonun değil, kasiyer/ödeme ekranının konusudur; kart sade kalır (ad / toplam / süre). `active_order_paid_total_cents` alanı schema/tip'te KALIR (web + gelecek kullanım), yalnız mobil UI satırı + `tables.card.partialPaid` i18n key'i kaldırılır. Kapsam daralması (scope creep değil), yeni ADR gerekmez.

---

#### Karar E — #15 (tip) v5.0; #17 (admin CRUD realtime) v5.1

**#15** repo `payments.amount_cents` SUM PG `bigint` döner, projection `number` bekler → tip-uyumsuzluğu. **Karar: v5.0**, `::int` cast (tutarlar kuruş-int, 25-masa ölçeğinde taşma yok) — Karar B migration PR'ıyla aynı slice. **#17** masa/bölge admin CRUD realtime (board canlı güncellenmiyor): yeni `tables.changed`/`areas.changed` event tipi gerekir; tek-tenant 25 masada admin CRUD nadir, manuel refresh yeterli. **Karar: v5.1 backlog** (kapsam kilidi — charter "v3 kapsamını koru", v3'te de admin CRUD push yoktu).

---

#### PR slice planı (önerilen)

- **PR-A — Etiket + migration (Karar A + B + E#15):** `tables.display_no` migration + backfill + index void-fix + `hasActiveOrders` hizalama + shared-domain `tableLabel` util + snapshot kanonik etiket + `::int` cast. db-migration-guard + security yok ama veri-bütünlüğü kritik → qa-engineer geniş test.
- **PR-B — Bölge/orphan (Karar C):** bölge-silme guard + `AREA_HAS_ACTIVE_TABLES` + orphan "Bölgesiz" grubu + reassign/sil UI + DeleteAreaDialog metin. hci + turkish-ux gate.
- **PR-C — Parite (Karar D):** shared `selectVisibleTables` + mobil kısmi ödeme + mobil silinmiş-masa guard + pill/bölge-yok eşitleme. hci + turkish-ux gate (mobil).

Sıra: PR-A (kök) → PR-B → PR-C. Hepsi **v5.0** (kapsam kilidi: tümü v3-parite davranış düzeltmesi / veri bütünlüğü; yalnız #17 v5.1).

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
| 2026-06-28 | §11 — `orders.*` event formalizasyonu (ADR-025 K5 / İş Kalemi 3) | §11.1 isim listesi (orders.* dot-notation kilit), `realtime.ts` `ServerToClientEvents` + `RealtimeEventName` | orders router'ın HÂLİHAZIRDA yaydığı 4 colon-string event (`order:created` / `order:status_changed` / `order:cancelled` / `order:customer_assigned`) §11.1 `<domain>.<verbPast>` camelCase 2-segment konvansiyonunu ihlal ediyordu + `ServerToClientEvents`'te tipli değildi. Mobil "canlı ortak masa tahtası" (ADR-025 K5) bunları tüketecek → tipli zod payload + dot-notation formalize. Detay: §11.6 amendment metni. |
| 2026-07-01 | §11.6 — Masa/Bölge admin-CRUD realtime (`tables.changed` / `areas.changed`) | `realtime.ts` `ServerToClientEvents` + `RealtimeEventName` (2 yeni invalidate-only event), tables/areas router emit + `TablesRouterDeps`/`AreasRouterDeps` `io?`, web `TablesListPage` + mobil `RealtimeBridge` consumer | Admin masa/bölge CRUD (create/update/delete/assign-area/sync-tables) HİÇBİR realtime event yaymıyordu → masa tahtası diğer terminallerde manuel refresh'e kadar bayat kalıyordu (canlılık yalnız `orders.*`'tan türetiliyordu, admin-config değişikliği order event üretmez). §11.6 dot-notation konvansiyonuyla tutarlı 2 invalidate-only event. Detay: §11.6 amendment metni (2026-07-01). |

#### §11.6 — Amendment (2026-06-28) — orders.* event formalizasyonu (ADR-025 K5 / İş Kalemi 3)

**Bağlam.** `apps/api/src/routes/orders.ts` Phase 2'den beri 4 realtime event yayıyordu, ama **colon-string** isimle (`order:created`, `order:status_changed`, `order:cancelled`, `order:customer_assigned`) ve `Record<string, unknown>` payload'la — §11.1 konvansiyonu (`<domain>.<verbPast>` camelCase, 2-segment) + §11.3 (emit öncesi zod parse) DIŞINDA. ADR-025 K5 mobil garson "canlı ortak masa tahtası"nı bu event'lere demirledi → formalizasyon ön-koşul oldu. Bu amendment tasarımı **uygular**, yeni karar almaz.

**Karar.** 4 event §11.1'e formalize edilir:

| Eski (colon) | Yeni (dot-notation) | Payload (orders.ts emit'ine SADIK) |
|---|---|---|
| `order:created` | `orders.created` | `{ orderId, type (OrderType), takeawayStage (TakeawayStage), total_cents (int≥0) }` |
| `order:status_changed` | `orders.statusChanged` | `{ orderId, takeawayStage, paid (bool) }` |
| `order:cancelled` | `orders.cancelled` | `{ orderId }` |
| `order:customer_assigned` | `orders.customerAssigned` | `{ orderId, customerId (UUID \| null) }` |

- **Tipleme:** `packages/shared-types/src/realtime.ts`'e 4 zod schema + tip + `ServerToClientEvents` girişi + `RealtimeEventName` eklendi. `OrderType`/`TakeawayStage` enum'ları `order.js`'ten reuse (duplikasyon yok). orders.ts `emitTenant` helper'ı overload + emit öncesi zod parse (§11.3) yapacak şekilde tipli.
- **Önbilgi düzeltme (`customerId` nullable).** İlk taslak `orders.customerAssigned.customerId`'yi non-null UUID varsaymıştı; typecheck `PATCH /orders/:id/customer` body'sinin `customerId: string | null` (un-assign / dine_in müşteri kaldırma, `OrderAssignCustomerSchema.nullable()`) olduğunu yakaladı. Non-null schema un-assign'da emit-time zod parse'ı patlatır (500) idi → payload `customerId: z.string().uuid().nullable()` olarak SADIK düzeltildi.
- **Ulaşım (room).** Event'ler `tenant:{id}` room'una gider; ADR-010 §4.2 gereği **role:waiter dahil her socket** bu room'a join olur → mobil canlı tahta **ek room olmadan** tüketir. Yeni room/namespace eklenmedi.
- **Base meta (§11.2) drift notu.** §11.2 her payload'a `event_id`/`tenant_id`/`emitted_at` zorunlu kılıyor; ancak Phase 3'te implement edilen `kitchen.*` ve `caller.*` event'leri **base meta taşımıyor** (`KitchenOrderSentPayloadSchema`/`CallerStatusChangedPayloadSchema` saf domain alanları). orders.* bu **mevcut implementasyon paterniyle** hizalandı (base meta YOK) — kitchen.*/caller.*'dan sapmamak için. §11.2 base meta'nın tüm event'lere geriye dönük eklenmesi ayrı bir iş kalemidir (v5.1; UI-side `event_id` dedup §8.3 reconnect-refetch ile zaten karşılanıyor).
- **Tüketici.** `apps/web`/`apps/mobile` bu 4 event'i dinleyen consumer **yok** (yalnız `kitchen.*`/`caller.*` dinleniyor — grep doğrulandı); colon→dot rename consumer-side breaking değil.

**Cross-ref.** ADR-025 K5 (~9916), §11.1 (event isim konvansiyonu), §11.3 (iki-taraflı zod), §4.2 (room hiyerarşisi), §8.3 (idempotency reconnect-refetch). Kod: `packages/shared-types/src/realtime.ts` (4 schema + tip + map), `packages/shared-types/src/realtime.test.ts` (schema unit testleri), `apps/api/src/routes/orders.ts` (`emitTenant` tipli overload + 4 call site). Gate: implementer. Ödeme/ABAC/DB şemasına dokunulmadı (cerrahi).

#### §11.6 — Amendment (2026-07-01) — Masa/Bölge admin-CRUD realtime (`tables.changed` / `areas.changed`)

**Bağlam.** Admin masa/bölge CRUD işlemleri (create / update / delete / assign-area / sync-tables) şu ana kadar **hiçbir realtime event yaymıyordu**. Masa tahtasının canlılığı yalnız `orders.*` (§11.6 üstteki amendment) event'lerinden **dolaylı** türetiliyordu — admin-config değişikliği ise order event üretmez. Sonuç: bir terminalde masa/bölge oluşturulup silinince veya bölgesi değişince, diğer terminallerdeki tahta (web `TablesListPage` + mobil `RealtimeBridge`) **manuel refresh'e kadar bayat** kalıyordu. Bu, ADR-025 K5 canlı ortak tahta hedefinin admin-config tarafındaki boşluğuydu. Bu amendment tasarımı **uygular**, yeni ürün davranışı getirmez.

**Karar.** §11.6 dot-notation konvansiyonuyla tutarlı **2 yeni invalidate-only tenant-room event** eklenir:

| Event | Yayan router / tetikleyici | Payload (invalidate-only — client parse ETMEZ) |
|---|---|---|
| `tables.changed` | tables router: POST /tables (`created`), PATCH /tables/:id (`updated`), DELETE /tables/:id (`deleted`), PATCH /tables/:id/area (`area_assigned`) | `TablesChangedPayloadSchema = { action: 'created'\|'updated'\|'deleted'\|'area_assigned', tableId: uuid }` |
| `areas.changed` | areas router: POST /areas (`created`), PATCH /areas/:id (`updated`), DELETE /areas/:id (`deleted`), POST /areas/:id/sync-tables (`synced`) | `AreasChangedPayloadSchema = { action: 'created'\|'updated'\|'deleted'\|'synced', areaId: uuid }` |

- **Tipleme.** İki zod schema `packages/shared-types/src/realtime.ts`'e (`OrderCreatedPayloadSchema` yanına) + `ServerToClientEvents` girişi + `RealtimeEventName` union'ına eklenir. Emit kontratı (§11.3) minimal-de-olsa zod schema zorunlu kılar; payload yalnız "hangi kayıt değişti" bilgisini taşır, client **parse etmez, yalnız invalidate eder**.
- **Ulaşım (room).** `tenant:${tenantId}` — `orders.*` ile **aynı mevcut tenant room'u** (§4.2 gereği role:waiter dahil her socket join). Yeni room/namespace yok. Emit, her router'a eklenen lokal `emitTenant` wrapper'ıyla (orders.ts:230-277 paterni), `if (deps.io === undefined) return` test-stub guard'ıyla yapılır; `io?` `TablesRouterDeps`/`AreasRouterDeps`'e eklenir ve `app.ts` üzerinden threadlenir (orders/payments paterni).
- **Tüketici.** web `TablesListPage` (`useSocketEvent('tables.changed'|'areas.changed', invalidateTables)`) + mobil `RealtimeBridge`. Her iki event de **HEM `['tables']` HEM `['areas']`** query'sini invalidate eder — grid + bölge pill'leri tek bir tahtadır. `useTableRealtimeInvalidate` `['areas']`'i de invalidate edecek şekilde genişletilir.
- **RBAC / güvenlik.** Mutation'lar admin-only kalır (**değişmedi**); yayılan event tenant tahta-izleyici room'una gider (her rol tahtayı görür). Cross-tenant izolasyon: yalnız `tenant:${tenantId}` room. Yeni mutation yüzeyi yok, **şema/migration değişikliği yok, invalidate-only** (aynı veri, manuel refresh yerine canlı yenilenir — ürün davranışı değişmez).

**Reddedilen alternatifler.** (a) tables+areas için tek `tables.changed` — reddedildi (isim tuhaflığı: bölge değişikliği `tables.changed` yayar); (b) 8 ince-taneli tipli event — reddedildi (tahta yalnız invalidate ediyor, gereksiz yüzey); (c) manuel-refresh'te bırakmak — reddedildi (bu amendment'ı tetikleyen backlog kalemi).

**Cross-ref.** §11.6 (base — üstteki `orders.*` emit paterni), §11.1 (isim konvansiyonu), §11.3 (emit öncesi zod), §4.2 (tenant room hiyerarşisi), ADR-025 K5 / ADR-009 (masa/bölge domain). Kod: `packages/shared-types/src/realtime.ts` (2 schema + tip + map), `apps/api/src/routes/tables.ts` + `areas.ts` (`emitTenant` + call site'lar), `apps/api/src/app.ts` (`io?` threading), web `TablesListPage` + `useTableRealtimeInvalidate`, mobil `RealtimeBridge`. Gate: implementer. **Migration yok / invalidate-only / mutation'lar admin-only** — cerrahi.

#### §11.6 — Amendment 3 (2026-07-01) — Menü admin-CRUD realtime (`products.changed` / `categories.changed`)

**Bağlam.** Admin ürün/kategori CRUD işlemleri (create / update / delete / reorder) şu ana kadar **hiçbir realtime event yaymıyordu**. Katalog canlılığı yoktu: web sipariş ekranı (`OrderScreenPage` → `useProductsAdmin`/`useCategoriesAdmin`) yalnız refetch-on-focus ile, mobil menü (`useMenuProducts`/`useMenuCategories`, staleTime **5 dk**) ise 5 dakikaya kadar **bayat** kalıyordu. Bir terminalde ürün eklenip/silinince veya fiyat/kategori güncellenince, sipariş alan diğer terminaller güncel katalogu görmüyordu (Session 77 user-reported borç). Bu, masa/bölge (üstteki Amendment) ile **aynı gerekçe** — admin-config değişikliği tüm client'lara canlı yansımalı. Bu amendment mevcut invalidate-only tasarımı **menü domain'ine birebir yansıtır**, yeni ürün davranışı getirmez.

**Karar.** §11.6 dot-notation konvansiyonuyla, masa/bölge amendment'iyle **tutarlı** olarak **2 yeni invalidate-only tenant-room event** eklenir (birleşik `menu.changed` yerine ayrı ürün/kategori — tables/areas ayrımıyla tutarlı, reorder yalnız kategoriyi ilgilendirir):

| Event | Yayan router / tetikleyici | Payload (invalidate-only — client parse ETMEZ) |
|---|---|---|
| `products.changed` | products router: POST /products (`created`), PATCH /products/:id (`updated`), DELETE /products/:id (`deleted`) | `ProductsChangedPayloadSchema = { action: 'created'\|'updated'\|'deleted', productId: uuid }` |
| `categories.changed` | menu router: POST /menu/categories (`created`), PATCH /menu/categories/:id (`updated`), DELETE /menu/categories/:id (`deleted`), POST /menu/categories/:id/products/reorder (`products_reordered`) | `CategoriesChangedPayloadSchema = { action: 'created'\|'updated'\|'deleted'\|'products_reordered', categoryId: uuid }` |

- **Tipleme.** İki zod schema `packages/shared-types/src/realtime.ts`'e (`TablesChangedPayloadSchema`/`AreasChangedPayloadSchema` yanına) + `ServerToClientEvents` girişi + `RealtimeEventName` union'ına eklenir. Emit kontratı (§11.3) minimal-de-olsa zod schema zorunlu kılar; payload yalnız "hangi kayıt değişti" bilgisini taşır, client **parse etmez, yalnız invalidate eder**. Not: kategori silme cascade ile ürünleri de etkiler (web `useDeleteCategory` zaten hem `['categories']` hem `['products']` invalidate eder) — bu davranış consumer tarafında korunur.
- **Ulaşım (room).** `tenant:${tenantId}` — `orders.*`/`tables.*` ile **aynı mevcut tenant room'u** (§4.2 gereği role:waiter dahil her socket join). Yeni room/namespace yok. Emit, her router'a eklenen lokal `emitProductsChanged`/`emitCategoriesChanged` wrapper'ıyla (tables.ts `emitTablesChanged` paterni), `if (deps.io === undefined) return` test-stub guard'ıyla yapılır; `io?` `ProductsRouterDeps`/`MenuRouterDeps`'e eklenir ve `app.ts` üzerinden conditional-spread ile threadlenir (tables/areas paterni, app.ts:121/133).
- **Tüketici.** (1) web **OrderScreenPage**: `useSocketEvent('products.changed', …)` → `invalidateQueries(['products'])`, `useSocketEvent('categories.changed', …)` → `invalidateQueries(['categories'])` (admin menü sayfaları mutation-sonrası zaten kendi invalidate'ini yapar; realtime yalnız çapraz-terminal canlılığı ekler). (2) mobil **RealtimeBridge** (App.tsx): `socket.on('products.changed'|'categories.changed', invalidate)` ve `invalidate` fonksiyonu **`['menu','products']` + `['menu','categories']`** anahtarlarını da invalidate edecek şekilde genişletilir → 5 dk staleTime baypas edilip katalog anında tazelenir.
- **RBAC / güvenlik.** Mutation'lar admin-only kalır (**değişmedi**); yayılan event tenant room'una gider (sipariş alan her rol güncel katalogu görmeli). Cross-tenant izolasyon: yalnız `tenant:${tenantId}` room. Yeni mutation yüzeyi yok, **şema/migration değişikliği yok, invalidate-only** (aynı veri, manuel/focus-refetch yerine canlı yenilenir — ürün davranışı değişmez).

**Reddedilen alternatifler.** (a) ince-taneli tipli payload (fiyat/isim/availability delta) — reddedildi (katalog yalnız invalidate ediyor, gereksiz yüzey); (b) manuel/focus-refetch'te bırakmak — reddedildi (bu amendment'ı tetikleyen user-reported borç; mobil 5 dk staleTime baytlık pencere yaratıyor); (c) tek birleşik `menu.changed` event — reddedildi (products/categories ayrı tutulması tables/areas ayrımıyla tutarlı; kategori reorder ürün query'sini gereksiz invalidate etmez, consumer'lar seçici davranabilir).

**Cross-ref.** §11.6 (base — `orders.*` emit paterni), §11.6 Amendment (üstteki `tables.changed`/`areas.changed` — birebir ayna), §11.1 (isim konvansiyonu), §11.3 (emit öncesi zod), §4.2 (tenant room hiyerarşisi), ADR-025 K5. Kod: `packages/shared-types/src/realtime.ts` (2 schema + tip + map), `apps/api/src/routes/products.ts` + `menu.ts` (`emitProductsChanged`/`emitCategoriesChanged` + call site'lar), `apps/api/src/app.ts` (`io?` threading — products/menu satırlarına conditional spread), web `OrderScreenPage`, mobil `RealtimeBridge` (App.tsx). Gate: implementer. **Migration yok / invalidate-only / mutation'lar admin-only** — cerrahi.

#### §11.6 — Amendment 4 (2026-07-07, Session 85) — Kategori bulk-reorder (`categories.changed` action `reordered`)

**Bağlam.** Amendment 3 yalnız `products_reordered` (kategori-içi ürün sırası) event'i tanımladı; **kategorilerin kendi arası sırası** (`sort_order`) için ne reorder UI ne event vardı. Sonuç: tüm kategoriler `sort_order = 0` (DEFAULT) → `categories.findAll` `ORDER BY sort_order ASC` eşitlikte PG-tanımsız sıra döndürüyordu; kullanıcı (canlı kullanım, S85) sipariş-alma ekranında kategori sırasını **ayarlayamıyordu** ("son eklenen başta" şikâyeti). Altyapı yarı-hazırdı (`sort_order` kolonu + index + POST/PATCH `sortOrder` kabulü + audit); yalnız reorder UI + bulk endpoint eksikti. Ürün-reorder (`POST /menu/categories/:id/products/reorder` + `ReorderProductsModal`) paritesi.

**Karar.** (1) Yeni **`POST /menu/categories/reorder`** (admin-only, `CategoriesReorderRequestSchema = { categoryIds: uuid[].min(1).max(200) }`); dizi index'i yeni `sort_order`; tek transaction'da `categories.reorder` (tenant-scoped bulk, kategori top-level → category scope yok) + audit **`menu_category.reordered`** (`{ count }`, snapshot §7). (2) `categories.changed` `action` enum'una **`'reordered'`** eklenir; reorder tek kategori değil → **`categoryId` opsiyonel** (emit invalidate-only, alıcı web/mobil payload'ı okumadan tazeler — mevcut consumer'lar categoryId kullanmıyor, kırılmaz). (3) `categories.findAll` `sort_order ASC` sonrası **`name ASC` ikincil tiebreak** → client-sort yapmayan tüketiciler (mobil/ham-API) için deterministik (web `CategoryTabs`/`MenuDefinitionsPage` zaten `(sort_order, name)` client-sort ediyordu). (4) Web: `useReorderCategories` + `ReorderCategoriesModal` (↑/↓ butonlu, literal drag DEĞİL — `ReorderProductsModal` paritesi + dokunmatik) + `MenuDefinitionsPage` sol panel "Kategorileri Sırala" tetikleyici (≥2 kategori).

**Kapsam.** v3 paritesi / yarım-kalmış özelliğin tamamlanması. **Migration YOK** (`sort_order` kolonu 000_init'te mevcut). `security-reviewer` gerekmez (admin-only, auth/payment/PII yok); `db-migration-guard` gerekmez (şema değişmedi). Gate: hci + turkish-ux + i18n.

**Cross-ref.** Amendment 3 (üstteki — birebir ayna, `products_reordered` precedent'i), §11.3 (emit öncesi zod), §7 (audit snapshot). Kod: `packages/shared-types/src/{realtime,menu,audit}.ts`, `packages/shared-domain/src/audit/allowed-keys.ts`, `packages/db/src/repositories/categories.ts` (`reorder` + `findAll` tiebreak), `apps/api/src/routes/menu.ts` (`POST /categories/reorder`), test `apps/api/src/__tests__/realtime-emits.test.ts` (M8/M9), web `menu-categories/{api.ts, components/ReorderCategoriesModal.tsx}` + `MenuDefinitionsPage.tsx` + `i18n/locales/tr.json`. **Migration yok / invalidate-only / admin-only** — cerrahi.

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

##### Amendment 2026-05-11 — PageHeader Standardı (Nielsen #4 tutarlılık)

**Bağlam:**
`apps/web/src/features/*` altındaki AppShell-içi feature sayfalarının başlık (`<h1>`) stilleri tutarsız — Nielsen heuristic #4 (Consistency and Standards) ihlali. İki ayrışmış pattern tespit edildi:

- **Admin pattern (8 sayfa)** — `grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]` + büyük h1: `AdminPlaceholderPage`, `AttributeGroupsPage`, `DiningAreasPage`, `MenuDefinitionsPage`, `ProductEditorPage`, `SettingsPage`, `UsersPage`, `CustomersPage`, `CustomerDetailPage`
- **App pattern (3 sayfa)** — `border-b px-6 py-4 pl-16` + `text-xl|text-2xl`: `KdsPage` (ChefHat ikon + sağda refetch), `DashboardPage`, `ReportsPage` (Sprint 14 PR-5a, henüz unmerged)

Aynı uygulama içinde başlık yüksekliği, padding sistemi, border davranışı ve typography ölçeği sayfadan sayfaya değişiyor. Kullanıcı zihinsel modeli kırılıyor.

**Karar:**
Tüm AppShell-içi feature sayfalarının başlığı **tek component** üzerinden render edilir: `apps/web/src/components/layout/PageHeader.tsx`. Mevcut "admin pattern" tamamen kaldırılır. Yeni standart **KdsPage'in `border-b` + `text-xl font-bold` pattern'i** baz alır (daha temiz, hamburger butonu için sol pad doğru, görsel ayraç var).

**Props sözleşmesi:**

```tsx
interface PageHeaderProps {
  title: string;             // i18n KEY (zorunlu — CLAUDE.md core directive #4, hardcoded yasak)
  subtitle?: string;         // i18n KEY (opsiyonel, h1 altında küçük açıklama)
  icon?: LucideIcon;         // opsiyonel, h1 solunda (örn ChefHat)
  actions?: React.ReactNode; // sağ slot (örn refetch butonu, "Yeni ekle")
  backHref?: string;         // opsiyonel; geri butonu olan ekranlar için (CustomerDetailPage)
}
```

**Standart pattern (tek doğru render):**

- Header element: `<header className="border-b border-border bg-white px-6 py-4 pl-16">` (sol pad 64px hamburger butonu için)
- h1: `<h1 className="text-xl font-bold tracking-tight">` — **tek boyut, tüm sayfalar aynı**
- Subtitle: `<p className="text-sm text-slate-600 mt-0.5">`
- Actions: header'ın sağında `flex items-center gap-2` (icon-only butonlar için min 44px touch target — HCI checklist)
- Icon: h1'in solunda `h-6 w-6` + kategori rengi opsiyonel
- backHref varsa: solda `<ArrowLeft />` icon-button, h1'in önünde

**Migrasyon kapsamı (12 sayfa):**

`AdminPlaceholderPage`, `AttributeGroupsPage`, `DiningAreasPage`, `MenuDefinitionsPage`, `ProductEditorPage`, `SettingsPage`, `UsersPage`, `CustomersPage`, `CustomerDetailPage`, `KdsPage`, `DashboardPage`, `ReportsPage`.

`OrderScreenPage` — tam ekran POS modu, sayfa header'ı yoksa kapsam dışı; implementer migrate öncesi dosyayı kontrol edecek.

**İstisnalar (PageHeader kullanmaz — gerekçeli):**

- `LoginPage` — AuthLayout altında, AppShell sözleşmesi dışında (`text-3xl font-bold` korunur)
- `ErrorBoundary` — global hata sayfası, AppShell render edilemediği durumda devreye girer (`text-2xl font-semibold` korunur)

**Alternatifler değerlendirildi ve reddedildi:**

1. **"Admin pattern'i baz al, app sayfalarını migrate et"** — Reddedildi: admin pattern'in `pl-[74px]` magic number'ı, `grid grid-cols-[1fr_auto]` karmaşıklığı, border yokluğu modern POS UI sözleşmesine uymuyor. Kdspage pattern'i daha temiz ve hamburger için doğru pad sağlıyor.
2. **"İki pattern'i koru, sadece h1 boyutunu eşitle"** — Reddedildi: yarım çözüm. Padding, border, layout farkları kullanıcı görsel deneyiminde halen kırılma yaratır. Tek component tek doğruluk kaynağı.
3. **"Tailwind variant ile pattern composition"** — Reddedildi: 12 sayfalık dar kapsam için ekstra soyutlama, props sözleşmesi netliğini düşürür. Tek dosya component yeterli.

**Sonuçlar:**

- (+) Nielsen #4 (Consistency and Standards) tek seferde çözülür — 12 sayfa aynı görsel sözleşme.
- (+) Yeni sayfa ekleme akışı 1 satır import + PageHeader kullanımına iner; copy-paste hatası imkânsız.
- (+) i18n key kullanımı zorunlu hale gelir (TS sözleşmesi ile garanti) — CLAUDE.md core directive #4 mekanik koruma kazanır.
- (+) HCI checklist 44px touch target sağ slot için merkezi yerden uygulanır.
- (−) 12 sayfanın migrasyonu tek implementer PR'ı (cerrahi değişiklik kuralı: her import + her h1 bloğu yer değiştirir). Test parity riski → DoD'da `text-2xl|text-[22px]|text-3xl.*<h1` grep'i sıfır match şartı.
- (−) Mevcut admin pattern'in `mt-3 mb-[14px]` vertical rhythm farkı kaybolur. Migrasyon sonrası tüm sayfalar `py-4` ile aynı dikey ritmi paylaşır — kabul edilebilir kayıp.

**DoD:**

- [ ] `PageHeader.tsx` unit test (TS happy path: title-only, title+icon, title+actions, title+subtitle+backHref kombinasyonu).
- [ ] `apps/web/src/features` altında `grep -rE 'text-2xl|text-\[22px\]|text-3xl' --include='*.tsx'` çıktısı yalnız `LoginPage` ve `ErrorBoundary` içerir; h1 tag'i için hiçbir feature sayfası match etmez.
- [ ] i18n key parity: tüm migrate edilen sayfaların title/subtitle key'leri `tr` ve `en` locale dosyalarında mevcut.
- [ ] `hci-reviewer` onayı (sol pad 64px + sağ actions 44px touch target doğrulaması).
- [ ] `turkish-ux-reviewer` onayı (Türkçe başlık tonalitesi, glossary uyumu).

**Kapsam kilidi:**

Bu amendment **yeni feature değil**, mevcut 12 sayfanın standardizasyonudur. Nielsen #4 ihlalini çözer. v5.0 MVP içinde — backlog'a ertelenmez. Yeni özellik (örn breadcrumb, tab navigation, search bar) bu amendment kapsamına eklenmez; gerekirse ayrı ADR amendment ile genişletilir.

**Cross-ref:**

- CLAUDE.md core directive #4 — Hardcoded string yasak, i18n key zorunlu.
- ADR-011 §"Component Library" — shadcn/ui pattern lock, custom layout component'leri `apps/web/src/components/layout/` altında.
- Nielsen Heuristic #4 — Consistency and Standards.
- `docs/hci/pos-checklist.md` — 44px touch target, sol pad hamburger.

##### Amendment 2026-05-12 — PageHeader Slot Extensions (HCI feedback addendum)

**Bağlam:** Amendment 2026-05-11 PR #141 olarak ADR-only, PR #142 olarak kod tarafı **paralel iki Claude oturumunda** yazıldı (lesson learned: tek brief, tek oturum). İki yaklaşım hafifçe ayrıldı; implementer (PR #142) v3 paritesi + hci-reviewer feedback altında 2-sütun pattern'i 3-slot'a genişletti. Bu amendment doküman-kod uyumsuzluğunu kapatır.

**Sorunlar (PR #142 sırasında ortaya çıkan):**

1. **Back navigation slot:** Amendment 2026-05-11 `backHref?: string` ile PageHeader'a otomatik back button çizdiriyordu. Mevcut sayfalarda back button **v3 paritesi gereği özel styling** taşıyor (`tables-action-btn` class, `var(--v3-surface-1)` background, `focus-visible:ring-orange-500/40`). Bunu `backHref` ile parametrize etmek mümkün değil — ReactNode slot daha esnek.
2. **Center primary CTA:** TablesListPage v3 paritesi 3-sütun grid (`sol: başlık+sayaç | orta: Paket button | sağ: Phone+Refresh`). 2-sütun `[title]...[actions]` pattern'inde Paket button sağ kümeye yığılıyordu — boş orta alan + sağa hizalanmış CTA HCI olarak sub-optimal.

**Karar — `PageHeaderProps` 3-slot genişletildi (geriye uyumlu):**

```ts
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;       // sağ slot (mevcut)
  startActions?: React.ReactNode;  // sol slot — back nav / leading control (YENİ)
  centerActions?: React.ReactNode; // orta slot — primary CTA (YENİ)
  backHref?: string;               // DEPRECATED — yeni sayfalar startActions kullanır
}
```

**Render sırası (left → right):**

```
[startActions]  [icon]  [title + subtitle]     [centerActions]     [actions]
└──────── sol grup (flex shrink) ────────┘    └─ flex-1 center ─┘ └─ shrink ─┘
```

- `centerActions` yoksa: empty div `flex-1` alır → title sola, actions sağa (Amendment 2026-05-11 davranışı korunur).
- `startActions` yoksa: back navigation YOK (sayfaya özel karar).
- `backHref` kullanımı **deprecate**: mevcut hiçbir sayfa kullanmıyor; gelecekte ADR-011 next major revision'da kaldırılabilir.

**Kullanım örnekleri:**

```tsx
// CustomerDetailPage (back manuel button, sol)
<PageHeader title={customer.fullName} startActions={<BackButton to="/customers" />} />

// TablesListPage (3-sütun v3 paritesi)
<PageHeader
  title={t('tables.title')}
  centerActions={<TakeawayButton />}
  actions={<><Summary /><PhoneIcon /><RefreshButton /></>}
/>

// Default (KdsPage, ReportsPage, SettingsPage save vs.)
<PageHeader title={t('kds.title')} icon={ChefHat} actions={<RefreshButton />} />
```

**HCI gerekçesi:**

- Back navigation **sol-üst** (platform convention: Gmail, Shopify admin) — `startActions` slot ile sağlanır
- Primary CTA **merkez** — Fitts kanunu: gözle takipte merkez kolay, sağa yapışık'tan iyi
- v3 paritesi korunur — kullanıcı eski POS'tan geçişte yer karışıklığı yaşamaz

**DoD addendum:**

- [x] PageHeader.tsx 3-slot render (PR #142 — `d4684ba` merged)
- [x] CustomerDetailPage + SettingsPage `startActions` kullanır (PR #142)
- [x] TablesListPage `centerActions={Paket}` kullanır (PR #142)
- [ ] `backHref` deprecated badge / JSDoc warning — sonraki cleanup PR'ında

**Lesson learned (paralel oturum):**

İki Claude oturumuna aynı brief verilirse:
- ADR amendment'ları farklı tasarlanır → merge sonrası doc-code drift
- Doğru pattern: **tek brief, tek oturum**. Paralel iş zorunluysa farklı görevler atanmalı.
- Bu memory'ye `feedback_parallel_claude_session_conflict.md` olarak eklenir.

**Cross-ref:**

- PR #141 (Amendment 2026-05-11 base) — paralel oturum
- PR #142 (`d4684ba`) — bu sohbet, kod migration + slot extensions
- hci-reviewer NEEDS_CHANGES feedback (PR #142 review) — back top-left platform convention
- v3 paritesi: `D:\dev\restoran-pos-v3\client\src\global.css:649` — page-header 3-sütun grid

##### Amendment 2026-07-05 — PageHeader dar-ekran sarma (chip task_341abb30 ailesi)

**Bağlam:** Session 82 canlı responsive denetimi — PageHeader tek-satır flex'i <768px'te bozuluyordu: geniş `actions` (`shrink-0`) + `centerActions` (`flex-1`), `min-w-0` başlık grubunu sıfıra eziyor. Repro: /tables "Masa|lar" taşan harfler Paket altında; /customers başlık 0px + "Excel'den İçe Aktar" viewport dışında kırpık.

**Karar — yalnız <`sm` (640px) sarma; ≥sm PİKSEL AYNI:**
- Header `flex-wrap sm:flex-nowrap`.
- Başlık grubu `basis-full sm:basis-auto` (<sm tam satır okunur; ≥sm content-width `flex:0 1 auto`, mevcut).
- `centerActions` div `sm:flex-1` (flex-1 yalnız ≥sm; <sm satırı yutmaz).
- `actions` grubu `basis-full flex-wrap justify-end sm:basis-auto sm:flex-nowrap sm:shrink-0` (<sm kendi satırında iç-sarma → dar butonlar alt alta, taşma yok).

Değişmez: başlık tipografisi (`text-xl font-bold tracking-tight`), `pl-16` hamburger payı, ≥sm 3-slot dağılımı. Tablet-first (charter: web = tezgah/tablet); telefon graceful-degradation. **Kabul edilen tradeoff:** <sm'de worst-case (başlık+subtitle+centerActions+çok-butonlu actions) 3-4 satıra çıkabilir — defect değil, yeniden flag'lenmez.

**Doğrulama:** canlı tarayıcı 375/768/1280 — /tables + /customers 375'te başlık tam okunur + sıfır yatay taşma (docScrollW==vw); 768/1280 layout değişmedi. hci-reviewer onayı. Cross-ref: #265 (sipariş ekranı responsive), branch `fix/page-header-responsive`.

<!-- ADR-011 Accepted (2026-04-29). Web UI tasarım kuralları — shadcn/ui + TanStack Query + Zustand + RHF/zod + RR v6 + react-i18next stack lock; feature-folders; auth flow access-memory + refresh-cookie; Socket.IO singleton + useSocketEvent hook; POS color tokens (light only, WCAG AA); Inter self-hosted; loading/empty/error/skeleton zorunlu pattern; HCI 44/48/56px; Sonner toast + ErrorBoundary; bundle <300KB; "Şifremi unuttum" Karar B (yönetici aracılı, Password Reset email akışı v5.1 backlog ADR-X). Implementer brief Görev 29 §15. Amendment 2026-05-01: Sprint 8c PR-D/E Menü Tanımları UI Revamp — 7 karar. Amendment 2026-05-11: PageHeader standardı (Nielsen #4) — tek component, 12 sayfa migrasyon, KdsPage pattern baz, admin pattern reddedildi. Amendment 2026-05-12: PageHeader slot extensions — startActions + centerActions slot'ları, backHref deprecate (paralel oturum doc-code drift fix). Amendment 2026-07-05: PageHeader dar-ekran sarma (flex-wrap sm:flex-nowrap + basis-full başlık; ≥sm piksel-aynı; tablet-first responsive fix, chip task_341abb30 ailesi). -->

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

**Amendment (2026-07-06, S84 — PR-7c implementasyonu):** K7 metni gerçek koda hizalandı (yeni ADR değil, mevcut kararın kod-gerçeği):
- **Tetikleyici İKİ op:** `pay_and_print` **ve** `pay_and_print_close` (K1 4-op modeli). `pay` / `pay_and_close` fiş BASMAZ — opt-in mekanizması mevcut web modal aksiyonu (`payments.ts` `shouldPrintBill = operation ∈ {pay_and_print, pay_and_print_close}`); yeni settings bayrağı YOK (kapsam-kilidi).
- **`job_type='receipt'` DEĞİL:** gerçek şema `print_jobs.payload.kind='bill'` kullanır (şema değişmedi) → `enqueueBillJob` / `renderBillReceipt` (kasa POS-80 CP857 = ESC t 61, ADR-004 Amd3). Kasa fişi = TAM adisyon snapshot'ı (ödenen dilim değil), manuel "Adisyon Yazdır" (`POST /orders/:id/print-bill`) ile birebir; müşteri PII fişe GİRMEZ (KVKK).
- **"fire-and-forget" = para-yolu için somut:** enqueue **POST-COMMIT** (ödeme tx'i commit edildikten SONRA) + **best-effort try/catch** → fiş render/enqueue hatası (CP857 throw dahil) ödeme 201'ini ASLA bozmaz; hata `logger.warn` ile loglanır (`writeAudit` DEĞİL — 'bill_render_failed' kapalı AuditEventType enum'ında yok + DB CHECK `^[a-z_]+\.[a-z_]+$` 2-segment → audit yolu patlardı). **At-most-once** (outbox yok → v5.1); çökme/hata → operatör manuel "Adisyon Yazdır" ile telafi eder.
- **Çift-baskı guard:** `!replayed` (fast-path replay tx öncesi 200 döner; concurrent race kaybedeni `replayed=true` → enqueue atlar → tek fiş).
- **Mod B kapanış (KARAR — S85, 2026-07-07, ürün sahibi onayı):** zaten-tam-ödenmiş sipariş `PATCH /orders status='paid'` ("Masayı Kapat" → `payOrderTx`) yoluna gider, `POST /payments`'e uğramaz → **bilerek fiş BASMAZ.** Otomatik kapanış-baskısı YOK; fiş yalnız (a) `pay_and_print` / `pay_and_print_close` opt-in ödeme aksiyonu (web "Öde ve Yazdır" butonu) veya (b) elle "Adisyon Yazdır" (`POST /orders/:id/print-bill`) ile basılır (opt-in modeli + kapsam kilidi). Chip `task_1ca50c9e` bu kararla KAPANDI — kod değişikliği yok.

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

<!-- Backend integration test 5/5 PASS (Session 58 `apps/api/src/__tests__/orders-mod-b.test.ts`).
     E2E coverage 3/3 PASS — Session 62 PR #160 sha `359e9da` (2026-05-13).
     Spec: `apps/web/e2e/tests/s7-payment-mod-b.spec.ts` (skip kaldırıldı).
     Seed: TABLE_2/3/4 + 3 order + 3 item + 2 payment fixture. -->

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

#### §12 — Amendment 2026-06-27 (Session 70 — `/payments *_close` tutar doğrulaması correctness bug fix)

- **Durum**: Accepted
- **Tarih**: 2026-06-27

##### 12.1 — Önbilgi / durum (bu bir bug fix, yeni özellik DEĞİL)

`/payments` endpoint'inin `*_close` operasyonları (`pay_and_close`, `pay_and_print_close` → `closeOrder=true`) bir adisyonu **`paid`'e kapatırken ödenen tutarı sipariş toplamıyla doğrulamıyor.** `payments.create` close bloğu (`packages/db/src/repositories/payments.ts:272-282`) yalnız `UPDATE orders SET status='paid'` yapıyor — tutar invariant kontrolü YOK.

Bu invariant **zaten tasarlanmış ama koda bağlanmamış** (ölü kod):
- Domain guard `canCloseOrder` (`packages/shared-domain/src/payment.ts:133`) üretimde **hiçbir yerden çağrılmıyor** (grep teyidi).
- Invariant kaynağı ADR-003 §10.4 invariant II: `isFullyComped=false → SUM(payments.amount_cents) === payableCents` (**tam eşitlik**; underpaid `<` ve overpaid `>` ikisi de reddedilir). `amount_cents` = adisyona uygulanan tutar; para üstü (`change_amount_cents`) ve tendered (`validateCashTendered`) ayrıdır — yani `SUM(amount_cents)` tam `payableCents` olmalı.

**Asimetri (kanıt):** Diğer kapanış yolu `orders.payOrder` (`packages/db/src/repositories/orders.ts:759`) `paidTotal < total_cents → PAYMENT_INSUFFICIENT_FOR_CLOSE` ile korumalı. `/orders` "Masayı Kapat" (Mod B) korumalı, `/payments *_close` korumasız. Aynı iş kuralı iki kapanış yolundan yalnız birinde uygulanıyor.

**Etki (güvenlik/veri bütünlüğü — öncelik 1-2):** Kasiyer 100 TL adisyonu 50 TL `pay_and_close` ile kapatabilir → sessiz kasa açığı, denetlenemez gelir kaybı. Overpay'de de adisyon fazla tahsille kapanır (yine invariant ihlali).

> Not: `payOrder` `total_cents` (GROSS) ile kıyaslar ve comp dalını ele almaz; bu Amendment'in `/payments` yolu `payableCents` (comp düşülmüş) + `isFullyComped` dalı ile **daha doğru** invariant uygular. `payOrder` bu Amendment'te DEĞİŞTİRİLMEZ (cerrahi sınır — ayrı yol, ayrı PR borcu).

##### 12.2 — Karar: close bloğunda `canCloseOrder` enforcement (tx içinde)

`payments.create` transaction'ında, **INSERT payments (+ payment_items) sonrası ve `closeOrder` UPDATE'inden ÖNCE** (yani close yalnız `closeOrder===true` iken), invariant doğrulanır:

1. Bu order için `SUM(payments.amount_cents)` **trx içinde** çekilir (yeni eklenen satır dahil — INSERT'ten sonra olduğu için kendiliğinden dahildir) + `COUNT(*)` (paymentsCount).
2. `payableCents` = order'ın `total_cents`'i **doğrudan** (trx içinden okunur; close bloğu order satırını `FOR UPDATE` ile zaten kilitlemiş; mevcut SELECT'e `total_cents`, `is_fully_comped` kolonları eklenir). ⚠️ **Önbilgi düzeltme (implementation-time, 2026-06-27):** İlk brief `comped_amount_cents` kolonu + `calculatePayableCents({totalCents, compedAmountCents})` varsaymıştı — ama bu kolon **YOK** (`orders.ts:686-688`: "Comp için ayrı `comped_amount_cents` kolonu yok, ADR-013 §9.3 v5.1 backlog; total_cents direkt aktif+ödenecek tutarı yansıtır"). `total_cents` recalc'i `is_comped=false` kalemleri zaten dışlar → `total_cents` halihazırda net payable. Dolayısıyla `calculatePayableCents` **gereksiz**; yalnız `canCloseOrder` import edilir, `payableCents: total_cents` geçilir.
3. `isFullyComped` = order satırının `is_fully_comped` alanı (fully-comped order'da `total_cents=0`, payment satırı olmamalı).
4. `canCloseOrder({ isFullyComped, payableCents, paymentsTotalCents, paymentsCount })` çağrılır.
5. `ok===false` ise `reason`'a göre `RepositoryError('check', <code>)` fırlatılır → transaction **rollback** (INSERT'ler dahil geri alınır; idempotency satırı da yazılmaz → retry temiz).

Tüm aritmetik **integer kuruş**; float yok, `any` yok.

##### 12.3 — Error mapping (reason → code → HTTP → i18n)

| `canCloseOrder` reason | RepositoryError code | HTTP | Durum |
|---|---|---|---|
| `underpaid` | `PAYMENT_INSUFFICIENT_FOR_CLOSE` | 400 | **Mevcut** — `apps/api/src/errors.ts:101` (`error.payment.insufficientForClose`) + `tr.json:705`. `payOrder` ile parite. Registry'ye ekleme GEREKMEZ. |
| `overpaid` | `PAYMENT_EXCEEDS_TOTAL` | 400 | **YENİ** — registry'de yok. `apps/api/src/errors.ts` `AUTH_MESSAGE_KEYS`'e + `tr.json`'a + ADR-006 §5.2'ye eklenmeli (implementer yapar; ADR-006'yı bu Amendment değiştirmez). i18n key önerisi `error.payment.exceedsTotal`, metin: "Sipariş kapatılamaz — ödenen tutar sipariş toplamını aşıyor". |
| `fully_comped_but_payments_exist` | `ORDER_INVARIANT_VIOLATED` | 409 | **Mevcut** kod. Pratikte bu yola düşmez: DB trigger C1 (`block_comped_item_in_payment`, ADR-003 §10.5.2) comped item'in payment'a girmesini zaten engeller; tam ikram order'da ödeme satırı oluşamaz. `canCloseOrder` bunu defense-in-depth olarak yine kontrol eder; ihlalde generic invariant kodu yeter — yeni kod gerekmez. |

**Route mapping zorunlu:** `toHttpError` `RepositoryError('check', …)` durumunu varsayılan olarak `ORDER_INVARIANT_VIOLATED` 409'a çökertir. Bu yüzden `apps/api/src/routes/payments.ts` catch bloğunda — mevcut `PAYMENT_QTY_EXCEEDS_ORDER_ITEM` / `COMP_ITEM_IN_PAYMENT` paterniyle birebir — iki yeni explicit mapping eklenir:
```
if (err.cause === 'check' && err.messageKey === 'PAYMENT_INSUFFICIENT_FOR_CLOSE') return next(domainError('PAYMENT_INSUFFICIENT_FOR_CLOSE', 400));
if (err.cause === 'check' && err.messageKey === 'PAYMENT_EXCEEDS_TOTAL') return next(domainError('PAYMENT_EXCEEDS_TOTAL', 400));
```
`fully_comped_but_payments_exist` için ayrı satır gerekmez — `messageKey==='ORDER_INVARIANT_VIOLATED'` zaten mevcut mapping'e (satır 123-125) düşer.

##### 12.4 — Reddedilen alternatifler

- **Route katmanında ön-kontrol (tx dışı SUM):** REDDEDİLDİ. Tx dışında okunan `SUM(amount_cents)` stale olur — iki paralel `*_close` request'i arasında race; lock yok. Invariant **mutlaka** order satırı `FOR UPDATE` ile kilitli iken, INSERT ile aynı transaction içinde doğrulanmalı. (Mevcut close bloğu zaten tx içinde ve order kilitli — doğru yer orası.)
- **Overpay'i sessiz izinli yapmak (`>=` mantığı):** REDDEDİLDİ. `canCloseOrder` invariant'ı **tam eşitlik** (ADR-003 §10.4 II). Overpay = veri bütünlüğü ihlali (fazla tahsil, para üstü `amount_cents`'e değil `change_amount_cents`'e gider). Underpaid'i reddedip overpaid'i geçirmek asimetriyi domain seviyesinde kalıcılaştırır. İkisi de 400.
- **`payOrder`'ı bu Amendment'te refactor edip ortak helper'a çekmek:** REDDEDİLDİ. Cerrahi sınır: bu PR yalnız `/payments *_close` yolundaki eksik enforcement'ı bağlar. `payOrder` çalışıyor ve test kapsamında; iki yolun invariant birleştirilmesi ayrı bir teknik-borç ADR'sidir (scratchpad'e açık soru).

##### 12.5 — İmplementasyon brief (parent main context implement edecek)

**Dosya whitelist (yalnız bunlar):**
1. `packages/db/src/repositories/payments.ts` — `create()` close bloğu (272-282): (a) order SELECT'ine (106-112) `total_cents`, `is_fully_comped` kolonları eklenir (`comped_amount_cents` YOK — bkz. 12.2 düzeltme); (b) `closeOrder===true` bloğunda, UPDATE'ten ÖNCE: tx içinde `eb.fn.coalesce(eb.fn.sum('amount_cents'), eb.lit(0))` + `eb.fn.countAll()` ile `paid_total`+`cnt` çekilir (payOrder coalesce pattern, satır 748-757); `canCloseOrder({ isFullyComped: order.is_fully_comped, payableCents: order.total_cents, paymentsTotalCents: Number(paid_total), paymentsCount: Number(cnt) })` çağrılır; `ok===false` → `RepositoryError('check', reason→code)`. `import { canCloseOrder } from '@restoran-pos/shared-domain'` (calculatePayableCents gerekmez).
2. `apps/api/src/routes/payments.ts` — catch bloğuna (118-135) 2 yeni `messageKey` mapping (12.3).
3. `apps/api/src/errors.ts` — `AUTH_MESSAGE_KEYS`'e `PAYMENT_EXCEEDS_TOTAL: 'error.payment.exceedsTotal'` satırı.
4. `apps/web/src/i18n/locales/tr.json` — `PAYMENT_EXCEEDS_TOTAL` + `error.payment.exceedsTotal` (mevcut payment error key bloğunun yanına; underpaid `tr.json:705` komşusu).
5. `apps/api/src/__tests__/` — yeni integration test dosyası `payments-close-amount.test.ts` (mevcut `orders-mod-b.test.ts` paterni şablon).

**Reason→code haritası (kod içinde):** `underpaid → 'PAYMENT_INSUFFICIENT_FOR_CLOSE'`, `overpaid → 'PAYMENT_EXCEEDS_TOTAL'`, `fully_comped_but_payments_exist → 'ORDER_INVARIANT_VIOLATED'`.

**Eklenecek SQL (tx içinde, close bloğunda):**
```
SELECT COALESCE(SUM(amount_cents), 0) AS paid_total, COUNT(*)::int AS cnt
FROM payments WHERE tenant_id = ? AND order_id = ?
```
`Number(paid_total)` ile cast (payOrder'daki `Number(paid.paid_total ?? 0)` paritesi); `paymentsCount = Number(cnt)`.

**Test case'leri (zorunlu, integration — gerçek DB):**
1. **underpaid close reddi:** 100 TL order, `pay_and_close` 50 TL → 400 `PAYMENT_INSUFFICIENT_FOR_CLOSE`; order `status='open'` KALIR (rollback teyidi); payments satırı YAZILMAMIŞ (`findByOrderId` boş).
2. **overpaid close reddi:** 100 TL order, `pay_and_close` 150 TL → 400 `PAYMENT_EXCEEDS_TOTAL`; order `open` kalır; rollback teyidi.
3. **exact-match close başarısı:** 100 TL order, `pay_and_close` 100 TL → 201; order `status='paid'`; `SUM(amount_cents)=10000`.
4. **partial-then-close accumulate:** önce `pay` (`closeOrder=false`) 40 TL (200/201, order `open`), sonra `pay_and_close` 60 TL → 201; close geçer çünkü SUM=100 TL = payable; order `paid`.
5. **(regresyon) idempotency replay:** exact-match `pay_and_close` 2. kez aynı `idempotencyKey` → replay 200, çift kapatma/çift satır yok.
6. **(opsiyonel, varsa comp fixture) comped item indirimli payable:** 100 TL order, 30 TL'lik kalem ikram (`comped_amount_cents=3000`), `pay_and_close` 70 TL → 201 (payable=70 TL).

**DoD maddeleri:**
- [ ] `canCloseOrder` artık üretim yolundan çağrılıyor (ölü kod değil); grep ile teyit.
- [ ] 6 test case PASS (en az 1-5); mevcut payments + orders-mod-b testleri kırılmadı.
- [ ] `PAYMENT_EXCEEDS_TOTAL` ADR-006 §5.2 registry'ye eklendi (ayrı edit — implementer; bu Amendment ADR-006'yı değiştirmez).
- [ ] i18n key `error.payment.exceedsTotal` `tr.json`'da; hardcoded string yok; error code → UI text mapping mevcut patterne uygun.
- [ ] integer kuruş; `any` yok; TypeScript strict geçer.
- [ ] Cerrahi: yalnız whitelist 5 dosya; `payOrder` ve ilgisiz kod dokunulmadı.
- [ ] Açık soru (`payOrder` vs `/payments` invariant birleştirme) scratchpad'e yazıldı.

<!-- ADR-014 §12 Amendment Accepted (2026-06-27, Session 70). Correctness bug fix: /payments *_close yolu canCloseOrder enforcement'a bağlandı (tx içi SUM(amount_cents) === payableCents tam eşitlik). underpaid→PAYMENT_INSUFFICIENT_FOR_CLOSE(400,mevcut), overpaid→PAYMENT_EXCEEDS_TOTAL(400,YENİ registry'ye eklenecek), fully_comped→ORDER_INVARIANT_VIOLATED(409). payOrder dokunulmadı. 5 dosya whitelist + 6 test case. -->

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

**Amendment v2 (Session 53c) — paid-only ciro matrisi (nihai):** Kullanıcı şikayeti (kısmi ödeme/açık masa ciroya girmesin) sonrası ciro/sayım endpoint'leri `status != 'cancelled'`'dan `status = 'paid'`'e çekildi. Yukarıdaki §3.1 şema yorumundaki (`status='paid'`) ile hizalı; Amendment 2/3'teki `!= 'cancelled'` ara-durumunu supersede eder. (Bu tablo Session 53c reports merge'inde yanlışlıkla ADR-017 Bağlam bölgesine düşmüştü; Session 78'de buraya taşındı — `task_0484571c`.)

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

### Amendment 1 (2026-05-11, Session 58 — Sprint 14 kapsamı)

- **Durum**: Accepted (2026-05-11, kullanıcı onayı Session 58 PR #129)
- **Tarih**: 2026-05-11

#### Bağlam

Charter Phase 3 madde 5 (raporlar) MVP listesinin yarısı eksik (audit raporu — Session 58 scratchpad). Mevcut 8 endpoint dashboard widget'larına hizmet ediyor; ek 5 endpoint **operasyonel rapor ekranı** (`/raporlar` route'u) ihtiyacını karşılar. Mevcut ADR-015 kararları (per-file route, RBAC `admin+cashier`, tenant scope, paid-only filter, no-cache, TZ-aware bugün) **bozulmaz** — yeni endpoint'ler aynı pattern'i izler.

#### Karar A1.1 — 5 yeni endpoint (per-file route, mevcut pattern)

1. **`GET /reports/category-sales?range=today|week|month`** — kategori bazlı satış. Response: `categories: [{categoryId, categoryName, qty, revenueCents, sharePct}]`. SQL: `JOIN order_items oi ON ... JOIN products p ON oi.product_id=p.id JOIN categories c ON p.category_id=c.id GROUP BY c.id`. Filter: `orders.status='paid' AND orders.created_at IN [range]`.
2. **`GET /reports/anomalies?range=today|week|month`** — iptal/void/comp özeti. Response: `summary: {cancelCount, voidCount, compCount, totalLossCents}`, `details: [{type, orderId, amountCents, reason, occurredAt, actorUserId}]`. Cancel = `orders.status='cancelled'`, void = `order_items` removed (audit_logs `order.item_void`), comp = `audit_logs action IN ('order.comp_item','order.comp_full')` (ADR-003 §11.05).
3. **`GET /reports/user-performance?range=today|week|month&role=cashier|waiter`** — kullanıcı bazlı sipariş/ciro. Response: `users: [{userId, name, role, orderCount, revenueCents, avgBillCents}]`. `role` opsiyonel — yoksa tüm roller; cashier için `orders.cashier_id`, waiter için `orders.waiter_id` (ADR-013).
   - **Implementasyon notu (Sprint 14 PR-2c, 2026-05-11):** Schema audit gösterdi ki `orders.cashier_id` kolonu **mevcut değil** (sadece `orders.waiter_user_id` var, Migration 005). Cashier semantiği "ödemeyi alan" → `payments.created_by_user_id` (ADR-014). Implementasyon iki SQL union: **waiter** (`orders.waiter_user_id` GROUP BY, paid-only) + **cashier** (`payments.created_by_user_id` GROUP BY, payments → paid orders JOIN). Bu yorum Karar 3'ün operasyonel doğru karşılığıdır; ADR-014 amendment veya yeni migration gerektirmez.
4. **`GET /reports/daily-close?date=YYYY-MM-DD`** — Z-Report semantik snapshot. Response: `{date, totalRevenueCents, orderCount, avgBillCents, paymentBreakdown[], topCategories[], anomalySummary, hourlyBuckets[]}` — tek atışta tüm KPI'lar. Real-time hesap (cache yok, paid data zaten immutable; snapshot table v5.1).
5. **`GET /reports/snapshot?at=ISO8601`** — X raporu (ara kapanış, herhangi bir an). `daily-close` ile aynı response şekli ama window `[start_of_day, at)` — gün ortasında "şu ana kadar ne oldu?" görünümü.

#### Karar A1.2 — Range parameter semantiği

`range` enum (`today`/`week`/`month`) **birincil**; opsiyonel `from`/`to` ISO date override. Default: `today`. Tanımlar:
- `today` = takvim günü (00:00–23:59 local TZ, `tenant_settings.timezone`). `business_day_cutoff_hour` kullanılmaz (Karar 7 — DROP'lu).
- `week` = mevcut ISO haftası (Pazartesi 00:00 → Pazar 23:59 local).
- `month` = mevcut takvim ayı (1. gün 00:00 → ay sonu 23:59 local).
- `from`/`to` verilirse `range` ignore — tam kontrolde işletmeci.

Window response field'ları (`windowStart`, `windowEnd` UTC ISO) tüm 5 endpoint'te döner — UI tooltip + saat dilimi şeffaflığı (ADR-015 §3 kararı uzantısı).

#### Karar A1.3 — Daily-close idempotency: real-time hesap

Aynı `date` ile tekrar çağrı → her seferinde fresh DB query. Snapshot tablo eklenmedi — paid data immutable (cancellation öncesi audit_log'da görünür); cache yok prensibi (Karar 6) korunur. Gelecekte `daily_close_snapshots` tablosu (denormalize Z-Report) v5.1 backlog — ay sonu raporu hızı gerekirse.

#### Karar A1.4 — User-performance role filter: opsiyonel

`role` query param yoksa tüm roller (cashier + waiter) tek listede döner; her satırda `role` field'ı var. Bu, "kim en çok sipariş aldı?" sorusunu role-blind cevaplar. Filter verilince scope daralır. RBAC: rapor sayfasını yine `admin+cashier` görür (cashier kendi performansını görmek meşru — kıyaslama). Self-only kısıtı yok (admin tüm liste görür, cashier de — bilinçli — küçük restoran şeffaflığı).

#### Karar A1.5 — Anomalies kapsamı: 3 tip MVP (cancel + void + comp)

`refund` (iade) ve `dispute` v5.1 backlog — refund domain'i ADR-014'te yok (ödeme geri alma akışı v5.1). MVP 3 tip: `cancel` (sipariş iptali), `void` (item silme — audit_log), `comp` (ikram). UI'da 3 sütunlu tablo + toplam zarar (kuruş).

#### Karar A1.6 — Snapshot endpoint şekli

`/reports/snapshot?at=ISO8601` response **`daily-close` ile aynı schema** — sadece window farkı (`windowStart`=start_of_day, `windowEnd`=at). Frontend tek `DailyCloseSchema` import eder; snapshot ayrı schema yok. Bu, X raporu ↔ Z raporu mental modelini kod düzeyinde yansıtır (X = gün içi snapshot, Z = gün sonu snapshot — aynı şekil).

#### Sonuçlar (Amendment 1)

- (+) Charter Phase 3 madde 5 MVP listesi 8/10 → 10/10 kapanır (CSV ADR-021'de ayrı).
- (+) Mevcut ADR-015 pattern'i bozulmaz — RBAC, tenant scope, no-cache, TZ semantiği aynı.
- (+) `daily-close` ↔ `snapshot` ortak schema = frontend basitliği.
- (−) `daily-close` real-time hesap → ay sonu büyük restoran p95 risk (v5.1 snapshot table'a ertelendi; tek tenant MVP'de sorun değil).
- (−) `anomalies` 3 tipi 3 farklı kaynaktan toplar (`orders.status`, `order_items` audit, `audit_logs.action`) → tek SQL karışık, repo helper gerek.
- (−) Range enum `today`/`week`/`month` opinionated; "yıl bazlı" ileride istenirse breaking değil ama enum genişler.

#### Açık DB ihtiyaçları

- Yeni migration **gerekmeyebilir** — mevcut indeks set (Migration 028 candidate) `category-sales` JOIN'ini kapsamalı; verify gerekir.
- `audit_logs (action, created_at)` composite index `anomalies` query'si için kritik (ADR-003 §12 — composite index var mı doğrula).
- `orders (cashier_id, created_at)` ve `orders (waiter_id, created_at)` için indeksler — mevcut ADR-003 §6 kontrol et.

#### Cross-ref (Amendment 1)

- ADR-003 §11.05 (comp audit), §12 (audit_logs şema)
- ADR-014 §10 (Mod B "Masayı Kapat" — paid filter ile uyum)
- ADR-021 (CSV export — bu amendment'ın ürettiği endpoint'ler de export olacak)
- charter Phase 3 madde 5 (rapor MVP listesi)

<!-- ADR-015 Amendment 1 Proposed (2026-05-11, Session 58 Sprint 14 prep). 6 karar: 5 yeni endpoint (category-sales, anomalies, user-performance, daily-close, snapshot), range enum + from/to override, daily-close real-time hesap, user-performance role opsiyonel, anomalies 3 tip MVP, snapshot ↔ daily-close shared schema. -->

### Amendment 2 (2026-05-12, Sprint 15 PR-1 — Range standardization)

- **Durum**: Proposed
- **Tarih**: 2026-05-12

#### Bağlam

Sprint 14 sonunda rapor endpoint topolojisi parçalı bir range modeli sergiliyor:

- **8 KPI endpoint** (`kpi/today-revenue`, `kpi/order-count`, `kpi/average-bill`, `hourly-revenue`, `payment-distribution`, `top-selling`, `recent-orders`, `closed-orders`) → range parametresi **yok**, sabit "bugün" döner. Window hesabı her dosyada inline `getCalendarDayWindow(tz)` çağrısı.
- **3 detail endpoint** (`category-sales`, `user-performance`, `anomalies`) → kendi enum'u var: `['today', 'week', 'month']` + `from`/`to` override (Amendment 1 §A1.2).
- **2 Z/X endpoint** (`daily-close`, `snapshot`) → `date` (YYYY-MM-DD) ve `at` (ISO8601) — tek-gün/tek-an semantiği; range mantığına uymuyor.

Sprint 14 PR-5b1'de web tarafında `RangeFilter` component eklendi (`today|yesterday|last7|last30|custom`). 8 KPI endpoint range desteklemediği için Sprint 14 PR-5e cleanup'ında **silindi** (Nielsen #5 — sahte UI). UI ile backend arasındaki bu uçurum kapanmalı; aksi halde Sprint 15 PR-2'de RangeFilter geri eklenemez.

Ayrıca detail endpoint enum'ı (`week`/`month`) UX standardı değil — "bu hafta" ve "bu ay" gibi takvim sınırına yapışık pencereler raporda az kullanışlı; pratikte işletmeci "son 7 gün" / "son 30 gün" / "dün" gibi rolling pencereleri ister (cüzdan dönüm noktalarına bağlı kalmadan). UX standardını ve frontend pattern'ini buluşturmanın zamanı.

#### Karar A2.1 — Tek standart range enum: `today|yesterday|last7|last30|custom`

5 preset değer + custom için `from`/`to` override:

- `today` = bugünün takvim günü pencereleri (tenant TZ, `[00:00, 24:00)`). Mevcut KPI default davranışı.
- `yesterday` = dünün takvim günü pencereleri (tenant TZ, `[önceki 00:00, bugünkü 00:00)`).
- `last7` = bugün dahil son 7 gün (`[bugün-6 00:00, bugün 24:00)`). Rolling.
- `last30` = bugün dahil son 30 gün (`[bugün-29 00:00, bugün 24:00)`). Rolling.
- `custom` = `from` + `to` (YYYY-MM-DD) zorunlu; window `[from 00:00, to+1 00:00)` (tenant TZ, `to` dahil).

Default tüm endpoint'lerde `today` (geriye uyumlu — mevcut KPI sabit-bugün davranışını korur).

**Gerekçe (`today/yesterday/last7/last30/custom` > `today/yesterday/week/month/custom`):**
- v3 paritesi: v3 raporlarında "son N gün" pattern'i baskın (`D:\dev\restoran-pos-v3\client\src\components\reports\` davranış özeti — ISO hafta/ay az tercih edilmiş).
- UX standardı: Adisyo/Toast/SambaPOS rapor filtrelerinde "Son 7 gün" / "Son 30 gün" dominant; "Bu hafta" / "Bu ay" daha az.
- Rolling pencereler aynı saatte alınınca aynı uzunluğu garanti eder — kıyaslama (week-over-week) için güvenli.
- Frontend `RangeFilter` (Sprint 14 PR-5b1) zaten bu enum'u kullanıyor — uyumlu hale gelir.
- ISO-hafta sınırı (Pazartesi 00:00) ve takvim-ayı sınırı (1. gün 00:00) tek-tenant MVP'de iş ihtiyacı olarak çıkmadı.

#### Karar A2.2 — 8 KPI endpoint'e range desteği

Ortak query schema `KpiRangeQuerySchema` (`packages/shared-types/src/reports.ts` paylaşımı):

```ts
export const KpiRangeQuerySchema = z
  .object({
    range: z
      .enum(['today', 'yesterday', 'last7', 'last30', 'custom'])
      .optional()
      .default('today'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (v) => (v.range === 'custom' ? v.from !== undefined && v.to !== undefined : true),
    { message: "range='custom' için from ve to zorunlu", path: ['from'] },
  )
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'from ve to birlikte verilmeli',
    path: ['from'],
  })
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.from <= v.to,
    { message: 'from <= to olmalı', path: ['from'] },
  )
  .refine(
    (v) => {
      if (v.from === undefined || v.to === undefined) return true;
      const start = new Date(`${v.from}T00:00:00Z`).getTime();
      const end = new Date(`${v.to}T00:00:00Z`).getTime();
      const days = (end - start) / 86_400_000;
      return days <= 90;
    },
    { message: 'custom range en fazla 90 gün olabilir', path: ['to'] },
  );
```

Bu schema 8 KPI endpoint'in tümünde **opsiyonel** olarak eklenir — istemci hiç vermezse default `today` (mevcut davranışla bit-identical). Endpoint'in iç davranışı:

1. `compute()` başlangıcında `KpiRangeQuerySchema.safeParse(req.query)` — 400 VALIDATION_ERROR davranışı (ADR-015 §6).
2. `resolveTenantTimezone(deps.db, tenantId)` → TZ string.
3. `resolveRangeWindow({ range, from, to, tz, now: new Date() })` → `{ startUtc, endUtc }`.
4. Mevcut SQL'in `WHERE created_at >= $startUtc AND created_at < $endUtc` filtresi.
5. Response'a `windowStart` / `windowEnd` UTC ISO8601 field'ları eklenir (ADR-015 §3, mevcut detail endpoint pariteti).

Response schema'ları breaking değil — sadece **opsiyonel** `windowStart`/`windowEnd` field eklenir. Mevcut bazı schema'lar (`AverageBillResponseSchema`, `TopSellingResponseSchema`, `RecentOrdersResponseSchema`, `ClosedOrdersResponseSchema`, `PaymentDistributionResponseSchema`, `HourlyRevenueResponseSchema`) bu alanları henüz dönmüyor — Sprint 15 PR-1'de hepsine eklenir. `TodayRevenueResponseSchema` ve `OrderCountResponseSchema`'da zaten var.

#### Karar A2.3 — Detail endpoint enum migration: breaking, alias yok

3 detail endpoint (`category-sales`, `user-performance`, `anomalies`) Amendment 1 ile **Sprint 14'te eklendi** (PR-2a/2b/2c, 2026-05-11). Production'da henüz frontend tüketicisi yok (Sprint 14 PR-5b1 RangeFilter cleanup edildi). Geriye uyumluluk borcu sıfır — **breaking değişiklik güvenli ve tercih edilir**:

- Mevcut enum: `['today', 'week', 'month']` → yeni: `['today', 'yesterday', 'last7', 'last30', 'custom']`.
- Alias mapping yok (`week → last7`, `month → last30` reddedildi — alias 6 ay sonra kaldırmak ekstra iş; UX semantiği farklı: ISO hafta ≠ rolling 7 gün).
- Eski değerlerle gelen request → 400 VALIDATION_ERROR (`Invalid enum value`). Frontend tek seferde geçiş yapar.
- `custom` artık enum içinde (Amendment 1'de "yalnız `from`/`to` verilirse override" idi); `range='custom'` zorunluluğu `from`+`to` ile birlikte gelir (yukarıdaki refine).

Migration etkisi: `CategorySalesQuerySchema`, `UserPerformanceQuerySchema`, `AnomaliesQuerySchema` enum'u `['today', 'yesterday', 'last7', 'last30', 'custom']` ile değiştirilir. Endpoint kodu `getRangeWindow` çağrı sözleşmesi `resolveRangeWindow`'a göç eder (Karar A2.4).

#### Karar A2.4 — Window helper: single source of truth `resolveRangeWindow`

Yer: **`apps/api/src/utils/business-day.ts`** (mevcut dosyaya ek). `packages/shared-domain`'e taşınmaz — DB tarafı değil, API helper'ı; mevcut `getCalendarDayWindow` + `getRangeWindow` zaten burada. Amendment 1'de eklenen `getRangeWindow({kind:'range'|'explicit'})` yerini **`resolveRangeWindow`** alır:

```ts
export type RangeKind = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface ResolveRangeInput {
  range: RangeKind;
  from?: string;   // YYYY-MM-DD, sadece range='custom' için
  to?: string;     // YYYY-MM-DD, sadece range='custom' için
  tz: string;      // IANA TZ
  now?: Date;      // test injection, default new Date()
}

export interface RangeWindow {
  startUtc: Date;
  endUtc: Date;
}

export function resolveRangeWindow(input: ResolveRangeInput): RangeWindow;
```

**Davranış kontratı:**
- `today` → `getCalendarDayWindow(tz, now)` (mevcut helper).
- `yesterday` → `getCalendarDayWindow(tz, now)` sonucunu 24 saat geri kaydır (DST-aware: günü `day-1` yaparak `localMidnightToUtc` ile yeniden hesapla — basit `-86400000` yanlış olur).
- `last7` → start = `getCalendarDayWindow(tz, now-6gün).startUtc`, end = `getCalendarDayWindow(tz, now).endUtc`.
- `last30` → start = `getCalendarDayWindow(tz, now-29gün).startUtc`, end = `getCalendarDayWindow(tz, now).endUtc`.
- `custom` → `getCalendarDayWindow(tz, from).startUtc` + `getCalendarDayWindow(tz, to).endUtc`. Validasyon (from<=to, max 90 gün, ikisi de var) schema seviyesinde garanti.

Geriye uyumluluk: mevcut `getRangeWindow({kind:'range', range:'week'|'month'})` çağrıları detail endpoint'lerde — Karar A2.3 breaking ile `resolveRangeWindow`'a göç edilirken silinir. `getRangeWindow` export'u export'tan kaldırılır (tek-PR breaking, dış kullanıcı yok).

#### Karar A2.5 — Z/X endpoint'lere dokunma

`daily-close?date=YYYY-MM-DD` ve `snapshot?at=ISO8601` semantik olarak **tek-gün/tek-an** raporu — range mantığı uygulanamaz. Mevcut `DailyCloseQuerySchema` ve `SnapshotQuerySchema` korunur, değişmez. Bu Amendment 1 Karar A1.4 + A1.5 ile uyumlu.

#### Karar A2.6 — Custom range max 90 gün

Validation: `range='custom'` ve `(to - from) <= 90 gün`. Gerekçe:

- p95 latency hedefi (NFR <500ms) — küçük tenant 90 gün ≈ 10-25k siparişte güvenli; 1 yıl request'i index olmadan timeout riski.
- KVKK + CSV export (ADR-021) — 100k row cap ile uyumlu; 90 gün × ortalama günlük sipariş = MVP cap altında.
- 90 gün üstü ihtiyaç → ay-bazlı snapshot tablosu (v5.1 backlog, Amendment 1 Karar A1.3 zaten not).

90 gün aşılırsa 400 VALIDATION_ERROR; hata mesajı: `"custom range en fazla 90 gün olabilir"`.

#### Test stratejisi (Amendment 2)

**Unit testler** (`apps/api/src/utils/business-day.test.ts` ek):
- `resolveRangeWindow` × 5 preset × 2 TZ (Europe/Istanbul UTC+3, Pacific/Apia UTC+13 — dateline edge) = 10 test.
- `custom` range × edge case (from===to → 1 gün; from+89 gün to → 90 gün PASS; from+90 gün to → 91 gün FAIL).
- DST sınırı (Avrupa için `yesterday` clock-forward günü `getCalendarDayWindow(now-1day)` 23 saatlik gün — yine doğru window dönmeli).
- `last7` referans gün → start.endUtc - start.startUtc = 7 takvim günü (yine DST testi: 168±1 saat).

**Integration testler** (`apps/api/src/routes/reports/*.test.ts`):
- Her 8 KPI endpoint için 1 test: `?range=yesterday` + seed (dün satılan sipariş) → response.totalRevenueCents>0; `?range=today` → 0 (bugün seed yok).
- `?range=custom&from=2026-01-01&to=2026-04-01` → 91 gün → 400.
- `?range=custom&from=2026-01-02&to=2026-01-01` → 400 ("from <= to").
- `?range=custom` (from/to yok) → 400.
- Detail endpoint'lerde eski `?range=week` → 400 (breaking validation regression test).

**Toplam yeni test sayısı:** ~25–30 (unit ~12 + integration ~16).

#### Frontend implikasyon (Sprint 15 PR-2)

- `RangeFilter` component geri eklenir (`apps/web/src/components/reports/RangeFilter.tsx`). Sprint 14 PR-5b1 implementasyonunu git history'den restore et — değişiklik yok, yeni endpoint'ler artık destekliyor.
- Hook'lar (`useTodayRevenue`, `useOrderCount`, vs.) imza değişimi: `(args?: { range?: RangeKind; from?: string; to?: string })`. Default `today` ile geriye uyumlu.
- ADR-011 PageHeader Amendment 2026-05-12 ile uyumlu — `centerActions` slot'unda RangeFilter yerleşir.
- Detail endpoint hook'larında (`useCategorySales`, `useUserPerformance`, `useAnomalies`) eski `'week'`/`'month'` referansları kaldırılır; tüm hook'lar tek `RangeKind` tip imza kullanır.

#### Sonuçlar (Amendment 2)

- (+) Tek range enum → tüm 11 detail/KPI endpoint'inde uyumlu davranış. Frontend `RangeFilter` tek state ile tüm widget'ları yönetir.
- (+) Window helper tek dosyada (`resolveRangeWindow`) — DST/TZ logic tek yerde test edilir. Endpoint kodu cleaner (5 satır → 3 satır).
- (+) v3 paritesi (rolling "son N gün") + UX standardı (Adisyo/Toast pattern).
- (+) Breaking değişim (detail enum) tek frontend tüketicisi olmayan endpoint'ler için ZERO maliyet — alias borç yok.
- (+) Default `today` geriye uyumlu — mevcut 8 KPI istemcileri (dashboard widget'ları) sıfır breaking.
- (−) `getRangeWindow` → `resolveRangeWindow` rename + signature değişimi = tek-PR commit'i biraz kabarık (3 detail endpoint dosyası + 8 KPI endpoint dosyası + helper + test'ler ~14 dosya).
- (−) DST edge case (yıl içinde 2 gün) için ekstra test gerekir; yanlış kurulursa "dün" cevabı 1 saat kaymış görünür. resolveRangeWindow Intl-bazlı (`localMidnightToUtc`) → riski sınırlı ama test gerekli.
- (−) Custom range 90 gün cap — 91+ gün ihtiyacı olan kullanıcı bug raporlayabilir; v5.1 snapshot tablo planı bunu kapsar.

#### Açık DB / index ihtiyaçları

- `last7` / `last30` query'leri için `orders (tenant_id, status, created_at)` composite index (mevcut Migration 028 candidate) zaten kapsıyor — yeni migration gerekmez.
- Audit gerek: `payments (tenant_id, created_at)` index — `payment-distribution` endpoint `last30` ile EXPLAIN ANALYZE.

#### Cross-ref (Amendment 2)

- ADR-015 + Amendment 1 (rapor endpoint pattern, range semantiği)
- ADR-011 PageHeader Amendment 2026-05-12 (RangeFilter slot)
- ADR-021 (CSV export — 90 gün cap uyumlu)
- Sprint 14 PR-5b1 (silinen RangeFilter, restore kaynağı)
- charter Phase 3 madde 5 (rapor MVP listesi)

<!-- ADR-015 Amendment 2 Proposed (2026-05-12, Sprint 15 PR-1). 6 karar: tek range enum (today/yesterday/last7/last30/custom), 8 KPI endpoint range desteği, detail endpoint enum migration (breaking, alias yok), resolveRangeWindow helper (business-day.ts), Z/X dokunulmaz, custom max 90 gün. -->

---

### Amendment 3 (2026-05-13, Session 61 — Anomaly endpoint scope: cancel + void + comp)

- **Durum**: Accepted
- **Tarih**: 2026-05-13

#### Bağlam

`GET /reports/anomalies` Sprint 14 PR-2c'de **cancel-only** olarak kapatıldı (anomalies.ts:26 yorum: "MVP scope: CANCEL-ONLY. void + comp domain emit'leri henüz YOK"). Schema 3 tipi destekliyor (`AnomalyDetailSchema.type ∈ ['cancel','void','comp']`), ama compute fonksiyonu yalnız `audit_logs.event_type='order.cancelled'` + `orders.status='cancelled'` sorguluyor. Response: `voidCount:0, compCount:0` sabit.

Mevcut durumda iki gerçek var:

1. **`order_items.is_comped` kolonu mevcut ve aktif kullanımda** (Migration 000_init.sql:290). Toggle endpoint `PATCH /orders/:orderId/items/:itemId { isComped: boolean }` admin/cashier'a açık (orders.ts:1133, ADR-013 §9.2). **Ama bu toggle audit yazmıyor** (orders.ts:1109-1175 incelendi — `writeAudit` çağrısı yok, silent boolean update). Yani: ikram veri olarak diskte var, sorgulanabilir; event olarak yok.
2. **`order_status` enum'a `'void'` eklenmiş** (Migration 001:10), repository terminal-status listesinde yer alıyor. **Ama hiçbir endpoint void status'a geçiş yapmıyor** — emit eden domain endpoint v5 MVP'de YOK. Sadece schema/enum hazır, future-proof.

v3 paritesi (`docs/v3-reference/domain-rules.md:49`, `modules.md:612, 1028`): kalem-bazlı ikram (`is_comped` + `comp_reason`) v3'te kesin; sipariş-bazlı ikram v3'te belirsiz/doğrulanmamış. v3 raporlarında "iptal–refund–ikram denetimi" var (Amendment 1 §10 ile aynı pozisyon). v5'te `comp_reason` kolonu YOK — v3'ten gelmemiş, ADR'lerde eklenmemiş.

Sprint 14 raporlar UI'ı (PR-5) anomaly kartını gösteriyor ama yalnız iptal sayılarını çiziyor; **ikram (comp) sayacı her zaman 0**. Müdür ekranında "Bugün 2 iptal, 0 ikram" yazıyor ama kasiyer aslında 3 kalemi ikram etmiş olabilir → **rapor yanlış**. void için durum farklı: emit yok, beklenti yok, 0 doğru cevap. comp için 0 yanlış cevap.

Bu Amendment cancel-only kısıtını kaldırıp anomaly endpoint scope'unu **cancel + comp + void (future-proof)** üçlüsüne genişletir. Yeni domain endpoint AÇILMAZ; sadece rapor sorgu kapsamı genişler.

#### Karar A3.1 — Scope: cancel + comp + void (rapor okuma, domain emit eklenmez)

Anomaly endpoint compute() fonksiyonu **3 tip** üretir:

- **cancel** (mevcut, değişmez): `audit_logs.event_type='order.cancelled'` join `order_items` → SUM(total_cents). `reason` audit payload'tan.
- **comp** (yeni): `order_items.is_comped=true` doğrudan DB sorgusu (audit event YOK olduğu için tek mümkün kaynak). Her ikram-edilmiş item **1 satır** üretir (item-level granularity, order-level grup değil — Karar A3.4).
- **void** (yeni, future-proof): `orders.status='void'` doğrudan DB sorgusu. Bugün 0 satır döner (emit eden endpoint yok), ileride `PATCH /orders/:id { status:'void' }` endpoint açıldığında otomatik dolar.

Yeni `PATCH /orders/:id { status:'void' }` endpoint AÇILMAZ — bu ayrı bir domain feature (sipariş-iptal sonrası muhasebe-dışı silme). v5.1 backlog'a aktarılır (Karar A3.7). Anomaly endpoint sadece **rapor okuma** scope'unda; yeni domain emit eklemez.

**Neden ADR-015 Amendment (ADR-014 değil):** ADR-014 ödeme akışı/Mod A/B bağlamı. Anomaly endpoint pure RAPORLAMA — sorgu okur, agregat döner. Yeni mutasyon eklenmiyor, yeni domain event açılmıyor. Scope ADR-015'in (rapor endpoint topolojisi) doğal uzantısı; ADR-014'e iliştirmek yanlış kategorize olur.

#### Karar A3.2 — comp veri kaynağı: DB direkt (audit YOK)

`order_items WHERE is_comped=true` doğrudan sorgulanır. Audit event çıkarmak (örn. `order_item.comped` yeni event_type) v5 MVP scope'unun dışında çünkü:

- Yeni event_type tasarımı domain işi (audit format, payload schema, version, replay senaryosu) — ADR-014/§domain'in genişlemesi.
- Mevcut PATCH endpoint'i değiştirmek (audit yazacak şekilde) **yeni audit yazımı** demek — ADR-005 audit subsystem'i etkiler, geriye dönük replay testleri gerekir.
- v5.1'de comp_reason kolonu + audit event birlikte gelmesi daha temiz (tek migration + tek ADR amendment).

**Bugünkü kısıt:** DB direkt query yaklaşımı 2 limit getirir:
- (a) `occurredAt` = `order_items.updated_at` (item satırı son güncellenme); item'ın ne zaman ikram edildiği değil (item not değişimi de bu kolonu günceller). **Tolerans:** comp toggle dışında item update sık değil (status değişimi ayrı kolon, note nadir); operatör için "yaklaşık" anlamlı kabul edilir.
- (b) `actorUserId` = NULL döner (kim ikram etti bilinmiyor; item'ı oluşturan ≠ ikramı yapan). Mevcut schema `actorUserId: z.string().uuid().nullable()` → null değer schema-uyumlu.

Bu kısıtlar response'ta NOT olarak gizlenmez; v5.1 audit event eklenince hem `occurredAt` (audit_logs.created_at) hem `actorUserId` (audit_logs.actor_user_id) gerçek değerle dolar. **Hangi alanlarda ne döndüğü** Amendment 3 kapsamında dokümanteler (Karar A3.5).

**Önbilgi düzeltme (2026-05-13, Session 61 code-implement sırasında):**

Amendment 3 ilk yazıldığında `order_items.updated_at` kolonunun mevcut olduğu varsayıldı. **Generated.ts doğrulaması: kolon YOK** (`000_init.sql:280-295` + Migration 019/020/021 hiçbiri eklemiyor; `orders`'da var, `order_items`'da yok). Düzeltme: **Migration 035 prereq olarak eklendi:**

- **Dosya:** `packages/db/migrations/035_order_items_updated_at.sql`
- **İçerik:** `ALTER TABLE order_items ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` + backfill `UPDATE order_items SET updated_at = created_at` (mevcut satırlar `created_at` zamanına çekilir; comp anomaly yaklaşıklığı korunur) + `BEFORE UPDATE` trigger `order_items_set_updated_at` `set_updated_at()` fonksiyonunu çağırır (`000_init.sql:35` mevcut function, orders pattern paritesi).
- **Domain emit değil** — yalnız audit kolonu eklemesi. `is_comped` toggle (`PATCH /orders/:id/items/:itemId`) sonrası kolon otomatik güncellenir.
- **Kapsam kilidi:** Migration 035 Amendment 3'ün doğrudan prereq'idir — yeni feature değil, mevcut kararın doğru çalışması için DB gap kapatması.

#### Karar A3.3 — void veri kaynağı: DB direkt (future-proof)

`orders WHERE status='void'` doğrudan sorgulanır. cancel ile aynı pattern (order-level grup, SUM(items.total_cents)). Bugün 0 row döner ama query çalışır → ileride emit endpoint açıldığında **kod değişikliği gerekmez**. 

void satırı için:
- `occurredAt` = `orders.updated_at` (status='void' güncellemesinin zamanı; status değişimi tek DB write olduğu için kolon güvenli).
- `actorUserId` = NULL (mevcut schema'da `orders.cancelled_by_user_id` benzeri kolon yok — v5.1'de eklenecek).
- `reason` = NULL (`orders.void_reason` kolonu yok; v5.1).
- `amountCents` = `SUM(order_items.total_cents)` (cancel ile bit-identical).

#### Karar A3.4 — comp granularity: item-level satırlar (order-level grup değil)

Bir sipariş içinde 3 kalem ikram edildiyse anomaly detail array'inde **3 satır** döner (aynı `orderId`, farklı `amountCents`). Order-level grup yapılmaz çünkü:

- v3 paritesi (`modules.md:612`): "Toplam hesabında is_comped kalemler atlanır — fiş/raporda görünür ama tutara katılmaz." v3 fiş bazlı, kalem bazlı — gruplamadan listeler.
- Operasyonel sorgu: müdür "Hangi kalem ikram edildi?" sorar (ürün adı raporun bir sonraki versiyonunda eklenebilir), "Sipariş bazında toplam kaç TL ikram?" değil.
- summary.compCount = **kalem sayısı** (toplam ikram-item adedi, sipariş adedi değil). cancel ile asimetri var (cancelCount = order adedi) ama bu kabul: cancel order-level event, comp item-level domain.
- totalLossCents = cancel-toplam + void-toplam + comp-toplam (item-level toplam, üç tip aritmetik olarak toplanır).

**Edge:** Aynı order'da hem `status='void'` hem `is_comped=true` item'ler varsa → **çift satır** döner (1 void row order-level + N comp row item-level). Mantıken void = sipariş silinmiş, içindeki ikramlar ayrı sayılmaz. **Karar:** void satırı bu durumda comp satırlarını **bastırmaz** çünkü void semantiği belirsiz (henüz emit yok). v5.1'de void emit eklenince: void row varsa o order'ın comp row'larını filtrele (mutex). Bugün için dual-row toleranslı (0 row dönecek zaten).

#### Karar A3.5 — Response field semantiği (alan-bazlı dolum)

Mevcut `AnomalyDetailSchema` 6 field (type/orderId/amountCents/reason/occurredAt/actorUserId). Üç tip için doluş matrisi:

| Field | cancel | comp | void |
|---|---|---|---|
| `type` | `'cancel'` | `'comp'` | `'void'` |
| `orderId` | audit_logs.entity_id | order_items.order_id | orders.id |
| `amountCents` | SUM(items.total_cents) order-level | item.unit_price_cents × quantity (=total_cents) | SUM(items.total_cents) order-level |
| `reason` | audit_logs.payload→>'reason' | NULL (v5'te comp_reason kolonu yok) | NULL (orders.void_reason kolonu yok) |
| `occurredAt` | audit_logs.created_at | order_items.updated_at | orders.updated_at |
| `actorUserId` | audit_logs.actor_user_id | NULL (audit event yok) | NULL (orders.cancelled_by_user_id benzeri yok) |

Schema değişmez (Sprint 14'te 3 tipe hazırdı). CSV export `csvSpec` değişmez — `reason` ve `actor_user_id` NULL field'ları zaten boş string olarak basılıyor (`format-csv` helper davranışı, ADR-021).

Summary güncellenir:
- `cancelCount` = mevcut (orders.status='cancelled' DISTINCT count)
- `compCount` = **yeni** (order_items.is_comped=true COUNT — item adedi)
- `voidCount` = **yeni** (orders.status='void' DISTINCT count)
- `totalLossCents` = SUM(cancel) + SUM(comp items) + SUM(void) tek alan (üç kaynağı toplar)

#### Karar A3.6 — RBAC + range + format=csv değişmez

- RBAC: admin + cashier ALLOW (mevcut Amendment 1 §A1.2 ve route auth değişmez)
- Range: tüm 5 preset + custom (Amendment 2'den miras)
- `?format=csv`: çalışır, satırlar yeni tipleri içerir (ADR-021 toCsv map'i 3 tipi de basıyor zaten)
- 100k row cap (ADR-021 REPORT_TOO_LARGE): item-level comp satırları cap'i hızlandırabilir → 100k geçilirse 413 (yine ADR-021)

#### Karar A3.7 — Scope-dışı (v5.1 backlog'a)

Aşağıdaki konular bu Amendment kapsamı **dışında**, v5.1 backlog'a aktarıldı:

1. **`order_items.is_comped` toggle audit event** (`event_type='order_item.comped'`, payload before/after + comp_reason) — comp anomaly satırlarında `actorUserId` + `occurredAt` doğru kaynaklı hale gelir.
2. **`comp_reason` kolonu** (`order_items` üzerine TEXT NULL) + UI alanı — v3 paritesi.
3. **`PATCH /orders/:id { status:'void' }` endpoint** — admin/cashier, void_reason zorunlu, audit event_type='order.voided'.
4. **`orders.void_reason` + `orders.voided_by_user_id` kolonları** — void anomaly satırlarında `reason` ve `actorUserId` dolması için.
5. **Anomaly endpoint ürün-adı join'i** — comp satırlarında "Hangi ürün ikram?" görünür (mevcut schema'ya `productName` field eklemek gerekir, Amendment 4).
6. **void emit edildiğinde comp suppression** (Karar A3.4 edge case).

Bu maddeler `.claude/memory/scratchpad.md`'e açık soru olarak işlenir.

#### Sonuçlar (Amendment 3)

- (+) Rapor doğruluğu: müdür ekranı bugün "ikram = 0 (yanlış)" yerine gerçek ikram sayısını ve tutarını gösterir.
- (+) Schema breaking yok — `AnomalyDetailSchema.type` 3 değeri zaten kabul ediyor; sadece response'ta yeni satırlar görünür.
- (+) v3 paritesi tamam: kalem-bazlı ikram raporda görünür.
- (+) void future-proof: emit endpoint v5.1'de eklendiğinde rapor otomatik dolar (yeni Amendment gerekmez).
- (+) Yeni domain endpoint açılmadı — kapsam kilidi korundu (CLAUDE.md MVP scope).
- (−) comp `actorUserId` + `occurredAt` yaklaşık dönüyor (audit event olmadığı için). v5.1 audit event eklenince netleşir; bu Amendment'ta açıkça not.
- (−) comp item-level granularity → aynı order'dan çoklu satır; CSV row sayısı büyür (100k cap önemi artar). Big-tenant tehlikesi MVP kapsamında değil.
- (−) totalLossCents 3 kaynağı toplayan tek alan → drill-down isteyen kullanıcı için summary'de tip-ayrımı yok. Detail array zaten tip-ayrımlı; summary aritmetik toplam yeterli MVP için.

#### Test stratejisi (Amendment 3)

**Integration testler** (`apps/api/src/__tests__/reports.test.ts` ek):

- Seed: 1 cancelled order (1 item, 50 TL) + 1 voided order (2 item, 30+40 TL) + 1 active order with 2 comp items (10 + 20 TL) → detail rows = 1 cancel + 1 void + 2 comp = **4 satır**, summary: cancelCount=1, voidCount=1, compCount=2, totalLossCents = 5000+7000+1000+2000 = **15000**.
- Empty window: 3 tip de 0 → detail=[], summary all-zero.
- Range filtresi: comp item'ı window dışına çıkarsa → 0 satır (order_items.updated_at filter).
- CSV export: 4 satırın 3 farklı type değeri içerdiği doğrulanır (`type` kolonu).
- Mevcut "cancel-only" regression testi (Sprint 14 PR-2c'den) → 1 cancel + 0 comp + 0 void → 1 satır, hâlâ PASS.
- RBAC regression: waiter 403 (Sprint 14 mevcut), schema değişmediği için aynı.

**Toplam yeni test sayısı:** ~6-8 (cancel-only regression hâlâ PASS, ek tipler için 4-5 yeni testcase + edge).

#### Implementer talimatları

1. **`apps/api/src/routes/reports/anomalies.ts`** — compute() içinde:
   - Mevcut cancel sorgusunu KORU.
   - Yeni comp sorgusu: `order_items` from + join orders + `where is_comped=true and tenant_id=$tid and updated_at in window`. SELECT: order_id, updated_at as occurred_at, total_cents as amount_cents, NULL as reason, NULL as actor_user_id. type='comp' map.
   - Yeni void sorgusu: `orders where status='void' and tenant_id and updated_at in window` + items SUM. type='void' map.
   - Summary: 3 ayrı COUNT/SUM birleşik; totalLossCents = cancel_loss + comp_loss + void_loss.
   - Detail array: 3 array concat + occurredAt DESC sort.
2. **`packages/shared-types/src/reports.ts`** — schema değişmez. anomalies.ts top-doc comment güncelle (cancel-only → 3 tip).
3. **csvSpec değişmez** — toCsv mevcut map 3 tipi zaten basıyor.
4. **Test**: `apps/api/src/__tests__/reports.test.ts` — ~6 yeni testcase, seed 3 tip + edge.
5. **Frontend dokunma yok** — Sprint 14 PR-5 anomaly kartı zaten 3 tipi gösterecek hazır; sadece backend gerçek değer dönmeye başlayınca otomatik dolacak.

#### Cross-ref (Amendment 3)

- ADR-013 §9.2 (comp toggle RBAC — admin/cashier only)
- ADR-014 §12 (comp/void domain bağlamı — bu Amendment domain emit eklemez, sadece rapor okur)
- ADR-015 + Amendment 1 (rapor endpoint pattern) + Amendment 2 (range)
- ADR-021 (CSV export — toCsv 3 tipi basıyor)
- v3 reference: `domain-rules.md:49`, `modules.md:612, 1028`
- Migration 000_init.sql:290 (`is_comped`), Migration 001:10 (void enum)

<!-- ADR-015 Amendment 3 Accepted (2026-05-13, Session 61). 7 karar: scope=cancel+comp+void / comp DB-direct query / void DB-direct future-proof / item-level comp granularity / field-by-field doluş matrisi / RBAC+range+CSV değişmez / 6 madde v5.1 backlog. Domain emit eklenmez, sadece rapor okuma kapsamı genişler. Merged in PR #158 (sha `6442822`, 2026-05-13) — Migration 035 + anomalies.ts 3 sorgu birleşik + reports.test 6 yeni integration test. -->

---

## ADR-016 — Caller ID + Müşteri Yönetimi (Inbound Call Pipeline + Customer Domain)

<!-- Status drift düzeltme (Session 70, 2026-06-27): Aşağıdaki "Durum: Proposed" STALE. Bu ADR PR-8a..PR-8e (PR #99 "Caller ID + müşteri yönetimi" + PR #100 "caller-bridge PR-8d .NET 8") ile TAM implement edildi (Sprint 8). Karar kesinleşmiş + shipped → de-facto Accepted; "Proposed" hiç güncellenmemişti. v5.1 backlog item'ları (çoklu hat, arama geçmişi raporu, KVKK silme UI, veresiye) bilinçli ertelenmiş, kabulü bloke etmez. → DURUM: Accepted. -->


- **Durum**: Accepted (2026-05-03 yazıldı; Session 70 2026-06-27'de Proposed→Accepted status-drift düzeltmesi — PR-8a..8e #99/#100 shipped)
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


#### §12 — Amendment 2 (2026-07-07, Session 85) — Caller Bridge Pilot Cutover + Donanım Kilidi (A5)

- **Durum**: Accepted (2026-07-07, Session 85)
- **İlişki**: ADR-016 Karar 1 + §11 (Caller Bridge = .NET 8 Windows Service) amendment'ı. **Yeni runtime kararı DEĞİL** — Karar 1 zaten .NET 8'i seçti ve **kod PR-8d/#100 ile shipped** (`apps/caller-bridge/`, 21 dosya, testli). Bu amendment yalnız *operasyonel pilot cutover* + *donanım varsayım kilidi* getirir. Emsal: ADR-004 Amendment 3 (shipped-ama-donanımda-doğrulanmamış bir yeteneği pilota çekerken go/no-go + `Doğrulanmamış:` disiplini).

##### Bağlam

`active-plan.md` A5 "Caller Bridge (.NET8; blocker değil)" + P5-4 "Caller Bridge ⏳" satırları bridge'i BEKLİYOR gösteriyor; brief de "PowerShell (v3-kanıtlı) vs .NET8 (robust) gerilimini çöz" diye soruyor. **Bu premise bayat.** Gerçeklik doğrulandı (Session 85 kod denetimi):

1. **Runtime kararı KAPALI.** ADR-016 Karar 1 (2026-05-03) .NET 8 Worker Service'i gerekçeli seçti (PowerShell/clipboard = v3 referansı ve reddedilen alternatif A; node-ffi-napi/edge-js reddedildi). Kod var: `apps/caller-bridge/src/` — `Program.cs`, `Devices/CidShowDevice.cs` (P/Invoke `cid.dll`), `Devices/MockCallerIdDevice.cs`, `Http/BridgeApiClient.cs` (Polly retry, `X-Bridge-Token`), `Workers/CallerBridgeWorker.cs` (bounded Channel, drop-oldest), `Logging/PhoneMasking.cs` (`055******67`), `install-service.ps1` (LocalSystem auto-start + failure=restart/5s), Serilog rolling 14 gün, `tests/`.
2. **`.claude/skills/caller-id-bridge/SKILL.md` STALE** — clipboard-poll PowerShell + `apps/desktop/...` (Electron) yollarını gösteriyor; v5'te Electron yok (CLAUDE.md), endpoint adı da yanlış (`/api/caller-id/incoming` yerine gerçek yol `/bridge/caller-id/incoming`). Skill v3 hafızası; v5 gerçeği = bu amendment + `apps/caller-bridge/README.md`.
3. **Bridge donanımda HİÇ çalıştırılmadı.** `cid.dll` P/Invoke imzaları (`cidOpen/cidClose/cidIsRing/cidGetCallerNumber`) vendor C# örneğinden türetildi ama fiziksel C812A'da doğrulanmadı → **`Doğrulanmamış:`** (ADR-004 Amd3'teki codepage-scan emsali gibi, ilk donanım bağlantısında teyit edilecek).

Dolayısıyla açık iş = kod değil, **pilot cutover kararları**: PowerShell'e geri dönülmez (aşağıda gerekçe); donanım varsayımı kilitlenir; deploy/config/token/log spec'i netleşir; OPS'a go/no-go checklist verilir.

##### Karar

**A2.1 — Runtime: .NET 8 TEYİT, PowerShell REDDEDİLDİ (reopen yok).**
Bridge `apps/caller-bridge/` .NET 8 Worker Service olarak kalır. PowerShell clipboard-listener'a dönmek REDDEDİLDİ çünkü: (a) Karar 1 zaten .NET 8'i seçti + kod shipped → ADR-before-code tersine döner, çalışan+testli kod atılır; (b) clipboard-poll kasiyerin panosunu kirletir (v3 zayıf yanı, `caller-id-and-customer.md §1A`), 250-300ms CPU polling; (c) `cid.dll` event modeli line-metadata (çoklu hat) verir, clipboard vermez; (d) self-contained `dotnet publish` tek `.exe` + Windows Service host battle-tested. PowerShell "hızlı/kanıtlı" argümanı v3 için geçerliydi; v5'te kod zaten .NET ve pilotu bloke etmiyor → hız avantajı yok. **`.claude/skills/caller-id-bridge/SKILL.md` bayat işaretlenmeli** (implementer değil, bir doc-hygiene chip'i; bu amendment tek doğru kaynak).

**A2.2 — Donanım varsayımı KİLİTLE: CIDShow C812A, USB-HID, `cid.dll` P/Invoke. Seri-port AT/`RING`+`NMBR=` modem DEĞİL.**
v5 bridge USB-HID cihazı `cid.dll` üzerinden poll eder (`cidIsRing(line)` → `cidGetCallerNumber`), **COM/serial port AÇMAZ**, AT komutu/`RING`/`NMBR=` parse ETMEZ. Config'de COM-port alanı **YOKTUR** (`BridgeOptions`: `ApiBaseUrl`, `BridgeToken`, `LineCount`, `UseMockDevice`, `MockEmitEverySeconds` — hepsi bu). Bu ADR-016 Karar 1 donanım seçimiyle (CIDShow C812A, Whozz/Twilio reddi) tutarlıdır. **⚠️ [USER doğrulaması gerekli]:** Restoranda fiilen bu USB-HID CIDShow cihazı mı var, yoksa RJ11 seri-modem mi? Seri-modem çıkarsa `cid.dll` yolu geçersiz → yeni `ICallerIdDevice` implementasyonu (`SerialPort` + AT parse) gerekir ve bu **ayrı bir amendment** olur (kapsam kilidi). Pilot bu doğrulama olmadan başlamaz.

**A2.3 — API iletim kontratı DEĞİŞMEZ (kod-teyitli).**
Bridge → `POST {ApiBaseUrl}/bridge/caller-id/incoming`. Auth: `X-Bridge-Token` (tenant-bound shared secret) + API tarafı `X-Tenant-Id` header'ı **bridge'den beklemez** — token'dan resolve eder... **DÜZELTME (kod denetimi):** Mevcut API `bridgeCallerIdRouter` `requireBridgeToken` + `requireTenantHeader()` ZİNCİRİ kullanıyor (`routes/caller-id/index.ts:189-191`) → yani **`X-Tenant-Id` UUID header ZORUNLU**. Fakat shipped .NET `BridgeApiClient` YALNIZ `X-Bridge-Token` gönderiyor (`BridgeApiClient.cs:34`), tenant header GÖNDERMİYOR → **canlı olsaydı her POST 400 `TENANT_HEADER_INVALID` alırdı.** Bu bir uçtan-uca kontrat kırığı (memory `feedback_realtime_contract_dead_untested` paterni: shipped ama hiç uçtan-uca koşulmadı). **Karar:** bu bir *bug*, mimari boşluk değil → implementer chip A5-fix: `BridgeApiClient`'a `X-Tenant-Id` header ekle + `BridgeOptions.TenantId` (Guid, appsettings). Bridge tek-tenant olduğu için TenantId statik config'ten gelir. (Alternatif — API'yi token→tenant çözecek şekilde değiştirmek — REDDEDİLDİ: Print Agent ADR-004 pattern'i header-tenant kullanıyor, tutarlılık + agents tablosunda token→tenant lookup yok.) Body şeması SABİT: `{ rawPhone: string(1..30), lineNumber?: int(1..8), receivedAt: ISO-8601 }` = `BridgeIncomingCallSchema`. Yanıt her durumda **200** `{ accepted, reason, callLogId }` (bridge'i bloke etmemek için hata bile 200); bridge sadece `IsSuccessStatusCode`'a bakar.

**A2.4 — Maskeli platform-no filtresi API'DE (köprüde DEĞİL) — kod-teyitli.**
`isMaskedNumber(normalized, tenant_settings.caller_id_bypass_patterns)` API pipeline'ında (`routes/caller-id/index.ts:209`, `utils/caller-id.ts`); köprü HAM numarayı gönderir, filtre/normalize/dedupe hepsi sunucuda (bridge'e güvenilmez — Karar 3). Bridge yalnız KVKK için **log'da** maskeler (`PhoneMasking.Mask`); DB'ye ham gider, retention cron 30 gün siler. Bu doğru seam — DEĞİŞMEZ.

**A2.5 — Dayanıklılık modeli DEĞİŞMEZ (kod-teyitli, yeterli):**
- **Retry:** README Polly (1s/2s/4s) diyor; `BridgeApiClient` timeout 10s. *Not:* Polly policy DI'da bağlı mı implementer teyit etsin (README iddia ediyor, `Program.cs` okunmadı) — bağlı değilse A5-fix ile `AddPolicyHandler` ekle.
- **Duplicate/broadcast:** İki kat — cihaz poll `cidIsRing` bir çağrıyı bir kez verir; asıl dedupe API'de `findRecentDuplicate(5s)` (`index.ts:217`) → aynı numara 5sn içinde `reason='duplicate'`, yeni call_log YOK. Client-side debounce v5'te GEREKSİZ (v3 çift-debounce karmaşası kaldırıldı — `caller-id-and-customer.md §2C`).
- **Tek-örnek (çift-popup önleme):** Windows Service tekil (aynı servis adı iki kez kurulamaz). Popup tek "primary station"a gider (`caller_id_station_user_id` room), broadcast yok → v3'ün "herkese düşer + yarış" sorunu yapısal olarak yok (Karar 5).
- **Offline (API/ağ kopuk):** Bounded Channel(128, DropOldest) → ağ yavaşken cihaz thread bloke olmaz; kalıcı kuyruk YOK → servis restart'ında bekleyen çağrılar KAYBOLUR. **Karar:** pilot için KABUL (paket-servis; kaçan çağrı = müşteri tekrar arar; call_log kalıcı-kuyruk KVKK'da ekstra PII-at-rest riski). Disk-persist dead-letter kuyruğu **v5.1 backlog**. Bu bilinçli bir sadelik, ADR-023 (DB backup) kapsamında değil.

**A2.6 — Yapılandırma + dağıtım (kod-teyitli, tek değişiklik = A2.3 tenant header):**
- Config: `appsettings.json` `Bridge` section — `ApiBaseUrl` (no trailing slash), `BridgeToken`, **`TenantId`** (A2.3 ile YENİ), `LineCount=1`, `UseMockDevice=false`. Secret'lar repoya girmez (`REPLACE_ME` placeholder).
- Token kaynağı: prod'da agent key `/root/pos-secrets.env` `PRINT_AGENT_API_KEY` paterni gibi bridge için ayrı tenant-bound token — **API env `BRIDGE_TOKEN`** ile eşleşmeli (memory `project_prod_server_provisioned`). Bridge ve Print Agent AYNI `BRIDGE_TOKEN`'ı mı paylaşır yoksa ayrı mı? **Karar:** AYRI token önerilir (ilke: minimum yetki + rotasyon izolasyonu) ama MVP'de tek `BRIDGE_TOKEN` env paylaşımı KABUL (tek-tenant, iki lokal servis); ayrıştırma v5.1. **[USER/OPS doğrulaması]:** prod'da hangi env değişkeni set edilecek.
- Windows'ta çalışma: `install-service.ps1 -ExePath ...` → LocalSystem, `start=auto`, failure=restart/5s×3. `services.msc`'de "Restoran POS — Caller ID Bridge".
- Deploy: `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` → `C:\restoran-pos\caller-bridge\`; **`cid.dll` (x64) elle kopyalanır** (repoya commit'lenmez — lisans + binary; `.gitignore`'da). WiX bundle (Print Agent + Caller Bridge tek installer) **v5.1** (ADR-016 §Karar 1 eksi + active-plan kapsam-dışı).
- **KVKK log kilidi (CLAUDE.md:125):** Ham telefon uygulama log'una YAZILMAZ. Kod uyumlu (`PhoneMasking` her log'da; `BridgeApiClient`/`Worker` yalnız `masked` basar). İhlal denetimi implementer DoD'unda: `grep -i "rawPhone\|RawPhone" apps/caller-bridge/src` → yalnız HTTP body + mask input'unda görünmeli, `Log*` çağrısında ASLA.

**A2.7 — Kapsam kilidi (v3 paritesi + ertelenenler):**
- Pilot MVP: tek hat (`LineCount=1`), USB-HID C812A, tek primary station popup, 30 gün retention (mevcut Karar 8 cron). = v3 paritesi (v3'ün clipboard+SDK ikili yolu, çift-debounce, legacy `incoming_calls` tablosu, "herkese popup" REDDEDİLDİ — hepsi v5'te sadeleşti).
- **v5.1 backlog (bu amendment'la teyit):** çoklu hat (C814A 4-port), disk-persist offline kuyruk, ayrı bridge token, C#-SDK-imza-versiyonlama, WiX bundle, seri-modem `ICallerIdDevice` (donanım seri çıkarsa), arama-geçmişi raporu, KVKK silme UI. (ADR-016 §Karar 1 + Amd1 backlog'una eklenir, çakışma yok.)

##### Alternatifler (bu amendment'a özel)

- **Yeni "ADR-034: Caller Bridge Runtime" yaz (PowerShell vs .NET yeniden değerlendir).** REDDEDİLDİ: karar zaten Accepted (Karar 1) + kod shipped; yeni ADR shipped kodla çelişir, ADR-before-code'u tersine çevirir. Amendment doğru araç (ADR-004 Amd3 emsali).
- **PowerShell clipboard bridge'e dön (brief'in "hız/kanıtlanmışlık" hissi).** REDDEDİLDİ (A2.1): clipboard kirliliği + polling + line-metadata kaybı + çalışan .NET kodu çöpe. Hız avantajı yok (kod hazır).
- **API'yi token→tenant çözecek şekilde değiştir (bridge tenant header göndermesin).** REDDEDİLDİ (A2.3): Print Agent ADR-004 header-tenant pattern'iyle tutarsız; token→tenant lookup tablosu yok; bridge'e tek satır header eklemek daha ucuz + defansif (`requireTenantHeader` fail-closed kalır).
- **Kalıcı disk-persist offline kuyruğu pilota koy.** REDDEDİLDİ (A2.5): ekstra PII-at-rest (KVKK), paket-serviste kaçan çağrı = tekrar aranır; DropOldest channel yeterli. v5.1.
- **Bridge ve Print Agent için tek paylaşılan `BRIDGE_TOKEN`.** KISMEN KABUL (A2.6): MVP tek-tenant iki-lokal-servis'te paylaşım kabul; ayrı token (minimum yetki) v5.1.

##### Sonuçlar

- (+) Runtime belirsizliği kapandı: .NET 8 teyit, PowerShell/clipboard kapı kapandı; skill bayat işaretlendi → gelecekte tekrar açılmaz.
- (+) Donanım varsayımı yazılı kilit (USB-HID cid.dll, seri-modem değil) → USER doğrulaması net bir go/no-go kapısı.
- (+) **Sessiz kontrat kırığı yakalandı** (bridge `X-Tenant-Id` göndermiyor → canlıda 400); pilot ilk donanım denemesinde saatler kaybetmeden düzeltilecek (implementer chip A5-fix).
- (+) Deploy/config/token/log spec tek yerde; OPS go/no-go checklist'i çıktı olarak var.
- (−) Bridge hâlâ donanımda doğrulanmadı — `cid.dll` imzaları + tenant-header fix + Polly bağlanması ilk fiziksel bağlantıda birlikte test edilecek (`Doğrulanmamış:` üç kalem).
- (−) Offline kalıcı kuyruk yok → servis restart'ında bekleyen çağrı kaybı (kabul: paket-servis, v5.1).
- (−) `active-plan.md`/skill güncelleme borcu doğdu (bu amendment ile doc-code drift düzeltilmeli).

##### İmplementer için net spec (A5-fix chip'i — bu bir DAVRANIŞ değişikliği değil, kontrat düzeltmesi)

**Dosyalar + değişiklikler (yalnızca bunlar; cerrahi — CLAUDE.md directive 7):**
1. `apps/caller-bridge/src/Configuration/BridgeOptions.cs` → `public Guid TenantId { get; set; }` ekle (default `Guid.Empty`).
2. `apps/caller-bridge/src/Http/BridgeApiClient.cs` → ctor'da `X-Tenant-Id` guard: `if (_options.TenantId == Guid.Empty) throw new InvalidOperationException("Bridge:TenantId is required.");` + `_http.DefaultRequestHeaders.Add("X-Tenant-Id", _options.TenantId.ToString());` (mevcut `X-Bridge-Token` satırının yanına).
3. `apps/caller-bridge/src/appsettings.json` → `"Bridge"` section'a `"TenantId": "REPLACE_ME_TENANT_UUID"` ekle (placeholder).
4. `apps/caller-bridge/src/Program.cs` (OKU + teyit) → Polly retry policy (`AddPolicyHandler`, 1s/2s/4s) `HttpClient` DI'ına bağlı DEĞİLSE ekle (README iddia ediyor; değilse README ile kod ayrışık — düzelt).
5. `apps/caller-bridge/README.md` → §3 appsettings örneğine `TenantId` ekle; §5 doğrulama adımına "400 alırsan TenantId/token kontrol et" satırı.
6. `apps/caller-bridge/tests/CallerBridgeWorkerTests.cs` (OKU) → `IBridgeApiClient` recorder mock'ta gönderilen header setinde `X-Tenant-Id` bekleyen assert ekle (qa-engineer teslimi; kontrat regression guard).

**Env/config spec (OPS, cutover günü):**
- API sunucu env: `BRIDGE_TOKEN=<tenant-bound-secret>` (mevcut; Print Agent ile paylaşım kabul veya ayrı — A2.6).
- Bridge `appsettings.json`: `ApiBaseUrl=https://restoranpos.org/api` (**S86 doğrulandı — `/api` prefix ŞART**: API `app.use('/bridge/caller-id', …)` `apps/api/src/app.ts:180` + Nginx `/api/` prefix STRIP `deploy.md`§1 → istek `…/api/bridge/caller-id/incoming`, API `/bridge/caller-id/incoming` görür; çıplak domain SPA'ya düşer/404. `feedback_cookie_path_behind_nginx_strip` emsali — bridge cookie kullanmaz), `BridgeToken=<BRIDGE_TOKEN ile aynı>`, `TenantId=<tenant UUID — api.env TENANT_ID>`, `LineCount=1`, `UseMockDevice=false`.
- Deploy: publish + `cid.dll` x64 kopyala + `install-service.ps1`.

**Go/no-go checklist (pilot, donanım eşliğinde — USER + OPS):**
- [ ] **[USER]** Fiziksel cihaz teyidi: USB-HID CIDShow C812A mı? (Seri-modem ise DUR — A2.2, ayrı amendment.)
- [ ] Mock smoke (donanımsız): `UseMockDevice=true`+`MockEmitEverySeconds=30` → API `tenant:{id}:caller-station` room'una emit + web popup görünür + call_log yazılır.
- [ ] Tenant-header fix doğrulandı: gerçek POST 200 (400 DEĞİL) döner.
- [ ] `cid.dll` x64 yerleşti + `cidOpen rc==0` (log). rc≠0 → README sorun-giderme.
- [ ] Kendini ara → log'da `Ring detected (phone=055******67 line=1)` + `Incoming call posted` + web'de doğru müşteri/bilinmeyen popup.
- [ ] Maskeli platform no (0850…) → popup YOK, call_log YOK (bypass).
- [ ] KVKK log denetimi: log dosyasında ham numara YOK, yalnız maskeli.
- [ ] Servis restart → auto-start + tekrar bağlanır.

##### Amendment 3 (2026-07-07, Session 86) — Cihaz P/Invoke düzeltmesi: fabricated polling → gerçek `SetEvents` callback

- **Durum**: Accepted (2026-07-07, Session 86)
- **Tetikleyici**: Kullanıcı Caller pilotuna başladı (cihaz USB-bağlı doğrulandı) + SDK dosyalarının yerini verdi (`D:\dev\restoran-pos-v3\tools\callerid-sdk-helper` + `store-bridge`). SDK'ya karşı doğrulama yapıldı.

**Bulgu (`Kodda tespit:` — Claude ana-context'te v3 `Program.cs`'i birebir okuyarak teyit etti):** Shipped `CidShowDevice.cs`'in 4 P/Invoke export'u (`cidOpen`/`cidClose`/`cidIsRing`/`cidGetCallerNumber`, StdCall, ANSI, polling) **UYDURMA** — kaynağı bir `/tmp/caller-id-sdk/...` yorumuydu; gerçek SDK'da bu isimler YOK. Gerçek `cid.dll` **tek export** sunar: `SetEvents(callerIdCb, signalCb)` — **cdecl**, **BSTR** string, **callback-push** (DLL çağrıyı iter, poll edilmez). CallerID callback = 5 BSTR (deviceSerial, line, phoneNumber, dateTime, other). İlk donanım çalıştırmasında `cidOpen()` → `EntryPointNotFoundException` → servis anında ölürdü. Yer gerçeği: v3 StoreBridge helper (`tools/callerid-sdk-helper/Program.cs`, net8.0, `NativeLibrary.Load`+`GetExport("SetEvents")`) — çalışan referans; gerçek `cid.dll` de orada (`cidshow_x64\cid.dll` 4.1MB + x86).

**Dürüstlük notu:** §12 Amd2 "kod shipped, yalnız donanım doğrulaması kaldı" premise'i bu katman için fazla iyimserdi — P/Invoke "doğrulanmamış" değil "yanlış"tı. PR #291 readiness HTTP/kontrat katmanını gerçekten test etti (12/12) ama cihaz P/Invoke'u SDK'ya karşı doğrulanmadı (`DllImport` runtime-çözümlü, derleme/mock-test yakalamaz).

**Karar (kullanıcı "direkt yeniden yaz" seçti):** `CidShowDevice.cs` cihaz modeli **polling → `SetEvents` callback** olarak düzeltilir. İmzalar v3 helper'ının kanıtlı yüzeyini yansıtır (**davranış referansı, kopya DEĞİL**):
- 3 `[UnmanagedFunctionPointer(Cdecl)]` delegate: `CallerIdCallback` (5×BStr), `SignalCallback` (2×BStr+4×int), `SetEventsDelegate`.
- `NativeLibrary.Load(dllPath)` → `GetExport("SetEvents")` → `Marshal.GetDelegateForFunctionPointer` → **rooted** delegate field'lar (GC-pin; native pointer'ı tutar) → `_setEvents(callerId, signal)`.
- DLL yolu: `cidshow_x64\cid.dll` / `cidshow_x86\cid.dll` **alt-klasör** (vendor konvansiyonu), düz kök değil.
- `cidOpen/cidClose/cidIsRing/cidGetCallerNumber` + poll-loop **SİLİNİR**.
- Callback yalnız **HAM numarayı** `CallReceived` ile fırlatır; normalize/filtre/dedupe API'de (A2.4 değişmez). Log maskeli (`PhoneMasking`, KVKK).
- **`ICallerIdDevice` DEĞİŞMEZ** (zaten event-tabanlı); `Worker`/HTTP/`BridgeApiClient` DEĞİŞMEZ.

**Kapsam:** tek-dosya rewrite + README cihaz bölümü (alt-klasör + SetEvents + troubleshooting). Native yol için birim test YOK (donanım gerektirir; #291 mock/HTTP testleri geçerli kalır).

**Doğrulama sınırı (`Doğrulanmamış:`):** SetEvents cdecl/BStr imzası vendor örneklerinden **"imply"** (v3 `Program.cs:8`; ampirik değil) — v5 aynı belirsizliği miras alır. Ayrıca v3'ün gerçek ÜRETİM yolu `store-bridge\callerid\Cid812Provider.js` = **`node-hid` doğrudan HID okuma**; SetEvents v3'te "aday" kaldı. Yani bu rewrite **derleme-doğru ama donanım-doğrulanmamış**; ilk fiziksel çağrı gerçek testtir. SetEvents patlarsa fallback = .NET HID-read → **ayrı amendment**.

**Alternatifler (reddedildi):** (1) Önce v3 helper'ı cihazda test et — kullanıcı reddetti ("direkt yaz"), risk kabul; (2) doğrudan HID-read yaz — SetEvents daha az kod + v3 net referans, HID gerekirse ayrı amendment.


---

## ADR-017 — Paket (Takeaway) Sipariş Akışı

- **Durum**: Accepted
- **Tarih**: 2026-05-04

### Bağlam

v3'te paket sipariş akışı, salon (dine_in) akışından **ayrı bir ekran** üzerinden yürür: Masalar üst-orta yeşil "Paket" butonu → "Paket Sipariş" sayfası (sol arama+kategori+ürün grid, sağ adisyon, alt "Kaydet") → müşteri zorunlu (modal) → ödeme tipi (nakit/kart) seçimi (modal) → sipariş kaydı + Masalar ekranına dönüş + sağ panelde "Paket siparişler" kartları (timer, status badge, "Teslimata Çıkarıldı"/"Teslim Edildi" butonları). v3 davranışı kullanıcı tarafından ekran görüntüleriyle teyit edildi; v3 koduna bakıldı (`D:\dev\restoran-pos-v3\server\services\orderService.js:354+` `createOrder`, `:817+` `updateTakeawayDelivery`, `:156+` `recordTakeawayDeliveryPaymentIfNeeded`).

v3'teki şema bilgileri:
- `orders.order_type IN ('dine_in','takeaway')`, `takeaway_out_at`, `takeaway_delivered_at`, `takeaway_planned_payment_type ('cash'|'card')`, `delivery_address`, `delivery_note` kolonları (`server/migrations/run.js:205, 217, 670–673`)
- Teslim anında `recordTakeawayDeliveryPaymentIfNeeded` çağrılıyor; planlanan ödeme tipi ile **`payments` satırı atomik insert** ediliyor (idempotency key: `takeaway-delivery:${orderId}`)
- `updateTakeawayDelivery` action ∈ {`out_for_delivery`, `delivered`}; ileri-dönüş yok, geri dönüş kuralları sıkı (delivered olduktan sonra out_for_delivery hata)

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

### Amendment 3 (2026-05-10) — Auth pattern: UI login per test (storageState retired)

**Bağlam**: Sprint 12 PR-3d (S6 KDS smoke) sırasında ortaya çıkan kritik bulgu — `apps/web/src/store/auth.ts` Zustand auth store **persist middleware kullanmıyor** (kasıtlı tasarım, comment "kept in memory (never persisted to localStorage)" + "Refresh token lives in httpOnly cookie"). Sonuç: PR #108'de yazılan `auth.setup.ts` storageState altyapısı **app'i hidrate etmiyor** — login API çağrısı yapıyor + localStorage `auth-storage` key yazıyor, ama hiçbir component bu key'i okumuyor. S1 zaten UI login akışı kullanıyor (empty storageState); S2-S5 plan'ı da UI login moduna geçirilir.

**Karar**: **UI login per test** (S6 pattern kanonik):
- Her test başında `await loginViaUI(page, { email, password })` helper çağrılır
- storageState altyapısı (`auth.setup.ts buildAuthStates`) Sprint 9'dan beri **dead code** — Sprint 9b kapsamında kaldırılmaz (gelecek `Zustand persist switch` v5.1 ADR ile reaktive edilebilir; geri çıkarmak ucuz)
- Rate limit (5 login / 15 dk / IP) bypass için `E2E_BYPASS_LOGIN_LIMIT='1'` env (PR #119'da eklendi); prod davranışı korunur

**Reddedilen alternatif**: Zustand `persist` middleware ekle.
- Pro: storageState path tekrar çalışır, test başına login süresi (~1 sn × 5 test = 5 sn) tasarrufu
- Contra: localStorage'a accessToken yazımı XSS riski (mevcut tasarım kasıtlı in-memory); bootstrap-on-mount eklemek (sayfa reload'unda silent refresh) ek scope; **Sprint 9b kapsamı dışı** (auth security review ADR gerek). v5.1 backlog: `feedback_zustand_persist_v51_decision`.

**Reddedilen alternatif**: `page.evaluate(() => useAuthStore.setState(...))` ile state inject.
- useAuthStore window'a expose edilmiyor; expose etmek production'a test-only kod sızdırma anti-pattern.

**Implementation kontratı (Sprint 9b)**:
- `apps/web/e2e/helpers/auth-login.ts` `loginViaUI(page, {email, password})` helper export
- Test'ler `test.use({ storageState: { cookies: [], origins: [] } })` ile başlar (S1 + S6 pattern)
- Login sonrası `await page.waitForURL(/\/dashboard$/)` doğrula
- KDS hedefli test'lerde: SPA içi nav için `history.pushState + popstate` (Sprint 12 öğretisi, `feedback_playwright_spa_navigation`)

**Phase 2 exit kriterine etki**: Sprint 9b kapanışında 5/5 senaryo yeşil → Phase 2 mühürlü.

### S2-S5 spec amendment (2026-05-10, gerçek DOM keşfi sonucu)

PR #108 S2-S5 spec'leri locator timeout fail oldu (qa-engineer body okumadan inferred locator). Sprint 9b'de **gerçek TSX kaynak inceleme + tr.json metin eşleştirmesi** ile yeniden yazılır. Locator stratejisi (her senaryo için):

1. **Stable id** (öncelik): NewAreaDialog `#newArea-name`, SettingsPage `#timezone`
2. **Türkçe text via getByRole**: `getByRole('button', { name: 'Yeni bölge' })` — tr.json `admin.diningAreas.newAreaButton` → "Yeni bölge"
3. **getByText fallback**: span/div text content match
4. **CSS class avoid**: refactor brittle

Test başına locator inventory inline yorum (revisit etmesi kolay).

### Amendment 4 (2026-05-10) — S3 scope dar smoke (kategori CRUD)

**Bağlam**: ADR-019 §1 S3 "Menü editörü kategori + ürün + variant CRUD" geniş kapsam — full CRUD smoke 30+ adım (ProductEditorPage route + variants tab + reorder modal). Single test'te brittle.

**Karar**: Sprint 9b S3 smoke kapsamı **kategori CRUD only** (oluştur → düzenle → sil). Ürün CRUD + variant CRUD smoke **Sprint 10+ E2E backlog**'a (`docs/v5.1-backlog.md` veya yeni amendment ile). Kategori CRUD pattern doğru kurulduktan sonra ürün ekleme aynı pattern'i (CategoryDrawer/ProductEditorPage benzer) reuse edebilir.

**Reasoning**: ADR-019 §1 lock'unun amacı "scope creep önle" — daraltma scope creep'in tam tersi. Smoke essence kategori CRUD'da yakalanır (drawer + DropdownMenu Radix + DeleteDialog Radix). Ürün+variant Sprint 10+ tam E2E suite'te ele alınır.

**Locator notu (S3 spesifik)**: `seed.ts` 2 kategori yaratıyor (Yemek + İçecek); S3 testinde **3. kategori** oluşturulur. Card-bound 3-dot menü click MUTLAKA scope-aware (`clickButtonInScopeByAriaLabel`) — global click yanlış kart'ın 3-dot'una basar (S2 öğretisi tekrar). DropdownMenu menü item'ları Portal'da render — global text click OK (aynı anda tek dropdown açık).

**Phase 2 exit kriterine etki**: Sprint 9b 5/5 yeşil koşulu S3 daraltılmış kapsam ile karşılanır. Ürün/variant smoke ertelemesi v5.1 backlog'da değil **Sprint 10+ E2E backlog**'da (MVP'de manuel smoke + integration test seviyesinde kapsanıyor zaten).


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

---

## ADR-021 — Rapor CSV Export (Sprint 14)

- **Durum**: Accepted (2026-05-11, kullanıcı onayı Session 58 PR #129)
- **Tarih**: 2026-05-11

### Bağlam

ADR-015 (+ Amendment 1) ile 13 rapor endpoint'i tanımlı; charter Phase 3 madde 5 son maddesi "CSV export" eksik. İşletmeci dış muhasebe (e-mali müşavir) ve kişisel arşiv için Excel'de açabileceği export ister. Bu cross-cutting concern (PII/KVKK, retention, format versioning, audit izi) — ayrı ADR meşru.

v3'te (`D:\dev\restoran-pos-v3\server\routes\reports.js`) rudimentary CSV export yok; v5'te sıfırdan tasarlanır. Kapsam: **server-side CSV üretimi**, anlık download, server'da dosya saklama yok.

### Karar

#### Karar 1 — Endpoint pattern: query param `?format=csv`

**Mevcut endpoint'lere `?format=csv` query param eklenir** — ayrı `/export` route'u **YOK**. JSON default; CSV opt-in. Örnek: `GET /reports/category-sales?range=today&format=csv`.

**Gerekçe:**
- Tek route, tek RBAC, tek auth — duplicate yok.
- Frontend rapor ekranında "İndir" butonu aynı path'e farklı `Accept`/`format` ile request atar.
- Ek route → ek migration footprint, ek shared-types entry → bakım yükü.

**Karşı argüman:** `GET` query param ile content negotiation alışılmış değil (REST'te `Accept` header tercih). Ancak CSV `Accept: text/csv` browser'da fetch ile zor (download trigger için `<a href>` lazım, header set edilmez). Query param browser indirimi için pragmatik.

**Alternatif (reddedildi):** `GET /reports/<name>/export?format=csv` — gereksiz path nesting, RBAC duplikasyonu.

#### Karar 2 — Response format

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="<filename>"`
- **Encoding: UTF-8 + BOM** (`﻿` başta) — Excel TR Türkçe karakterleri (`ç`, `ğ`, `ı`, `ş`, `ü`, `ö`) BOM olmadan bozar.
- **Delimiter: `;` (noktalı virgül)** — Türkiye Excel default ayraçtır, tıkla-aç gerek (TR locale'de virgül = ondalık ayırıcı, çakışma yaratır). Uluslararası tooling için `?delimiter=,` opsiyonu eklenebilir (v5.1 backlog).
- **Line ending: `\r\n`** (CRLF) — Windows + Excel standardı.
- **Quoting:** RFC 4180 — alan içinde `;`, `"` veya CRLF varsa çift tırnağa al, içindeki `"`'yi `""` ile escape et.

#### Karar 3 — Filename şeması

`<report-name>-<tenant-slug>-<YYYY-MM-DD>-<HHmmss>.csv`

Örnek: `category-sales-myrestaurant-2026-05-11-143022.csv`

- `<tenant-slug>`: `tenants.slug` (URL-safe, lowercase, dash-separated). Multi-tenant geleceği için ayraç.
- `<YYYY-MM-DD>` ve `<HHmmss>`: server time (UTC değil — tenant TZ; raporu indiren kullanıcı için anlamlı).
- ASCII only — Türkçe karakter yok (browser/OS download path uyumu).

#### Karar 4 — PII maskeleme (KVKK)

**Mecburi maskeleme alanları:**
- **Telefon** (`recent-orders`, `closed-orders`, `daily-close` order detayında geçerse): `5XX***1234` (ilk 3 + son 4, ortası `***`).
- **Müşteri adı**: `Ahmet K***` (ilk isim tam + soyad ilk harfi + `***`).
- **Adres**: tam blok yerine **mahalle düzeyi** (`Kızılay Mah., Çankaya/Ankara`) — sokak/no maskelenir.

**Maskeleme YAPILMAZ:**
- `cashier_id`, `waiter_id` → personel adı (iç operasyon, KVKK çalışan rıza kapsamında).
- Sipariş id, tutar, ödeme tipi, kategori (PII değil).

**Implementasyon:** `packages/shared-domain/src/pii-mask.ts` saf fonksiyonlar — JSON response'unda da KVKK için kullanılabilecek temel; CSV'de **mecburi**, JSON'da **rol bazlı** (admin tam görür, cashier maskeli — bu ayrı ADR konusu, CSV'de tutar sıkı).

#### Karar 5 — Retention: server cache yok

ADR-015 Karar 6 (no-cache) ile uyumlu — CSV her request'te bellek üzerinde streaming üretilir, response gönderildikten sonra GC'ye bırakılır. Disk yazma yok, S3 yok, presigned URL yok. **Maksimum row limiti 100k** — daha fazlası rate-limit 400 (`REPORT_TOO_LARGE`); büyük export için `range` daraltılır.

Bellek baskısı: streaming CSV writer (`csv-stringify` Node.js stream) → row-by-row write, full result-set bellek tutulmaz.

#### Karar 6 — Audit log zorunlu

Her CSV download `audit_logs` tablosuna yazılır:
- `action='reports.export.csv'`
- `details JSONB`: `{reportName, range/from/to, rowCount, filename, ipAddress}`
- `actor_user_id`: indiren kullanıcı (JWT)

ADR-003 §12 audit_logs şeması mevcut (Sinyal #39); yeni migration **gerekmez**. KVKK denetimi için "kim ne export etti" izlenebilir olmalı — özellikle PII içeren rapor (recent-orders, daily-close customer details).

#### Karar 7 — Format versioning

CSV header satırı **versioned** — ilk satır `# format: v1` yorumu **YOK** (Excel parser'ı bozar). Bunun yerine:
- **Filename suffix**: schema değişirse yeni endpoint adı (örn. `category-sales-v2`) — breaking change ADR ile.
- **Header row** = stable column adları; eklemek **non-breaking** (eski tüketici fazla kolonu ignore), kaldırmak **breaking**.
- v1 header satırı her endpoint için Sprint 14 PR-4'te kilitlenir (`docs/api/csv-schemas.md`).

`?version=v1` query param **şimdi yok** — ihtiyaç olunca eklenir (YAGNI).

### Alternatifler (reddedildi)

1. **Ayrı `/export` route prefix**: `/reports/<name>/export?format=csv` — RBAC duplikasyonu, route şişmesi.
2. **Excel (.xlsx) native**: SheetJS dependency ağır (~1MB), TR muhasebe standardı CSV; xlsx v5.1 backlog.
3. **PDF rapor export**: müşteri PDF (mevcut adisyon) farklı domain — rapor PDF v5.1 backlog.
4. **Email/cron scheduled export**: SMTP gerek, queue gerek; manuel "İndir" MVP'ye yeter.
5. **Server-side cache (Redis snapshot)**: ADR-015 no-cache prensibi tutarlılığını bozar; tek tenant MVP'de gereksiz.

### Sonuçlar

- (+) Charter Phase 3 madde 5 son alt-madde kapanır (CSV export ✅).
- (+) Mevcut endpoint pattern bozulmadan tek kavşaktan content negotiation.
- (+) KVKK uyumlu (PII mask + audit log) — denetimde "kim indirdi" net.
- (+) Server disk/cache yok → operasyonel basitlik.
- (−) `;` delimiter TR-opinionated → uluslararası tüketici manuel ayar yapar (v5.1 `?delimiter=`).
- (−) PII mask iki yerde (CSV + JSON role-based) — kod tekrarını önlemek için `pii-mask.ts` shared-domain modülü zorunlu.
- (−) 100k row hard cap → büyük tarihçe export için "range böl" UX'i gerekir; UI'da uyarı mesajı.
- (−) Audit log her export'ta yazılır → audit_logs hacim artışı; retention cron (Sinyal #44, 2 yıl) hâlihazırda kapsar.

### Kapsam dışı (v5.1 backlog)

- Excel (.xlsx) export
- PDF rapor export (müşteri PDF dışında)
- Email/cron scheduled export
- `?delimiter=,` parametre desteği
- Format versioning `?version=vN`
- Server-side cache / pre-generated daily snapshot CSV

### Açık sorular (architect ↔ ilhan)

1. **Delimiter `;` mi `,` mi?** — Önerim `;` (TR Excel default), karşı görüş varsa `,` evrensel.
2. **PII mask: rol bazlı JSON da maskelensin mi?** — MVP'de CSV mecburi, JSON full (admin/cashier ayrımı v5.1). Şu an admin+cashier ikisi de tam görüyor.
3. **Row hard cap 100k mı, daha düşük mü?** — Tek tenant MVP'de yıllık ~50k sipariş tahmini; 100k güvenli rezerv.
4. **Filename TZ — server UTC mi, tenant TZ mi?** — Önerim tenant TZ (operatör için anlamlı saat).
5. **Audit log row limit aşımı 400 mü 413 mü?** — `REPORT_TOO_LARGE` 400 (client error: range daralt). 413 (Payload Too Large) request body için.

### Cross-ref

- ADR-003 §12 (audit_logs şema)
- ADR-006 §5 (error envelope — `REPORT_TOO_LARGE` yeni kod)
- ADR-015 + Amendment 1 (rapor endpoint'leri)
- charter Phase 3 madde 5 (rapor MVP listesi son alt-madde)
- KVKK çerçevesi (`docs/security/kvkk-checklist.md` — varsa, yoksa Sprint 14'te oluştur)
- Yeni dosya: `packages/shared-domain/src/pii-mask.ts`
- Yeni dosya: `apps/api/src/lib/csv-stream.ts`
- Yeni dosya: `docs/api/csv-schemas.md` (v1 column locks)

<!-- ADR-021 Draft (2026-05-11, Session 58 Sprint 14 prep). 7 karar: query param ?format=csv (route şişmeden), UTF-8 BOM + ; delimiter + CRLF + RFC 4180 quoting, filename pattern with tenant slug, PII mecburi mask (telefon/isim/adres), no server cache + 100k row cap, audit_logs zorunlu, format versioning filename-based (header non-breaking add). 5 alternatif reddedildi (Excel/PDF/email/cache/separate route). 5 açık soru architect/ilhan onayı bekliyor. -->

---

## ADR-022 — Print Agent v5.1+ Backlog Roadmap

**Durum:** Accepted (2026-05-14, Session 69)
**Bağlı ADR'lar:** ADR-004 (Print Agent mimari)

### Bağlam

Print Agent Phase 3 MVP closure 2026-05-14 itibarıyla tamamlandı (Session 67/68). Lokal MSI build + install/uninstall E2E ✅, CI MSI artifact 18.3MB ✅, production-deployable durumda. Tool stack: `@yao-pkg/pkg` (vercel/pkg fork, Node 22 desteği) + WiX v4 + nssm.exe vendor in repo. 9 sub-PR'nin 8'i tamam (PR-5b USB lokal donanım eşliğine ertelendi).

Phase 3 MVP "ilk restorana kurulup çalışır" hedefini karşılar; ancak production operasyonu (debugging, supply chain güvenliği, kullanıcı güveni, uzun vadeli sürdürülebilirlik) için iyileştirmeler gerekir. Bu ADR **v5 MVP'ye iş eklemez** — yalnız Phase 3 sonrası **v5.1+ Print Agent backlog** maddelerini sıralı yol haritasına çevirir. ADR-004 §5 footer comment'inde geçen "v5.1 backlog" satırının detay genişlemesidir; ADR-004 metni değişmez, yalnız bu ADR ile re-direct edilir.

Kapsam kilidi (CLAUDE.md core directive 6): Her madde v5.1+ etiketli. Yeni feature talep edilirse `scope-guard` skill çağrılır.

### Karar — 6 v5.1+ Backlog Maddesi

Aşağıdaki 6 madde önerilen önceliklendirme sırasıyla listelenir. Her madde v5.1 sprint planlamasında ayrı ADR amendment veya yeni ADR ile detaylandırılır (M1-M6 implementasyon kararları sprint açıldığında yazılır).

---

#### v5.1+ M1: Windows Event Log integration

**Tetikleyici / Neden:**
- Phase 3'te servis log'ları nssm stdout/stderr → text file'a yazılıyor (`%PROGRAMDATA%\PrintAgent\logs\`).
- Admin / IT operatör Windows Event Viewer'dan göremiyor → production debugging zayıf.
- Restoran sahibi/IT teknisyeni "servis neden durdu" sorusuna Windows native arayüzden cevap bulamıyor.

**Scope (kısa):**
- Service start/stop event yazımı (Information).
- Print job result event (Success/Warning/Error level, jobId + printer adı).
- Auth fail event (Warning, IP + agent name).
- Custom event source registration installer'da (`Application` log altında `RestoranPOS-PrintAgent`).
- Severity mapping ile Event Viewer filtreleme uyumu.

**Teknik seçim:**
- Önerilen: `node-windows` paketi (EventLogger API mevcut, MIT lisans, aktif bakım).
- Alternatif: Direct Win32 API binding (`node-ffi-napi`) — ek native bağımlılık, ağır.

**Bağımlılık:** Yok — bağımsız implementasyon.

**Effort tahmini:** ~2 gün dev.

**Sıralama priority:** 3

**Out-of-scope:**
- Centralized log aggregation (ELK / Loki / Sentry) — v6.0+.
- Real-time Event Viewer push (WMI subscription) — manual refresh yeterli.

---

#### v5.1+ M2: Structured logging + rotation

**Tetikleyici / Neden:**
- Phase 3'te nssm stdout/stderr → unbounded text file (boyut yönetimi yok, eski log silinmiyor).
- Disk dolma riski (uzun süreli servis çalışmasında ~MB/gün birikim).
- Structured (JSON) log yok → grep/analytics zor.

**Scope (kısa):**
- JSON structured log (timestamp, level, jobId, durationMs, printer, message).
- File rotation: max 7 gün retention, max 50MB per file.
- Log level config (`config.json` → `logLevel: 'info' | 'warn' | 'error' | 'debug'`).
- Console + file dual transport (development debug için).
- nssm AppStdout/AppStderr redirect'i kaldırılır (logger kendi yazar).

**Teknik seçim:**
- Önerilen: `pino` + `pino-roll` (lightweight, ESM-friendly, JSON-first, Node 22 uyumlu).
- Alternatif: `winston` + `winston-daily-rotate-file` — daha ağır, kurulum daha karmaşık.

**Bağımlılık:** Yok — M1 ile paralel çalışılabilir.

**Effort tahmini:** ~1 gün dev.

**Sıralama priority:** 2

**Out-of-scope:**
- Remote log shipping (Loki/Sentry) — v6.0+.
- Log encryption-at-rest — KVKK risk değerlendirmesi yoksa gereksiz.

---

#### v5.1+ M3: Icon (.ico) embedding

**Tetikleyici / Neden:**
- Phase 3'te MSI installer Add/Remove Programs listesinde WiX default generic icon görünüyor.
- Profesyonel görünüm yok — kullanıcı güveni ve marka tutarlılığı zayıf.
- Service Control Manager'da da generic icon (görsel ayırt edilemezlik).

**Scope (kısa):**
- 256×256 .ico tasarımı (multi-resolution embed: 16/32/48/256).
- WiX `<Icon Id="ProductIcon.ico" SourceFile="..\branding\print-agent.ico"/>` direktifi.
- `<Property Id="ARPPRODUCTICON" Value="ProductIcon.ico"/>` (Add/Remove Programs).
- pkg `assets` üzerinden .exe içine icon embed (rcedit veya pkg native).

**Teknik seçim:**
- Önerilen: WiX `<Icon>` + pkg `--icon` flag (yao-pkg destekler).
- Alternatif: Post-build `rcedit` — ekstra build adımı.

**Bağımlılık:** Yok.

**Effort tahmini:** ~0.5 gün dev (icon tasarım süresi hariç; tasarım dışsal).

**Sıralama priority:** 1 (en kolay görünür kazanım)

**Out-of-scope:**
- Animasyonlu splash screen — gereksiz.
- Tema değişikliği (dark/light) — out of scope.

---

#### v5.1+ M4: Code signing (Authenticode)

**Tetikleyici / Neden:**
- Phase 3'te MSI imzasız → Windows SmartScreen "Unknown Publisher" uyarısı.
- Kullanıcı (restoran sahibi) "bilinmeyen yayıncı" uyarısını görüp kuruluma çekiniyor.
- KVKK + production deploy için imzalı binary best practice (supply chain integrity).
- Antivirus false-positive riski azalır.

**Scope (kısa):**
- EV (Extended Validation) code signing sertifikası satın alma (Sectigo / DigiCert).
- `signtool.exe` ile `.exe` + `.msi` imzalama.
- GitHub Actions secret olarak cert PFX + password.
- CI workflow'da release artifact'lar otomatik imzalanır.
- Timestamp server kullanımı (`/tr http://timestamp.sectigo.com`) — cert expire sonrası geçerlilik korunur.

**Teknik seçim:**
- Önerilen: EV cert (~$200-400/yıl, immediate trust). Standard OV cert (~$80/yıl) reputation kazanana kadar SmartScreen tetikler.
- Alternatif: Self-signed — production'da geçersiz, sadece internal test için.

**Bağımlılık:** Sertifika satın alma süreci (1-2 hafta provisioning); ödeme + dış doğrulama.

**Effort tahmini:** ~1 gün dev (workflow integration) + 1-2 hafta cert provisioning (paralel).

**Sıralama priority:** 5 (cert provisioning paralel başlatılır, workflow hazır olduğunda integrate)

**Out-of-scope:**
- Kernel-mode driver signing — Print Agent user-mode.
- HSM (Hardware Security Module) integration — overkill, GitHub secret yeterli.

---

#### v5.1+ M5: MSI deterministic / reproducible build

**Tetikleyici / Neden:**
- Session 68'de tespit: Aynı kaynak farklı MSI hash üretiyor (CI artifact ≠ lokal artifact hash).
- Supply chain audit zayıf — "kullanıcının indirdiği MSI = release notes'ta belirtilen hash" kontrolü yapılamıyor.
- Forensic incident response'da binary integrity doğrulanamaz.

**Scope (kısa):**
- File timestamp normalize (PowerShell `SetFileTime` post-build, fixed epoch).
- WiX `--reproducible` flag (WiX v4 native destek yok şu an — upstream takip).
- Build environment variable cleanup (`SOURCE_DATE_EPOCH` honor).
- SHA-256 hash release notes'a otomatik ekleme (GH Actions step).
- Reproducible build verification step (CI'da 2 kez build → hash compare).

**Teknik seçim:**
- Önerilen Phase 1: PowerShell post-process `SetFileTime` (pragmatik, WiX v4 limit içinde).
- Önerilen Phase 2: WiX upstream `--reproducible` flag eklenirse migrate (issue tracking).
- Alternatif: `msitools` Linux'ta — Windows-only build CI ile uyumsuz.

**Bağımlılık:** M4 önerilir — signed reproducible build supply chain için ideal kombinasyon (imzasız reproducible build limited value).

**Effort tahmini:** ~1 gün dev.

**Sıralama priority:** 4

**Out-of-scope:**
- SBOM (Software Bill of Materials) üretimi — v6.0+.
- Sigstore / cosign — Windows ecosystem zayıf adoption.

---

#### v5.1+ M6: `@yao-pkg/pkg` → Node 22 SEA migration

**Tetikleyici / Neden:**
- `@yao-pkg/pkg` upstream vercel/pkg fork; vercel/pkg deprecated (2023 sonu).
- Tek maintainer dependency riski — uzun vadeli sürdürülebilirlik kırılgan.
- Node 22 native Single Executable Applications (SEA) experimental → stable yolda.
- Native Node feature kullanmak external pkg deprecation riskini ortadan kaldırır.

**Scope (kısa):**
- `sea-config.json` (main, output, disableExperimentalSEAWarning).
- `node --experimental-sea-config sea-config.json` → blob üretimi.
- `postject` ile blob'u node binary'sine inject.
- CI workflow `pkg` step'i `node --experimental-sea-config` + `postject` ile değiştirilir.
- Icon embed (`rcedit`) ayrı adım — pkg `--icon` SEA'da yok.
- Smoke test: SEA-built .exe MSI içinde, install + service start + print job E2E.

**Teknik seçim:**
- Önerilen: Node 22 SEA + `postject` (Node native, sıfır external pkg).
- Alternatif: Bun executable / Deno compile — runtime değişikliği, regression riski yüksek.

**Bağımlılık:** M2 sonrası — logging değişiklikleri SEA bundle'da serialization sorunsuz çalışmalı (smoke test gerek).

**Effort tahmini:** ~3 gün dev (SEA POC + smoke + CI update + edge case'ler).

**Sıralama priority:** 6 (uzun vadeli, deprecated tool kurtulma, kritiklik düşük şu an)

**Out-of-scope:**
- Cross-platform SEA (macOS/Linux) — Windows-only sabit.
- Bytecode obfuscation / source protection — open architecture, gereksiz.

---

### Önerilen sıra (özet)

1. **M3** — Icon (.ico) — ucuz, görünür kazanım, bağımlılık yok (0.5 gün)
2. **M2** — Logging rotation — production debugging için kritik (1 gün)
3. **M1** — Event Log integration — admin UI hazırsa görünür (2 gün)
4. **M5** — Reproducible build — supply chain sertleştirme (1 gün)
5. **M4** — Code signing — cert provisioning paralel (1-2 hafta) → workflow integrate (1 gün)
6. **M6** — SEA migration — uzun vadeli sürdürülebilirlik (3 gün)

**Toplam dev effort: ~8.5 gün** + cert provisioning paralel (1-2 hafta).

**Bağımlılık zinciri:** M3 → M2 → M1 → M5 (paralel M4 cert) → M6

### Out-of-scope (v5.1+'nın da dışı, v6.0+ veya hiç)

- **Auto-update channel** (Squirrel.Windows / MSI patch / TUF) — Phase 1 manuel re-install yeterli (1 tenant pilot charter); v6.0+ multi-tenant ölçekte değerlendirilir.
- **Multi-Agent** (birden fazla Print Agent paralel) — pilot dışı; tek restoran tek Agent yeterli (charter "başta 1 tenant" kapsam kilidi).
- **macOS / Linux Print Agent** — Windows-only sabit (ADR-004 §1).
- **Adaptive polling** (HTTP long-poll → WebSocket migration) — Phase 3 fixed 2s polling yeterli; uzun süreli stabilizasyon (6 ay+) sonrası karar.
- **Yazıcı driver auto-discovery / plug-and-play** — Phase 3 config.json manuel yeterli; v6.0+ UX iyileştirme.
- **Web-based admin UI** (Print Agent için lokal :8443 panel) — out of scope; Cloud panel + audit log yeterli.

### Alternatifler (genel, reddedildi)

1. **Tüm 6 maddeyi v5.1 tek sprint'te bitir** — effort ~8.5 gün dev + cert tamamı tek sprint'te aşırı; iterative delivery tercih edilir (M3-M2-M1 hızlı kazanım, M4-M5-M6 olgunlaşma).
2. **Hiçbirini yapma, Phase 3 yeterli** — production deploy + uzun vadeli operasyon için reddedildi (debugging zayıflığı + SmartScreen güven sorunu + pkg deprecation riski).
3. **Üçüncü parti printing servisi (PrintNode/Pharos)** kullan, Print Agent kaldır — ADR-004 mimari kararı bozar; lokal kontrol + KVKK + offline operasyon kaybedilir.

### Sonuçlar

- (+) Print Agent Phase 3 sonrası v5.1+ yol haritası net — ad-hoc öncelik tartışması engellenir.
- (+) Her madde bağımsız teslimat (M3-M2-M1 paralel/sıralı, M4 cert paralel) → küçük PR'lar, az risk.
- (+) Out-of-scope açıkça listeli → kapsam büyümesi şikâyetleri engellenir (auto-update / multi-Agent / macOS).
- (+) ADR-004 metni dokunulmadan (§5 footer "v5.1 backlog" satırı bu ADR'a re-direct).
- (−) Cert provisioning (M4) dış bağımlılık — 1-2 hafta blocker olabilir; erken başlat.
- (−) M6 SEA experimental Node feature → Node 22 LTS release notes takip gerekir; stable'a geçerse migration kararı tekrar değerlendirilir.
- (−) Toplam ~8.5 gün dev + cert süreç — tek sprint'e sığmaz; v5.1 boyunca yayılır (charter v5.1 sprint planında konumlandır).

### Kapsam kilidi onayı

**Bu ADR v5 MVP'ye iş EKLEMEZ.** 6 maddenin tamamı v5.1+ etiketli. ADR-004 Phase 3 closure mührü değişmez. Phase 3 production-deployable durumu korunur; bu maddeler iyileştirmedir, blocker değildir.

### Cross-ref

- **ADR-004 §5 footer "v5.1 backlog" satırı** — bu ADR detaylandırır (ADR-004 metni dokunulmaz).
- **ADR-004 Phase 3 PR-6 amendment** — MSI installer closure (Session 67/68).
- **charter Phase 4** — v5 sonrası faz; Print Agent v5.1+ ≠ charter Phase 4 (terminoloji ayrımı).
- **MEMORY: `feedback_vendor_in_repo_binary`** — M5 reproducible build için vendor binary stratejisi (nssm.exe paterni).
- **MEMORY: `feedback_pkg_yao_migration`** — M6 SEA migration için pkg → @yao-pkg geçiş öğretisi.
- **MEMORY: `feedback_ci_workflow_audit_first`** — M4 code signing workflow audit-first pattern.

### Açık sorular (architect ↔ ilhan, v5.1 sprint açılışında)

1. **M4 cert satın alımı bütçe onayı:** EV (~$300/yıl) vs standard OV (~$80/yıl, ilk 6-12 ay SmartScreen warning) — operasyon kararı.
2. **M6 SEA migration timing:** Node 22 SEA stable olduğunda mı (Node 24+?) yoksa experimental ile şimdi mi? Önerim: Node LTS'de stable olunca.
3. **M3 icon tasarım:** İç tasarım kaynağı var mı (logo varsa türev) yoksa dış tasarımcıya çıkar mı?
4. **Önceliklendirme override:** M4 (code signing) iş güvenliği açısından M1-M3'ten önce gelmeli mi? Cert provisioning paralel mantığı korunursa hayır.

<!-- ADR-022 Accepted (Session 69, 2026-05-14) — architect sub-agent; Print Agent v5.1+ Backlog Roadmap; 6 madde (M1-M6) sıralı priority + effort + dependency; kapsam kilidi v5 MVP'ye iş eklenmez yalnız v5.1+ haritalama; out-of-scope v6.0+: auto-update / multi-Agent / macOS-Linux / adaptive polling -->

---

## ADR-023 — Otomatik DB Yedek (Automated PostgreSQL Backup)

- **Durum**: Accepted
- **Tarih**: 2026-06-27 (Session 70)
- **Bağlı ADR'lar**: ADR-002 §13 (cron pattern + advisory lock), ADR-003 (DB şema ilkeleri), ADR-016 (Caller ID / customer PII — KVKK)

### Bağlam

charter §Phase 4'te "Otomatik DB yedek (Hetzner Storage Box veya S3-compatible cron)" kapsam içi ama **ADR yok, kod yok**. Repo'da `backup` / `restore` / `pg_dump` araması SIFIR sonuç; `docs/ops/backup-strategy.md` yok. v3'te otomatik yedek **hiç yoktu** (`docs/v3-reference/modules.md` negatif sinyal) — sipariş/ödeme verisi kaybına karşı tek koruma manuel/şanstı.

Mimari öncelik hiyerarşisi (architect rol): **veri bütünlüğü #2** — "sipariş/ödeme verisi kaybı asla olmamalı". Tek-sunucu pilot kurulumda (Hetzner CX22→CX32; `hetzner-deployment` skill DR planına göre API + PostgreSQL **aynı box** üzerinde, off-site sync ile coğrafi yedek) disk arızası / fat-finger `DROP` / başarısız migration = veri kaybı. Bu kabul edilemez. RPO hedefi: son günlük dump (≤24 saat veri kaybı) — pilot için kabul, WAL/PITR (RPO ~dakika) v5.1+'a ertelenir.

`hetzner-deployment` skill (SKILL.md §Backup stratejisi, ~satır 320-394) zaten pilot-kabul seviyesinde recipe öneriyor: günlük `pg_dump | gzip` → lokal `/backups`, haftalık `rclone sync` → off-site (Storage Box / S3 / B2), retention (günlük 14 / haftalık 8 / aylık 12), DR runbook (RTO ~30-45dk, RPO son daily dump). Bu ADR o recipe'yi **karara bağlar** ve v5 ölçeğine (over-engineering yok) sadeleştirir.

Kapsam kilidi (CLAUDE.md core directive 6): WAL/PITR, restore UI, pgBackRest, çoklu off-site hedef = **v5.1+**. Bu ADR yalnız "günlük logical dump + off-site + şifreli + manuel restore runbook" kapsar.

### Karar

Backup, **mimarın #1/#2 önceliği (güvenlik + veri bütünlüğü)** doğrultusunda, **uygulamadan (API process) tamamen bağımsız OS-level cron + shell script** olarak koşar. 6 soruya net karar:

#### Soru 1 — Nerede koşar: **OS-level cron + shell script (B), API-içi node-cron DEĞİL**

Backup'ın temel değeri **API/uygulama down iken bile çalışmasıdır**. Veri bütünlüğü önceliği (#2), "yedek alma mekanizması, yedeklediği sistemden bağımsız olmalı" ilkesini dayatır:

- API process crash / OOM / deploy sırasında durmuş olsa bile gece 03:00 yedeği alınmalı.
- pg_dump zaten bir shell tool — node process'ten `child_process.exec` ile shell-out etmek hiçbir izolasyon kazanmaz, aksine API'nin sağlığına bağımlılık ekler.
- ttl-cleanup paterni (advisory lock + tenant-loop) **mantıksal DELETE** içindir; backup **fiziksel dump** — farklı sorumluluk, app domain'ine ait değil, ops domain'ine ait.

**Seçim:** `apps/api/scripts/backup/pg-backup.sh` (in-repo, versiyonlu, code-review edilebilir shell script) + sunucuda systemd timer (öncelikli) veya cron (skill recipe fallback) ile schedule. Script repo'da yaşar (testability + audit), schedule **deployment artifact** (Ansible/systemd unit) olarak `docs/ops/backup-strategy.md`'de tanımlı. node-cron registry'ye **yeni lock id eklenmez** (`CRON_LOCK_IDS` dokunulmaz) — bu app cron değil.

> **Not (testability ödünü):** OS-level script repo unit-test edilemez (gerçek pg_dump + Storage Box CI'da yok). Bunu kabul ediyoruz — backup bir ops mekanizması; doğrulama MSI smoke paterniyle aynı: **lokal/sunucu manuel smoke + restore drill** (DoD aşağıda). In-repo script + shellcheck lint + `--help`/`--dry-run` self-doğrulama, testability'nin makul kısmını kurtarır.

#### Soru 2 — Yedek aracı: **`pg_dump` (logical, custom format `-Fc`)**

- `pg_dump -Fc` (custom/compressed format) — tek DB, `pg_restore` ile seçici/paralel restore, gzip'e gerek yok (format kendi sıkıştırır; veya `-Fc -Z 6`).
- Logical dump tek-DB pilot için yeterli; şema + veri tek dosya, restore basit ve deterministik.
- **WAL archiving / PITR / pgBackRest = v5.1+** (skill "v1'de WAL yok, pilot için kabul"). RPO ≤24 saat pilot kabul.
- `pg_dumpall --globals-only` ile roller/grant ayrı küçük dump (restore'da auth bütünlüğü) — opsiyonel, runbook'ta belirtilir.

#### Soru 3 — Storage hedefi + retention: **Hetzner Storage Box (SFTP/rclone), KVKK Almanya**

- Off-site hedef **Hetzner Storage Box** (Almanya datacenter, KVKK uyumlu, 1TB 3.81€/ay). S3-compatible üzerine tercih nedeni: aynı sağlayıcı/bölge, ek hesap yok, KVKK veri-ikamet (Almanya) garantili, `rclone` SFTP backend olgun.
- **İki katman:**
  1. **Lokal** `/var/backups/postgres/` — günlük dump (hızlı restore, son 7 gün).
  2. **Off-site** `rclone sync` → Storage Box (3-2-1 kuralı: farklı medya + off-site).
- **Retention** (skill'den sadeleştirildi, pilot ölçek): **günlük 14 gün, haftalık 8 hafta, aylık 6 ay**. (Skill'in "aylık 12 ay"ı tek-restoran pilotu için fazla — 6 ay yeterli; v5.1'de revize edilebilir.) Retention enforcement script içinde (`find -mtime +N -delete` lokal + `rclone delete --min-age` off-site).

#### Soru 4 — Şifreleme + KVKK: **at-rest `age` ile şifreli + transfer SFTP/TLS**

Dump müşteri PII içerir (`customers`, `call_logs` — ADR-016 caller-id). KVKK §12 (veri güvenliği) gereği:

- **At-rest:** dump dosyası **`age`** (modern, basit, tek public-key recipient) ile şifrelenir: `pg_dump -Fc | age -r <recipient-pubkey> > dump.age`. Özel anahtar **sunucuda değil** — operatörün ayrı kasası (1Password vault, skill §Environment config paterni). Sunucu compromise olsa bile off-site/lokal dump okunamaz.
  - `age` tercihi (gpg değil): tek-dosya binary, anahtar yönetimi basit, KVKK için yeterli; gpg keyring karmaşıklığı pilot için over-engineering.
- **Transfer:** `rclone` SFTP (Storage Box) zaten SSH/TLS şifreli kanal — transfer-in-flight güvenli.
- **Anahtar kaybı riski:** runbook'ta açık uyarı — `age` private key kaybolursa tüm yedekler kurtarılamaz; key backup prosedürü (1Password + offline kopya) zorunlu.

#### Soru 5 — Restore: **manuel runbook (MVP), restore UI v5.1+**

- `docs/ops/backup-strategy.md` içinde adım-adım **restore runbook**: (1) off-site'tan dump çek (`rclone copy`), (2) `age -d -i key.txt` ile çöz, (3) `pg_restore --clean --if-exists -d <db>` (veya yeni DB'ye), (4) doğrulama sorguları (satır sayıları, son sipariş tarihi), (5) API restart.
- **Restore doğrulama (drill):** **ayda bir** manuel restore drill — son dump'ı throwaway DB'ye restore + smoke. Drill sonucu `docs/ops/backup-strategy.md`'de tarih log'u (basit tablo). "Test edilmemiş backup = backup değil" ilkesi.
- Restore UI / one-click restore = **v5.1+** (charter "restore şimdilik manuel (SQL dump)" satırıyla uyumlu).

#### Soru 6 — Test/CI sınırı + DoD

Gerçek `pg_dump` + Storage Box CI'da yok. Net DoD:

- **CI/otomatik test edilebilir:** (a) script `shellcheck` lint geçer (workflow'a eklenir veya pre-commit); (b) `pg-backup.sh --dry-run` (gerçek dump/upload yapmaz, komut planını yazar) exit 0; (c) `--help` çıktısı var; (d) script `set -euo pipefail` + error trap içerir (statik kontrol).
- **Manuel doğrulama (sunucu, MSI smoke paterni — kullanıcı yapar):** (1) script'i sunucuda elle çalıştır → lokal `.age` dosya oluşur; (2) `rclone sync` → Storage Box'ta dosya görünür; (3) **restore drill** throwaway DB'ye → satır sayıları eşleşir; (4) retention: 15 günden eski dosya silinmiş; (5) systemd timer/cron `systemctl list-timers` / `crontab -l` ile aktif.
- **DoD kapanışı:** ADR + `docs/ops/backup-strategy.md` runbook + `pg-backup.sh` (shellcheck-clean) + sunucu smoke + ilk restore drill log'u tamam olduğunda Phase 4 backup ✅.

### Alternatifler

- **A — API-içi node-cron task (ttl-cleanup paterni), pg_dump shell-out**:
  - Artıları: in-repo, lock registry mevcut, integration test edilebilir (mock), tek yer.
  - Eksileri: backup API process sağlığına bağımlı (crash/deploy → yedek atlanır); pg_dump zaten shell tool, node sarmalamak izolasyon kazandırmaz; ops sorumluluğu app domain'ine sızar.
  - **Neden reddedildi:** Backup, yedeklediği sistemden bağımsız olmalı (veri bütünlüğü #2). API down iken yedek almak şart.
- **C — Hetzner Cloud otomatik snapshot (volume-level) tek başına**:
  - Artıları: sıfır kod, Hetzner panel'den aç, tüm disk.
  - Eksileri: snapshot tüm-VM granülaritesi (tek-tablo/tek-tenant restore yok); crash-consistent değil (Postgres çalışırken disk image tutarsız olabilir); off-site/şifreleme kontrolü yok; ek maliyet.
  - **Neden reddedildi:** logical dump'ın seçici restore + tutarlılık garantisini vermiyor. (Snapshot **tamamlayıcı** olarak DR planında kalır — skill §DR "snapshot'tan yeni server" — ama backup'ın yerini almaz.)
- **D — S3-compatible (AWS S3 / Cloudflare R2 / Backblaze B2)**:
  - Artıları: olgun ekosistem, versiyonlama, lifecycle policy.
  - Eksileri: KVKK veri-ikamet → AWS region/R2 lokasyon dikkat gerektirir; ek hesap/fatura; tek-restoran pilot için fazla.
  - **Neden reddedildi (şimdilik):** Hetzner Storage Box aynı sağlayıcı + garantili Almanya + ucuz. `rclone` backend swap'i ileride trivial (S3'e geçiş v5.1'de tek config satırı).
- **E — gpg şifreleme (age yerine)**:
  - Eksileri: keyring/trust modeli pilot için ağır.
  - **Neden reddedildi:** `age` tek-recipient public-key, daha basit, KVKK için yeterli.

### Sonuçlar

- (+) Veri bütünlüğü (#2 öncelik) korunur — günlük off-site şifreli yedek, RPO ≤24 saat. v3'teki "yedek yok" riski kapanır.
- (+) Backup API'den bağımsız (OS-level) — uygulama down iken bile çalışır.
- (+) KVKK uyumlu: Almanya veri-ikamet (Storage Box) + at-rest `age` şifreleme + SFTP transit şifreleme; PII içeren dump compromise'de bile okunamaz.
- (+) In-repo script (versiyonlu, shellcheck-lint, code-review) — "ops as code" makul seviyede testability.
- (+) Restore runbook + aylık drill → "test edilmemiş backup" tuzağı engellenir.
- (+) Over-engineering yok: pilot ölçek (tek-tenant, tek-sunucu), skill recipe sadeleştirildi.
- (−) RPO ≤24 saat — gün içi veri kaybı mümkün (son dump ile crash arası). Kabul: pilot; WAL/PITR v5.1+.
- (−) Script CI unit-test edilemez (gerçek pg_dump/Storage Box yok) — doğrulama manuel smoke + drill'e bağımlı (MSI smoke paterni).
- (−) `age` private key kaybı = tüm yedekler kurtarılamaz — key backup prosedürü operatör disiplinine bağımlı (runbook'ta kritik uyarı).
- (−) Schedule deployment artifact'ta (systemd/cron) — repo'da değil; deploy doc'u ile senkron tutulmalı.

### Kapsam kilidi (v5.1+ ertelenenler)

- **WAL archiving + PITR** (RPO ~dakika) — pgBackRest veya `archive_command` + base backup.
- **Restore UI / one-click restore** — panel'den.
- **Snapshot otomasyonu** (Hetzner API ile programatik snapshot) — manuel panel yeterli.
- **Çoklu off-site hedef** (Storage Box + S3 redundancy).
- **Backup başarı/başarısızlık alerting** (Telegram/Slack webhook) — v5.1 (pilotta manuel `systemctl status` + drill yeterli; basit fail→exit-code log MVP'de var).
- **Multi-tenant per-tenant dump** — pilot tek-tenant; `pg_dump` tüm-DB yeterli.

### İmplementasyon brief (parent main context implement edecek)

**Dosya whitelist (cerrahi — yalnız bunlar):**

1. **`apps/api/scripts/backup/pg-backup.sh`** (YENİ) — bash, `set -euo pipefail`, error trap.
   - Env/arg: `PGDATABASE`, `PGUSER`, `PGHOST`, `BACKUP_DIR` (default `/var/backups/postgres`), `AGE_RECIPIENT` (public key), `RCLONE_REMOTE` (default `storagebox:restoran-pos-backups`), `RETENTION_DAILY_DAYS` (default 14).
   - Akış: (a) timestamp `$(date +%Y%m%d-%H%M%S)`; (b) `pg_dump -Fc "$PGDATABASE"` → pipe `age -r "$AGE_RECIPIENT"` → `"$BACKUP_DIR/${PGDATABASE}-${ts}.dump.age"`; (c) exit-code kontrol (pg_dump fail → log + exit 1); (d) `rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE"`; (e) lokal retention `find "$BACKUP_DIR" -name '*.dump.age' -mtime +"$RETENTION_DAILY_DAYS" -delete`; (f) `--dry-run` ve `--help` flag desteği; (g) her adım stderr'e tek-satır structured log (`echo "[pg-backup] ..."`).
   - **KISIT:** kullanıcıya görünen string yok (ops script, i18n muaf); no-any (bash); `pg_dumpall --globals-only` opsiyonel ikinci dump (runbook'ta belirt).
2. **`docs/ops/backup-strategy.md`** (YENİ) — bölümler: (1) Genel bakış + RPO/RTO; (2) Mimari (OS-cron bağımsızlık gerekçesi, ADR-023 ref); (3) Schedule kurulumu — **systemd timer unit** örneği (`pg-backup.timer` + `.service`, `OnCalendar=*-*-* 03:00:00`, `Persist=true`) + cron fallback (skill recipe); (4) Storage Box `rclone config` adımları (SFTP backend); (5) `age` anahtar üretimi + **key backup zorunluluğu (kritik uyarı)**; (6) Retention politikası (14/8/6); (7) **Restore runbook** (5 adım, doğrulama sorguları); (8) **Restore drill** prosedürü + aylık log tablosu; (9) DoD checklist + smoke adımları.
3. **(opsiyonel) `.github/workflows/` shellcheck step** — VARSA mevcut lint workflow'una `shellcheck apps/api/scripts/backup/*.sh` ekle; yeni workflow yazma (audit-first, `feedback_ci_workflow_audit_first` paterni). Eğer mevcut shellcheck akışı yoksa bu maddeyi atla (over-engineering).

**DOKUNULMAYACAKLAR (negatif whitelist):**
- `packages/shared-domain/src/cron/lock-ids.ts` — **değişmez** (bu app cron değil, lock id eklenmez).
- `apps/api/src/cron/ttl-cleanup.ts`, `apps/api/src/index.ts` — **değişmez** (node-cron'a backup eklenmez).
- Migration — **yok** (backup şema değiştirmez; `Asla: migration'sız şema değişikliği` kuralı tetiklenmez çünkü şema değişmiyor).

**Test edilebilir kısım (DoD otomatik):** `shellcheck` clean + `pg-backup.sh --dry-run` exit 0 + `--help` çıktı + `set -euo pipefail` mevcut.

**Manuel-doğrulama kısmı (kullanıcı/sunucu, MSI smoke paterni):** sunucuda elle çalıştır → `.age` dosya + Storage Box'ta görünür + restore drill throwaway DB + retention silme + `systemctl list-timers` aktif.

### Referanslar

- **ADR-002 §13** — cron pattern + advisory lock (referans alındı, ama backup OS-level olduğu için lock registry kullanılmadı).
- **ADR-016** — Caller ID / customer PII (KVKK şifreleme gerekçesi).
- **`hetzner-deployment` skill §Backup stratejisi** (SKILL.md ~320-394) — recipe kaynağı (pg_dump|gzip + rclone + retention + DR runbook), bu ADR'da kararlaştırıldı + sadeleştirildi.
- **charter §Phase 4** ("Otomatik DB yedek — Hetzner Storage Box veya S3-compatible cron") + §MVP kapsam ("restore şimdilik manuel SQL dump").
- **`docs/v3-reference/modules.md`** — v3'te yedek yoktu (negatif sinyal).
- **MEMORY `feedback_local_msi_smoke_faster` / `feedback_ci_workflow_audit_first`** — manuel smoke + audit-first workflow paterni.

### Açık sorular (architect ↔ ilhan, implement öncesi)

1. **API + Postgres aynı box mu?** Skill DR planı aynı box varsayıyor. Eğer ayrılırsa (managed PG / ayrı DB sunucu) backup host'u değişir — runbook'ta her iki senaryo not edilir. (Doğrulanmamış: skill varsayımı, sunucu kurulumu henüz canlı değil.)
2. **`age` vs gpg operatör tercihi** — `age` öneriliyor; ilhan gpg'ye aşinaysa override mümkün.
3. **Storage Box hesabı mevcut mu** yoksa kurulumda mı açılacak — rclone config bu hesaba bağlı.

<!-- ADR-023 Accepted (Session 70, 2026-06-27) — architect sub-agent; Otomatik DB Yedek; OS-level cron+shell (API'den bağımsız) + pg_dump -Fc + Storage Box rclone SFTP + age at-rest şifreli + manuel restore runbook + aylık drill; lock-ids/ttl-cleanup/index.ts DOKUNULMAZ, migration YOK; kapsam kilidi WAL/PITR + restore UI + alerting = v5.1+; dosya whitelist: apps/api/scripts/backup/pg-backup.sh + docs/ops/backup-strategy.md -->

### ADR-023 Amendment 1 — off-site `rclone copy` (sync değil) + PGHOST socket/peer (2026-07-06, S84 — P5-3)

DR adversarial review (S84) iki showstopper + ADR'nin kendi içinde bir çelişkisini ortaya çıkardı. Yalnız kod-gerçeğine hizalama + iç-çelişki çözümü (yeni ADR değil, whitelist içi: pg-backup.sh + backup-strategy.md).

**1. Off-site retention çelişkisi (BLOCKER — düzeltildi):** ADR-023 gövdesi hem `rclone sync` (Soru 3 impl-brief) hem `rclone delete --min-age` (Soru 3 retention) diyor — UYUMSUZ. `pg-backup.sh` `sync` uygulamıştı: sync off-site'ı local'in **aynası** yapar → local retention 14 gün olduğundan off-site de max ~14 gün tutar; "haftalık-8/aylık-6" FİZİKSEL OLARAK İMKANSIZ ve her gece 14 günden eski off-site kopyaları SİLER (DR veri-kaybı tuzağı: gün-20'de keşfedilen bozulma kurtarılamaz). **Karar:** off-site `rclone copy` (additive — off-site kopyayı ASLA silmez) + ayrı yaş-tabanlı prune `rclone delete "${RCLONE_REMOTE}" --min-age "${OFFSITE_RETENTION_DAYS:-180}d"`. Pilotta GFS katmanlama (14/8/6 inceltme) yerine **düz 180 gün (~6 ay) günlük tutma** — dump ~150K, 180 kopya ~30MB (önemsiz depolama) + daha çok restore noktası (DR-daha-güvenli). GFS katmanlama (depolama optimizasyonu, DB büyüyünce) v5.1. Local retention 14 gün (hızlı restore) DEĞİŞMEZ.

**2. PGHOST peer-auth riski (MED — düzeltildi):** backup.env `PGHOST=localhost` TCP'yi zorluyordu; systemd `User=postgres` + TCP `127.0.0.1` genelde scram şifre ister (peer yalnız Unix socket). Prod `sudo -u postgres psql` (socket/peer) ile çalışıyor (deploy.md:120); şifresiz → 03:00'da sessiz `password authentication failed` = gece DR sessiz-fail. **Karar:** pilotta `PGHOST` BOŞ (Unix socket + peer auth, `User=postgres`); yalnız uzak DB host'ta TCP ayarlanır. Script default `localhost`→boş; `PGHOST` yalnız verilmişse export edilir.

**3. Config bug'ları (düzeltildi):** DB adı `restoran_pos`→`pos_prod` (prod gerçeği, deploy.md); systemd `ExecStart`+cron yolu `/opt/restoran-pos/scripts/backup/`→`/opt/restoran-pos/apps/api/scripts/backup/pg-backup.sh` (repo yolu). Bunlar olmadan ilk gerçek yedek yanlış/olmayan DB'yi hedefler + systemd script'i bulamaz.

Not: `hetzner-deployment` skill'i stale (eski DB adı + gzip→b2 reçetesi, ADR-023 ile superseded) — whitelist dışı, ayrı temizlik (chip).

<!-- ADR-023 Amd1 (2026-07-06, S84, P5-3) — DR fix: off-site rclone SYNC->COPY (sync mirror=off-site max14gun=8/6 imkansiz + eski silinir=DR veri-kaybi); COPY additive + rclone delete --min-age OFFSITE_RETENTION_DAYS(default 180d duz; GFS 14/8/6 katmanlama v5.1); local retention 14gun degismez. PGHOST=localhost(TCP scram)->BOS (Unix socket peer, User=postgres, deploy.md:120); script default localhost->bos, yalniz verilmisse export. DB adi restoran_pos->pos_prod + systemd/cron yolu apps/api/scripts/backup fix. Whitelist ici, yeni ADR degil. hetzner-deployment skill stale=ayri chip. Bagli: ADR-023 Soru3 · ADR-031 K7 -->

---

## ADR-024 — Audit Coverage Gap Closure (comp / void / dine-in close)

- **Durum**: Accepted
- **Tarih**: 2026-06-27 (Session 70)
- **Bağlı ADR'lar**: ADR-003 §10.5 + §11.4 + §12.4 + §12.6 (audit subsystem + comp/cancel audit mandate), ADR-002 §10.4 (mutation+audit aynı transaction), ADR-013 §9.2/§9.3 (comp/void domain), ADR-014 §10.4/§12 (Mod B close + payments), ADR-015 Amendment 3 §A3.2/§A3.7 (anomaly rapor comp veri kaynağı — bu ADR ile düzeltiliyor)

### Bağlam

Session 70 security-reviewer denetimi, ADR-003'ün MVP'de **zorunlu** kıldığı (§10.5 + §12.6) comp/cancel audit'inin parasal mutation yollarında **hiç implement edilmemiş** olduğunu doğruladı. Bu yeni özellik değil — kapatılmamış bir borç. Doğrulanmış (kod okundu) 4 gap:

1. **İkram (comp) audit'siz.** `apps/api/src/routes/orders.ts` PATCH `/:orderId/items/:itemId` (`isComped` toggle, satır ~1140-1206) → `writeAudit` yok. ADR-003 §10.5/§12.6 `comp.apply` event'i + payload `{order_id, comp_reason, amount_cents}` zorunlu kılmış; event type bile yok (`packages/shared-types/src/audit.ts`). `payments.create` (`packages/db/src/repositories/payments.ts`) ödenmeye çalışılan comped item'ı DB trigger ile reddediyor → comp parasal sonucu olan bir aksiyon, kanıtsız.
2. **Void (kalem iptali) audit'siz.** Aynı handler, `status='cancelled'` yolu → audit yok.
3. **Dine-in close/ödeme audit'siz.** `payments.ts POST /payments` (`pay_and_close`/`pay_and_print_close` → repo `payOrder`/`close`) + `orders.ts PATCH /:id { status:'paid' }` (Mod B `repo.payOrder`) → audit yok. `order.paid` SADECE takeaway `delivered` yolunda yazılıyor (`orders.ts` ~659-672). En hassas parasal aksiyon — masa kapatma/tahsilat — kanıtsız.
4. **`payment.created` / `payment.refunded` ALLOWED_KEYS boş** (`packages/shared-domain/src/audit/allowed-keys.ts:42-43`) — event tipleri tanımlı ama whitelist `[]`, yani yazılsa bile tüm payload düşer.

**Cross-ADR çelişki (önce çözülmeli):** ADR-015 Amendment 3 §A3.2 + §A3.7 madde 1, comp audit event'ini "v5 MVP scope DIŞINDA" işaretleyip v5.1'e ertelemişti (anomaly raporu `is_comped=true` DB-direkt okur, `actorUserId`/`occurredAt` yaklaşık döner). Bu, ADR-003 §10.5/§12.6'nın orijinal **MVP zorunluluğu** ile çelişir. Mimari öncelik hiyerarşisi (CLAUDE.md): **güvenlik/uyumluluk #1, veri bütünlüğü #2**. Parasal/forensic kanıt (kim ikram etti, kim masa kapattı) bu iki başlığın kalbinde. Bu ADR çelişkiyi **ADR-003 lehine** çözer: comp/void/close audit MVP'de yazılır. ADR-015 Amendment 3 §A3.2 bu ADR ile **supersede** edilir (aşağıda Amendment notu).

### Karar

#### K1 — Audit'i mutation transaction'ına sokma yöntemi: tx-variant sibling metot (Option A, callback değil)

ADR-002 §10.4 gereği domain mutation INSERT'i + audit INSERT'i AYNI `BEGIN..COMMIT` içinde olmalı. Sorun: `orders.ts` repo'nun `updateItem`/`payOrder` ve `payments.ts` repo'nun `create` metotları transaction'ı **kendileri sahipleniyor** (`db.transaction().execute()`) ve dış executor kabul etmiyor; bu yüzden route bunları sarıp `writeAudit(trx)` çağıramaz.

**Seçilen yöntem:** Her parasal metoda bir **`*Tx` kardeş metot** eklenir; mevcut mantık `Transaction<DB>` alan tx-variant'a taşınır, **mevcut public metot bu variant'ı `db.transaction().execute(trx => …Tx(trx, …))` ile sarıp delege eder** (davranış birebir korunur, geriye uyumlu). Route, tek transaction açar: `db.transaction().execute(trx => { const r = await repo.xTx(trx, …); await writeAudit(trx, …); return r; })`.

- `updateItemTx(trx, tenantId, orderId, itemId, params)` → mevcut `updateItem` gövdesi (FOR UPDATE yok, var olan davranış). `updateItem` delege eder.
- `payOrderTx(trx, tenantId, orderId)` → mevcut `payOrder` gövdesi (FOR UPDATE + SUM-check + status=paid). `payOrder` delege eder. **#193 close-validation davranışı DEĞİŞMEZ.**
- `payments.createTx(trx, tenantId, params)` → mevcut `create` gövdesi (idempotency replay + order lock + payment INSERT + payment_items + canCloseOrder). `create` delege eder. **#194 retry + idempotency davranışı DEĞİŞMEZ.**

**Neden bu, callback (Option B) değil:**
- (+) Codebase'de zaten kanıtlı pattern: `createTakeawayOrder(tx, …)`, `updateTakeawayStage(tx, …)`, `cancelTakeawayOrder(tx, …)`, `assignCustomer(tx, …)` hepsi `Transaction<DB>` alıyor; route `db.transaction().execute()` açıp `writeAudit(trx)` ile aynı tx'te yazıyor (orders.ts:646-672, 716-729, 1078-1100). Yeni `*Tx` metotları **aynı kontratı** izler — tutarlılık.
- (+) Public imza geriye uyumlu (mevcut çağıranlar — testler, başka route'lar — hiç dokunulmadan çalışır). Cerrahi sınır korunur.
- (−) Geçici kod ikizliği (public metot = ince delege wrapper). Kabul: wrapper 3 satır, tx-variant gerçek mantığı tutar; sıfır mantık duplikasyonu.
- Option B (repo'ya `onAudit(trx)` callback enjekte) reddedildi: db katmanına (`packages/db`) audit/route bağımlılığı sızdırır (layering ihlali — db paketi `writeAudit`/`AuditEventType` bilmemeli), audit payload'ı repo içinde kuramaz (route-level context: actorUserId, role gerekir).

#### K2 — Yeni event tipleri + payload (PII-safe)

ADR-003 §12.6 `comp.apply` ismini önerdi; ancak codebase 2-segment `entity.verb` DB CHECK (`^[a-z_]+\.[a-z_]+$`) ve `order_item.status_changed` precedent'i ile **item-level** isimlendirme kullanıyor. Tutarlılık için item-level event'ler `order_item` namespace alır:

- **`order_item.comped`** (yeni) — `isComped` toggle yolunda. ALLOWED_KEYS: `['order_id', 'order_item_id', 'product_id', 'is_comped_before', 'is_comped_after', 'amount_cents']`.
- **`order_item.voided`** (yeni) — `status='cancelled'` yolunda. ALLOWED_KEYS: `['order_id', 'order_item_id', 'product_id', 'status_before', 'amount_cents']`.
- **`payment.created`** (mevcut tip, whitelist DOLDURULUR) — ALLOWED_KEYS: `['order_id', 'payment_id', 'payment_type', 'payment_scope', 'amount_cents', 'operation', 'order_closed']`.
- **`order.paid`** (mevcut tip) — dine-in close yolunda yeniden kullanılır; whitelist mevcut `['order_id', 'payment_type', 'amount_cents']` korunur (Mod B / `pay_and_close`).

**`comp_reason` KARARI: payload'a YAZILMAZ.** ADR-003 §10.5 `comp_reason`'ı önerse de v5'te `order_items.comp_reason` kolonu **YOK** (ADR-015 Amendment 3 §A3.7 madde 2 ile doğrulandı: comp_reason kolonu v5.1 backlog). Olmayan kolon audit'e yazılamaz; ayrıca serbest-metin reason ADR-003 §7 "snapshot serbest-metni event payload'a yazma" kuralına ve deny-list PII riskine girer. **Karar:** `comp_reason` v5.1'de kolon+UI ile geldiğinde whitelist'e eklenir (forward-ref). `amount_cents` = ikram edilen item'ın `total_cents`'i (integer kuruş, parasal etki kanıtı), `comp_reason` yerine yeterli forensic sinyal.

**Payload PII-safe doğrulaması:** Tüm alanlar UUID veya integer/enum literal — product adı, müşteri bilgisi, serbest metin YOK. `product_id` forensic için (raporlama: hangi ürün ne kadar ikram edildi). deny-list (`phone/email/address/...`) hiçbir alanı yakalamaz → sanitize throw etmez.

#### K3 — Hangi event hangi tx'te, hangi yol

| Yol | Route | tx-variant | Audit event | Payload |
|---|---|---|---|---|
| Comp toggle | `orders.ts PATCH /:orderId/items/:itemId` (isComped) | `updateItemTx` | `order_item.comped` | order_id, order_item_id, product_id, is_comped_before/after, amount_cents (item.total_cents) |
| Void kalem | aynı handler (status='cancelled') | `updateItemTx` | `order_item.voided` | order_id, order_item_id, product_id, status_before, amount_cents |
| Dine-in close (Mod A) | `payments.ts POST /payments` (operation `*_close`) | `payments.createTx` | `payment.created` (+ `order.paid` close olduğunda) | payment_id, order_id, payment_type, payment_scope, amount_cents, operation, order_closed |
| Dine-in close (Mod B) | `orders.ts PATCH /:id { status:'paid' }` | `payOrderTx` | `order.paid` | order_id, payment_type (SUM kaynaklı yok → 'mixed' literal değil; aşağıya bak), amount_cents (order.total_cents) |

**Mod B `order.paid` payment_type sorunu:** Mod B "zaten ödenmiş close" — tek payment_type yok (split olabilir). `order.paid` whitelist'i `payment_type` bekliyor. **Karar:** Mod B'de `payment_type='mixed'` literal yazılır (whitelist enum-serbest, string kabul eder; sanitize sadece key kontrol eder, değer kontrol etmez). `amount_cents = order.total_cents` (kapatılan tutar). Bu, takeaway `order.paid` (tek planned_payment_type) ile uyumlu kalır, Mod B çoklu-ödeme gerçeğini `'mixed'` ile dürüstçe işaretler.

**Non-close payment (Mod A partial, operation `pay`/`pay_and_print`):** `payment.created` yazılır, `order_closed=false`, `order.paid` YAZILMAZ (sipariş açık kalır). Her parasal hareket (partial dahil) audit'lenir.

**Idempotency replay → audit YAZILMAZ.** `payments.createTx` replay dalında (mevcut payment bulundu) mutation olmadığı için audit de yazılmaz (no-op pattern, `assignCustomer` no-op precedent'i ile uyumlu). Route, `createTx`'in "yeni mi replay mı" sinyalini döndürmesine göre `writeAudit` çağırır.

**Comp/void no-op:** `isComped`/`status` zaten hedef değerdeyse audit yazılmaz (toggle gerçek değişim üretmedi). `updateItemTx` before-değeri döndürür; route before==after ise `writeAudit` atlar.

#### K4 — Kapsam kilidi (DOKUNULMAZ, v5.1)

- **refund:** `payment.refunded` whitelist `[]` BOŞ KALIR — refund endpoint yok (ADR-014 kapsam dışı). Bu ADR refund'a dokunmaz; v5.1 refund ADR'sinde doldurulur.
- **audit viewer UI:** v5.1 (ADR-003 §12.7a).
- **uncomp / comp rollback:** v5.1 (ADR-013 §9.2 + ADR-003 §10.5 not).
- **comp_reason kolonu + UI:** v5.1 (ADR-015 Amendment 3 §A3.7 madde 2).
- **`order.voided` (sipariş-düzeyi void):** v5.1 — bu ADR yalnız **kalem-düzeyi** void (`order_item.voided`) ekler; `orders.status='void'` emit endpoint'i hâlâ yok (ADR-015 Amendment 3 §A3.7 madde 3).
- **anomaly raporu comp veri kaynağını audit'e taşıma:** Bu ADR comp audit event'ini **üretir** ama anomaly raporu (`reports/anomalies`) hâlâ `is_comped=true` DB-direkt okumaya devam eder — rapor sorgusunu audit'e bağlamak ayrı iş (v5.1 Amendment 4). Yeni event yazımı raporu kırmaz (rapor audit okumuyordu). Bu ADR yalnız **yazma** tarafını kapatır.

#### K5 — Test stratejisi

writeAudit transaction-aware ve mevcut testler `audit_logs`'u `ctx.db.selectFrom('audit_logs').where('entity_id', …).where('event_type', …)` ile doğruluyor (precedent: `orders.takeaway.test.ts:318-326, 609-617, 702-709`). Aynı pattern yeni yollar için kullanılır. Her yeni audit yolu **integration test** alır (gerçek PG, `ctx.db`):

1. **comp toggle → `order_item.comped` satırı** + payload alanları doğru (is_comped_before=false, after=true, amount_cents=item.total_cents).
2. **comp no-op** (zaten comped) → audit satırı **yazılmaz** (count==1, ikinci toggle artırmaz).
3. **void kalem → `order_item.voided` satırı** + status_before doğru.
4. **Mod B pay_and_close (PATCH /:id paid) → `order.paid` satırı** + amount_cents=order.total_cents.
5. **Mod A POST /payments operation=pay_and_close → `payment.created` satırı** (order_closed=true) + `order.paid` satırı.
6. **Partial payment (operation=pay) → `payment.created`** (order_closed=false), `order.paid` YAZILMAZ.
7. **idempotency replay → ikinci POST audit satırı artırmaz** (#194 davranışı korunur + audit no-op).
8. **payload PII-safe** — sanitize unit testi yeni event'ler için (deny-list miss yok, whitelist tam).
9. **Mutation rollback → audit rollback** (atomicity): tx içinde mutation fail ederse (örn. close invariant) audit satırı da yazılmaz (writeAudit aynı trx'te). Mevcut bir hata yolunu tetikleyip `audit_logs` count==0 doğrula.

### Alternatifler

- **Option B — repo'ya `onAudit(trx)` callback:** Reddedildi (K1). Layering ihlali: `packages/db` audit bilmemeli.
- **Audit'i ayrı transaction'da (mutation commit sonrası `writeAudit(db, …)`):** Reddedildi. ADR-002 §10.4 ihlali: commit sonrası audit patlarsa "kim yaptı kanıtı yok" (§10.7). Veri bütünlüğü #2 ödün veremez.
- **`comp.apply` order-level event (ADR-003 §12.6 orijinal isim):** Reddedildi. v5 toggle item-level (`PATCH …/items/:itemId`); order-level comp emit yok. Item-level event (`order_item.comped`) gerçeğe + DB CHECK 2-segment kuralına + `order_item.status_changed` precedent'ine uyar.
- **comp_reason payload'a yaz:** Reddedildi (K2). Kolon yok; serbest metin §7 + PII riski.
- **ADR-015 Amendment 3'ü değiştirmeyip rapor yolunu audit'e taşı:** Reddedildi. Rapor sorgusunu yeniden yazmak bu ADR'nin cerrahi sınırı dışı; bu ADR yalnız **yazma** tarafını (kanıt üretimi) kapatır, **okuma** (rapor) v5.1.

### Sonuçlar

- (+) ADR-003 §10.5/§12.6 MVP zorunluluğu nihayet karşılandı: comp/void/close forensic kanıt üretir (kim, ne zaman, ne kadar).
- (+) Veri bütünlüğü #2 + uyumluluk #1: en hassas parasal aksiyon (masa kapatma) artık audit'li.
- (+) Cerrahi + geriye uyumlu: public repo imzaları değişmez; #193 close-validation + #194 retry/idempotency davranışı bit-identical korunur (yalnız tx-variant ekleme + delege).
- (+) PII-safe: tüm payload UUID/integer/enum; deny-list throw yok.
- (−) Geçici kod ikizliği (public metot = tx-variant'a delege eden ince wrapper). Kabul: 0 mantık duplikasyonu.
- (−) `comp_reason` hâlâ yok → ikram **gerekçesi** kanıtlanmaz, yalnız **tutarı + aktörü** kanıtlanır. v5.1'de tamamlanır (forward-ref).
- (−) ADR-015 Amendment 3 §A3.2 supersede edildi (aşağı not) → iki ADR aynı konuya değiniyor; okuyucu cross-ref izlemeli.

### ADR-015 Amendment 3 §A3.2 supersede notu

ADR-015 Amendment 3 §A3.2 ("comp veri kaynağı: DB direkt, audit YOK, v5.1") **yazma tarafı** açısından ADR-024 ile supersede edildi: comp artık `order_item.comped` audit event'i üretir. **Okuma tarafı** (anomaly raporu `is_comped=true` DB-direkt sorgusu) **değişmez** — rapor sorgusunu audit'e bağlamak v5.1 Amendment 4 (ADR-015 §A3.7 madde 1 + 5). Yani: kanıt bugün diskte audit_logs'ta var; rapor onu okumaya v5.1'de başlar. Migration 035 (`order_items.updated_at`) Amendment 3 için eklenmişti, ADR-024 ile alakasız (audit event timestamp `audit_logs.created_at`'ten gelir).

<!-- ADR-024 Accepted (Session 70, 2026-06-27) — architect sub-agent; Audit Coverage Gap Closure; comp/void/dine-in-close audit ADR-003 §10.5/§12.6 MVP zorunluluğu karşılanır; yöntem: tx-variant sibling metot (updateItemTx/payOrderTx/payments.createTx, public metot delege — geriye uyumlu, #193/#194 davranış DEĞİŞMEZ); yeni event order_item.comped + order_item.voided, payment.created + order.paid whitelist doldurulur; comp_reason YAZILMAZ (kolon yok, v5.1); refund/uncomp/viewer/comp_reason/order.voided = v5.1; ADR-015 Amendment 3 §A3.2 yazma tarafı supersede (okuma=rapor değişmez); migration YOK; dosya whitelist brief'te -->

---

## ADR-025 — Mobil Garson Uygulaması Kickoff (Android-first, cloud client)

- **Durum**: Accepted (2026-06-28)
- **Tarih**: 2026-06-28
- **Bağlı ADR'lar**: ADR-002 §2 (mobil token taşıma — her iki token `expo-secure-store`, Bearer header), §3 (access TTL 30 dk), §6 (RBAC matrix — garson satırı: sipariş oluştur/güncelle ✓ kendi açtığı, ödeme/iptal/ikram —), §9 (JWT payload); ADR-004 (Print Agent cloud-first — cloud'dan yazıcıya doğrudan baskı imkânsız, baskı restoran PC'sinde); ADR-010 §3 (realtime JWT handshake), §3.3 (tenant claim server-otoriter), §4 (tek `/realtime` namespace + `tenant:${id}` zorunlu room + `role:` opsiyonel room), §11.1 (event ismi `<domain>.<verbPast>` camelCase, 2-segment), §11.3 (iki-taraflı zod), §11.5 (stability); ADR-016 (Caller ID popup yalnız primary station — garsona push YOK)

### Bağlam

Phase 4'ün **kalan tek büyük işi** = garson mobil uygulaması (charter §186 + §191: "Phase 4'ün gerçek kalan işi Mobile (sıfırdan)"). `apps/mobile` şu an **boş iskelet** (`src/index.ts` + `package.json` + `.npmrc`; Expo/Metro/ekran yok). Caller ID Sprint 8'de (ADR-016, PR #99/#100), Print Agent Phase 3'te (9/9 PR), Audit ADR-024'te, DB yedek ADR-023'te kapandı.

Mimari avantaj: **backend + paylaşımlı paket + realtime altyapı HAZIR** (reuse). Sipariş/masa/adisyon REST endpoint'leri, RBAC (ADR-002 §6), JWT auth (ADR-002), Socket.IO realtime (ADR-010) Phase 2'de canlandı. Mobil **yeni backend yazmaz** — mevcut cloud API'nin yeni bir istemcisidir; tıpkı `apps/web` gibi. v3'te garson mobil uygulaması **YOKTU** (charter §10: "Garson için mobil uygulama yok — garson koşarak kasaya gelip sözlü sipariş veriyor") → bu **yeni bir surface**, v3 referansı yok, sıfırdan tasarım (Login istisnası gibi) ama web kasiyer sipariş akışına demirlenir (tutarlılık).

Kapsam kilidi (CLAUDE.md core directive 6): charter §78 mobil MVP'yi **kesin** çiziyor — "sadece garson rolü: sipariş girişi, masa takibi, adisyon görüntüleme". Bu üç ekran dışı her şey (cihaz eşleştirme UI, PIN, offline, push notification, iOS pilot build, garsonda ödeme/iptal/comp) **v5.1+** (charter §90 mobil cihaz eşleştirme = v5.1; §97 offline = v5.2+).

Bu ADR bir **kickoff kararıdır**: mimari sınırları + iş kalemi sırasını + reddedilen yolları kilitler. Tasarım/kod detayı vermez (implementer'ın işi). İki ön-koşul iş kalemi (ADR-002 §2 auth amendment + ADR-010 §11 tipli event amendment) **bu ADR'de yazılmaz, yalnız referans verilir** — ayrı PR + ayrı gate.

### Karar

#### K1 — Kapsam: yalnız garson rolü, 3 ekran (charter §78 birebir)

Mobil MVP = **(1) sipariş girişi, (2) masa takibi, (3) adisyon GÖRÜNTÜLEME**. Adisyon yalnız **görüntüleme** — ödeme kasiyerde kalır. Garson **ödeme/iptal/comp YAPMAZ**. Bu bir eksik değil, **tasarım**: ADR-002 §6 RBAC matrisi zaten garsona ödeme (POST /payments) / sipariş-iptal / ikram (is_comped) yetkisi **vermiyor** (matrix satırları `—`). Mobil bu mevcut kontratı tüketir; backend tarafında yetki genişletme **gerekmez** (K4 hariç — aşağı).

> **Amendment (2026-06-29, ADR-027):** Kapsam **kısmen genişledi** — mobil 3-nokta operasyonel menüsüyle **ödeme (Öde/Hızlı Öde) + on-demand baskı + masa-yönetimi (Faz B)** garson dahil herkese AÇILDI (v3 paritesi + ürün sahibi kararı). **İptal/comp/müşteri-ata KAPALI kalır** (ADR-002 §6 o satırlar değişmez). Backend yetki genişletme ARTIK gerekir: `payments.create`/`payments.read` `+waiter` (ADR-008 §7e). Detay: ADR-027.

#### K2 — Platform: Android-first, iOS fast-follow (aynı Expo kod tabanı)

**Belirleyici sebep: geliştirme ortamı Windows.** iOS lokal derleme macOS + Xcode zorunlu kılar (Windows'ta imkânsız); Android `expo run:android` + emülatör Windows'ta yerel çalışır. Tek Expo kod tabanı iki platforma derlenir → kod ~%95 ortak. Dev döngüsü = **Expo Go** (native modül yok → custom dev client gerekmez, sıfır native kurulum, K3). Pilot derleme = **EAS cloud → Android APK** (store review yok, ucuz Android telefonda yan-yükleme). iOS sonra: EAS + Apple Developer ($99/yıl) + TestFlight — kod hazır, yalnız build + review pipeline'ı eklenir (v5.1 deferral, K-kapsam). Pilot 2-4 garson tek tip ucuz Android telefonla başlayabilir; iOS gecikmesi pilotu **bloke etmez**.

#### K3 — Native modül = HAYIR (saf cloud client)

Telefon, `apps/web` gibi davranır: **HTTPS REST + Socket.IO**, başka native köprü yok. Açıkça **DIŞARIDA**: mDNS/LAN keşfi (cloud-first; "Ana Bilgisayar" bulma v3-legacy), offline SQLite (CLAUDE.md "Lokal SQLite yok" + charter §97 offline = v5.2+), printer bridge (baskı tamamen restoran PC'sindeki Print Agent'ta — ADR-004; cloud'dan yazıcıya doğrudan basmak zaten imkânsız). Kullanılan iki paket — `expo-secure-store` (token saklama) + `socket.io-client` — Expo Go'da ek native modül gerektirmeden çalışır. Bu seçim tahmini charter ~12-20 gün aralığının **alt ucuna** çeker (~12-15 iş günü; daha az native = daha az sürpriz).

#### K4 — ABAC genişletme (KRİTİK, security-gated): garson tenant-geneli açık adisyon görür + kalem ekler

**Bu, Phase 2 Görev 16'da kurulan "own-only" (`order.created_by === req.user.sub`, ADR-002 §6 implementation notu) ABAC IDOR-korumasını BİLİNÇLİ olarak tersine çevirir.** Operasyonel gerekçe: 25 masa, 2-4 garson, **devir/handoff** gerçeği — bir garson diğerinin masasına kalem ekleyebilmeli (charter §133 "en az 2 garson aynı anda kesintisiz sipariş girebiliyor"). own-only kuralı bu akışı kırar.

**SINIR (muhafazakâr — net çiz):**
- Garson **TÜM açık adisyonları GÖRÜR** (tenant-geneli, masa devri için) — `kendi açtığı` kısıtı GET tarafında genişler.
- Garson **yeni kalem EKLER** (herhangi açık adisyona) — ekleme tarafı genişler.
- Garson **başka garsonun mevcut kalemini void/edit ETMEZ** — yalnız kendi eklediğini `status='new'` iken düzenler/siler (mevcut kural KORUNUR, genişlemez).
- **Ödeme / iptal / ikram / kapatma HÂLÂ kasiyer/admin'de** (ADR-002 §6 değişmez).

**security-reviewer onayı ZORUNLU** (CLAUDE.md: auth/PII dokunan değişiklik). IDOR yüzeyi genişlediği için tehdit modeli + tenant-izolasyon (genişleme yalnız tenant içi; cross-tenant ASLA) açıkça denetlenir. Bu genişletme **ayrı bir iş kalemidir** (aşağı, İş Kalemi 2'nin parçası), bu ADR yalnız sınırı kilitler.

#### K5 — Realtime MVP'ye dahil (canlı ortak masa tahtası)

Garson canlı ortak masa durumu görür (başka garson masa açtı/kapadı → anında yansır). Mekanizma: `apps/api/src/routes/orders.ts` **HÂLİHAZIRDA** 4 colon-string event yayıyor (doğrulandı: satır 215-225 union tipi + emit'ler) — `order:created` (449), `order:status_changed` (676), `order:cancelled` (731), `order:customer_assigned` (1125), hepsi `emitTenant(tenantId, …)` ile `tenant:{id}` room'una. ADR-010 §4 gereği bu room'a **her** socket join olur (role:waiter dahil) → **ek room GEREKMEZ**.

Bu event'ler ADR-010 §11.1 konvansiyonuna (`<domain>.<verbPast>` camelCase, 2-segment) **formalize edilir**: `orders.created` / `orders.statusChanged` / `orders.cancelled` / `orders.customerAssigned` + `ServerToClientEvents`'e tipli zod payload (ADR-010 §11.3 iki-taraflı doğrulama). Bu **ADR-010 §11 amendment'ı gerektiren AYRI bir shared-types iş kalemidir** (İş Kalemi 3) — bu ADR referans verir, kendisi uygulamaz.

#### K6 — Auth: email + şifre (mevcut akış reuse + iki amendment forward-ref)

Garson `POST /auth/login` (email + şifre) ile girer; her iki token `expo-secure-store`'da, her istekte `Authorization: Bearer`. Bu ADR-002 §2'nin mobil tasarımıdır (zaten karara bağlı). **AMA implementasyon eksik**: ADR-002 §2 backend'i `req.cookies.refresh_token ?? req.body.refresh_token` okuyacak şekilde tasarladı, ancak `/auth/login` response'unda refresh **body'de dönmüyor** (web cookie-only) + `/auth/refresh` cookie-yolu öncelikli. → **ADR-002 §2 implementation amendment** gerekir: login + refresh, mobil için body-refresh döndürür; web cookie-only davranışı korunur (mobil isteği `X-Client: mobile` header'ı ile gate edilir). Bu **AYRI iş kalemi** (İş Kalemi 2) + **security-reviewer gate**. PIN giriş + cihaz eşleştirme/fingerprint = **v5.1** (charter §90).

#### K7 — Stack & monorepo

- **Expo SDK 54** (React 19.1 / RN 0.81). Skill'in "SDK 53"ü bayat; "53+" şartını SDK 54 karşılar.
- **Monorepo gotcha (kritik):** pnpm `node-linker` YALNIZ **kök `.npmrc`**'den okunur → `apps/mobile/.npmrc`'deki `node-linker=hoisted` satırı **NO-OP**. Kök `.npmrc` **isolated/symlinked KALIR** (hoisted'a geçiş cross-app riski + SDK 54'te opsiyonel). Çözüm Metro tarafında: `apps/mobile/metro.config.js` → `watchFolders=[workspaceRoot]` + `resolver.nodeModulesPaths` (iki seviye) + `unstable_enableSymlinks` + `unstable_enablePackageExports`; isolated modda `disableHierarchicalLookup` **AÇMA**.
- **Tüketilen paketler:** `@restoran-pos/shared-types` + `@restoran-pos/shared-domain` (ikisi de RN-safe: saf zod/TS, 0 Node import). `@restoran-pos/shared-ui` **RN-ready DEĞİL** (boş placeholder `src/index.ts`; web Radix/Tailwind RN'e taşınmaz) → **mobil UI sıfırdan** (K9).
- **Node sürüm gerilimi (not):** repo `engines` Node 22 vs Expo-önerilen 20.19 → `engine-strict=true` install riski; implementer kurulumda doğrular.

#### K8 — `react-native-expo-setup` skill'i BAYAT — yalnız mekanik referans

Skill v3 LAN mimarisini varsayıyor: mDNS/Bonjour `_restoranpos._tcp`, offline SQLite, "Ana Bilgisayar" keşfi, **yanlış paket adları** (`@restoran-pos/domain`/`api-client`/`ui-core` — gerçekte `shared-types`/`shared-domain`), `react-native-mdns`. Bunlar v5 cloud-first + CLAUDE.md "Lokal SQLite yok" ile **ÇELİŞİR**. Karar: skill **yalnız Expo/Metro/monorepo MEKANİĞİ** için referanstır; mDNS / SQLite / printer-bridge / yanlış-paket bölümleri **"v3-legacy, kapsam DIŞI"** işaretlenir, izlenmez.

#### K9 — UI / HCI / i18n

Garson mobil v3'te yoktu → **sıfırdan tasarım** (Login istisnası gibi) AMA **web kasiyer sipariş akışına demirlenir** (kavramsal tutarlılık). Telefon için **portrait (dikey)** yönelim (skill'in landscape'i tablet/POS varsayımıydı; garson telefonu tek elle dikey kullanır). Tüm kullanıcı metni **Türkçe + i18n-key** (hardcoded yasak, CLAUDE.md directive 4); mobil **kendi i18n setup'ı** kurar, web ile **aynı key konvansiyonu** (`t('order.sendToKitchen')`). **Her UI PR'ında `hci-reviewer` + `turkish-ux-reviewer` + `i18n-key-checker` gate ZORUNLU.**

### Uygulama Planı / İş Kalemleri (sıralı — her biri ayrı PR + gate; branch-first, DoD, CI yeşil olmadan merge YOK)

1. **ADR-025** (bu doküman — kickoff). Gate: architect.
2. **ADR-002 §2 implementation amendment + auth API + K4 ABAC genişletme** — `X-Client: mobile` body-refresh (login + refresh) + garson tenant-geneli açık-adisyon GET/kalem-ekle ABAC. Gate: implementer + **security-reviewer** (auth + IDOR yüzeyi).
3. **Tipli `orders.*` realtime event'leri** — `apps/api/src/routes/orders.ts` colon-string → `orders.created`/`orders.statusChanged`/`orders.cancelled`/`orders.customerAssigned`; `ServerToClientEvents` + zod payload (`packages/shared-types`). **ADR-010 §11 amendment** içerir. Gate: implementer (+ web client event ismi senkron).
4. **Mobil iskelet** — Expo SDK 54 scaffold + `metro.config.js` (K7) + `expo-secure-store` auth katmanı + API/socket client. Gate: implementer.
5. **Ekranlar** — login → masa listesi (canlı) → sipariş girişi → adisyon görüntüleme → realtime sync. Gate (her UI PR): **hci-reviewer + turkish-ux-reviewer + i18n-key-checker**.

### Alternatifler

- **A — iOS-first (veya iOS+Android eşzamanlı MVP):**
  - Neden reddedildi: geliştirme ortamı Windows; iOS lokal build macOS/Xcode zorunlu → dev döngüsü imkânsız. Android Windows'ta yereldir. Aynı kod tabanı iOS'a sonra derlenir (kod hazır, K2).
- **B — Native LAN/printer modülü (mDNS keşfi, USB/Bluetooth yazıcı):**
  - Neden reddedildi: baskı zaten Print Agent'ta çözülü (ADR-004, cloud-first); cloud'dan yazıcıya doğrudan baskı imkânsız + kapsam dışı. LAN keşfi v3-legacy (cloud-first'te gereksiz). Native modül = Expo Go kaybı + native kurulum maliyeti.
- **C — `@restoran-pos/shared-ui` reuse:**
  - Neden reddedildi: RN-ready değil (boş placeholder; web Radix/Tailwind primitive'leri RN'e taşınmaz). Mobil UI sıfırdan (K7/K9).
- **D — Kök `.npmrc` `node-linker=hoisted`'a geçiş:**
  - Neden reddedildi: tüm app'leri etkiler (cross-app regresyon riski); SDK 54'te Metro symlink desteğiyle hoisted **opsiyonel**. Metro config çözümü izole + güvenli (K7).
- **E — PIN giriş / cihaz eşleştirme MVP'de:**
  - Neden reddedildi: charter §90 cihaz eşleştirme UI = v5.1; email+şifre+JWT MVP için yeterli (ADR-002 §2). PIN UX iyileştirmesi sonraya.

### Sonuçlar / Riskler

- (+) Phase 4'ün son büyük işi başlar; backend/paket/realtime reuse → yeni backend yazılmaz.
- (+) Android-first Windows'ta sıfır-friction dev döngüsü (Expo Go); iOS kod ~%95 hazır, build pipeline sonra.
- (+) Native modül yok → daha az sürpriz, daha az kurulum, tahmin alt-ucu (~12-15 iş günü).
- (+) Canlı ortak masa tahtası mevcut event altyapısından (ek room yok); event'ler ADR-010 §11 konvansiyonuna hizalanır (teknik borç kapanır).
- (−) **ABAC genişletme IDOR yüzeyini büyütür** (own-only → tenant-geneli açık adisyon). Mitigasyon: security-reviewer gate + muhafazakâr sınır (yalnız GÖR + EKLE; void/edit/ödeme genişlemez; cross-tenant ASLA).
- (−) Node sürüm gerilimi (repo 22 vs Expo 20.19, `engine-strict`) — kurulumda doğrulama gerek.
- (−) iOS pilot gecikmesi (Apple Developer hesabı + review). Kabul: pilot Android'le başlar; iOS bloke etmez.
- (−) İki ön-koşul amendment (ADR-002 §2 + ADR-010 §11) mobil ekranlardan ÖNCE bitmeli — sıra bağımlılığı (İş Kalemi 2-3 → 4-5).

### Kapsam kilidi (v5.1+ ertelenenler)

- **Mobil cihaz eşleştirme + device fingerprint UI** (charter §90).
- **PIN giriş** (email+şifre MVP yeterli).
- **Offline mod** (charter §97 = v5.2+; CLAUDE.md "Lokal SQLite yok").
- **Push notification** (Expo Notifications — realtime socket MVP için yeterli).
- **iOS pilot build** (kod hazır; EAS + Apple Developer + TestFlight build/review sonra).
- **Garsonda ödeme / iptal / comp** (ADR-002 §6 — kasiyer/admin'de kalır; mimari karar, eksik değil).

### Cross-ref tablosu (doğrulanmış satır/bölüm referansı)

| Konu | Kaynak | Doğrulanan içerik |
|---|---|---|
| Mobil token taşıma (her iki token secure-store, Bearer; backend `cookies ?? body`) | ADR-002 §2 (decisions.md ~3620-3642) | ✓ doğrulandı |
| Access TTL 30 dk | ADR-002 §3 (~3645-3655) | ✓ |
| Garson RBAC (sipariş ✓ kendi açtığı / ödeme,iptal,ikram —) | ADR-002 §6 matrix (~3751-3780) | ✓ |
| own-only ABAC (`order.created_by === req.user.sub`) | ADR-002 §6 impl. notu (~3778) | ✓ (K4 genişletir) |
| Print Agent cloud-first (baskı restoran PC'sinde) | ADR-004 (~4133) | ✓ |
| Realtime JWT handshake / tenant server-otoriter | ADR-010 §3, §3.3 (~5272-5291) | ✓ |
| Tek `/realtime` namespace + `tenant:${id}` zorunlu room + `role:` opsiyonel | ADR-010 §4.1-§4.2 (~5306-5327) | ✓ |
| Event ismi `<domain>.<verbPast>` camelCase 2-segment | ADR-010 §11.1 (~5524-5536) | ✓ (K5 formalize) |
| `orders.created`/`orderItems.statusChanged` → role:waiter (own) | ADR-010 §11 tablo (~5536-5539) | ✓ |
| 4 colon-string event mevcut (order:created/status_changed/cancelled/customer_assigned, emitTenant) | `apps/api/src/routes/orders.ts:215-225,449,676,731,1125` | ✓ (kodda tespit) |
| Caller ID popup primary station — garsona push YOK | ADR-016 Bağlam (~8162) | ✓ |
| Mobil MVP = garson, 3 ekran (sipariş/masa/adisyon görüntüle) | charter §78 | ✓ |
| Cihaz eşleştirme UI = v5.1 | charter §90 | ✓ |
| Offline mod = v5.2+ | charter §97 | ✓ |
| v3'te garson mobil YOKTU | charter §10 | ✓ |
| 2 garson eşzamanlı sipariş (K4 gerekçe) | charter §133 | ✓ |
| Phase 4 kalan iş = Mobile sıfırdan; `apps/mobile` boş iskelet | charter §186, §191 | ✓ |
| Phase 2 Görev 16 own-only ABAC IDOR koruması (K4 tersine çevirir) | ADR-002 §6 impl. notu + RBAC matrix | ✓ (genişletilir, security-gated) |
| Apple/store onay gecikme riski (TestFlight ile mitigasyon) | charter §224 (risk tablosu) | ✓ doğrulandı (main context grep teyidi: "Mobil uygulama store onayı gecikir (Apple özellikle) … TestFlight / Firebase Distribution") |

<!-- ADR-002 §2.1 Amendment (2026-06-28) — implementer; Mobil body-refresh implementasyonu (ADR-025 K6 ön-koşulu); §2 `cookies ?? body` tasarımı uygulandı; login body-return `X-Client: mobile` header-gate; refresh body-return TOKEN-SOURCE gate (`isBodySourced = !cookieTok && !!bodyTok`) — XSS HttpOnly-bypass önlemi (header değil kaynak); web cookie-only HttpOnly davranışı + rotateRefreshToken/reuse motoru (transport-agnostik) DEĞİŞMEDİ; shared-types drift kapandı (LoginResponseSchema +expiresIn +refreshToken?, yeni RefreshResponseSchema, RefreshRequestSchema route'ta validateBody); +9 test (mobil login/refresh, web korundu, cookie+X-Client güvenlik gate, mobil reuse→family revoke); security-reviewer gate; İş Kalemi 2b (ABAC/orders) ayrı PR -->

<!-- ADR-025 Accepted (2026-06-28) — architect sub-agent; Mobil Garson Uygulaması Kickoff; Android-first iOS fast-follow (Windows dev engeli, tek Expo SDK 54 kod tabanı, Expo Go dev + EAS APK pilot); saf cloud client (REST+Socket.IO, native modül YOK, mDNS/SQLite/printer-bridge DIŞ — ADR-004); kapsam charter §78 birebir (garson, 3 ekran: sipariş/masa/adisyon görüntüle, ödeme/iptal/comp YOK); K4 ABAC genişletme garson tenant-geneli açık adisyon GÖR+kalem EKLE (own-only Görev 16 tersine, security-reviewer ZORUNLU, void/edit/ödeme genişlemez); K5 realtime dahil (mevcut orders colon-string event'ler → ADR-010 §11 camelCase formalize, AYRI amendment); K6 auth email+şifre (ADR-002 §2 body-refresh X-Client:mobile amendment, AYRI security-gated); K7 SDK54 + metro.config (kök .npmrc isolated kalır, mobile/.npmrc node-linker NO-OP), shared-types+shared-domain RN-safe / shared-ui DEĞİL; K8 skill bayat (yalnız mekanik ref); K9 portrait + Türkçe i18n-key + hci/turkish-ux/i18n gate; İş kalemleri: ADR→auth/ABAC amendment→tipli event amendment→iskelet→ekranlar; v5.1: cihaz eşleştirme/PIN/offline/push/iOS-build/garson-ödeme; tahmin ~12-15 iş günü; charter §224 (Apple store gecikme riski, TestFlight mitigasyon) doğrulandı -->

---

## ADR-026 — Mobil Garson UI Tasarım Kuralları

- **Durum**: Accepted (2026-06-28)
- **Tarih**: 2026-06-28
- **Bağlı ADR'lar**: ADR-025 (mobil kickoff — K1 kapsam 3 ekran, K3 native modül YOK, K7 stack/monorepo, K9 portrait + i18n + hci/turkish-ux/i18n gate); ADR-011 (web UI tasarım kuralları — bu ADR'nin web muadili, demir noktası); ADR-008 §7 Amendment (garson tenant-geneli açık adisyon ABAC + void owner-guard `created_by_user_id === self` AND `status='new'`); ADR-010 §11.6 (tipli `orders.*` event'leri, `tenant:{id}` room, role:waiter otomatik join); ADR-002 §2.1 (mobil body-refresh auth, `X-Client: mobile`, her iki token expo-secure-store, Bearer); ADR-013 §1 (cart local state — Kaydet'e kadar sunucuya gitmez), §10 Karar 10.1 (ürüne dokun = direkt sepete ekle, modal yok); ADR-016 (Caller ID popup yalnız primary station — garsona push YOK); ADR-009 (areas/bölge domain). Charter §78 (mobil MVP 3 ekran), §90 (cihaz eşleştirme = v5.1), §97 (offline = v5.2+).

### Bağlam

ADR-025 İş Kalemi 5 = mobil garson ekranları (Login → Masalar → Sipariş → Adisyon). ADR-025 K9 yalnız ilkeyi kilitledi: "sıfırdan tasarım AMA web kasiyer sipariş akışına demirlenir + her UI PR'ında hci-reviewer + turkish-ux-reviewer + i18n-key-checker gate". **Tasarım detayını bilinçli olarak implementer'a bırakmıştı** — bu ADR o boşluğu doldurur ve dört ekran PR'ının (5a-5d) uyacağı **kural kitabını** kilitler. ADR-011'in mobil muadilidir.

Tasarım **iki kaynağa demirlenir**: (a) web kasiyer sipariş akışı (`apps/web/src/features/orders`) keşfi — kategori ızgarası, ürüne-dokun-direkt-ekle, tek "Kaydet" semantiği, void owner+status kuralı; (b) ürün sahibinin günlük aktif kullandığı ticari POS uygulamasının ekranları (görsel ilham — **birebir kopya değil**: koyu başlık, sepet-ikonu → alt-sheet adisyon, renkli kategori tile'ları). Mockup ürün sahibiyle **6 iterasyonla onaylandı** (2026-06-28).

Backend + paylaşımlı paket + realtime altyapı **HAZIR** (reuse): mobil **yeni backend yazmaz** — mevcut cloud API + ADR-010 §11.6 tipli event'lerin yeni bir istemcisidir. Bu ADR backend'e dokunmaz; tasarım + UI kuralı kilitler, somut RN kodu implementer'ın işidir.

### Karar

#### K1 — Navigation: React Navigation v7 native-stack, Adisyon ayrı ekran DEĞİL

**React Navigation v7 native-stack.** Gerektirdiği native bağımlılıklar (`react-native-screens`, `react-native-gesture-handler`, `react-native-safe-area-context`) **Expo Go'da gömülü gelir** → ADR-025 K3 "custom native modül YOK" **ihlal edilmez** (Expo Go'nun standart paket seti serbesttir; `safe-area-context` zaten transitively dependency). Stack ekranları: `Login` (auth gate) → `Tables` (Masalar) → `Order` (Sipariş).

**Adisyon AYRI ekran değildir**: `Order` ekranı üzerinde **modal/bottom-sheet** olarak sunulur, sağ-üst sepet ikonundan açılır. Implementer `npx expo install` ile SDK 54 uyumlu sürümleri (React 19.1 / RN 0.81) doğrular — manuel `package.json` pin DEĞİL.

#### K2 — Ekran envanteri + akış (ONAYLANAN, 6-iter mockup)

**Login.** e-posta + şifre + "Giriş yap". ADR-002 §2.1 body-refresh; her iki token expo-secure-store; her istekte Bearer.

**Masalar.** Koyu başlık + bölge pill'leri (`Salon (N)` / `Bahçe (N)`, **ilk bölge seçili**; web'deki "Tümü" sekmesi mobilde YOK — tek el, daraltılmış görünüm) + 3 sütun **yuvarlak-kare** masa kartları + sağ-üstte yenile + canlı bağlantı göstergesi + başlıkta profil/çıkış (logout) ikonu. Boş kart: "Masa N" + soluk `+`. Dolu kart: "Masa N" + ₺tutar + açık süre (amber tint). **60 dk+ açık: kırmızı tint** (web kuralı paritesi `elapsedMs > 3600000`). **Boş ve dolu masa AYNI `Order` ekranına** gider (web `/tables/:id/order` paritesi — boşsa yeni adisyon, doluysa mevcut).

**Sipariş (Order — Ürünler).** Koyu slate başlık `[← | Masa N (orta) | sepet ikonu + sayı rozeti (sağ)]`; arama çubuğu ("Ürün ara..."); **renkli kategori ızgarası** (yatay chip DEĞİL — 3 sütun renkli tile, renk = v5 `category.color`; seçili kategori beyaz + alt-çizgi); 3 sütun ürün kartları (ad + fiyat; sepetteyse kart üstünde inline dikey stepper); altta **kalıcı koyu "Kaydet" barı** (`cart.isDirty` iken görünür). **Ürüne dokunma = DİREKT sepete ekle** (modal yok — web ADR-013 §10 Karar 10.1 paritesi); detay (porsiyon/özellik/not/adet) = **adisyon satırına** dokununca modal.

**Adisyon (sepet sheet).** Sepet ikonundan açılan alt-sheet (tutamak + X); başlık `Adisyon: Masa N`; kalem satırları: sol dikey stepper (`+` / adet / `qty>1` ise `−`, `qty==1` ise çöp) + ad + "Tam Porsiyon" (variant) + sağda fiyat + çöp; altta "Toplam Tutar" + ₺X. **Kaydet sheet'te DEĞİL** — Order ekranının altındaki kalıcı barda (referans paritesi). Mutfak durum etiketi (Hazır/Mutfakta) **YOK** (ürün sahibi talebi — garsona gereksiz). Ürün adı **gerçek yazımıyla** (cümle düzeni); ALL-CAPS zorlanmaz.

#### K3 — Görsel dil + token seti

Portrait (dikey, tek el — ADR-025 K9). **Koyu slate başlık** (#24333d ailesi — ürün sahibinin aktif uygulamasından ilham); açık gövde. Kategori tile renkleri **`category.color`'dan** (sabit palet değil — v5 verisi). Dokunma hedefi **≥44pt** (HCI Fitts yasası, pos-checklist). Mobil **kendi küçük token setini** tanımlar (renkler, boşluk skalası, radius) — web ADR-011 ile **AYNI key konvansiyonu** ama **RN StyleSheet** (`@restoran-pos/shared-ui` RN-ready DEĞİL — ADR-025 K7/C, web Radix/Tailwind RN'e taşınmaz). Bu görsel dil **PR-zamanı hci-reviewer onayına** tabidir.

#### K4 — State yönetimi: server=TanStack Query, cart=saf local

**Server state: TanStack Query v5** (tables, areas, menu categories/products, orders) — web paritesi (ADR-011 §karar 2). **Cart: saf local store** (Zustand v5 veya yerel reducer) — web `useOrderCart`/`useCart` paterni: ADR-013 §1 gereği **cart sunucu draft DEĞİL**, "Kaydet"e kadar sunucuya gitmez. i18next zaten kurulu (TR-only).

**Mobil-özgü risk:** telefon arka plana atma/agresif kill → dirty cart kaybolur. **Mitigasyon:** `cart.isDirty` iken ekrandan çıkışta **uyarı dialog'u**. Otomatik draft-persist (AsyncStorage) = **v5.1** (kapsam kilidi).

#### K5 — i18n: web key konvansiyonu reuse + eksik-key kuralı

Web key konvansiyonu reuse: `order.*` (tekil), `order.adisyon.*`, `tables.*` (çoğul), `common.*`. **Aynen reuse edilecek** anahtarlar (web `tr.json`'dan): `order.adisyon.save` ("Kaydet"), `order.adisyon.saveSuccess`/`saveError`, `order.header.back`/`tableLabel`/`searchPlaceholder`, `order.catalog.tabAll`/`empty`/`noSearchResults`, `order.attributes.*` (porsiyon/özellik/not/adet), `order.adisyon.voidDialog.*`, `tables.title`/`status.*`/`summary.*`/`empty.*`, `common.cancel`/`close`/`loading`/`retry`.

**Web'de HARDCODED olan (CLAUDE.md kural-4 ihlali) → mobilde DÜZGÜN key olarak eklenir** (web'in hatasını taşıma): `order.adisyon.itemIncrease` ("Artır"), `itemDecrease` ("Azalt"), `itemRemove` ("Kaldır"), `tables.actions.refresh` ("Yenile"). **Kural:** her yeni mobil metni TR key üzerinden; eksik key bulunursa eklenir, hardcoded string `i18n-key-checker` gate'inde reddedilir. (Tüm key listesi bu ADR'de tek tek sayılmaz — konvansiyon + reuse + eksik-key kuralı bağlayıcı.)

#### K6 — Garson UI kısıtları: FRONTEND EXPLICIT gating (web'in TERSİNE)

Web'de yetkisiz butonlar herkese render edilip backend 403 atar; **mobilde bu KOPYALANMAZ** — garsona yetkisiz aksiyon **HİÇ render edilmez** (daha temiz UX + IDOR yüzeyi görünmez). **RENDER EDİLMEYECEKLER:** Ödeme/Hızlı Öde, sipariş İptal, İkram (comp) toggle, Taşı (transfer), Yazdır, sipariş-meta düzenle (pencil), satır 3-nokta menüsü, Caller-ID headset (ADR-016: popup primary station'da, garsona push YOK), +Yeni Bölge (admin `areas.manage`), floating `+` (özel ürün), alt-nav Satışlar/Ayarlar sekmeleri, Müşteri ata (varsayılan kapsam-dışı — K-kapsam).

**VOID / EDIT (ADR-008 §7b authoritative):** adisyon satırında stepper + çöp **YALNIZ** `created_by_user_id === self` **VE** `status === 'new'` kalemde aktif. Mutfağa gitmiş (`status !== 'new'`) veya başkasının kalemi **salt-okunur** (stepper/çöp render edilmez). Adisyona kalem ekleme: ayrı "Kalem ekle" butonu **YOK** (web paritesi) — yalnız katalogtan.

> **Amendment (2026-06-29, ADR-027):** RENDER EDİLMEYECEKLER listesinden **Ödeme/Hızlı Öde + Yazdır + Taşı (transfer)** ÇIKARILDI — bunlar artık dolu masa kartı + Order başlığındaki **3-nokta operasyonel bottom-sheet'inde** render edilir (garson dahil herkes; ADR-027 K4). **İptal + İkram (comp) + Müşteri ata RENDER EDİLMEZ kalır.** DİKKAT: bu **kart/başlık** 3-noktası (operasyonel) ≠ **satır** (kalem-düzeyi) 3-noktası; kalem void owner-guard (§7b yukarı) değişmez. Faz B aksiyonları (move/merge/transfer) backend gelene dek render edilmez.

#### K7 — Kaydet semantiği: Kaydet = kaydet + mutfağa otomatik gönderme

Tek "Kaydet" butonu (`order.adisyon.save`) kalıcı alt barda, `cart.isDirty` iken görünür. `handleSave` akışı: dine_in → önce **tables refetch** (race koruması) → fresh `active_order_id` varsa `POST /orders/:id/items` (mevcut adisyona ekle), yoksa `POST /orders` (yeni adisyon + items atomik).

Backend **her iki endpoint'te KDS hook'u çalıştırır** (`kitchen_print=true` kategori kalemleri `status='new' → 'sent'`, `print_job` INSERT, `kitchen.orderSent` emit) → **Kaydet = kaydet + mutfağa otomatik gönderme. AYRI "Mutfağa gönder" butonu YOK** (web paritesi). Başarı: toast + `cart.clear()` + tables invalidate + Masalar'a dön.

#### K8 — Mock-first, sonra gerçek API + realtime

Ekranlar **önce mock veri katmanına** (shared-types ile tipli) karşı kurulur → telefonda Expo Go ile akış test edilir → **sonra gerçek API** bağlanır. Gerçek API endpoint'leri (HEPSİ HAZIR, yeni backend YOK): `POST /auth/login` (`X-Client: mobile` body-refresh), `GET /tables`, `GET /areas`, `GET /menu/categories` + `/menu/products`, `POST /orders`, `GET /orders` (+ `/:id`), `POST /orders/:id/items`, `PATCH /orders/:orderId/items/:itemId` (void).

**Realtime:** tipli `orders.*` event'leri (ADR-010 §11.6: `orders.created`/`statusChanged`/`cancelled`/`customerAssigned`, `tenant:{id}` room, role:waiter otomatik join) → canlı masa tahtası: `orders.created`/`cancelled` gelince tables refetch/invalidate.

**NOT (backend eksiği — web'de de var):** `tables.statusChanged` event'i backend'de emit EDİLMİYOR → mobil masa canlılığını `orders.*` event'lerinden **DOLAYLI** türetir; bu ADR backend'e dokunmaz (mevcut event'ler yeterli). Gerçek-API test ortamı: lokal **Windows-native Postgres** + API PC'de, telefon **LAN IP** ile (Session 72 ops kararı; Docker yerine).

#### K9 — Auth & oturum

Email + şifre login; her iki token **expo-secure-store**; her istekte `Authorization: Bearer`; refresh **body-refresh** (ADR-002 §2.1). Logout = Masalar başlığında profil/çıkış ikonu (token temizle → Login). **PIN + cihaz eşleştirme = v5.1** (ADR-025 K6, charter §90).

### Alternatifler

- **A — Segment-toggle `[Ürünler | Adisyon]`** (önce önerildi): REDDEDİLDİ — ürün sahibi + referans uygulama "sepet ikonu (rozetli) → alt-sheet adisyon" paternini seçti; daha akıcı, kalıcı Kaydet barı korunur.
- **B — Ayrı "Adisyon görüntüleme" ekranı:** REDDEDİLDİ — `Order` ekranı + sepet-sheet'e KATLANDI (charter §78 "adisyon görüntüleme" = sheet'in salt-görüntü hali).
- **C — `@restoran-pos/shared-ui` reuse:** REDDEDİLDİ — RN-ready değil (ADR-025 K7/C); mobil UI sıfırdan RN StyleSheet.
- **D — Alt sekme nav (Masalar/Siparişler/Satışlar/Ayarlar — referansta var):** REDDEDİLDİ — garson tek-akış (Masalar home); Satışlar/Ayarlar admin/kasiyer. v5.1.
- **E — Web'in "tüm butonları render et + backend 403" modeli:** REDDEDİLDİ mobilde — explicit frontend gating (K6).

### Sonuçlar / Riskler

- (+) Onaylanan tasarım kilitlendi; 4 ekran PR'ı (5a-5d) tek kural kitabına demirli.
- (+) Reuse: backend + realtime + paket hazır — yeni backend yazılmaz.
- (+) Familiar UX (ürün sahibinin günlük kullandığı patern) → düşük öğrenme eğrisi.
- (+) Frontend explicit gating (K6) → garsona IDOR yüzeyi hiç görünmez, daha temiz UX.
- (−) Cart local state mobilde kayıp riski (arka plan/kill) — K4 mitigasyon (dirty uyarı dialog'u; auto-persist v5.1).
- (−) `tables.statusChanged` backend eksiği → dolaylı canlılık (`orders.*`'tan türetilir, K8).
- (−) Dark-header görsel dili web ADR-011'den sapar — kabul: mobil ayrı surface (ADR-025 K9 "sıfırdan ama demirli").

### Kapsam kilidi (v5.1+ ertelenenler)

Müşteri atama, paket/takeaway oluşturma (dine_in-only MVP), PIN, cihaz eşleştirme UI, offline, push notification, iOS pilot build, alt-nav Satışlar/Ayarlar, otomatik cart draft-persist, audit/iskonto UI. (charter §78/§90/§97.)

### Uygulama Planı / İş Kalemleri (İş Kalemi 5 alt-PR'ları — sıralı; her biri branch-first, DoD, CI yeşil olmadan merge YOK; her UI PR'ında hci-reviewer + turkish-ux-reviewer + i18n-key-checker gate; gerçek-API PR'ı ayrıca security-reviewer)

- **PR-5a:** React Navigation iskeleti (K1) + i18n key seti (K5) + mock veri katmanı (K8) + **Login** ekranı (K2/K9).
- **PR-5b:** **Masalar** ekranı (K2) — mock + canlı simülasyon.
- **PR-5c:** **Order** ekranı (Ürünler katalog + sepet, K2/K3/K4/K6) + **Adisyon** sheet (mock).
- **PR-5d:** Gerçek API + realtime bağlama (auth, tables, menu, orders, `orders.*` events — K7/K8/K9). Gate: + **security-reviewer** (auth/Bearer).

### Cross-ref tablosu

| Konu | Kaynak |
|---|---|
| Mobil kickoff (kapsam 3 ekran, native YOK, stack, portrait, gate) | ADR-025 K1/K3/K7/K9 (~9913-9960) |
| Web UI tasarım kuralları (muadil, demir noktası) | ADR-011 (~5736) |
| Garson void: own item AND `status='new'` | ADR-008 §7b Amendment (~5146) |
| Tipli `orders.*` event'leri, `tenant:{id}` room, role:waiter join | ADR-010 §11.6 |
| Mobil body-refresh auth (`X-Client: mobile`, secure-store, Bearer) | ADR-002 §2.1 Amendment (~10027) |
| Cart local state (Kaydet'e kadar sunucuya gitmez) | ADR-013 §1 |
| Ürüne dokun = direkt sepete ekle (modal yok) | ADR-013 §10 Karar 10.1 |
| Caller ID popup primary station — garsona push YOK | ADR-016 |
| Areas/bölge domain (`category.color`, area pill'leri) | ADR-009 |
| Mobil MVP = 3 ekran / cihaz eşleştirme v5.1 / offline v5.2+ | charter §78/§90/§97 |
| Kod hedefleri | `apps/mobile/` (App.tsx navigation, src/screens/*, src/i18n, src/api veya src/lib, src/mock) |

### Amendment (2026-06-29) — PR-5c telefon-testi rafineleri + ürün sütun tercihi

PR-5c (Order ekranı) ürün sahibiyle **canlı telefon testi** (Expo Go, gerçek Android) sırasında 8+ iterasyonla aşağıdaki kararlar netleşti. Bu amendment tasarımı **uygular/rafine eder**; K1/K8/K9 değişmedi.

**A — Kart stepper'ı: referans-paritesi "çıplak köşe butonları" (K2/K3 rafine).** İlk bordürlü "pill" tasarımı ürün sahibi tarafından "ürün kartı içinde ayrı bir kart gibi duruyor" diye reddedildi. Onaylanan: stepper **kutu/bordür YOK** — açık-gri yuvarlak `+` (sağ-üst köşe) / büyük koyu **sayı** (orta) / `−` veya 1-adette kırmızı **çöp** (sağ-alt köşe), referans POS uygulamasıyla bire bir. Açık-zemin koyu-glif → azaltma her zaman görünür. Dikey; yatay denendi ve reddedildi. **Adisyon sheet kalem satırı = aynı stepper (çöp@qty1); K2'deki ayrı "sağda çöp" KALDIRILDI** (hci-reviewer: qty1'de çift çöp ikonu = görsel gürültü + yanlış silme riski) → tek kaldırma yüzeyi, kart ile tutarlı.

**B — Sağ rail HER ZAMAN rezerve (K2 rafine — reflow yasağı).** Ürün sahibi gözlemi: referansta stepper kolonu yazı/fiyat içermez, bu yüzden ekleyince yazı kaymaz. Karar: ürün **sepette olmasa bile** sağ stepper kolonu (sabit genişlik) rezerve edilir; ad/fiyat sütunu sabit genişlikte → sepete ekleyince/artırınca **metin asla reflow olmaz**. Sepette değilken rail boş (referans gibi).

**C — Ürün sütun sayısı = KULLANICI TERCİHİ 2 veya 3 (K2 "3 sütun sabit" → tercih).** Dar telefon (≤360dp) fiziksel gerçeği: 3 sütun = ~104px kart → uzun ad + sağ stepper sığması için font 12px + word-wrap; 2 sütun = ~165px kart (referansın geniş ekrandaki 3-sütun kart boyutu) = rahat okunur. Tek "doğru" yok → **mobil Ayarlar'a `productColumns` (2|3) tercihi** eklenir. Varsayılan **3** (K2 ruhu). `expo-secure-store`'da kalıcı (auth deseni), açılışta hydrate. Order ekranı `useWindowDimensions` + tercihle `numColumns`/`cardWidth` türetir (FlatList `key` sütun değişince remount). Masalar ekranı **3 sütun sabit kalır** (kare kart, kısa "Masa N" — etkilenmez).

**D — Minimal Ayarlar ekranı (K6 istisnası — display-only).** K6 "alt-nav Satışlar/Ayarlar gated out" **operasyonel/admin** aksiyonları kapsar (ödeme, iskonto, admin ayar). `productColumns` saf **görüntüleme tercihi** (yetki yüzeyi yok) → K6 ihlali değil. Erişim: Masalar başlığına **dişli (gear) ikonu** → `Settings` route → 2/3 segmented control. Logout Masalar başlığında kalır (K9 korunur). v5.1 genişlemesi (tema, dil, vb.) bu ekrana eklenebilir; MVP'de **yalnız sütun tercihi**.

**E — Kaydet sonrası popup + dirty-exit uyarısı KALDIRILDI (K4/K7 rafine).** Ürün sahibi: (1) Kaydet sonrası başarı uyarısı (Alert) **gereksiz** → sessizce Masalar'a dön (tahta güncellemesi = onay). (2) Sepet doluyken geri çıkışta **dirty-exit uyarı dialog'u gereksiz** → sessiz çık. K4 "dirty-exit uyarısı" mitigasyonu **düşürüldü**; otomatik draft-persist hâlâ v5.1. Cart local-kayıp riski ürün sahibi tarafından **kabul edildi**.

<!-- ADR-026 Amendment 2026-06-29 (implementer, canlı telefon testi): A kart stepper çıplak köşe-buton referans-paritesi (bordürlü pill reddedildi) / B sağ rail her zaman rezerve = metin reflow yasağı / C productColumns 2|3 kullanıcı tercihi (3 sütun-sabit kaldırıldı, default 3, secure-store kalıcı, Masalar 3-sabit) / D minimal Ayarlar ekranı gear→Settings (K6 display-only istisna, logout K9 korundu) / E Kaydet-success Alert + dirty-exit dialog kaldırıldı (K4/K7, cart-loss kabul, auto-persist v5.1) -->

<!-- ADR-026 Accepted (2026-06-28) — architect sub-agent; Mobil Garson UI Tasarım Kuralları (ADR-011 mobil muadili, ADR-025 K9 tasarım boşluğunu doldurur, mockup 6-iter onaylı); demir: web kasiyer akışı + ürün sahibi aktif POS app (görsel ilham, kopya değil); K1 React Navigation v7 native-stack (Expo Go gömülü native serbest, K3 ihlal değil), Adisyon AYRI ekran DEĞİL = Order üstü bottom-sheet (sepet ikonu); K2 ekran envanteri ONAYLANAN (Login / Masalar koyu başlık+bölge pill+3-sütun yuvarlak-kare kart, 60dk+ kırmızı tint, boş+dolu AYNI Order / Order renkli kategori tile category.color + ürüne-dokun-direkt-ekle ADR-013 §10 + kalıcı Kaydet barı / Adisyon sepet-sheet, Kaydet sheet'te DEĞİL barda, mutfak durum etiketi YOK); K3 portrait + koyu slate başlık #24333d + RN StyleSheet token (shared-ui RN-ready değil) + ≥44pt; K4 server=TanStack Query v5 / cart=saf local (ADR-013 §1, dirty-çıkış uyarı, auto-persist v5.1); K5 web key konvansiyonu reuse + web-hardcoded'ları mobilde DÜZGÜN key (itemIncrease/Decrease/Remove, tables.actions.refresh); K6 FRONTEND EXPLICIT gating (web'in TERSİNE — yetkisiz HİÇ render edilmez), void = own AND status='new' (ADR-008 §7b); K7 Kaydet = kaydet+mutfağa otomatik gönder (POST /orders veya /orders/:id/items, KDS hook backend, AYRI Mutfağa-gönder YOK); K8 mock-first→gerçek API (hepsi HAZIR, orders.* realtime, tables.statusChanged backend eksik→dolaylı, Win-native Postgres+LAN); K9 email+şifre / secure-store / Bearer / body-refresh ADR-002 §2.1 / PIN+cihaz eşleştirme v5.1; reddedilen: segment-toggle / ayrı adisyon ekranı / shared-ui reuse / alt-nav / web-403-render-all; iş kalemleri PR-5a iskelet+i18n+mock+Login / 5b Masalar / 5c Order+Adisyon sheet / 5d gerçek API+realtime (+security-reviewer); v5.1: müşteri atama/takeaway/PIN/cihaz eşleştirme/offline/push/iOS/alt-nav/auto-persist -->

### Amendment 2026-06-29 (PR-5d — Gerçek API transport + wire-casing)

PR-5d (gerçek API + realtime bağlama) **gerçek backend route'larına + repo'larına karşı doğrulanırken** (kod okundu, dosya referansları aşağıda) ortaya çıktı ki **`shared-types` şemaları aspirasyonel** — gerçek wire bazı uçlarda farklı (casing + alan seti). Bu amendment K8'i (mock→gerçek API) **uygular/rafine eder**; K1/K4/K6/K7/K9 değişmedi.

**A — Wire-casing matrisi (kritik — EMPİRİK doğrulandı, route+repo okundu).**
- `POST /auth/login` (+`X-Client: mobile`) + `POST /auth/refresh` (+`X-Refresh-Request: 1`, body `{refreshToken}`) → **camelCase** (route `toUserPublic()` map eder; `auth.ts`). `LoginResponseSchema`/`RefreshResponseSchema` reuse edilebilir. **`user.email` nullable.**
- `GET /areas` → **snake_case** (`{id,tenant_id,name,sort_order,deleted_at,created_at,updated_at}` — icon/color **YOK**; `areas.ts` repo `selectAll` ham döner).
- `GET /menu/categories` → **snake_case** (`+kitchen_print`; `vat_rate_bps` **YOK** — `menu.ts` `repo.findAll` ham döner).
- `GET /products` → **camelCase** (DİKKAT: `/menu/products` **DEĞİL**; `products.ts` `toProduct()/toVariant()` map → `ProductWithVariants` ile birebir).
- `GET /tables` → **snake_case** projection (mobil `ApiTable` ile birebir).
- `POST /orders`, `POST /orders/:id/items`, `GET /orders?tableId`, `GET /orders/:id` → **snake_case** (dine_in ham repo satırı; yalnız takeaway `toOrderResponseDto` ile camel). Item satırları mobilin beklediğinden **10+ fazla alan** taşır.

**B — Transport kararları (boundary zod doğrulama + casing köprüsü).** auth/products → shared-types şema reuse. areas+categories → **lokal snake zod şema + snake→camel mapper** (UI camelCase `Area`/`Category` tüketir; mock paritesi korunur). `Category.vatRateBps` wire'da yok → mapper **0** verir (garson kataloğunda kullanılmaz, kozmetik). tables + order-items → lokal snake şema; order-item **subset** şema (zod varsayılan fazla alanları eler — **`.strict()` KULLANMA**). `API_BASE_URL` Expo `Constants.expoConfig.hostUri`'den otomatik türetilir (`http://<host>:3001`; host = Metro = aynı PC), manuel override sabiti ile. Port **3001** (`PORT ?? 3001`). `USE_MOCK` seam korunur (offline demo); dev'de **false**.

**C — Auth taşıma (K9 uygular).** Bearer access (in-memory + secure-store); 401 → **tek-uçuş refresh** (`X-Refresh-Request: 1` + body `refreshToken`) → rotated refresh token secure-store'a yazılır → retry → başarısızsa logout. **Token/PII loglanmaz (KVKK).**

**D — Realtime (K8 uygular — dolaylı masa canlılığı doğrulandı).** `socket.io-client`, `/realtime` namespace, handshake `auth:{token}`. Mobil `orders.created/cancelled/statusChanged` event'lerine abone → `['tables']` + aktif sipariş query invalidate. **`tables.statusChanged` backend'de YOK** (K8 NOT teyit) → masa canlılığı `orders.*`'tan **DOLAYLI** türetilir: payload parse edilmez, **sadece invalidate** (dine_in `takeawayStage:null` şema sorununu by-pass eder).

**E — Kaydet (K7) yazma yolu (doğrulandı).** Masada aktif sipariş varsa `POST /orders/:id/items`, yoksa `POST /orders {tableId, orderType:'dine_in', items:[{productId,quantity,variantId?}]}`. Backend kaydetmede **KDS job + `kitchen.orderSent` otomatik tetikler** (ayrı "mutfağa gönder" YOK — K7 teyit).

**F — Test fixture.** `seed.ts`'e `waiter` kullanıcı eklendi (`garson@local.test` / `garson1234`); `apps/api/.env`'e `JWT_AGENT_SECRET` eklendi (API fail-fast gereği).

**G — Realtime tamamlama (PR-5d cihaz testi + 2 denetim workflow'u; ADR-010 §11.6 uygular).** Cihaz testinde realtime katmanının **kırık + eksik** olduğu bulundu, tek geçişte kapatıldı: (1) **handshake** JWT claim `tenantId`→`tenant_id` (tüm socket `AUTH_TOKEN_INVALID` → realtime ÖLÜYDÜ) + REST paritesi için inline `jwt.verify` yerine paylaşılan **`verifyAccessToken`** (HS256+aud+iss+`type:'access'` pin; refresh-token bir socket için kabul edilemez — security HIGH). (2) **Emit-site tamamlama:** dine-in `POST /orders`, `POST /orders/:id/items`, item void/comp, `PATCH /orders/:id` (cancel + Mod-B "Masayı Kapat" paid), `POST /payments` (close) → `orders.created`/`orders.statusChanged`/`orders.cancelled` (tenant odası, `emitTenant`). `OrderCreated`/`OrderStatusChanged` payload `takeawayStage` **nullable** (dine-in stage yok). (3) **Web tüketici:** TablesListPage (ölü `tables.statusChanged` yerine) + OrderScreenPage `orders.*` abone → invalidate. (4) **`POST /orders/:id/items` KDS hook:** yeni `kitchen_print` kalemler `status='new'`→`'sent'` + `enqueueKitchenJob` + `kitchen.orderSent` (K7 "Kaydet=mutfağa otomatik" add-items için de — eksikti). (5) **`GET /products` RBAC** `['admin']`→`['admin','cashier','waiter','kitchen']` (katalog sipariş-alan tüm rollere; `/menu/categories` paritesi; mutasyonlar admin-only kalır). **Ertelendi → v5.1:** masa/bölge admin-CRUD realtime (yeni event tipi gerekir, nadir admin-config), takeaway paneli poll→socket (kod-içi v5.1 etiketli). **6 DoD gate geçti** (security/qa/hci/turkish-ux/i18n/kapsam); security HIGH (handshake verify) + qa BLOCKER (`realtime.test.ts` token shape `tenant_id`+aud/iss/type) bu geçişte düzeltildi. Açık DoD: emit/KDS-hook otomatik test kapsamı (P1-P5) takip görevi — davranışlar entegrasyon-doğrulandı (socket/HTTP smoke).

<!-- ADR-026 Amendment 2026-06-29 (PR-5d gerçek API transport, EMPİRİK route+repo doğrulandı): A wire-casing matrisi — auth/products=camelCase (toUserPublic/toProduct map, user.email nullable, /products DEĞİL /menu/products), areas/categories/tables/orders(dine_in)=snake_case ham repo (areas icon/color YOK, categories vat_rate_bps YOK +kitchen_print, order-items 10+ fazla alan, yalnız takeaway camel toOrderResponseDto); B boundary zod — auth/products shared-types reuse, areas+categories lokal snake şema+snake→camel mapper (vatRateBps wire'da yok→0 kozmetik), tables+order-items lokal snake subset (.strict() KULLANMA), API_BASE_URL=Constants.expoConfig.hostUri→http://<host>:3001 (override sabit), USE_MOCK seam korunur dev=false; C auth Bearer in-memory+secure-store, 401→tek-uçuş refresh (X-Refresh-Request:1+body), rotated token secure-store, fail→logout, token/PII loglanmaz KVKK; D realtime socket.io-client /realtime ns auth:{token}, orders.created/cancelled/statusChanged→tables+active-order invalidate, tables.statusChanged YOK→dolaylı (payload parse YOK sadece invalidate, takeawayStage:null by-pass); E Kaydet aktif sipariş→POST /orders/:id/items yoksa POST /orders dine_in, backend KDS job+kitchen.orderSent auto; F seed waiter garson@local.test/garson1234 + apps/api/.env JWT_AGENT_SECRET fail-fast -->

---

## ADR-027 — Mobil Operasyonel Terminal Genişlemesi (3-Nokta Aksiyon Menüsü)

- **Durum**: Accepted (2026-06-29 — ürün sahibi 3 açık kararı onayladı: K3 = hafif onay dialog'u (b); Yazdır = MVP/Faz A; Split = v5.1 (Quick Pay + tam Öde MVP))
- **Tarih**: 2026-06-29
- **Bağlı ADR'lar**: ADR-025 (mobil garson kickoff — K1 kapsam 3 ekran, K4 ABAC genişletme sınırı); ADR-026 (mobil UI tasarım kuralları — K6 frontend explicit gating, K2 ekran envanteri, K3 görsel dil, 2026-06-29 Amendment); ADR-008 §7 (garson tenant-geneli açık adisyon ABAC, owner-guard void); ADR-002 §6 (RBAC role matrix — `payments.create` admin/cashier; garson `—`); ADR-013 (sipariş alma + comp/void domain); ADR-014 (ödeme akışı — Quick Pay + Split + Idempotency-Key, `POST /payments` admin/cashier); ADR-024 (audit coverage — `payment.created`/`order.paid` event'leri yazılır); ADR-004 (Print Agent — baskı restoran PC'sinde, cloud'dan doğrudan yazıcı imkânsız); ADR-009 (areas/masa domain). Charter §78 (mobil MVP = garson, ödeme/iptal/comp YOK).

### Bağlam

ADR-025/026 mobili **saf garson terminali** olarak kilitledi: Login → Masalar → Sipariş, ödeme/iptal/comp YOK (charter §78). Ürün sahibi, **dolu masa kartlarına 3-nokta operasyonel menü** istedi — referans, günlük aktif kullandığı kendi kasiyer POS uygulaması (hem görsel hem işlevsel). Bu, mobili saf garson terminalinden **kısmi POS terminaline** çevirir: garson artık ödeme alabilir, adisyon bastırabilir, masa yönetimi yapabilir.

Bu bir **kapsam genişlemesidir** ve CLAUDE.md kapsam kilidi (core directive 6) bunu ADR ile gerekçelendirmeyi şart koşar. Gerekçe iki ayaklı: **(1) v3 paritesi** — v3'te masa transfer (`POST /api/tables/:id/transfer`) vardı; pide/lokanta operasyonunda garsonun masada ödeme alıp adisyon bastırması rutin akıştı (charter §10: garson koşarak kasaya geliyordu — v5 bunu mobile taşıyarak çözüyor). **(2) Ürün sahibi operasyonel kararı** — yoğun saatte 25 masa / 2-4 garson gerçeğinde, ödeme/baskı/masa-yönetimi için kasaya koşmak iş akışını kesiyor (öncelik #3, UX). İptal/comp **bilinçli olarak DIŞARIDA** tutuldu (aşağı K2).

**Onaylanan 6 aksiyon (ürün sahibi netleştirdi):** Öde, Hızlı Öde, Yazdır, Masayı Değiştir, Masaları Birleştir, Adisyon Aktar.
**Reddedilen 3 aksiyon (ürün sahibi istemedi):** İptal Et, İkram (comp), Müşteri Ata. → Garson HÂLÂ iptal/comp/müşteri-ata YAPAMAZ.

**Yetki kararı (ürün sahibi):** "Garson dahil herkes" bu 6 aksiyonu yapar. Mobilde giriş yapan garson da ödeme/baskı/masa-yönetimi yapar. Bu, ADR-002 §6 RBAC matrisinin garson satırını (ödeme `—`) ve ADR-008 §7'nin "ödeme genişlemez" sınırını **kısmen tersine çevirir** (aşağı K1/K2 + amendment işaretleri).

**Backend denetimi (architect doğruladı — kod okundu):**
- **Öde / Hızlı Öde:** `apps/api/src/routes/payments.ts` VAR ✅ — `POST /payments` (Idempotency-Key header + body, ADR-014 §10.10), `GET /payments`, `GET /payments/orders/:orderId/split-state`. **AMA `authorize(['admin','cashier'])`** (satır 47, 204, 231) → garson 403 alır; ABAC açılmalı.
- **Yazdır:** `apps/api/src/routes/print-jobs.ts` VAR ✅ ama **yalnız agent-facing** (`GET /print/v1/jobs/next`, `POST /jobs/:id/result`, `/agent/register`, `/agent/refresh`) + KDS auto-enqueue (`enqueueKitchenJob`). **On-demand adisyon/fiş baskı endpoint'i YOK** ❌ — web bile reprint için bir endpoint'e sahip değil. "Yazdır" SIFIRDAN bir on-demand print job enqueue endpoint'i gerektirir.
- **Masayı Değiştir / Masaları Birleştir / Adisyon Aktar:** v5 backend'de **YOK** ❌. `tables.ts` CRUD-only (`POST /`, `GET /`, `PATCH /:id`, `DELETE /:id`, `PATCH /:id/area`); `orders.ts`'de move/merge/transfer route'u yok (yalnız `enqueueKitchenJob` import'u eşleşti). **v3 referansı:** `D:\dev\restoran-pos-v3\server\routes\tables.js:107-140` `POST /:id/transfer` = masa-değiştir (kaynak→hedef, hedef boş olmalı, order taşınır, audit + `table:transferred` emit). v3'te **ayrı merge/bill-transfer route yok** — "Birleştir"/"Adisyon Aktar" v3-kavramsal ama v5'te sıfırdan domain tasarımı gerektirir.

### Karar

#### K1 — Kapsam genişlemesi onaylanır: mobil = kısmi POS terminali (6 aksiyon, v3 paritesi + ürün sahibi kararı)

Mobil 3-nokta menüsü **6 operasyonel aksiyon** kazanır: Öde, Hızlı Öde, Yazdır, Masayı Değiştir, Masaları Birleştir, Adisyon Aktar. Bu, ADR-025 K1 "saf garson, 3 ekran"ı **operasyonel terminale** genişletir. Kapsam kilidi gerekçesi: v3 paritesi (masa transfer + masada ödeme rutindi) + ürün sahibi açık operasyonel kararı (kasaya koşmayı ortadan kaldırır). **Sessiz kapsam büyümesi değil** — bu ADR açık gerekçe + amendment işaretleriyle kilitler.

**MVP / v5.1 ayrımı (her aksiyon):**

| Aksiyon | Backend durumu | MVP / v5.1 | Faz |
|---|---|---|---|
| Öde | VAR (ABAC aç) | **MVP** | A |
| Hızlı Öde | VAR (ABAC aç) | **MVP** | A |
| Yazdır (on-demand adisyon) | Endpoint YOK (yeni) | **MVP** | A* |
| Masayı Değiştir | YOK (sıfırdan) | **v5.1** (öneri) | B |
| Masaları Birleştir | YOK (sıfırdan) | **v5.1** (öneri) | B |
| Adisyon Aktar | YOK (sıfırdan) | **v5.1** (öneri) | B |

\* Yazdır backend'i küçük (tek enqueue endpoint + ADR-004 render reuse) → MVP'de Faz A ile birlikte yapılabilir; ama yeni endpoint olduğu için kendi alt-iş kalemi + db-migration-guard değerlendirmesi alır. **KARAR (2026-06-29, ürün sahibi): Yazdır = MVP / Faz A** (Öde akışının doğal tamamlayıcısı, fiş basmadan ödeme eksik).

#### K2 — ABAC: hangi permission garson/herkese açılır (İPTAL/COMP KAPALI kalır — net çiz)

**AÇILAN (garson dahil herkes):**
- `payments.create` — `POST /payments` `authorize`'ı `['admin','cashier']` → **`['admin','cashier','waiter']`**. Quick Pay + normal Öde + Split aynı endpoint'i tüketir (ADR-014). Idempotency-Key zaten zorunlu (çift-tahsilat koruması korunur).
- `payments.read` — `GET /payments` + `GET /payments/orders/:orderId/split-state` garsona açılır (ödeme ekranı state hidrasyonu için).
- `print.bill` (yeni permission) — on-demand adisyon/fiş baskı, garson dahil herkes.
- `tables.move` / `tables.merge` / `orders.transferBill` (yeni permission'lar, **Faz B**) — garson dahil herkes; her biri kendi ADR'sinde ABAC detayı + tenant-izolasyon.

**KAPALI KALAN (garson ASLA — bu ADR genişletmez):**
- **Sipariş İptali** — `POST /orders/:id/cancel`, `PATCH /orders/:id {status:'cancelled'}` → admin/cashier (ADR-008 §7c değişmez).
- **İkram / comp** — `isComped` toggle → admin/cashier (ADR-008 §7c + ADR-013 §9.2 değişmez).
- **Müşteri Ata** — varsayılan kapsam-dışı (ADR-026 K6 render edilmez kalır).
- **Kalem void/edit** — garson yalnız `created_by_user_id === self` AND `status='new'` (ADR-008 §7b owner-guard değişmez; mutfağa gitmiş/başkasının kalemi salt-okunur).

**Cross-tenant ASLA** — her sorgu `tenant_id` WHERE; genişleme yalnız tenant içi (ADR-008 §7c kuralı korunur).

#### K3 — Emniyet: audit ZORUNLU + PIN/onay opsiyonu (KARAR BEKLİYOR — ürün sahibi)

**Audit (zorunlu, ADR-024 reuse):** Garson artık ödeme yapabildiğinden forensic emniyet kritik. ADR-024 `payment.created` + `order.paid` event'lerini zaten yazıyor (tx-variant `payments.createTx`/`payOrderTx`, aktör = `req.user.sub`) → **garson ödemesi otomatik audit'lenir, ek iş yok** (yalnız aktörün artık garson olabilmesi). Faz B aksiyonları (move/merge/transfer) **kendi audit event'lerini** tanımlar (`table.moved` / `table.merged` / `order.bill_transferred` — entity.verb 2-segment, ADR-024 deseni) — her birinin ADR'sinde + ALLOWED_KEYS PII-safe.

**PIN / onay opsiyonu — KARAR (2026-06-29, ürün sahibi): (b) hafif onay dialog'u.** "Garson dahil herkes ödeme alır" güçlü bir yetki. Parasal aksiyonlar (Öde / Hızlı Öde) öncesi **tek-dokunuş onay dialog'u** ("Ödemeyi onaylıyor musun? ₺X") render edilir — yanlış-dokunuş/yanlış-tahsilat koruması, akışı kesmez. PIN (a) reddedildi (UX yavaşlatır + cihaz eşleştirme v5.1); salt-audit (c) reddedildi (onay dialog'u ucuz emniyet katmanı). **ADR-026 Amendment 2026-06-29 §E** ile çelişmez (o "başarı popup'ı"nı kaldırdı; bu **aksiyon-öncesi** onay — farklı). Faz B masa-yönetimi aksiyonları için onay dialog'u her aksiyonun kendi ADR'sinde değerlendirilir.

#### K4 — 3-Nokta UI: bottom-sheet aksiyon menüsü (ADR-026 görsel diliyle uyum)

**Tetikleyici + erişim noktaları:**
- **Masalar ekranı — dolu masa kartı:** kartta **3-nokta (kebab) ikonu** (sağ-üst köşe; ADR-026 K2 dolu kart amber/kırmızı tint korunur). Dokunma → **bottom-sheet aksiyon menüsü** (ADR-026 K1 Adisyon sheet'iyle aynı paternin alt-sheet'i — tutamak + başlık `Masa N` + aksiyon satırları + X). Boş kart 3-nokta **YOK** (aksiyon yok).
- **Order ekranı başlığı:** ADR-026 K2 başlık `[← | Masa N | sepet ikonu]` → sepet ikonu yanına **3-nokta ikonu** (aynı 6 aksiyon). Garson sipariş alırken masaya gitmeden ödeme/baskı/masa-yönetimi yapabilir.

**Sheet içeriği (referans paterni):** ikon + Türkçe etiket satırları, ≥44pt dokunma hedefi (ADR-026 K3). Parasal aksiyonlar (Öde/Hızlı Öde) görsel olarak gruplanır (üst); masa-yönetimi (Değiştir/Birleştir/Aktar) alt grup; Yazdır ortada. **Faz A'da yalnız Öde/Hızlı Öde/Yazdır render edilir**; Faz B aksiyonları backend gelene kadar **render EDİLMEZ** (ADR-026 K6 explicit gating ruhu — yetkisiz/yok aksiyon hiç görünmez). İptal/comp/müşteri-ata **hiçbir zaman render edilmez** (K2).

**Ödeme/Split UI:** ADR-014 web ödeme akışının (Quick Pay tek-dokunuş, Split modal) mobil muadili — ayrı tasarım ADR'si gerekebilir (Faz A iş kalemi içinde hci-reviewer ile netleşir). **KARAR (2026-06-29, ürün sahibi): Quick Pay + tam Öde ekranı (nakit/kart) = MVP; Split (kişi/kalem bölme) = v5.1.** Quick Pay basit, Split modal mobil-port karmaşık.

#### K5 — Fazlama (NET): Faz A = backend HAZIR, Faz B = backend YOK

**Faz A — Backend HAZIR (Öde / Hızlı Öde / Yazdır):**
- Öde/Hızlı Öde: yalnız `payments.create`/`payments.read` ABAC açılır (`+waiter`) + mobil ödeme UI + 3-nokta sheet. Backend mutation yazılmaz (endpoint var).
- Yazdır: tek yeni on-demand print enqueue endpoint (ADR-004 render reuse) + `print.bill` permission + UI.
- **Gate: security-reviewer ZORUNLU** (parasal yetki garsona açılıyor — IDOR + yanlış-tahsilat yüzeyi), + hci/turkish-ux/i18n (UI), + db-migration-guard (yeni permission seed + print endpoint).
- Tahmin: küçük (ABAC genişletme + UI + 1 endpoint).

**Faz B — Backend YOK (Masayı Değiştir / Masaları Birleştir / Adisyon Aktar):**
- Her biri **kendi ADR** + migration (gerekirse) + domain + endpoint + ABAC + UI + test.
- **Muhtemelen ayrı sprint / v5.1** (charter MVP = 3 ekran; bu 3 aksiyon yeni domain yüzeyi, masada-tek-aktif-sipariş invariant'ına dokunur — K6).
- Her biri ayrı PR zinciri: ADR (architect) → migration (db-migration-guard) → backend (implementer + security-reviewer) → UI (hci/turkish-ux/i18n).

#### K6 — Faz B domain notu (yüksek-seviye — detay tasarım her aksiyonun kendi ADR'sinde)

Bu aksiyonlar **masada-tek-aktif-sipariş invariant'ına** + KDS'e + print'e dokunur. Yüksek-seviye semantik (detay Faz B ADR'lerinde):

- **Masayı Değiştir (move/transfer):** Bir masanın aktif siparişini boş başka masaya taşı. v3 davranışı (`tables.js:107-140`): hedef masa **boş olmalı**, `orders.table_id` güncellenir, kaynak masa boşaltılır, atomik tx, audit + realtime emit. v5 etkilenen: `orders.table_id` (FK + tenant composite), masa-durum türetimi (ADR-026 K8 `orders.*`'tan dolaylı), realtime (`table.moved` veya mevcut `orders.*` invalidate). **Invariant korunur** (her masa ≤1 aktif sipariş). En basit Faz B aksiyonu — v3 paritesi net.
- **Masaları Birleştir (merge):** İki dolu masanın siparişlerini tek masada topla → **masada-tek-aktif-sipariş invariant'ını zorlar** (iki aktif sipariş → bir sipariş). Seçenek: (a) kaynak siparişin kalemlerini hedef siparişe taşı + kaynak siparişi kapat/iptal, (b) yeni birleşik sipariş. KDS etkisi (taşınan kalemlerin `status`/print durumu), audit, ödeme bütünlüğü (kısmi ödeme varsa?) **karmaşık** → kendi ADR'si zorunlu, v5.1 güçlü aday.
- **Adisyon Aktar (bill transfer):** Bir adisyonun **bir kısım kalemini** başka masaya/adisyona aktar (split-table senaryosu — müşteri masa değiştirdi, bazı kalemler gitti). Kalem-düzeyi taşıma + kalan/yeni sipariş bölme + ödeme/KDS tutarlılığı. En karmaşık; v5.1.

**Ortak risk:** üçü de ödeme yapılmış/mutfağa gitmiş kalemlerle etkileşince veri bütünlüğü (#2) riski taşır. Faz B ADR'leri bu kenar durumları (kısmi ödeme sonrası taşıma, `sent` kalem taşıma) açıkça çözmeli.

### Alternatifler

- **A — Mobili saf garson tut, ödeme/baskı kasiyerde kalsın (ADR-025 K1 değişmez):** REDDEDİLDİ — ürün sahibi açık operasyonel ihtiyaç belirtti (kasaya koşma iş akışını kesiyor, charter §10 problemi). v3 paritesi de destekliyor.
- **B — 6 aksiyonun hepsini tek MVP'de yap:** REDDEDİLDİ — Masa-yönetimi 3 aksiyonu sıfırdan domain + invariant riski; MVP'yi şişirir + veri bütünlüğü riski. Fazlama (Faz A hazır-backend, Faz B yeni-backend) cerrahi sınır.
- **C — Garsona ödeme açma, yalnız "ödeme talebi" oluştur (kasiyer onaylar):** REDDEDİLDİ — ürün sahibi "garson dahil herkes öder" dedi; iki-aşamalı onay akışı kapsamı büyütür, operasyonel ihtiyaca aykırı. (Yanlış-tahsilat koruması K3 onay dialog'u ile hafifçe çözülür.)
- **D — İptal/comp'u da aç (tam POS terminali):** REDDEDİLDİ — ürün sahibi açıkça istemedi; iptal/comp en yüksek suistimal yüzeyi (parasal kayıp + forensic). Garson kademesinde KAPALI kalır (K2).
- **E — Web'in "tüm butonları render et + 403" modeli mobile taşı:** REDDEDİLDİ — ADR-026 K6 explicit gating korunur; yok/yetkisiz aksiyon hiç render edilmez.

### Sonuçlar / Riskler

- (+) Garson kasaya koşmadan ödeme/baskı/masa-yönetimi yapar → yoğun-saat iş akışı kesilmez (öncelik #3). v3 paritesi + ürün sahibi kararı karşılanır.
- (+) Faz A reuse-ağırlıklı: `POST /payments` + ADR-024 audit + ADR-004 render zaten var; yalnız ABAC + UI + 1 endpoint.
- (+) Fazlama veri-bütünlüğü riskini izole eder: hazır-backend (A) hızlı, yeni-domain (B) kendi ADR + gate.
- (−) **Parasal yetki garsona açılır → IDOR + yanlış-tahsilat + suistimal yüzeyi büyür.** Mitigasyon: security-reviewer gate (Faz A zorunlu) + ADR-024 audit (her ödeme kanıtlı) + K3 onay dialog'u + Idempotency-Key (çift-tahsilat) + cross-tenant ASLA + iptal/comp KAPALI.
- (−) Faz B 3 aksiyon masada-tek-aktif-sipariş invariant'ına dokunur → veri bütünlüğü (#2) riski; her biri kendi ADR + kenar-durum çözümü şart.
- (−) ADR-025 K1 + charter §78 + ADR-026 K6 + ADR-008 §7 amendment gerektirir (aşağı). Doküman-tutarlılık borcu; bu ADR amendment'leri **işaret eder**, gövdeleri implementer/architect ayrı uygular.
- (✓) Açık kararlar 2026-06-29 onaylandı: K3 = (b) hafif onay dialog'u · Yazdır = MVP/Faz A · Split = v5.1 (Quick Pay + tam Öde MVP). Faz A başlayabilir.

### Gerekli Amendment'ler (bu ADR İŞARET EDER — gövdeler ayrıca uygulanacak, bu ADR mevcut ADR'leri DEĞİŞTİRMEZ)

> Aşağıdaki taslaklar amendment **niyetini** sabitler. Karar onaylanınca implementer/architect ilgili ADR gövdelerine ekler (Amendment History deseni). Bu ADR yalnız decisions.md'ye eklenir.

- **Charter §78 — KISMİ reversal (taslak):** "Mobil = garson; ödeme/iptal/comp YOK" → "Mobil = garson + kısmi operasyonel terminal; **ödeme (Öde/Hızlı Öde) + on-demand adisyon baskı + masa-yönetimi (move/merge/transfer) AÇIK** (ADR-027); **iptal/comp/müşteri-ata KAPALI**." (Faz B aksiyonları MVP'de değilse "v5.1" notuyla.)
- **ADR-025 K1 (taslak):** "saf garson, 3 ekran, ödeme/iptal/comp YOK" → "ADR-027 ile 6 operasyonel aksiyon (ödeme/baskı/masa-yönetimi) eklenir; iptal/comp KAPALI kalır."
- **ADR-026 K6 (taslak):** RENDER EDİLMEYECEKLER listesinden **Ödeme/Hızlı Öde + Yazdır + Taşı (transfer)** çıkarılır (artık 3-nokta sheet'te render edilir, ADR-027 K4). **İptal + İkram (comp) toggle + Müşteri ata RENDER EDİLMEZ kalır.** Satır 3-nokta menüsü (kalem-düzeyi) ≠ kart/başlık 3-nokta (operasyonel) — karıştırma; kalem void owner-guard değişmez.
- **ADR-008 §7 (taslak — yeni §7e Amendment):** Garson ABAC genişler: `payments.create`/`payments.read` (`POST /payments` + GET'ler) + `tables.move`/`tables.merge`/`orders.transferBill` (Faz B) garsona açılır. **comp/void/sipariş-iptali KAPALI kalır (§7c değişmez); cross-tenant ASLA.** Gate: security-reviewer.

### Kapsam kilidi (bu ADR'nin DIŞINDA / v5.1)

- **İptal Et / İkram (comp) / Müşteri Ata mobilde** — garson kademesinde ASLA (K2/D); admin/cashier'da kalır.
- **Masayı Değiştir / Birleştir / Adisyon Aktar** — Faz B, her biri kendi ADR; muhtemelen v5.1 (K5/K6).
- **PIN / cihaz eşleştirme** — v5.1 (ADR-025 K6, charter §90); K3 onay dialog'u PIN'in yerine geçmez ama MVP-yeterli.
- **Split payment mobil UI** — v5.1 (ürün sahibi onayladı 2026-06-29; Quick Pay + tam Öde MVP).
- **Refund / uncomp** — kapsam dışı (ADR-014/ADR-024 v5.1).

### Uygulama Planı / İş Kalemleri (sıralı — branch-first, DoD, CI yeşil olmadan merge YOK)

**Faz A (backend HAZIR — MVP):**
1. **ADR-027** (bu doküman — ✅ Accepted 2026-06-29, 3 açık karar çözüldü) + 4 amendment uygulandı (charter §78 / ADR-025 K1 / ADR-026 K6 / ADR-008 §7e). Gate: architect.
2. **ABAC genişletme: `payments.create` + `payments.read` → `+waiter`** (`apps/api/src/routes/payments.ts` authorize + `packages/shared-types/src/permissions.ts` matrix + ADR-008 §7e). Gate: implementer + **security-reviewer** (parasal yetki + IDOR) + db-migration-guard (permission seed varsa).
3. **On-demand adisyon baskı endpoint** (`print.bill` permission + enqueue endpoint, ADR-004 render reuse, audit). Gate: implementer + **security-reviewer** (yeni endpoint) + db-migration-guard.
4. **Mobil 3-nokta bottom-sheet + Öde/Hızlı Öde UI + Yazdır + K3 onay dialog'u** (Masalar dolu kart + Order başlık; ADR-026 görsel dili; i18n key'ler). Gate: implementer + **hci-reviewer + turkish-ux-reviewer + i18n-key-checker** + security-reviewer (parasal UI).

**Faz B (backend YOK — her biri kendi sprint, muhtemelen v5.1):**
5. **ADR-028 (rezerv): Masayı Değiştir** — domain + migration + endpoint + ABAC + UI + test (v3 paritesi, en basit).
6. **ADR-029 (rezerv): Masaları Birleştir** — invariant-zorlayan, kenar-durum ağır.
7. **ADR-030 (rezerv): Adisyon Aktar** — kalem-düzeyi split, en karmaşık.

### Cross-ref tablosu

| Konu | Kaynak | Doğrulanan içerik |
|---|---|---|
| `POST /payments` admin/cashier (garson 403) | `apps/api/src/routes/payments.ts:47,204,231` | ✓ kodda tespit (`authorize(['admin','cashier'])`) |
| Idempotency-Key header+body | `payments.ts:48-55` (ADR-014 §10.10) | ✓ |
| Print yalnız agent-facing + KDS auto-enqueue; on-demand bill endpoint YOK | `print-jobs.ts` (jobs/next, result, agent/register/refresh) + `enqueueKitchenJob` | ✓ kodda tespit |
| tables.ts CRUD-only (move/merge YOK) | `tables.ts` (POST/GET/PATCH/:id/DELETE/PATCH :id/area) | ✓ |
| orders.ts'de move/merge/transfer route YOK | `orders.ts` (yalnız enqueueKitchenJob import eşleşti) | ✓ |
| v3 masa transfer davranışı (hedef boş, order taşı, audit+emit) | `D:\dev\restoran-pos-v3\server\routes\tables.js:107-140` | ✓ (v3 davranış özeti) |
| Garson ödeme/comp/iptal `—` (RBAC) | ADR-002 §6 + ADR-008 §7c | ✓ |
| comp/void audit yazılır, aktör=req.user.sub | ADR-024 K2/K3 | ✓ |
| Mobil = garson, ödeme/iptal/comp YOK | charter §78 | ✓ (KISMİ reversal işaretlendi) |
| Frontend explicit gating, void owner-guard | ADR-026 K6 + ADR-008 §7b | ✓ (amendment işaretlendi) |

<!-- ADR-027 Accepted (2026-06-29) — architect sub-agent + ürün sahibi 3 karar onayı; Mobil Operasyonel Terminal Genişlemesi (3-nokta aksiyon menüsü); mobil saf-garson → kısmi POS terminali; 6 aksiyon AÇIK (Öde/Hızlı Öde/Yazdır/Masayı Değiştir/Birleştir/Adisyon Aktar), 3 KAPALI (İptal/İkram-comp/Müşteri Ata garson ASLA); gerekçe v3 paritesi + ürün sahibi kararı (kapsam kilidi açık gerekçe); K1 kapsam genişleme + MVP/v5.1 matrisi; K2 ABAC payments.create/read+waiter + print.bill + tables.move/merge/orders.transferBill (Faz B), comp/void/iptal/müşteri-ata KAPALI, cross-tenant ASLA; K3 audit zorunlu (ADR-024 reuse, garson ödeme otomatik audit) + PIN/onay KARAR BEKLİYOR (architect öneri: hafif onay dialog b); K4 3-nokta bottom-sheet (dolu masa kartı + Order başlık, ADR-026 K1 sheet paterni, Faz B render edilmez backend gelene dek); K5 fazlama A=backend HAZIR (Öde/Hızlı Öde ABAC + Yazdır endpoint) B=backend YOK (move/merge/transfer kendi ADR+migration+test, muhtemelen v5.1); K6 Faz B domain notu (masada-tek-aktif-sipariş invariant + KDS + print, move v3-pariteli basit, merge invariant-zorlayan, transfer kalem-split en karmaşık); backend denetimi: payments VAR(ABAC kapalı) / print agent-only on-demand-bill YOK / tables CRUD-only / orders move-merge-transfer YOK; amendment İŞARET (charter §78 kısmi reversal / ADR-025 K1 / ADR-026 K6 / ADR-008 §7e) gövde ayrı uygulanır; iş kalemleri Faz A 4 PR (ADR+amendment / payments ABAC / print.bill endpoint / mobil sheet+ödeme UI) gate security-reviewer+hci+turkish-ux+i18n+db-migration-guard, Faz B ADR-028/029/030 rezerv; kararlar onaylandı 2026-06-29: K3 onay-dialog(b) / Yazdır MVP-FazA / Split v5.1; reddedilen: saf-garson-tut / hepsi-tek-MVP / ödeme-talebi-2aşama / iptal-comp-aç / web-403-render-all -->

---

## ADR-028 — Masayı Değiştir (Aktif Siparişi Boş Masaya Taşıma)

- **Durum**: Accepted (2026-07-01 — ADR-027 Faz B'nin en basit aksiyonu; v3 paritesi net, invariant korunur, migration gerekmez)
- **Tarih**: 2026-07-01
- **Bağlı ADR'lar**: ADR-027 (Faz B umbrella — K5/K6 move v3-pariteli en basit aksiyon, ADR-028 rezerv); ADR-003 §7 (snapshot invariant — `table_code_snapshot`/`area_name_snapshot`); ADR-009 + Amendment 2026-05-05 (areas/masa domain, hard-delete + snapshot pattern) + Amendment 2026-06-30 (bölge-guard); ADR-008 §7e (garson ABAC genişleme — `tables.move` garsona açık, cross-tenant ASLA); ADR-002 §6 (RBAC role matrix); ADR-006 (error envelope + message key registry); ADR-010 §11.6 (`tables.changed` invalidate-only realtime); ADR-024 (audit event deseni — entity.verb 2-segment, PII-safe payload); ADR-014 (masada-tek-aktif-sipariş + ödeme bütünlüğü). Charter §78 (mobil kısmi operasyonel terminal — ADR-027 ile masa-yönetimi AÇIK).

### Bağlam

**Neden karar gerekiyor:** ADR-027 K5/K6, "Masayı Değiştir" aksiyonunu Faz B olarak rezerve etti (backend YOK, kendi ADR + tasarım gerekir) ve ADR-028'i bunun için ayırdı. Bu aksiyon = **bir masanın tek aktif dine-in siparişini, aynı tenant içinde BAŞKA bir BOŞ masaya taşımak.** Müşteri yemek ortasında masa değiştirdiğinde (kalabalık, pencere kenarı isteği, masa arızası) operasyonel bir zorunluluk. Şu an v5'te böyle bir akış yok: siparişi iptal edip yeniden açmak veri bütünlüğünü (öncelik #2) bozar ve rapor/KDS/ödeme geçmişini kırar.

**Kapsam kilidi gerekçesi (CLAUDE.md core directive 6 — açık gerekçe zorunlu):** Masa değiştirme **v5.0 MVP listesinde DEĞİL.** Ancak (a) **v3 paritesi** — v3 masa ekranında "masa taşı/değiştir" vardı (`D:\dev\restoran-pos-v3\server\routes\tables.js:107-140` `POST /:id/transfer`: hedef masa boş olmalı, `orders.table_id` güncellenir, atomik, audit + `table:transferred` emit; **swap/merge YOK**) ve (b) ADR-027 mobil operasyonel terminal + web kasiyer için gerçek operasyonel ihtiyaç (yoğun saatte kasaya koşmadan masa taşıma, öncelik #3). Bu ADR, kapsam kilidinin gerektirdiği **açık gerekçedir**; feature ADR-027 Faz B şemsiyesi altında teslim edilen bir **v3-parite operasyonel özelliktir.** Durum = **Accepted.**

**Kapsam kilidi — swap/merge DIŞARIDA:** Bu ADR **yalnız move-to-empty** (tek aktif siparişi boş masaya). **İki dolu masanın yer değiştirmesi (swap) ve iki siparişin birleşmesi (merge) DIŞARIDA → ADR-029/030.** Bu v3'e birebir uyar: v3'te de yalnız move-to-empty vardı, swap/merge yoktu (`tables.js:107-140` doğrulandı).

**Backend denetimi (architect kodu okudu — file:line teyitli):**
- `orders.table_id` UUID nullable; composite FK `(tenant_id, table_id) → tables(tenant_id, id)` `ON DELETE SET NULL` (Migration 032:30-35).
- Aktif sipariş = `status NOT IN ('paid','cancelled','void')` (`TERMINAL_ORDER_STATUSES`, `packages/db/src/repositories/orders.ts:153-157`).
- Masa doluluk **türetilmiştir** (`tables.status` kolonu YOK); tahta aktif siparişlere LEFT JOIN yapar (`packages/db/src/repositories/tables.ts:150-217`).
- **Invariant atomik zorlanır:** partial unique index `orders_tenant_table_open_uq ON orders (tenant_id, table_id) WHERE status NOT IN ('paid','cancelled','void')` (Migration 041). App-level ön-kontrol `orders.ts:530-544` → `RepositoryError('unique','TABLE_ALREADY_OCCUPIED')` → 409.
- **VERIFY #1 — snapshot kolonları UPDATE edilebilir mi?** `orders.table_code_snapshot` + `orders.area_name_snapshot` `TEXT NULL`, application-level doldurulur (Migration 032:24-26, trigger değil). `orders_reject_temporal_update` trigger'ı (`000_init.sql:86-97`) **YALNIZCA `created_at` + `store_date`** append-only guard eder; `table_id` / snapshot kolonlarına DOKUNMAZ. → Snapshot'lar serbestçe UPDATE edilebilir. **Karar C güvenli — taşımada hedef masanın etiketi + bölge adı yazılır.**
- **VERIFY #2 — audit event_type CHECK migration gerektirir mi?** `audit_logs.event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$')` (`000_init.sql:360-361`) — **allow-list DEĞİL, 2-segment regex.** `order.table_changed` (`order` + `table_changed`) regex'e uyar. **→ MIGRATION GEREKMEZ.** Ayrıca `audit_logs_payload_no_pii` CHECK (`000_init.sql:367+`) PII anahtar listesi reddeder; taşıma payload'ı (`from_table_id`/`to_table_id`/`from_table_code`/`to_table_code`) PII-safe.
- **VERIFY #3 — area_name_snapshot türetimi.** Sipariş create'te snapshot handler-level türetilir: `tables JOIN areas` ile `t.code`, `t.area_id`, `t.display_no`, `areas.name` çekilir; `tableCodeSnapshot = tableLabel({code, area_id, display_no})` helper'ından, `areaNameSnapshot = areas.name` (`orders.ts:889-913`). Masa yoksa/orphan ise NULL. **→ Taşıma AYNI türetimi yeniden kullanır** (hedef masa için `tableLabel()` + `areas.name`; hedef bölgesiz/area_id NULL → `areaNameSnapshot = NULL`). Ham `tables.code` DEĞİL, `tableLabel()` kullanılır (tahta render'ıyla tutarlı olsun).
- **Attribute-patch presedenti:** `PATCH /orders/:orderId/customer` → `orders.customerAssigned` emit (`apps/api/src/routes/orders.ts:1337`). Endpoint şekli bunun ikizi olur.
- **Realtime:** `emitToTenant(deps,{io,eventName,payloadSchema}, tenantId, payload)` (`apps/api/src/realtime/emit.ts:39-45`); io router deps üzerinden geçer (`deps.io === undefined → no-op`, test-safe). `tables.changed` payload = `{action:'created'|'updated'|'deleted'|'area_assigned', tableId}` **INVALIDATE-ONLY** (`packages/shared-types/src/realtime.ts:210-214`); web `TablesListPage` bunda `['tables']` invalidate eder.

### Karar

#### Karar A — Endpoint: `PATCH /orders/:orderId/table`

Orders router'ında `PATCH /orders/:orderId/table`, body `{ tableId: string (uuid) }`. `PATCH /orders/:orderId/customer` presedentini birebir yansıtır (attribute-patch deseni). 200 + güncellenmiş sipariş projeksiyonu döner (order-get'in döndürdüğü aynı shape). Backend/endpoint **paylaşımlı** — mobil garson terminali + web kasiyer aynı endpoint'i tüketir (ürün sahibi kararı: mobil + web parite; PR-1 tek backend).

#### Karar B — Validation sırası + hata kodları (her biri: HTTP + code + i18n key)

Sıra önemli (ucuz → pahalı, güvenlik → bütünlük):

1. **Sipariş var + tenant-scoped mı?** → değilse **404 `ORDER_NOT_FOUND`** (`error.order.notFound`). Cross-tenant sipariş = 404 (varlık sızıntısı yok).
2. **`order_type === 'dine_in'` mi?** → değilse **409 `ORDER_NOT_DINE_IN`** (`error.order.notDineIn`). Takeaway/delivery'nin masası yok — taşınamaz.
3. **status terminal DEĞİL mi?** (`NOT IN ('paid','cancelled','void')`) → değilse **409 `ORDER_ALREADY_CLOSED`** (`error.order.alreadyClosed`). Kapalı/ödenmiş sipariş taşınamaz.
4. **Hedef masa var + tenant-scoped + `deleted_at IS NULL` mi?** → değilse **404 `TABLE_NOT_FOUND`** (mevcut `error.table.notFound`, registry'de VAR).
5. **`tableId !== order.table_id` mi?** → değilse **409 `TABLE_MOVE_SAME_TABLE`** (`error.table.moveSameTable`). No-op taşıma reddedilir (v3 aynı masayı reddederdi).
6. **Hedef masa boş mu?** → app-level ön-kontrol (`hasActiveOrders`-tarzı repo sorgusu) → değilse **409 `TABLE_ALREADY_OCCUPIED`** (mevcut `error.table.alreadyOccupied`, registry'de VAR); **VE** partial unique index atomik backstop (23505 → aynı 409).

> **errors.ts sapması (architect kodu okudu):** `ORDER_NOT_FOUND`, `ORDER_NOT_DINE_IN`, `ORDER_ALREADY_CLOSED`, `TABLE_MOVE_SAME_TABLE` registry'de **YOK** → PR-1'de `AUTH_MESSAGE_KEYS`'e eklenir (`error.<domain>.<camelCase>` konvansiyonu, `apps/api/src/errors.ts:57-155`). `TABLE_NOT_FOUND` + `TABLE_ALREADY_OCCUPIED` **VAR** — reuse. (Öneride "reuse an existing terminal-guard code" denmişti; kod incelemesi gösterdi ki generic terminal-guard kodu yok → yeni `ORDER_ALREADY_CLOSED` gerekli.)

#### Karar C — Mutasyon: tek transaction

Tek tx içinde: **SELECT order FOR UPDATE** (satır kilidi, race önlem) → yukarıdaki validation'ları tx-içi re-validate → `UPDATE orders SET table_id = :target, table_code_snapshot = tableLabel(hedef), area_name_snapshot = <hedef areas.name veya NULL>` → audit yaz `order.table_changed` payload `{from_table_id, to_table_id, from_table_code, to_table_code}` actor = `req.user` (userId/sub) → commit.

- `updated_at` `orders_set_updated_at` trigger'ıyla **otomatik bump** — elle set edilmez.
- `created_at` / `store_date` DOKUNULMAZ → `orders_reject_temporal_update` trigger tetiklenmez (VERIFY #1).
- Snapshot türetimi create'teki `tableLabel()` + `areas.name` deriv'iyle **birebir aynı** (VERIFY #3) — rapor/tahta tutarlılığı korunur; hedef orphan/bölgesiz ise `area_name_snapshot = NULL`.
- Partial unique index ihlali (concurrent occupy) → `RepositoryError('unique','TABLE_ALREADY_OCCUPIED')` catch → 409 (Karar B.6 ile aynı).

#### Karar D — Realtime: mevcut `tables.changed` `updated` action reuse (İKİ emit)

Commit'ten sonra **İKİ `tables.changed {action:'updated', tableId}`** emit edilir: kaynak masa + hedef masa (ikisi de artık farklı doluluk gösterir). Mevcut `updated` action reuse → **realtime schema değişmez.** `orders.statusChanged` emit **EDİLMEZ** (sipariş status'u değişmedi; kontrat temiz kalır — sadece masa değişti).

**Yeni action/event REDDEDİLDİ:** `tables.changed`'e yeni `order_moved` action VEYA yeni `orders.tableChanged` event eklenmesi gereksiz. Gerekçe: (i) `tables.changed` invalidate-only — payload zaten "şu masayı yeniden çek" diyor, taşıma da tam olarak bu; (ii) 2-segment isimlendirme + minimal yüzey (ADR-010 §11.6); (iii) yeni action tüm consumer'ların (web + mobil) exhaustive switch'ini kırar, sıfır fayda. İki `updated` emit yeterli ve semantik olarak doğru.

> **Not (kapsam DIŞI, mevcut boşluk):** Mobil tahtada `tables.changed` listener'ı YOK (refetch-on-focus). Bu ADR-öncesi boşluk; ADR-028 kapsamında değil. Mobil client PR-2, taşıma sonrası kendi `['tables']`/`['orders']` invalidate'ini yapar (Karar H).

#### Karar E — Permission: yeni `orders.move` action

`packages/shared-types/src/permissions.ts`'e yeni Action `'orders.move'` eklenir; **admin + cashier + waiter** Set'lerine grant (kitchen'a DEĞİL). Route `authorize(['admin','cashier','waiter'])`. Bu ADR-027 K2 + ADR-008 §7e "garson masa-yönetimi açık, comp/void/iptal KAPALI" ile uyumlu (masa taşıma parasal olmayan, düşük-risk operasyonel aksiyon). Cross-tenant ASLA — her sorgu `tenant_id` WHERE.

> **İsimlendirme notu:** ADR-027 K2 taslakta `tables.move` demişti; architect `orders.move` öneriyor (aksiyon sipariş mutasyonudur — masa CRUD değil, sipariş `table_id` patch'i; endpoint de orders router'ında). Ürün sahibi/architect nihai: **`orders.move`** (endpoint domain'iyle tutarlı). ADR-008 §7e amendment gövdesi bu ismi kullanmalı.

#### Karar F — Migration: GEREKMEZ

Şema değişikliği YOK: partial unique index (041), snapshot kolonları (032), `audit_logs.event_type` regex CHECK (000_init) ve `order.table_changed` event'i mevcut kısıtları geçer (VERIFY #1/#2/#3). **Sıfır migration.** (Öneride "NONE required IF VERIFY #2 passes" denmişti; VERIFY #2 GEÇTİ → migration yok.) → PR-1'de db-migration-guard gate'i "migration yok, gerekmez" doğrulamasıyla kapanır (yeni permission de seed-migration değil, kod-içi Set).

#### Karar G — shared-types

- `packages/shared-types/src/permissions.ts`: `'orders.move'` Action + 3 role Set'ine (admin/cashier/waiter) ekle.
- `packages/shared-types/src/order.ts`: `OrderMoveTableRequestSchema = z.object({ tableId: z.string().uuid() })` + inferred type.
- `realtime.ts` değişmez (Karar D — mevcut `tables.changed` reuse).

#### Karar H — Client UI (mobil + web parite)

- **Mobil:** Dolu-masa 3-nokta sheet'inde (`TableActionsController`, PR #227) yeni **"Masayı Değiştir"** aksiyonu → hedef-masa seçici (BOŞ masalar bölgeye göre gruplu) → hafif onay ("Masa X → Masa Y taşınsın mı?") → PATCH → `['tables']` + `['orders']` invalidate.
- **Web:** Masa tahtası dolu-masa kartında AYNI "Masayı Değiştir" aksiyonu → aynı seçici + onay + invalidate.
- Tüm metinler i18n key (TR). Onay dialog'u **yüksek-etkili-ama-parasal-değil** kategori (ADR-027 K3'teki parasal onay dialog'undan farklı; masa taşıma parasal değil ama yanlış-taşıma da operasyonel karışıklık yaratır → tek-dokunuş onay). Nihai UX kararı **hci-reviewer**'ın (onay dialog'unun tam şekli/metni).

#### Karar I — Alt-PR kırılımı

- **PR-1 (backend, paylaşımlı):** `orders.move` permission + `PATCH /orders/:orderId/table` endpoint + repo move metodu + `OrderMoveTableRequestSchema` + 2× `tables.changed` emit + `order.table_changed` audit + 4 yeni error key + integration testler. **Migration YOK (Karar F).**
- **PR-2 (mobil UI):** 3-nokta sheet aksiyonu + hedef-masa seçici + onay + invalidate.
- **PR-3 (web UI):** tahta kartı aksiyonu + seçici + onay + invalidate.
- Her biri kendi branch (branch-first), kendi DoD, kendi reviewer'ları.

#### Karar J — DoD / reviewer gate'leri

- **kapsam-kilidi:** bu ADR ile gerekçelendirildi (v3 paritesi + ADR-027 Faz B).
- **db-migration-guard:** PR-1'de "migration gerekmez" doğrulaması (Karar F).
- **security-reviewer:** PR-1 zorunlu — sipariş mutasyonu auth (`orders.move` RBAC) + tenant izolasyon (cross-tenant 404) + IDOR yüzeyi.
- **hci-reviewer + turkish-ux-reviewer + i18n-key-checker:** UI PR'ları (PR-2/3).
- **qa-engineer:** test matrisi (aşağı Sonuç).
- CI yeşil olmadan merge YOK.

### Alternatifler

- **A — Ayrı `tables` router endpoint (`POST /tables/:id/transfer`, v3 birebir):** REDDEDİLDİ — v3 route masa-merkezliydi ama v5'te doluluk türetilmiş (`tables.status` yok) ve mutasyon `orders.table_id` üzerinde. Sipariş-merkezli `PATCH /orders/:orderId/table` mevcut `PATCH /orders/:orderId/customer` presedentine uyar, semantik daha doğru.
- **B — Yeni realtime `order_moved` action / `orders.tableChanged` event:** REDDEDİLDİ — Karar D. `tables.changed` invalidate-only zaten yeterli; yeni action tüm exhaustive consumer switch'lerini sıfır faydayla kırar.
- **C — Migration ile `event_type`'a allow-list + yeni değer:** GEREKSİZ — VERIFY #2: event_type regex-CHECK (allow-list değil), `order.table_changed` geçer. Sıfır migration.
- **D — Swap/merge'i bu ADR'ye dahil et:** REDDEDİLDİ — kapsam kilidi; v3'te de yoktu; invariant-zorlayan/kalem-split karmaşıklığı ayrı ADR gerektirir (ADR-029/030, ADR-027 K6).
- **E — Snapshot'ları taşımada güncelleme (eski masa etiketini koru):** REDDEDİLDİ — snapshot'ın amacı raporun **siparişin fiilen bulunduğu masayı** göstermesi (ADR-003 §7). Taşıma sonrası eski etiket rapor/fiş tutarsızlığı yaratır. Snapshot hedef masaya güncellenir (Karar C).
- **F — `orders.statusChanged` de emit et:** REDDEDİLDİ — sipariş status'u değişmedi; kontratı gereksiz kirletir (Karar D).

### Sonuçlar / Riskler

- (+) Müşteri masa değiştirdiğinde sipariş/ödeme/KDS/rapor bütünlüğü korunarak taşınır (öncelik #2) — iptal-yeniden-aç anti-pattern'i önlenir.
- (+) v3 paritesi + ADR-027 operasyonel ihtiyaç karşılanır; garson/kasiyer kasaya koşmadan taşır (öncelik #3).
- (+) **Reuse-ağırlıklı, sıfır migration:** mevcut FK + partial unique index + snapshot kolonları + audit regex CHECK hepsi hazır. Yeni yüzey: 1 endpoint + 1 permission + 1 schema + 4 error key.
- (+) Realtime yüzeyi minimal: mevcut `tables.changed updated` reuse, schema değişmez.
- (−) Sipariş mutasyon yetkisi genişler (`orders.move` garsona açık) → IDOR/yanlış-taşıma yüzeyi. Mitigasyon: security-reviewer gate + tenant-scope 404 + audit (`order.table_changed` her taşıma kanıtlı) + onay dialog + boş-masa guard (index + app-level).
- (−) Concurrent occupy race (iki client aynı boş masaya taşır): partial unique index atomik reddeder (ikincisi 409). Ölümsüz garanti değil ama veri bütünlüğü index'te kilitli.
- (−) Mobil tahta realtime listener boşluğu (ADR-öncesi) taşımada da geçerli — PR-2 lokal invalidate ile maskeler; gerçek mobil board realtime ayrı iş (kapsam dışı).

### Test matrisi (qa — PR-1 integration; `apps/api/src/__tests__/realtime-emits.test.ts` harness: `createMockIo`/`findEmit`/`routedTo`/`clearEmits`, `insertTable()`, `loginAndGetToken`, `E2E_BYPASS_LOGIN_LIMIT`)

- **happy:** 200 → `table_id` + `table_code_snapshot` + `area_name_snapshot` güncellendi + audit satırı (`order.table_changed`, doğru payload, actor) + **2× `tables.changed`** emit (doğru `tableId`'ler = kaynak+hedef, doğru tenant room).
- **hedef dolu:** 409 `TABLE_ALREADY_OCCUPIED`.
- **hedef yok / cross-tenant:** 404 `TABLE_NOT_FOUND`.
- **sipariş yok / cross-tenant:** 404 `ORDER_NOT_FOUND`.
- **takeaway sipariş:** 409 `ORDER_NOT_DINE_IN`.
- **kapalı/ödenmiş sipariş:** 409 `ORDER_ALREADY_CLOSED`.
- **aynı masa:** 409 `TABLE_MOVE_SAME_TABLE`.
- **RBAC:** waiter → 200 (izinli); kitchen → 403 (yasak).
- **snapshot NULL:** hedef orphan/bölgesiz masa → `area_name_snapshot = NULL` doğrulanır.

### Kapsam kilidi (bu ADR'nin DIŞINDA)

- **Swap (iki dolu masa yer değiştir):** ADR-029 (rezerv).
- **Merge (iki sipariş birleştir):** ADR-030 (rezerv, invariant-zorlayan).
- **Adisyon Aktar (kalem-düzeyi split):** ADR-027 K6 / ADR-030 ailesi (en karmaşık).
- **Mobil board realtime listener:** ADR-öncesi boşluk, ayrı iş.
- **Move geçmişi/undo:** kapsam dışı (audit `order.table_changed` forensic kayıt yeter; undo v5.1+).

### Cross-ref tablosu

| Konu | Kaynak | Doğrulanan içerik |
|---|---|---|
| `orders.table_id` nullable + composite FK ON DELETE SET NULL | `packages/db/migrations/032_orders_table_snapshot_and_fk_set_null.sql:24-35` | ✓ kodda tespit |
| Aktif sipariş = status NOT IN paid/cancelled/void | `packages/db/src/repositories/orders.ts:153-157` | ✓ |
| Masa doluluk türetilmiş (tables.status yok) | `packages/db/src/repositories/tables.ts:150-217` | ✓ |
| Partial unique index (atomik invariant) | Migration 041 `orders_tenant_table_open_uq` | ✓ |
| App-level TABLE_ALREADY_OCCUPIED pre-check | `orders.ts:530-544` | ✓ |
| Snapshot kolonları UPDATE-able (trigger sadece created_at/store_date) | `000_init.sql:86-97` (reject_temporal_update) + Migration 032:24-26 | ✓ VERIFY #1 |
| event_type CHECK = 2-segment regex (allow-list DEĞİL) → migration YOK | `000_init.sql:360-361` `^[a-z_]+\.[a-z_]+$` | ✓ VERIFY #2 |
| snapshot türetimi = tableLabel() + areas.name at create | `orders.ts:889-913` | ✓ VERIFY #3 |
| payload_no_pii CHECK (taşıma payload PII-safe) | `000_init.sql:367+` | ✓ |
| PATCH customer presedenti (attribute-patch shape) | `orders.ts:1337` `orders.customerAssigned` emit | ✓ |
| emitToTenant io-threading + no-op test-safe | `apps/api/src/realtime/emit.ts:39-45` | ✓ |
| tables.changed invalidate-only + action union | `packages/shared-types/src/realtime.ts:210-214` | ✓ |
| errors.ts: ORDER_NOT_FOUND/NOT_DINE_IN/ALREADY_CLOSED/MOVE_SAME_TABLE YOK (yeni); TABLE_NOT_FOUND/ALREADY_OCCUPIED VAR | `apps/api/src/errors.ts:57-155` | ✓ sapma tespit |
| v3 move-to-empty (swap/merge YOK) | `D:\dev\restoran-pos-v3\server\routes\tables.js:107-140` | ✓ (v3 davranış özeti) |
| Garson masa-yönetimi ABAC açık, comp/void/iptal KAPALI | ADR-027 K2 + ADR-008 §7e | ✓ |

### Gerekli Amendment'ler (bu ADR İŞARET EDER — gövdeler ayrıca uygulanacak)

- **ADR-008 §7e (taslak):** Garson ABAC listesinde `tables.move` yerine `orders.move` yazılır (Karar E isimlendirme kararı; endpoint orders router'ında, aksiyon sipariş mutasyonu). comp/void/iptal KAPALI kalır (§7c değişmez); cross-tenant ASLA.
- **ADR-027 K5/K6 (taslak):** "Masayı Değiştir Faz B rezerv" → "ADR-028 ile teslim edildi (Accepted 2026-07-01); endpoint `PATCH /orders/:orderId/table`, permission `orders.move`, sıfır migration."

<!-- ADR-028 Accepted (2026-07-01) — architect sub-agent; Masayı Değiştir (aktif dine-in siparişi boş masaya taşıma); ADR-027 Faz B'nin en basit aksiyonu, v3 paritesi (move-to-empty, swap/merge YOK → ADR-029/030); kapsam kilidi gerekçe = v3 paritesi + ADR-027 operasyonel ihtiyaç; VERIFY #1 snapshot kolonları UPDATE-able (reject_temporal_update sadece created_at/store_date guard) / VERIFY #2 event_type 2-segment regex CHECK order.table_changed geçer → MIGRATION YOK / VERIFY #3 snapshot tableLabel()+areas.name deriv taşımada reuse; Karar A endpoint PATCH /orders/:orderId/table body {tableId} (customer-patch presedenti, mobil+web parite tek backend); Karar B validation 6-adım + kodlar 404 ORDER_NOT_FOUND / 409 ORDER_NOT_DINE_IN / 409 ORDER_ALREADY_CLOSED / 404 TABLE_NOT_FOUND(var) / 409 TABLE_MOVE_SAME_TABLE / 409 TABLE_ALREADY_OCCUPIED(var+index) — errors.ts sapma: 4 kod YENİ (order.notFound/notDineIn/alreadyClosed + table.moveSameTable), TABLE_NOT_FOUND+ALREADY_OCCUPIED VAR reuse; Karar C tek-tx SELECT FOR UPDATE + re-validate + UPDATE table_id+snapshot(tableLabel/areas.name) + audit order.table_changed {from/to_table_id,from/to_table_code} + updated_at auto-bump + 23505→409; Karar D 2× tables.changed{action:updated} kaynak+hedef reuse (schema değişmez), orders.statusChanged EMIT ETME, yeni order_moved action/orders.tableChanged event REDDEDİLDİ; Karar E permission orders.move admin+cashier+waiter (kitchen değil), authorize; Karar F MIGRATION YOK (index+snapshot+regex CHECK hazır); Karar G shared-types permissions.ts orders.move + order.ts OrderMoveTableRequestSchema, realtime.ts değişmez; Karar H UI mobil TableActionsController + web tahta kartı, hedef-masa seçici (boş masalar bölge gruplu) + hafif onay + invalidate ['tables']+['orders'], i18n TR, hci-reviewer nihai; Karar I 3 PR (backend paylaşımlı / mobil / web); Karar J gate kapsam-kilidi+db-migration-guard(yok doğrula)+security-reviewer(PR-1)+hci/turkish-ux/i18n(UI)+qa; test matrisi 10 case (happy 2emit+audit / dolu409 / hedef404 / sipariş404 / takeaway409 / kapalı409 / aynı-masa409 / RBAC waiter200 kitchen403 / snapshot NULL); reddedilen: ayrı tables router / yeni realtime action / event_type allow-list migration / swap-merge dahil / eski etiket koru / statusChanged emit; amendment İŞARET ADR-008 §7e(orders.move) + ADR-027 K5/K6(teslim edildi) -->

---

## ADR-029 — Adisyon Birleştir (Dolu Masanın Adisyonunu Başka Dolu Masaya Aktar/Merge)

- **Durum**: Accepted (2026-07-03 — ADR-027 Faz B rezervi; ADR-028 "Masayı Değiştir" ikizi ama hedef DOLU + kalemler re-parent; tüm kullanıcı-onaylı kararlar (K2/K3) kilitli + v3 referans gate'i bu oturumda çözüldü — migration mekaniği PR-1'de db-migration-guard'la doğrulanacak)
- **Tarih**: 2026-07-03 (Session 79)
- **Bağlı ADR'lar**: ADR-028 (İKİZ — "Masayı Değiştir" endpoint/tx/UI paterni birebir baz; fark: hedef DOLU, kalemler re-parent, kaynak terminal olur); ADR-027 K5/K6 (Faz B umbrella — "Adisyon Aktar/merge" rezerve edilmişti + masada-tek-aktif-sipariş invariant); ADR-014 (masada-tek-aktif-sipariş + ödeme bütünlüğü — `payments` guard'ı buradan); ADR-013 (`order_items` domain — re-parent hedefi + `total_cents` recalc formülü); ADR-008 §7e (garson ABAC role-only, ownership YOK — `orders.merge` `orders.move` aynası, cross-tenant ASLA); ADR-002 §6 (RBAC role matrix) + §10.4 (audit-same-tx); ADR-006 §5.2 (error envelope + `AUTH_MESSAGE_KEYS` registry-completeness); ADR-010 §11.6 (`tables.changed` invalidate-only realtime); ADR-024 (audit event deseni — entity.verb 2-segment, PII-safe payload); ADR-003 §7 (snapshot invariant — re-parent'te snapshot kolonları DOKUNULMAZ). Charter §78 (mobil kısmi operasyonel terminal — ADR-027 ile masa-yönetimi AÇIK). Ürün Sınırı (CLAUDE.md core directive 6 — bu ADR ile açık kapsam kararı).

### Bağlam

**Neden karar gerekiyor:** ADR-027 K5/K6, "Adisyon Aktar/merge" aksiyonunu Faz B olarak rezerve etti ve ADR-029/030 ailesine bıraktı. Kullanıcı isteği (Session 78): "Adisyon Aktar = 2 farklı **dolu** masayı ürün ve tutar bazında birleştirme." Masalar ekranında dolu masa kartı 3-nokta → **Adisyon Aktar** → hedef (dolu) masa seç → kaynak masanın tüm ürünleri + hesabı hedef adisyona eklenir, kaynak masa boşalır. Hem mobil (garson) hem web (kasiyer). İki müşteri grubunun masaları birleşmesi (arkadaş grubu tek hesap ister, iki masa yan yana çekilir) yaygın restoran operasyonu; şu an v5'te tek yol siparişi iptal edip yeniden açmak → veri bütünlüğünü (öncelik #2) + rapor/KDS/ödeme geçmişini bozar.

**v3 referans bulgusu (Session 79 — kullanıcı gözlemi):** **v3'te masa/adisyon birleştirme özelliği YOKTU.** v3 yalnız move-to-empty (ADR-028'in bazı) sunuyordu (`D:\dev\restoran-pos-v3\server\routes\tables.js:107-140`: transfer hedefi boş olmalı — swap/merge YOK). Sonuç: ADR-029 **tamamen YENİ bir v5.1 yeteneğidir** → bu ADR ile v5.1 kapsamına **AÇIKÇA** alınır (CLAUDE.md Ürün Sınırı uyumlu, sessiz kapsam büyümesi DEĞİL — core directive 6 gereği açık gerekçe). UI v3 muadilinden türetilemez (yok); **ADR-028 "Masayı Değiştir" ikizinden** türetilir (feedback_v3_screenshots_reference istisnası: v3'te olmayan ekran → ADR-028 pattern'i baz). K2 APPEND kararı v3'te combine davranışı olmadığından sorgusuz kilitli.

**"Masayı Değiştir" (ADR-028) ile fark:** Değiştir hedefi BOŞ masa (`orders.table_id` değişir, kalemler taşınmaz — yalnız masa etiketi/snapshot). Birleştir hedefi DOLU masa (kaynak `order_items` hedef siparişe **re-parent** edilir; kaynak sipariş terminal `merged` olur, masası boşalır). İki ayrı 3-nokta seçeneği; picker'ları zıt (Değiştir=boş masalar, Aktar=dolu masalar).

**Çekirdek invariant (ADR-027 K6) nasıl korunur:** masada tek aktif sipariş. Birleştirme sonrası kaynak masa terminal olur (aktif sipariş yok → boş); hedef masa tek (büyümüş) siparişi tutar → invariant korunur. Bu invariant partial unique index `orders_tenant_table_open_uq` ile atomik zorlanır (aşağı KRİTİK not).

**Backend gerçeği (architect kod haritası — file:line teyitli):**
- `order_status` mevcut değerler: `open, sent_to_kitchen, partially_served, served, billed, paid, cancelled, void` → `merged` eklenir (yeni terminal değer).
- Aktif sipariş = `status NOT IN ('paid','cancelled','void')` (`TERMINAL_ORDER_STATUSES`, `packages/db/src/repositories/orders.ts:153-157`).
- **KRİTİK — partial unique index `orders_tenant_table_open_uq` (Migration 041):** predicate `WHERE status NOT IN ('paid','cancelled','void')`. Migration 042 bunu DROP+CREATE ile aktif-statü **whitelist**'ine çevirir: `WHERE status IN ('open','sent_to_kitchen','partially_served','served','billed')` (mevcut blacklist ile birebir aynı küme + `merged` omission ile hariç). Blacklist'e `merged` YAZILMAZ (aynı tx'te yeni enum değeri kullanımı 55P04 verir — Karar I). Yoksa `merged` durumundaki kaynak sipariş masayı bloke eder (masaya yeni sipariş açılamaz). **En riskli implementasyon adımı.**
- `total_cents` recalc formülü mevcut: SUM WHERE `status != 'cancelled' AND is_comped = false` (`packages/db/src/repositories/orders.ts` — ADR-013). Re-parent sonrası hedef bu formülle yeniden hesaplanır.
- `audit_logs.event_type` CHECK `~ '^[a-z_]+\.[a-z_]+$'` (`000_init.sql:360-361`) → `order.merged` (order + merged) 2-segment regex'e uyar → event_type için migration GEREKMEZ. **Ancak** `order.merged` string'i `packages/shared-types/src/audit.ts` `AuditEventTypeSchema`'ya EKLENMELİDİR — yoksa `writeAudit` zod sanitizasyonu reddeder (Risk R1).
- ABAC iki-katmanlı: endpoint `authorize(['admin','cashier','waiter'])` role-gate + `packages/shared-types/src/permissions.ts` PERMISSIONS matrisine `orders.merge` (`orders.move` ile birebir aynı: admin/cashier/waiter, kitchen HARİÇ).
- `payments` guard: `SELECT COUNT(*) FROM payments WHERE order_id IN (source,target) AND tenant_id = ?` (ADR-014 ödeme tablosu).

### Karar

#### Karar A — Yön ve hayatta kalan sipariş {#K1}

Kaynak = aksiyonu başlatan (3-nokta açılan) masa. Hedef = seçilen dolu masa. **Hedef sipariş hayatta kalır** (order_no, created_at, audit korunur); kaynak sipariş absorbe edilip terminal olur. Zihinsel model: "X'in adisyonunu Y'ye aktar" → Y kalır. Bu yön kullanıcının iş akışına (kaynak masayı boşalt, müşteriler hedef masaya toplandı) doğrudan izlenir.

#### Karar B — Kalem birleştirme: APPEND (re-parent, satırlar birleştirilmez) {#K2}

**Kullanıcı onayı (Session 78).** Kaynak `order_items` hedef siparişe **ayrı satırlar olarak** re-parent edilir: `UPDATE order_items SET order_id = <hedef>, updated_at = now() WHERE order_id = <kaynak> AND tenant_id = ?`. Aynı ürün olsa bile satırlar **birleştirilmez** — çünkü:
- Her satırın kendi actor'ı (`created_by_name`), saati, variant/özellik/notu, KDS durumu var → birleştirmek forensic + operasyonel bilgi kaybı.
- Variant/özellik/not kombinasyonları "aynı ürün"ü belirsizleştirir.
- Toplam yine doğru birleşir (hedef `total_cents` yeniden hesaplanır) → "tutar bazında birleştirme" sağlanır.
- **Snapshot kolonları (ürün adı/fiyat/actor) DOKUNULMAZ** (ADR-003 §7) — yalnız `order_id` + `updated_at` değişir.

Combine (aynı ürün+variant+not satırlarını qty toplayarak tek satır) v5.1 dışı; v3'te combine davranışı yok → sorgusuz APPEND.

#### Karar C — Ödeme alınmış sipariş politikası: MERGE YASAK {#K3}

**Kullanıcı onayı (Session 78).** Kaynak VEYA hedef siparişte **herhangi bir ödeme kaydı** (`payments` satırı) varsa birleştirme **reddedilir**: `SELECT COUNT(*) FROM payments WHERE order_id IN (source,target) AND tenant_id = ?` > 0 → **409 `ORDER_HAS_PAYMENTS`**. Gerekçe: `payment_items` re-parent edilen `order_items`'a bağlı; kısmi ödenmiş iki adisyonu birleştirmek ödeme atıflarının yeniden dağıtımını gerektirir (karmaşık, hataya açık, nadir — birleştirme genelde servis başında/ödeme öncesi olur). MVP scope-lock: yalnız "temiz" (ödemesiz) adisyonlar birleşir. "Kısmi ödenmişleri de birleştir" isteği → ayrı ADR/complexity.

#### Karar D — Kaynak siparişin terminal durumu: yeni `merged` enum

Migration ile `ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'merged'`. Kaynak: `status = 'merged'` + yeni kolon `orders.merged_into_order_id UUID NULL` (forensic iz + idempotency). Neden yeni değer (`cancelled`/`void` reuse DEĞİL): `cancelled`/`void` iptal/void anomali raporlarını + sayımları kirletir; `merged` ayrı terminal durum → raporlar temiz kalır. **Raporlar `merged`'ı TERMİNAL sayar:** paid-only ciroyu etkilemez (kaynak zaten ödemesizdi — K3); iptal/void anomali raporu `merged`'ı SAYMAZ (ayrı durum). Kaynak kalemler hedefe taştığı için çift-sayım da olmaz (kaynakta kalem kalmaz).

#### Karar E — Endpoint + transaction {#K5}

`POST /orders/:sourceOrderId/merge` body `{ targetTableId: string (uuid) }` (moveToTable şekil ikizi; ADR-028 Karar A presedenti). Tek transaction:

1. Kaynak + hedef siparişi **`SELECT FOR UPDATE`** — **order id sırasıyla** kilitle (deadlock önlemi).
2. Guard sırası (ucuz→pahalı, güvenlik→bütünlük): kaynak var + tenant-scoped (yoksa 404 `ORDER_NOT_FOUND`) · her ikisi `dine_in` (409 `ORDER_NOT_DINE_IN`) · her ikisi non-terminal (409 `ORDER_ALREADY_CLOSED`) · kaynak ≠ hedef sipariş (409 `MERGE_SAME_ORDER`) · aynı tenant · **hedef masada aktif sipariş VAR** (yoksa 409 `MERGE_TARGET_NOT_OCCUPIED` → kullanıcıyı "Masayı Değiştir"e yönlendir) · kaynak+hedef ödemesiz (409 `ORDER_HAS_PAYMENTS`, K3).
3. `UPDATE order_items SET order_id = <hedef>, updated_at = now() WHERE order_id = <kaynak> AND tenant_id = ?` (snapshot kolonları DOKUNULMAZ — ürün/fiyat/actor korunur, K2).
4. Hedef `orders.total_cents` yeniden hesap (mevcut formül: SUM WHERE `status != 'cancelled' AND is_comped = false`).
5. Kaynak `status = 'merged'`, `merged_into_order_id = <hedef>`, **`total_cents = 0`** (kalemler taşındı → hayalet tutar kalmasın; R3).
6. Audit `order.merged` (aynı-tx — ADR-002 §10.4; PII-safe payload: `source_order_id`, `target_order_id`, `source_table_id`, `target_table_id`, `table_code` (snapshot), taşınan kalem sayısı, eski/yeni `total_cents`).
7. Commit → **2× `tables.changed {action:'updated', tableId}`** emit: kaynak masa (boşaldı) + hedef masa (doluluk/tutar değişti). Mevcut invalidate-only event reuse — realtime schema DEĞİŞMEZ.

Yanıt: 200 + güncellenmiş HEDEF sipariş projeksiyonu (düz DTO). Web hook `Promise<void>` + invalidate-only olmalı, yanıtı `{order,items}` sanıp cast ETMEMELİ ([[feedback_mutation_response_shape_mismatch]] — Session 78 #240 dersi; Karar H).

#### Karar F — ABAC/yetki {#K6}

Yeni `orders.merge` permission (admin/cashier/waiter; **kitchen HARİÇ**). Rol-only, ownership ABAC YOK (ADR-008 §7e, `orders.move` presedenti birebir aynası). İki-katmanlı: (a) `packages/shared-types/src/permissions.ts` PERMISSIONS matrisine `orders.merge` `orders.move` ile aynı Set'lere; (b) route `authorize(['admin','cashier','waiter'])` role-gate. Cross-tenant ASLA — her sorgu `tenant_id` WHERE.

#### Karar G — Hata kodları (→ AUTH_MESSAGE_KEYS + web/mobil i18n) {#K7}

Var olanlar reuse: `ORDER_NOT_FOUND` (404) · `ORDER_NOT_DINE_IN` (409) · `ORDER_ALREADY_CLOSED` (409). YENİ 3 kod:
- **`MERGE_SAME_ORDER`** (409) — kaynak = hedef sipariş.
- **`MERGE_TARGET_NOT_OCCUPIED`** (409) — hedef masa boş ("hedef masa boş — Masayı Değiştir kullan").
- **`ORDER_HAS_PAYMENTS`** (409) — kaynak veya hedefte ödeme kaydı var (K3).

Üçü de `AUTH_MESSAGE_KEYS` registry'ye (`error.<domain>.<camelCase>` konvansiyonu) + `errors.test` registry-completeness lint'ine (task_56cd16fe) girer.

> **KRİTİK hata-çeviri notu (Risk R2 aynası):** `toHttpError`'ın generic `check` yolu tüm `'check'` hatalarını `ORDER_INVARIANT_VIOLATED`'a çökertir. Bu yüzden merge repo'su `RepositoryError(cause, CODE)` fırlatır ve **route handler** bunu explicit `domainError(CODE, 409)`'a çevirir (moveToTable handler'ının hata-çeviri bloğunun aynısı). Yeni 3 kod semantiğini yalnız bu yolla korur.

#### Karar H — Client UI (mobil + web parite, ADR-028 UI ikizi) {#K8}

- **Mobil (PR-2):** dolu-masa 3-nokta sheet'inde (`TableActionsController` presedenti) "Adisyon Aktar" → `MergeTableSheet` (hedef picker = **DOLU** masalar, bölgeye gruplu, kaynak hariç; her kartta tutar) → onay "‹kaynak› adisyonu ‹hedef› masasına aktarılıp birleştirilsin mi?" → POST → `['tables']` + `['orders']` invalidate.
- **Web (PR-3):** kasiyer masa panosu dolu-kart 3-nokta → "Adisyon Aktar" → `MergeTableModal` (hedef picker = dolu masalar) → onay → POST + OrderScreen adisyon panelinde giriş ("Taşı" yanında "Aktar"). Web hook `Promise<void>` + invalidate-only ([[feedback_mutation_response_shape_mismatch]]).
- **Boş masa hiç listelenmez** (boşa aktar = Masayı Değiştir). Picker boşsa "birleştirilecek başka dolu masa yok" boş-durumu.
- Tüm metinler i18n key (TR). Onay dialog'u yüksek-etkili-ama-parasal-değil kategori. Nihai UX kararı **hci-reviewer**'ın.

#### Karar I — Migration: TEK DOSYA + whitelist index predicate (yeni enum değerini REFERANS ETMEYEN) (db-migration-guard PR-1'de zorunlu)

**Sorun (iki katman):** (1) PostgreSQL, önceden var olan bir enum'a `ADD VALUE` ile eklenen değerin **aynı transaction içinde kullanılmasını reddeder** (`ERROR: unsafe use of new value ... must be committed before they can be used`; canlı PG 17). (2) **node-pg-migrate v7 default `up` TÜM pending migration'ları TEK transaction'a sarar** (Session 79: pos_test 041→042 pending iken migrate `55P04` verdi). → "enum-add / enum-use ayrı dosya" YETMEZ (ikisi de aynı batch tx'inde). **Fresh CI yanıltıcı yeşil verir:** fresh DB'de enum tipi 000'de aynı batch tx'te CREATE edildiği için yeni değer aynı tx'te kullanılabilir (PG same-tx-created-type istisnası) — ama **incremental prod deploy'da (000-041 zaten canlı) enum önceden var → KIRILIR**; CI bu latent bug'ı yakalamaz.

**Çözüm — index predicate yeni değeri hiç REFERANS ETMEZ:** partial unique index blacklist yerine aktif statülerin **beyaz-listesi** olur; `merged` liste-dışı kaldığı için otomatik hariç tutulur → migration hiçbir yerde `merged`'i kullanmaz → **tek tx'te güvenli (fresh + incremental)**. **`042_order_merge.sql`** (TEK dosya):
- **(a)** `ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'merged' AFTER 'void'` (bu tx'te KULLANILMAZ).
- **(b)** `orders.merged_into_order_id UUID NULL` + composite FK `(merged_into_order_id, tenant_id) → orders(id, tenant_id)`.
- **(c)** **KRİTİK:** partial unique index `orders_tenant_table_open_uq` DROP+CREATE — predicate `WHERE status IN ('open','sent_to_kitchen','partially_served','served','billed')` (aktif set = mevcut blacklist `NOT IN ('paid','cancelled','void')` ile BİREBİR aynı küme + `merged` de omission ile hariç → masayı bloke etmez). Blacklist `NOT IN (...,'merged')` OLMAZ (55P04); `status::text NOT IN (...)` da OLMAZ (`functions in index predicate must be marked IMMUTABLE`). **Bakım notu:** ileride yeni AKTİF statü eklenirse bu whitelist güncellenmeli.
- **(d)** `event_type` CHECK zaten `order.merged`'ı geçer (2-segment regex) → event_type için migration GEREKMEZ.

> **Doğrulama (Session 79, canlı PG 17.10 + node-pg-migrate):** whitelist → ADD VALUE ile CREATE INDEX aynı tx'te çalışır (Test B). Fresh full chain exit 0; **incremental 041→042 ayrı migrate exit 0 (55P04 YOK)**; 37/37 test PASS (orders-merge 11 + errors 11 + orders-move-table 15 regresyon).

#### Karar J — Rollout + DoD / reviewer gate'leri

- **PR-1 (backend, paylaşımlı):** Migration 042 (tek dosya: enum + kolon + FK + whitelist index) + repo `mergeInto` + `POST /orders/:sourceOrderId/merge` endpoint + `orders.merge` permission + `AuditEventTypeSchema` `order.merged` + 3 yeni error key + integration testler (K9).
- **PR-2 (mobil UI):** `MergeTableSheet` + 3-nokta girişi + invalidate.
- **PR-3 (web UI):** `MergeTableModal` + masa panosu 3-nokta + OrderScreen girişi + invalidate.
- Her biri kendi branch (branch-first), kendi DoD, kendi reviewer'ları.
- Gate'ler: **kapsam-kilidi** (bu ADR ile gerekçelendirildi — v3'te YOK, v5.1 açık kapsam kararı); **db-migration-guard** (PR-1 zorunlu — Migration 042 tek dosya, özellikle whitelist index predicate (c) — yeni enum değerini referans etmez, incremental deploy 55P04 önlenir); **security-reviewer** (PR-1 zorunlu — sipariş mutasyonu auth `orders.merge` RBAC + tenant izolasyon cross-tenant 404 + ödeme-guard bütünlük yüzeyi); **hci-reviewer + turkish-ux-reviewer + i18n-key-checker** (UI PR-2/3); **qa-engineer** (test matrisi). CI yeşil olmadan merge YOK.

### Alternatifler

- **A — Kalem combine (aynı ürün+variant+not satırlarını qty toplayarak birleştir):** REDDEDİLDİ (K2) — forensic + KDS-durum + actor bilgisi kaybı; v3'te combine yok; toplam APPEND'de zaten doğru birleşir. Combine v5.1+.
- **B — Kısmi ödenmiş adisyonları da birleştir (payment_items yeniden dağıt):** REDDEDİLDİ (K3) — karmaşık, hataya açık, nadir; ödeme atıf yeniden-dağıtımı ayrı ADR gerektirir. MVP = yalnız temiz adisyonlar.
- **C — Kaynak durumu `cancelled` reuse (yeni enum yerine):** REDDEDİLDİ (K4) — iptal anomali raporlarını + sayımları kirletir. `merged` ayrı terminal durum → raporlar temiz.
- **D — Kaynak siparişi hard-delete / kalemleri kopyala:** REDDEDİLDİ — forensic iz + idempotency kaybı; `merged` + `merged_into_order_id` re-parent (kopya değil) veri bütünlüğünü (öncelik #2) korur, çift-kayıt yaratmaz.
- **E — Ayrı `tables` router endpoint (`POST /tables/:id/merge`):** REDDEDİLDİ — mutasyon `orders` üzerinde (re-parent + status); sipariş-merkezli `POST /orders/:sourceOrderId/merge` ADR-028 `PATCH /orders/:orderId/table` presedentine uyar.
- **F — Yeni realtime `order_merged` action / event:** REDDEDİLDİ — `tables.changed` invalidate-only zaten yeterli (2× updated emit = "iki masayı yeniden çek"); yeni action tüm exhaustive consumer switch'lerini sıfır faydayla kırar (ADR-028 Karar D presedenti).
- **G — Web hook'un yanıtı `{order,items}` cast etmesi:** REDDEDİLDİ ([[feedback_mutation_response_shape_mismatch]]) — attribute-endpoint düz DTO döner; yanlış cast onSuccess'te TypeError → mutasyon reject → başarılıyken UI hata basar. Hook `Promise<void>` + invalidate-only.

### Sonuçlar / Riskler

- (+) İki dolu masa tek adisyonda birleşir; sipariş/kalem/KDS/rapor bütünlüğü korunarak (re-parent, kopya değil) → iptal-yeniden-aç anti-pattern'i önlenir (öncelik #2).
- (+) ADR-027 operasyonel ihtiyaç (arkadaş grubu tek hesap, masalar birleşti) garson/kasiyer kasaya koşmadan karşılanır (öncelik #3).
- (+) ADR-028 ikizi → reuse-ağırlıklı: endpoint/tx/UI/realtime paterni hazır. Yeni yüzey: 1 endpoint + 1 permission + 1 audit event + 3 error key + 1 migration.
- (+) Realtime yüzeyi minimal: mevcut `tables.changed updated` 2× reuse, schema değişmez.
- (+) `merged` ayrı terminal durum → raporlar temiz (iptal/void anomalisi kirlenmez; paid-ciro etkilenmez).
- (−) **Migration 042 KRİTİK — whitelist index predicate (c):** aktif statüler whitelist'e alınmazsa (`merged` blacklist'e yazılırsa 55P04; whitelist'e aktif statü eksik yazılırsa o statüdeki sipariş masayı tutmaz) invariant bozulur. db-migration-guard PR-1'de bu adımı özel doğrular. **En yüksek risk.**
- (−) **R1 — `AuditEventTypeSchema` boşluğu:** `order.merged` `packages/shared-types/src/audit.ts`'e eklenmezse `writeAudit` zod sanitizasyonu reddeder (audit yazılmaz, tx patlar). event_type DB CHECK'i geçse de zod schema ayrı gate.
- (−) **R2 — hata-çeviri çökmesi:** generic `check` yolu 3 yeni kodu `ORDER_INVARIANT_VIOLATED`'a çökertir; route handler explicit `domainError(CODE, 409)` çevirisi (moveToTable aynası) yapılmazsa semantik + i18n kaybolur.
- (−) **R3 — terminal-statü türetim yayılımı (Session 79 correctness-lens BLOCKER):** yeni `merged` terminal değeri "kaynak masa boşalır" invariant'ını yalnız partial index (whitelist) katmanında zorlar — AMA doluluk/aktiflik türeten TÜM READ path'leri de `merged`'i terminal saymalı: `TERMINAL_ORDER_STATUSES` sabiti (`orders.ts`) + board doluluk (`tables.ts` baseQuery) + silme-guard (`hasActiveOrders`) + bölge doluluk (`areas.ts`) + moveToTable hedef doluluk. Biri atlanırsa `merged` kaynak masa READ-path'te DOLU görünür (masa boşalmaz + masaya yeni sipariş açılınca board LEFT JOIN çift-satır bozulması + silme-guard yanlış bloke). Ayrıca kaynak sipariş `total_cents` re-parent sonrası 0'lanmalı (yoksa hayalet tutar). Mitigasyon: tüm türetimler `TERMINAL_ORDER_STATUSES`'a merkezlenir (yeni terminal statü tek yerden yayılır) + drift-guard testi (aktif whitelist ∪ `TERMINAL_ORDER_STATUSES` == tüm `OrderStatus`, disjoint). **Genel ders: yeni terminal order_status eklemek = index whitelist + `TERMINAL_ORDER_STATUSES` + tüm aktif-sipariş türetimleri (checklist).**
- (−) Sipariş mutasyon yetkisi genişler (`orders.merge` garsona açık) → IDOR/yanlış-birleştirme yüzeyi. Mitigasyon: security-reviewer gate + tenant-scope 404 + audit (`order.merged` her birleştirme kanıtlı) + onay dialog + ödeme-guard (K3) + target-occupied guard.
- (−) `ALTER TYPE ADD VALUE` tx kısıtı ÇÖZÜLDÜ (Session 79 canlı PG 17 + node-pg-migrate): node-pg-migrate `up` tüm pending'i TEK tx'e sarar → iki-dosya split YETMEZ (incremental deploy'da 55P04). Çözüm: tek dosya + index predicate `merged`'i referans etmeyen whitelist (Karar I). Fresh full chain exit 0 + incremental 041→042 exit 0 doğrulandı.

### Test matrisi (qa — PR-1 integration; `realtime-emits.test.ts` harness: `createMockIo`/`findEmit`/`routedTo`/`clearEmits`, `insertTable()`, `loginAndGetToken`, `E2E_BYPASS_LOGIN_LIMIT`; izole masa + izole tenant fixture — [[feedback_api_integration_test_fixtures]])

- **happy merge:** 200 → kaynak `order_items` hedefe re-parent (order_id + updated_at değişti, snapshot kolonları AYNI) + hedef `total_cents` = birleşik toplam + kaynak `status='merged'` + `merged_into_order_id` = hedef + **2× `tables.changed`** emit (doğru tableId'ler = kaynak+hedef, doğru tenant room) + audit satırı `order.merged` (doğru PII-safe payload, actor).
- **same order:** kaynak = hedef → 409 `MERGE_SAME_ORDER`.
- **hedef masa boş:** 409 `MERGE_TARGET_NOT_OCCUPIED`.
- **ödeme var (kaynak veya hedef):** 409 `ORDER_HAS_PAYMENTS`.
- **kaynak/hedef takeaway:** 409 `ORDER_NOT_DINE_IN`.
- **kaynak/hedef terminal (paid/cancelled/void/merged):** 409 `ORDER_ALREADY_CLOSED`.
- **kaynak yok / cross-tenant:** 404 `ORDER_NOT_FOUND`.
- **cross-tenant hedef:** 409 `MERGE_TARGET_NOT_OCCUPIED` (hedef masa istekçinin tenant'ında yok → "aktif sipariş yok" sayılır; 409 de varlık ifşa etmez → sızıntı yok). *(Not: taslak "404" diyordu; gerçek kod davranışı 409 — mergeInto hedef için ayrı "masa var mı" sorgusu yapmaz, doğrudan tenant-scoped aktif-sipariş sorgular. Session 79 qa-lens düzeltmesi.)*
- **RBAC:** waiter → 200 (izinli); kitchen → 403 (yasak).
- **idempotency:** `merged` kaynağı tekrar merge → 409 (terminal guard `ORDER_ALREADY_CLOSED`).
- **+ mobil/web UI smoke + cihaz/tarayıcı iki-yön realtime** ([[feedback_realtime_contract_dead_untested]] — erken uçtan-uca socket smoke).

### Kapsam kilidi (bu ADR'nin DIŞINDA)

- **Kalem combine (qty topla):** v5.1+ (ayrı karar); MVP = APPEND (K2).
- **Kısmi ödenmiş adisyon birleştirme:** ayrı ADR/complexity (K3 — ödeme atıf yeniden-dağıtımı).
- **Swap (iki dolu masa yer değiştir):** ADR-030 (rezerv, ADR-028 kapsam kilidi).
- **Merge undo / birleştirme geçmişi UI'sı:** kapsam dışı (audit `order.merged` + `merged_into_order_id` forensic kayıt yeter; undo v5.1+).
- **Adisyon Aktar kalem-düzeyi split (kısmi kalem taşıma):** kapsam dışı; bu ADR tüm-adisyon birleştirir.

### Cross-ref tablosu

| Konu | Kaynak | Doğrulanan içerik |
|---|---|---|
| ADR-028 İKİZ (endpoint/tx/UI/realtime paterni baz) | ADR-028 Karar A–J | ✓ format + pattern baz |
| Masada-tek-aktif-sipariş invariant (merge sonrası korunur) | ADR-027 K6 | ✓ |
| `payments` ödeme guard (K3) | ADR-014 + `payments` tablosu | ✓ |
| `order_items` re-parent + `total_cents` recalc formülü | ADR-013 + `orders.ts` (SUM WHERE status!='cancelled' AND is_comped=false) | ✓ |
| ABAC role-only, ownership YOK (orders.merge = orders.move aynası) | ADR-008 §7e | ✓ |
| audit-same-tx + PII-safe payload | ADR-002 §10.4 + ADR-024 | ✓ |
| error registry (AUTH_MESSAGE_KEYS completeness) | ADR-006 §5.2 + task_56cd16fe lint | ✓ |
| snapshot kolonları re-parent'te DOKUNULMAZ | ADR-003 §7 | ✓ |
| Migration 042 (TEK dosya: enum + kolon + FK + whitelist index) — yeni enum değeri aynı tx'te kullanılamaz, node-pg-migrate tek-tx batch → whitelist çözümü | `packages/db/migrations/042_order_merge.sql` (mevcut en yüksek 041) | ✓ kod haritası + canlı PG fresh+incremental test |
| order_status değerleri (merged eklenir) | open/…/void → +merged | ✓ |
| KRİTİK: partial unique index predicate merged hariç | Migration 041 `orders_tenant_table_open_uq` DROP+CREATE | ✓ KRİTİK |
| event_type 2-segment regex (order.merged geçer, migration YOK) | `000_init.sql:360-361` | ✓ |
| AuditEventTypeSchema order.merged EKLE (yoksa writeAudit red) | `packages/shared-types/src/audit.ts` | ✓ Risk R1 |
| ABAC iki-katman (matris + route role-gate) | `packages/shared-types/src/permissions.ts` + `authorize()` | ✓ |
| hata-çeviri: RepositoryError→route domainError (generic check çökmesi) | `toHttpError` + moveToTable handler aynası | ✓ Risk R2 |
| web hook Promise<void>+invalidate (cast ETME) | [[feedback_mutation_response_shape_mismatch]] #240 | ✓ |
| v3'te masa/adisyon birleştirme YOK (yeni v5.1 yeteneği) | Session 79 kullanıcı gözlemi + `tables.js:107-140` (swap/merge yok) | ✓ kullanıcı gözlemi |

### Gerekli Amendment'ler (bu ADR İŞARET EDER — gövdeler ayrıca uygulanacak)

- **ADR-008 §7e (taslak):** Garson ABAC listesine `orders.merge` eklenir (`orders.move` ile aynı grant: admin/cashier/waiter, kitchen HARİÇ, ownership YOK). comp/void/iptal KAPALI kalır; cross-tenant ASLA.
- **ADR-027 K5/K6 (taslak):** "Adisyon Aktar/merge Faz B rezerv (ADR-029/030)" → "ADR-029 ile teslim ediliyor (Accepted 2026-07-03); endpoint `POST /orders/:sourceOrderId/merge`, permission `orders.merge`, Migration 042 (tek dosya: `merged` enum + `merged_into_order_id` + whitelist index predicate)."
- **ADR-014 (taslak, isteğe bağlı):** merge'in ödemesiz-adisyon ön-koşulu (`ORDER_HAS_PAYMENTS` guard) ödeme-bütünlüğü invariant'ına referans eklenir.

<!-- ADR-029 Accepted (2026-07-03, Session 79) — architect sub-agent; Adisyon Birleştir (dolu masanın adisyonunu başka DOLU masaya aktar/merge); ADR-027 Faz B rezervi + ADR-028 İKİZ (fark: hedef DOLU, order_items re-parent, kaynak terminal merged); v3'te YOK → yeni v5.1 yeteneği, bu ADR ile AÇIK kapsam (charter core directive 6, sessiz büyüme değil); UI ADR-028 pattern'inden türetilir (v3 ekranı yok); K1 yön=kaynak 3-nokta→hedef seçilen dolu masa, hedef hayatta kalır; K2 APPEND re-parent UPDATE order_items SET order_id=hedef (satır birleştirme YOK, snapshot dokunulmaz, combine v5.1) — kullanıcı onayı S78; K3 MERGE YASAK ödeme varsa 409 ORDER_HAS_PAYMENTS (COUNT payments IN(source,target)>0) — kullanıcı onayı S78; K4 kaynak status='merged' yeni enum + merged_into_order_id UUID (cancelled/void reuse DEĞİL → raporlar temiz, merged TERMİNAL sayılır iptal/void anomalisi saymaz paid-ciro etkilenmez); K5 POST /orders/:sourceOrderId/merge {targetTableId} tek-tx: SELECT FOR UPDATE id-sırasıyla (deadlock) + guard (dine_in/non-terminal/same-order/tenant/target-occupied/payments) + UPDATE order_items re-parent + hedef total_cents recalc(SUM status!=cancelled AND !is_comped) + kaynak merged+merged_into + audit order.merged (PII-safe: source/target order_id+table_id+table_code+kalem sayısı+eski/yeni total) + 2× tables.changed{updated} → 200 hedef DTO; K6 permission orders.merge admin+cashier+waiter (kitchen HARİÇ, ownership YOK, orders.move aynası) iki-katman matris+route authorize; K7 hata 3 var (ORDER_NOT_FOUND404/ORDER_NOT_DINE_IN409/ORDER_ALREADY_CLOSED409) + 3 YENİ (MERGE_SAME_ORDER409/MERGE_TARGET_NOT_OCCUPIED409/ORDER_HAS_PAYMENTS409) → AUTH_MESSAGE_KEYS+errors.test lint; K8 UI mobil MergeTableSheet(PR-2)+web MergeTableModal(PR-3) picker=DOLU masalar bölge-gruplu kaynak hariç+tutar, boş masa listelenmez, web hook Promise<void>+invalidate (cast ETME #240); Migration TEK DOSYA 042_order_merge.sql (ALTER TYPE order_status ADD VALUE merged AFTER void + merged_into_order_id UUID NULL + composite FK (id,tenant_id) + KRİTİK partial unique index orders_tenant_table_open_uq DROP+CREATE predicate = aktif-statü WHITELIST 'open/sent_to_kitchen/partially_served/served/billed' — merged'i REFERANS ETMEZ, omission ile hariç); NEDEN whitelist: node-pg-migrate up tüm pending'i TEK tx'e sarar + PG yeni enum değerini aynı tx'te kullandırtmaz (55P04) → blacklist NOT IN(...,merged) OLMAZ, status::text NOT IN de OLMAZ (IMMUTABLE değil); fresh CI yeşil AMA incremental prod'da blacklist kırılırdı (CI yakalamaz) → whitelist fresh+incremental güvenli (041→042 exit 0 doğrulandı); event_type regex order.merged geçer migration YOK; Risk R1 AuditEventTypeSchema order.merged EKLE yoksa writeAudit red / R2 RepositoryError→route domainError(CODE,409) generic check ORDER_INVARIANT_VIOLATED çökmesi (moveToTable aynası); test 11 case (happy re-parent+total+merged+merged_into+2emit+audit / same-order409 / target-empty409 / payments409 / takeaway409 / terminal409 / order404 / cross-tenant404 / RBAC waiter200 kitchen403 / idempotency merged-tekrar 409 / +UI smoke+realtime); rollout 3 PR (backend+migration+repo mergeInto / mobil / web); reddedilen: combine / kısmi-ödeme merge / cancelled reuse / hard-delete / ayrı tables router / yeni realtime action / web cast {order,items}; amendment İŞARET ADR-008 §7e(orders.merge) + ADR-027 K5/K6(teslim ediliyor) + ADR-014(ödeme-guard ref) -->

---

## ADR-031 — Phase 5: Pilot Go-Live + Adisyo→v5 Geçişi + v3 Müşteri Verisi Taşıma

- **Durum**: Accepted (2026-07-04 — Session 81 kapsam röportajı; tüm kararlar kullanıcı-onaylı, kod YAZILMADI; her KOD işi sprint listesinde PR olarak planlandı, implementasyon taze oturumlara bırakıldı)
- **Tarih**: 2026-07-04 (Session 81)
- **Numara notu**: ADR-030 numarası **rezerv** — "Adisyon Aktar (kalem-düzeyi split/swap)", ADR-027 Faz B ailesi, v5.1 (decisions.md:10351/10395; active-plan.md). Bu ADR bir sonraki serbest numara olan **031**'i alır; boşluk drift değildir.
- **Bağlı ADR'lar / referanslar**:
  - ADR-010 §5 (Redis adapter trigger — decisions.md:5473-5475: single-instance kontratı; "tek PM2 worker, Redis adapter dep eklenmez"; trigger = >500 socket VEYA PM2 cluster >1 worker). **Pilot bu kontratı korur: TEK instance.**
  - ADR-001 §7.1 (`migrator` DELETE revoke → `docs/engineering/deploy-checklist.md` forward-ref'i — bu ADR ile `docs/ops/deploy.md`'ye taşınıp kapatılır, Karar 3) + §7.2 (`migrator` Credential Rotation — tasarım var, `rotate-migrator.yml` implemente EDİLMEDİ; bu ADR pilotta rotasyonu sunucu-taraflı manuel prosedüre indirir, Karar 3).
  - ADR-003 §14.1.B.3 (CREATE INDEX CONCURRENTLY enforcement tetikleyicisi — bu ADR ile go-live SONRASI ilk canlı-veri migration'ına eşlenir, Karar 12).
  - ADR-004 (Print Agent — MSI + TCP 9100 / USB transport + CP857 codepage); ADR-004 Amendment 2 (Manager UI Phase 4+ deferred — decisions.md:4534).
  - ADR-015 Karar 10 + Migration 026 (`business_day_cutoff_hour` DROP — head şemada `tenant_settings` yalnız `timezone`, Karar 4).
  - ADR-016 §11.1 (veresiye/balance kapsam dışı — v5.1) + KVKK raw_phone 30 gün retention + call_log maskeleme + `docs/compliance/kvkk-data-inventory.md` **planlandı ama YAZILMADI** (decisions.md:8550/8626/8694 — Karar 11).
  - ADR-022 M4 (code signing — v5.1); ADR-023 + `docs/ops/backup-strategy.md` §9 (6 açık sunucu ayağı — Karar 7); ADR-024 (audit event deseni).
  - Charter §Phase 5 (`docs/project-charter.md:194-201` — paralel-koşum varsayımı bu ADR ile GEÇERSİZ) + Başarı Kriterleri (`:121-136` — ölçülebilir performans/kullanılabilirlik kriterleri korunur, paralel-koşum kriteri revize edilir; Karar 10). Ürün Sınırı (CLAUDE.md core directive 6 — kapsam kilidi).

### Bağlam

**Neden karar gerekiyor:** Phase 0-4 tamamlandı (main `2f960b9` — Session 80 kapanışı #256; api suite ~627 PASS — *Doğrulanmamış*, bu oturumda koşulmadı; 0 açık PR). Sıradaki tek büyük iş = pilotu canlıya almak. Ancak charter'ın Phase 5 tanımı (`docs/project-charter.md:194-201`) bir varsayım üzerine kurulu: "v3 ana, v5 yedek, 2 hafta paralel koşum". **Bu varsayım GEÇERSİZ.**

**Kullanıcı kararı — mevcut durum gerçeği (Session 81):** Restoran ŞU ANDA **Adisyo** (ticari cloud POS) kullanıyor; **v3 kullanım dışı**. "v3 ana / v5 yedek paralel koşum" mümkün değil — geçiş bir **Adisyo→v5 doğrudan go-live**'dır. Bu ADR bu gerçeklik değişimini ve charter drift'ini kayda geçirir (charter `:194-201` metninin + `:124` paralel-koşum başarı kriterinin güncellenmesi ayrı docs işi olarak sprint listesindedir).

**Charter başarı kriterleri (Kodda tespit — `docs/project-charter.md:121-136`):** Aralığın İÇİNDE iki tür kriter var:
- **Ölçülebilir performans/kullanılabilirlik kriterleri (korunur):** web p95 < 200ms, mobil sipariş→mutfak < 2sn, günlük 8 saat çökme yok, ≥2 garson eşzamanlı, sipariş < 45sn (3-4 kalem), parçalı ödeme < 1dk, fiş Türkçe karakter doğru. Bunlar go/no-go kapısı olarak AYNEN korunur (Karar 10).
- **Paralel-koşum kriteri `:124` ("v5 2 hafta paralel çalıştıktan sonra v3 tamamen kaldırıldı") — REVİZE EDİLİR.** Bu, ADR'nin GEÇERSİZ ilan ettiği varsayımın kendisidir; go/no-go'dan düşürülür ve `:194-201` ile birlikte Adisyo gerçekliğine göre yeniden yazılır (eşdeğer güvenlik ağı = Adisyo aboneliği 2-4 hafta açık, Karar 10). `:126` (Print Agent ayrı-sürümleme) geçerlidir ama go-live anında değil, ilk güncelleme yaşandığında doğrulanabilir — go/no-go dışı, DoD sonrası izlenir.

**Phase 0-4 hazırlık envanteri (Kodda tespit):**
- Migration dizini `packages/db/migrations/` — 41 dosya, son numara 043; forward-only (ADR-003). Prod fresh install = tüm migration'lar sıfır DB'ye tek seferde koşar. Head şema, ara-migration DROP'ları dahil nihai halidir (ör. Migration 026 `business_day_cutoff_hour`'u drop eder → head `tenant_settings` yalnız `timezone`).
- **Prod tenant bootstrap YOK:** `000_init.sql:490-494` "prod onboarding ayrı bootstrap akışı Phase 5'te ele alınır"; `seed.ts` dev-only (NODE_ENV=production guard). Gerçek restoran tenant'ı + admin + tenant_settings için bootstrap script/runbook Phase 5 KOD işidir.
- v5 şemasında veresiye/balance YOK (bilinçli — ADR-016 §11.1); payment_type enum: cash/card/transfer. `customers.legacy_v3_no` BIGINT partial UNIQUE hazır (Migration 027). `customer_phones` UNIQUE(tenant_id, normalized_phone). `customers` tablosunda `is_blacklisted`/`blacklist_reason` kolonları hazır (Migration 027:21-22).
- Müşteri import scripti MEVCUT: `apps/api/scripts/import-v3-customers.ts` (Excel `Müşteriler.xlsx`, `legacy_v3_no` idempotent, `normalizePhoneTr`, `--dry-run`/`--batch`). **Kodda tespit — kolon kapsamı:** `detectColumns()` yalnız No / Ad Soyad / Telefon / Mahalle / Adres / Toplam Sipariş Sayısı okur; **kara liste kolonu YOK** → mevcut script `is_blacklisted`/`blacklist_reason` taşımaz (Karar 5).
- v3 üretim DB'si restoran PC'de `%APPDATA%\Restoran POS\pos.db` (dev'deki kopya DEMO); WAL modu. v3 `customer_phones`'ta UNIQUE yok → dedup script'te mevcut.
- Backup: ADR-023 Accepted + `docs/ops/backup-strategy.md` runbook hazır; §8 drill tablosunda 1 kayıt (2026-07-04 LOKAL drill: pos_dev dump→restore exit 0, 27/27 tablo). `docs/ops/backup-strategy.md` §9 DoD checklist'inde 6 sunucu-taraflı ayak açık.
- Deploy runbook YOK (repo genelinde `deploy*.md` 0 sonuç; `docs/engineering/deploy-checklist.md` de YOK — ADR-001 §7.1 forward-ref'i olarak planlı, hiç yazılmadı). `hetzner-deployment` skill'i var (Ubuntu 24.04 + Nginx + PG17 + PM2 + Let's Encrypt + firewall).
- Print Agent: Phase 3 9/9 kapalı, MSI hazır (WiX v4; config `%PROGRAMDATA%\restoran-pos\print-agent.json` NeverOverwrite; MSI plaintext apiKey İÇERMEZ). SmartScreen "Unknown Publisher" pilotta kabul (code signing v5.1). TCP 9100 + USB transport destekli. **Kodda tespit — Manager UI MEVCUT DEĞİL:** ADR-004 Amendment 2 "Manager UI Phase 4+ deferred"; `generateAgentApiKey` helper var (`print-jobs.ts:650`) ama UI yok. İlk `agents` satırı bootstrap ile üretilmezse register 401 → yazıcı hiç bağlanamaz (Karar 4/8).
- Mobil: Expo SDK 54; dev-loop Expo Go + Metro LAN. Release APK için prod API URL config işi KOD işidir.
- Realtime/ölçek: rate-limit **kod-içi in-memory store** (`apps/api` loginLimiter, print-jobs.ts agentAuthLimiter — ADR-001'e bağlı değil); single-instance kontratı ADR-010 §5 (tek PM2 worker). Pilot TEK instance (cluster YOK). RLS hiç yok — izolasyon app-level; tek-tenant pilot için yeterli (RLS v5.1+).

**Kapsam kilidi (CLAUDE.md core directive 6):** Bu ADR YENİ ürün özelliği açmaz. Yalnız mevcut Phase 0-4 çıktılarını canlıya taşıma + v3 müşteri verisi migration'ını karara bağlar. Maliyet minimal tutulur.

### Karar

#### Karar 1 — Sunucu topolojisi + maliyet-minimal provisioning {#K1}

**Kullanıcı kararı — maliyet-minimal:** Tek Hetzner **CX22** (~4-5 EUR/ay) — API + PostgreSQL 17 + Nginx **aynı box**. Bu, **ADR-023 Soru 1 kararının (OS-level systemd/cron shell script) koşacağı host'u somutlar:** backup script'i API+PG ile aynı CX22'de çalışır (off-site sync ile coğrafi yedek korunur). Off-site: Hetzner **Storage Box BX11** (~4 EUR/ay, Almanya, KVKK). Bölge: Almanya (KVKK veri-ikamet). PM2 tek instance (cluster YOK — ADR-010 §5 single-instance kontratı korunur; PG 5432 internete AÇILMAZ, yalnız localhost + firewall). Ölçek büyürse (multi-tenant) CX32 upgrade + ayrı DB box değerlendirmesi v5.1+.

#### Karar 2 — Domain + SSL + reverse proxy {#K2}

Ucuz domain (~10-15 EUR/yıl; .com veya daha ucuz TLD — kullanıcı tercihi). **Nginx reverse proxy** + **Let's Encrypt** ücretsiz SSL (certbot auto-renew). Web UI `https://<domain>`, API `https://<domain>/api` (veya `api.<domain>` subdomain — deploy runbook'ta netleşir). **Nginx `/socket.io` için WebSocket upgrade proxy bloğu zorunlu** (Socket.IO handshake; runbook şablonunda). Mobil + Print Agent + Caller Bridge hepsi bu HTTPS endpoint'e bağlanır. HTTP→HTTPS redirect zorunlu.

#### Karar 3 — Deploy modeli: önce MANUEL, sonra CI/CD {#K3}

**Kullanıcı kararı:** Pilot go-live **manuel deploy** ile yapılır — dokümante runbook (`docs/ops/deploy.md`, Phase 5 docs işi): SSH + `git pull` + build + migration + PM2/servis restart. `hetzner-deployment` skill baz alınır. **CI/CD otomasyonu pilot stabilize olunca ayrı iş (v5.1 veya Phase 5 sonu).**

- **Prod env/secret zinciri (Kodda tespit — `apps/api/src/index.ts`):** runbook, tam değişken envanterini kapsar: `JWT_ACCESS_SECRET`, `JWT_AGENT_SECRET`, `BRIDGE_TOKEN` (Caller Bridge), `TENANT_ID` (bootstrap'in ürettiği gerçek tenant UUID ile EŞLEŞMELİ), `DATABASE_URL` / `MIGRATOR_DATABASE_URL`, `WEB_ORIGIN` (CORS + Socket.IO origin = prod domain), `PORT`, `NODE_ENV=production` (secure cookie şartı), web build'i için `VITE_SOCKET_URL`. `E2E_BYPASS_LOGIN_LIMIT` prod'da **set EDİLMEZ**. Secret üretimi `openssl rand`.
- **Migrator credential rotasyonu (ADR-001 §7.2 sapması — amendment notu):** `rotate-migrator.yml` repoda YOK ve §7.2 tasarımı GitHub Actions→prod PG bağlantısı varsayar; K1 firewall topolojisinde (PG internete açık değil) + manuel-SSH deploy modelinde bu uygulanamaz. **Pilot kararı:** rotasyon **sunucu-taraflı manuel runbook adımına** indirilir (`ALTER ROLE migrator PASSWORD ...` + prod env dosyasını güncelle; sıklık haftalık yerine pilotta gözden-geçir); `rotate-migrator.yml` CI/CD ile birlikte v5.1'e ertelenir. Bu sapma ADR-001 §7.2'ye in-place amendment olarak işlenir (docs işi, sprint listesi).
- **ADR-001 §7.1 kapanışı:** `migrator` DELETE revoke doğrulama maddesi (`has_table_privilege → f`) `deploy-checklist.md` yerine `docs/ops/deploy.md`'ye taşınır; §7.1 forward-ref'i in-place notla kapatılır.

#### Karar 4 — Prod bootstrap akışı {#K4}

`000_init.sql:490-494`'ün işaret ettiği prod onboarding akışı Phase 5'te KOD olarak yazılır (idempotent bootstrap script/runbook; `seed.ts` DEĞİL — o dev-only):
- **tenant** (`tenants.name` = fiş başlığında basılan işletme adı — Kodda tespit `enqueue-bill-job.ts:72` / `enqueue-kitchen-job.ts:97`; doğru ad kritik).
- **admin kullanıcı** (bcrypt password hash).
- **tenant_settings** — **yalnız `timezone`** (`Europe/Istanbul`). `business_day_cutoff_hour` head şemada YOK (Migration 026 DROP etti, ADR-015 Karar 10); bootstrap bu kolona INSERT DENEMEZ.
- **ilk `agents` satırı (Print Agent auth):** Manager UI olmadığından (ADR-004 Amendment 2), bootstrap script `generateAgentApiKey` + `hashAgentApiKey` ile ilk `agents` satırını (bcrypt `api_key_hash`) üretir; **plaintext key yalnız üretim anında bir kez gösterilir**, Print Agent config'e elle girilir (runbook'a yaz). Bu olmadan register 401 → yazıcı bağlanamaz (Karar 8, fiş go/no-go kriteri).
- **`TENANT_ID` env doğrulaması:** bootstrap tenant UUID'si prod env `TENANT_ID` ile eşleşmeli (bootstrap DoD'sinde kontrol).

Menü/masa/bölge/kullanıcılar ELLE girilir (Karar 5). Bootstrap script bir PR olarak sprint listesindedir.

#### Karar 5 — Veri taşıma kapsamı {#K5}

**Taşınır:**
- **YALNIZ v3 müşteri defteri** (isim + telefon + adres) — **kaynak: SADECE v3** (Kullanıcı kararı: Adisyo export'u KULLANILMAZ). Mevcut `apps/api/scripts/import-v3-customers.ts` kullanılır (isim/telefon/mahalle/adres/legacy_v3_no/total_orders + `normalizePhoneTr` dedup). Restoran PC'deki v3 DB'den taze Excel export adımı plana girer (kullanıcı aksiyonu). **Bayatlık kabulü:** v3 kullanım dışı olduğundan defter, v3'ün son-kullanım tarihinde **donmuştur**; Adisyo döneminde eklenen/değişen müşteriler taşınmaz — canlıda Caller ID / elle yeniden oluşur (bilinçli kabul, Sonuçlar (−)).
- **Kara liste — mevcut script TAŞIMAZ (Kodda tespit):** `detectColumns()` blacklist kolonu okumaz; ADR-016 §11 Amendment 1 Excel analizi de blacklist kolonu içermez. **Karar:** kara liste **canlıda ELLE işaretlenir** (`is_blacklisted` + zorunlu `blacklist_reason` — ADR-016 Karar 6 #5; muhtemelen birkaç kayıt). Script genişletme KOD işi AÇILMAZ (kapsam kilidi). *Doğrulanmamış:* v3 export'unda ayrı bir kara-liste kolonu var mı — yoksa elle-işaretleme tek yol.

**TAŞINMAZ (NET liste — kapsam kilidi):**
- **Menü** (kategori/ürün/fiyat/porsiyon): ELLE girilir, import scripti YAZILMAZ (Kullanıcı kararı). v3'te `*_cents` INTEGER gölge kolonlar hazırdı ama menü elle girileceği için bu yalnız bilgi notudur.
- **Geçmiş siparişler/ödemeler/raporlar**: TAŞINMAZ — v5 sıfır geçmişle başlar. v3 DB READ-ONLY arşiv olarak saklanır.
- **Veresiye/açık borç**: kağıt/harici izleniyor — taşınacak veri YOK (ADR-016 §11.1; v5.1 veresiye modülü).
- **Adisyo verisi**: hiçbir şey (Kullanıcı kararı).

#### Karar 6 — order_no seed + backfill forward-ref'lerinin kapanışı {#K6}

Geçmiş sipariş TAŞINMADIĞI için (Karar 5) iki forward-ref DÜŞER:
- `order_no_counters` v3 `MAX(order_no)` seed (decisions.md 1680/1842/1896) — geçmiş yok → seed GEREKMEZ. `order_no` günlük reset zaten; cutover günü v5 **1'den başlar**.
- takeaway/delivery backfill forward-ref'i (decisions.md:1263) — DÜŞER.

Bu forward-ref site'larına ("Phase 5 backfill seed edecek" notları) "**ADR-031 ile düştü**" in-place kapanış notu docs işi olarak sprint listesindedir (kaynaklar çelişik kalmasın).

**Öneri (operasyonel):** cutover **gün sonunda** yapılır ki `order_no` temiz 1'den başlasın (aynı gün Adisyo + v5 numara karışması olmaz).

#### Karar 7 — Backup sunucu ayakları {#K7}

`docs/ops/backup-strategy.md` §9 checklist'indeki (ADR-023 runbook'u) 6 açık sunucu-taraflı ayak Phase 5'te tamamlanır: (1) script sunucuda `.age` üretimi, (2) `rclone` sync Storage Box, (3) ilk SUNUCU restore drill'i, (4) retention silme doğrulaması, (5) systemd timer aktif, (6) age private key kasa + offline + sunucudan kaldırma. **age key kaybı = tüm yedekler kayıp** → key kasası (parola yöneticisi + offline USB/kağıt) kullanıcı aksiyonu, go/no-go ön-koşulu.

#### Karar 8 — Restoran istasyonu kurulumu {#K8}

**Kullanıcı kararı — donanım:** restoran PC (Windows) + USB yazıcı + Ethernet yazıcı mevcut.
- **Birincil transport: Ethernet TCP 9100** (sürücüsüz). **USB fallback** (Zadig WinUSB + `ESC t 13` = CP857 codepage doğrulaması).
- **Her iki yazıcıda codepage scan adımı** kurulum runbook'una girer (Türkçe karakter fiş doğrulaması — charter :125 kriteri).
- Print Agent MSI kurulur; **apiKey bootstrap script'in ürettiği ilk `agents` satırından gelen plaintext key ile** config'e elle girilir (Karar 4; Manager UI YOK). MSI plaintext içermez.
- **KDS + kasiyer/müdür web istasyonu:** tarayıcı, otomatik başlatma, ekran uyku/güç-tasarrufu KAPALI (rush saatinde KDS kararırsa mutfak siparişi görmez — hci rush-hour ilkesi), KDS tam ekran. Cihaz (restoran PC tarayıcısı veya ayrı ekran/tablet) kurulumu runbook'ta.
- Caller Bridge (`apps/caller-bridge/`, .NET 8 Windows Service) Print Agent'tan AYRI manuel kurulur (WiX bundle v5.1). `tenant_settings.caller_id_station_user_id` + `bypass_patterns` config'i mevcut. **Caller ID pilotta opsiyonel değil — kurulur ve smoke'a girer** (v3 paritesi: paket serviste arayan-müşteri eşleştirme günlük akış); ancak arıza go-live BLOCKER'ı DEĞİL (yazıcı/sipariş kritik yolu bağımsız).

#### Karar 9 — Mobil dağıtım: Android release APK sideload {#K9}

**Kullanıcı kararı:** Android **release APK sideload** (prod API URL gömülü). Garsonlar mobil internetle bağlanır (cloud HTTPS) — **WiFi şartı yok**. Store/TestFlight pilot dışı. **Build kararı: en maliyetsiz/basit olan** — EAS ücretsiz build queue VEYA lokal gradle build.
- **İmza (teknik düzeltme):** APK **kendi ürettiğimiz sabit self-signed release keystore** (veya debug keystore) ile imzalanır — imzasız APK Android'e HİÇ kurulmaz (INSTALL_PARSE_FAILED_NO_CERTIFICATES). Keystore **age key gibi kasada saklanır**; sonraki güncellemeler AYNI keystore ile imzalanır (aksi halde signature mismatch → kaldır-yeniden kur, oturum kaybı). Play App Signing v5.1.
- Prod API URL config işi (app config/env) KOD işidir → sprint listesinde PR.

#### Karar 10 — Pilot go-live modeli + go/no-go + rollback {#K10}

- **Model:** Adisyo→v5 doğrudan go-live (paralel koşum YOK — Bağlam). Cutover gün sonunda (Karar 6).
- **Go/no-go kriterleri:** charter'ın **ölçülebilir kriterleri** (`:125` fiş Türkçe · `:129-136` web p95 < 200ms, mobil sipariş→mutfak < 2sn, 8 saat çökme yok, ≥2 garson eşzamanlı, sipariş < 45sn, parçalı ödeme < 1dk). `:124` (paralel koşum) go/no-go DIŞI — revize edilir. Ek ön-koşullar: backup §9 yeşil (Karar 7) + age key kasada + `kvkk-data-inventory.md` yazılı (Karar 11, PII taşımadan önce) + deploy sonrası smoke geçti (web kasiyer/müdür/mutfak KDS + mobil + yazıcı + realtime iki-yön + Caller ID popup).
- **Ölçüm reçetesi (K13'e bağlı):** p95 = Nginx access log `$request_time` + tek-satır p95 script (kod değişikliği 0); "çökme yok" = `pm2 describe` restart sayısı 0 + günlük not; "≥2 garson eşzamanlı" = iki cihazdan aynı anda sipariş smoke'u.
- **Rollback (Kullanıcı kararı) — somut eşik:** `>30 dk sipariş alınamıyor` VEYA `veri bütünlüğü şüphesi` → **Adisyo'ya dönüş** (karar: işletme sahibi). Daha kısa kesinti = **kağıt fallback + fix-forward**. Kağıt fallback = masa/kalem/tutar 1 sayfalık şablon; sonra v5'e elle girilir (şablon P5-5 eğitim maddesine bağlı). **Adisyo aboneliği go-live kriterleri sağlanana dek AÇIK kalır** (öneri 2-4 hafta; cihazlarda Adisyo erişimi + menü güncelliği korunur), sonra iptal (iptal tarihi = açık soru).

#### Karar 11 — KVKK {#K11}

Gerçek müşteri verisinin Almanya sunucusuna taşınması **mevcut kararlara dayanır — YENİ mekanizma icat edilmez:** Hetzner Almanya (KVKK veri-ikamet) · backup `age` şifreleme (dump PII içerir — ADR-023) · ADR-016 raw_phone 30 gün retention + call_log maskeleme · `audit_logs` PII deny-list CHECK. v3 müşteri verisi (isim/telefon/adres) işletme sahibinin kendi verisi; taşıma meşru işleme.
**Düzeltme (Kodda tespit):** `docs/compliance/kvkk-data-inventory.md` **repoda YOK** — ADR-016 PR-8e'de planlanmış (decisions.md:8550/8626/8694), hiç yazılmamış. Bu dosya **gerçek müşteri PII'si prod'a taşınmadan ÖNCE yazılır** (docs işi, go/no-go ön-koşulu). KVKK silme talebi (`anonymizeCustomer`) v5.1.

#### Karar 12 — ADR-003 CONCURRENTLY eşleme + aktivasyon tetikleyicisi revizyonu {#K12}

ADR-003 §14.1.B.3 geçici izni "Phase 4 prod cutover hazırlığıyla sona erer" der. **Bu ADR, faz-terminolojisini düzeltmenin ötesinde aktivasyon tetikleyicisini de revize eder** (dürüst adlandırma): **Fresh install'da tablolar boş** → CONCURRENTLY enforcement fresh migration'larda anlamsız (kilit sorunu yok, plain CREATE INDEX yeterli). Enforcement **go-live SONRASI canlı-veri üzerinde koşacak ilk şema değişikliğinde** gerçek anlam kazanır.
- **Somut gate kilidi (mekanizma):** go-live SONRASI açılan **İLK migration içeren PR**, önce enforcement gate PR'ını (002-005 index whitelist + CI regex gate) merge etmeden merge EDİLEMEZ. Bu kural `db-migration-guard` talimatına yazılır. Gate PR'ının ön-işleri (TS migration infra, runner alternatifi) o noktada değerlendirilir. Kazara CONCURRENTLY'siz canlı index → sipariş kilidi riski böyle önlenir.
- ADR-003 §14.1.B.3 metnine "ADR-031 ile eşlendi/revize edildi" in-place notu docs işi (sprint listesi).

#### Karar 13 — Monitoring/izleme: MİNİMAL (kapsam kilidi) {#K13}

Pilotta yetinilecek: **pino yapısal log** (mevcut) + **Nginx access log `$request_time`** (p95 hesaplama kaynağı — Karar 10) + **günlük manuel log/pm2 kontrolü** + **haftalık `rclone lsl`** (off-site yedek varlık doğrulaması). **Alerting / metrics dashboard / uptime monitor / APM / yük testi aracı = v5.1.** Charter p95 kriteri Nginx log'dan tek-satır script ile spot-check edilir (KOD değişikliği 0). Her go/no-go kriterinin "nasıl ölçülür"ü Karar 10'da tanımlı.

#### Karar 14 — Personel eğitimi (Adisyo→v5 alışkanlık geçişi) {#K14}

Personel Adisyo'ya alışık — v5 iş akışı farkları (masa aç → sipariş → mutfağa gönder → ödeme → yazdır; garson mobil app; KDS) kısa eğitim + yanında pratik ile aktarılır. **Kağıt fallback prosedürü (Karar 10) + 1 sayfalık şablon** personele önceden anlatılır. Eğitim materyali docs işi (opsiyonel; ekran-akış notu + kağıt-fallback şablonu yeterli).

### Sonuçlar

- (+) Adisyo→v5 doğrudan go-live gerçekliği + charter `:124`/`:194-201` drift'i açıkça kaydedildi — sonraki oturumlar yanlış bağlamla başlamaz.
- (+) Maliyet minimal (~9-10 EUR/ay + ~15 EUR/yıl domain) — tek CX22'de API+PG+Nginx; ADR-023 Soru 1 kararının koşacağı host somutlandı.
- (+) Veri taşıma kapsamı NET: yalnız v3 müşteri (mevcut idempotent script); menü/geçmiş/veresiye/Adisyo/kara-liste-toplu taşınmaz — gizli iş yok (kara liste bilinçle elle-işaretlemeye alındı).
- (+) forward-ref borçları (order_no seed, takeaway backfill) kapatıldı + in-place not planı; ADR-003 CONCURRENTLY tetikleyicisi somut gate ile revize edildi.
- (+) Kritik yol tutarlılığı düzeltildi: bootstrap ilk `agents` satırını üretir (Manager UI yokluğu kapatıldı), tenant_settings yalnız timezone (Migration 026 gerçeği), prod env envanteri + Nginx socket.io upgrade + KVKK inventory ön-koşullaştırıldı.
- (+) Go/no-go ölçülebilir kriterlere + ölçüm reçetesine bağlı + somut rollback eşiği (>30dk / veri şüphesi → Adisyo) → veri bütünlüğü (#2) ve iş sürekliliği korunur.
- (−) Paralel koşum yok → cutover günü tüm yük v5'te; kağıt fallback + Adisyo geri-dönüş dışında ağ yok (risk kabul, 2-4 hafta Adisyo aboneliği ile azaltıldı).
- (−) v3 müşteri defteri Adisyo-geçiş tarihinde **donmuş** — Adisyo dönemi müşterileri taşınmaz, canlıda Caller ID/elle yeniden oluşur (bilinçli kabul; kullanıcı açık teyidi Açık Soru'da).
- (−) Manuel deploy → insan hatası riski (runbook + checklist ile azaltılır; CI/CD ertelendi). Migrator rotasyonu pilotta manuel (§7.2 otomasyonu v5.1'e ertelendi).
- (−) Tek instance + in-memory rate-limit + RLS yok + minimal monitoring → tek-tenant pilot için kabul; multi-tenant öncesi (v5.1+) Redis adapter (ADR-010 §5) + RLS + alerting gerekir.
- (−) age private key + APK keystore = iki tekil başarısızlık noktası (kayıp = yedekler/güncelleme kaybı) → kasa prosedürleri go/no-go ön-koşulu yapıldı.

### Kapsam dışı (v5.1+)

CI/CD otomasyonu + `rotate-migrator.yml` · alerting/metrics/APM/uptime monitor · yük testi aracı · WAL/PITR · restore UI · code signing (ADR-022 M4) · Print Agent Manager UI · Caller Bridge WiX bundle · RLS · Redis Socket.IO adapter (ADR-010 §5) · PM2 cluster/multi-instance · veresiye modülü · KVKK `anonymizeCustomer` · store/TestFlight + Play App Signing · menü/masa/kara-liste import scripti · CX32/ayrı DB box.

### Açık sorular / kullanıcı aksiyonları

1. **Hetzner hesabı/domain envanteri** (İLK SPRINT) — kullanıcı "almış olabilirim, emin değilim" dedi; hesap + domain durumu netleşecek.
2. **v3 taze Excel export** — restoran PC'deki güncel v3 DB'den `Müşteriler.xlsx` export'u; ayrıca **v3 uygulaması PC'de hâlâ açılıyor mu + export yolu (v3 UI mı, DB script mi)** doğrulaması (import öncesi).
3. **v3 defteri bayatlık teyidi** — Adisyo dönemi müşterilerinin taşınmayacağı trade-off'unun açık kabulü (Sonuçlar (−)).
4. **Kara liste kaynağı** — v3 export'unda ayrı kara-liste kolonu var mı; yoksa canlıda elle işaretleme (Karar 5).
5. **Garson cihaz envanteri** — kaç Android telefon, iOS kullanan garson var mı (K9 Android-only).
6. **Adisyo iptal kararı tarihi** — go-live kriterleri sağlandıktan 2-4 hafta sonra; kesin tarih açık.
7. **age private key + APK keystore kasası** — parola yöneticisi + offline USB/kağıt; sunucudan kaldırma (go/no-go ön-koşulu).

### DoD (Phase 5 bütünsel bitti tanımı)

Phase 5 kapandı sayılır ancak: (a) tenant/admin/tenant_settings(timezone) + ilk `agents` satırı bootstrap prod'da koştu, `TENANT_ID` env eşleşti · (b) v3 müşteri verisi taşındı (idempotent, dedup doğrulandı, export=import satır sayısı); kara liste canlıda elle işaretlendi · (c) menü+masa+kullanıcılar elle girildi · (d) web+mobil+yazıcı(TCP+USB codepage Türkçe doğru)+KDS+Caller ID popup deploy sonrası smoke geçti · (e) backup §9 6 ayak yeşil + sunucu restore drill + age key kasada · (f) go/no-go ölçülebilir kriterler (`:125`, `:129-136`) canlıda doğrulandı (ölçüm reçetesiyle) · (g) `docs/ops/deploy.md` runbook + `docs/compliance/kvkk-data-inventory.md` yazıldı · (h) charter `:124` (paralel-koşum kriteri) + `:194-201` güncellendi + ADR-003 §14.1.B.3/§7.1/§7.2 + order_no forward-ref in-place notları düşüldü · (i) Adisyo geri-dönüş ağı 2-4 hafta açık tutuldu, sonra iptal edildi · (j) personel eğitildi + kağıt-fallback şablonu + prosedürü aktarıldı.

<!-- ADR-031 Accepted (2026-07-04, Session 81) — architect sub-agent + Ultracode 4-lens adversarial verify (37 bulgu / 4 BLOCKER hepsi revizyonda kapatıldı); Phase 5 Pilot Go-Live + Adisyo→v5 geçişi + v3 müşteri taşıma; PLAN ADR'si — kod YAZILMADI, KOD işleri sprint listesinde PR. KRİTİK GERÇEKLİK DEĞİŞİMİ: restoran ARTIK Adisyo (ticari cloud POS) kullanıyor, v3 kullanım-DIŞI → charter :194-201 "2 hafta paralel (v3 ana/v5 yedek)" GEÇERSİZ; geçiş Adisyo→v5 DOĞRUDAN go-live; charter :124 paralel-koşum başarı-kriteri de revize (P5-5 docs). 14 KARAR: K1 tek Hetzner CX22 API+PG+Nginx AYNI box (~4-5€/ay, ADR-023 Soru1 host somutlandı) + Storage Box BX11 off-site + PM2 TEK-instance (ADR-010 §5 kontratı, cluster YOK, PG 5432 internete KAPALI); K2 domain+Let's Encrypt+Nginx reverse proxy + /socket.io upgrade bloğu ZORUNLU; K3 deploy MANUEL runbook docs/ops/deploy.md (CI/CD v5.1) + prod env envanteri (JWT_ACCESS/AGENT_SECRET,BRIDGE_TOKEN,TENANT_ID,WEB_ORIGIN,VITE_SOCKET_URL,NODE_ENV=production; openssl rand; E2E_BYPASS set edilmez) + migrator rotasyon sunucu-taraflı MANUEL (rotate-migrator.yml YOK → §7.2 in-place amendment) + §7.1 DELETE-revoke deploy.md'ye; K4 prod bootstrap script idempotent (seed.ts DEĞİL): tenant(name=fiş başlığı)+admin+tenant_settings YALNIZ timezone (business_day_cutoff_hour Migration026 DROP edildi)+ilk agents satırı generateAgentApiKey/hashAgentApiKey (Manager UI YOK ADR-004 Amd2, plaintext BİR KEZ göster)+TENANT_ID env eşleşme; K5 TAŞINIR=YALNIZ v3 müşteri (import-v3-customers.ts, Adisyo export KULLANILMAZ-kullanıcı kararı, defter Adisyo-geçiş tarihinde DONMUŞ-kabul); kara liste script'te YOK→canlıda ELLE işaretle (script genişletme AÇILMAZ); TAŞINMAZ=menü(ELLE gir)/geçmiş sipariş+ödeme+rapor(v3 READ-ONLY arşiv)/veresiye(ADR-016 §11.1 v5.1)/Adisyo(hiçbir şey); K6 order_no v3 MAX seed + takeaway/delivery backfill forward-ref'leri (decisions.md:1263/1680/1842/1896) DÜŞER (geçmiş yok); cutover gün-sonu order_no temiz 1'den + in-place "ADR-031 ile düştü" notu; K7 backup-strategy.md §9 6 sunucu-ayağı (age key kasa+offline+sunucudan-kaldır = go/no-go, key kaybı=tüm yedek kaybı); K8 istasyon: Ethernet TCP9100 birincil+USB fallback(Zadig WinUSB+ESC t 13 CP857 her iki yazıcı scan)+Print Agent MSI(apiKey bootstrap plaintext)+KDS ekran(uyku/güç-tasarrufu KAPALI tam ekran)+Caller Bridge .NET8(smoke'a girer, blocker DEĞİL); K9 Android release APK sideload (SABİT self-signed keystore KASADA, imzasız kurulmaz; mobil-internet HTTPS, WiFi şartı YOK; prod API URL config KOD); K10 go/no-go=charter :125/:129-136 ölçülebilir (p95=Nginx $request_time script, çökme=pm2 restart 0, ≥2 garson=iki-cihaz smoke) + backup§9+age+kvkk-inventory+smoke ön-koşul; ROLLBACK eşik >30dk sipariş-yok VEYA veri-şüphesi→Adisyo (abonelik 2-4 hafta AÇIK), kısa=kağıt fallback+fix-forward; :124 revize; K11 KVKK mevcut kararlara dayanır (Hetzner Almanya+age+ADR-016 retention/maskeleme+audit deny-list) + kvkk-data-inventory.md repoda YOK→YAZILACAK (PII taşımadan önce, go/no-go); K12 ADR-003 §14.1.B.3 CONCURRENTLY enforcement fresh-install'da anlamsız (tablo boş)→go-live SONRASI ilk canlı-veri migration'ına eşlenir+SOMUT gate (ilk canlı migration PR'ı gate PR'ı olmadan merge EDİLEMEZ, db-migration-guard talimatı); tetikleyici REVİZYONU (salt faz-eşleme değil); K13 monitoring MİNİMAL (pino+Nginx $request_time+günlük pm2+haftalık rclone lsl; alerting/APM/metrics/yük-testi v5.1); K14 personel eğitimi Adisyo→v5 + kağıt-fallback şablonu. SPRINT: P5-1 provisioning+env/secret+deploy.md · P5-2 bootstrap+kvkk-inventory+v3 müşteri import · P5-3 backup §9 sunucu ayakları · P5-4 istasyon(yazıcı+KDS+Caller Bridge)+mobil APK · P5-5 go-live+stabilizasyon+charter/forward-ref docs · P5-6 CONCURRENTLY gate (yalnız go-live SONRASI ilk canlı migration). KAPSAM KİLİDİ: yeni feature YOK, hepsi mevcut ADR/charter/kullanıcı-kararına izlenebilir; kara-liste script genişletme + rotate-migrator otomasyonu + monitoring hepsi v5.1'e/elle bırakıldı. AÇIK: Hetzner/domain envanteri · v3 export yolu+PC'de açılıyor mu · kara-liste kolonu · garson cihaz envanteri(Android/iOS) · Adisyo iptal tarihi · age+APK keystore kasa · api 627 Doğrulanmamış. Bağlı: ADR-001 §7.1/§7.2 · ADR-003 §14.1.B.3 · ADR-004 Amd2 · ADR-010 §5 · ADR-015 K10/Mig026 · ADR-016 §11.1/KVKK · ADR-022 M4 · ADR-023/backup-strategy.md §9 · charter :121-136/:194-201; ADR-030 rezerv (Adisyon Aktar v5.1) atlanarak 031 alındı -->

---

## ADR-032 — İkincil Yazıcı Yönlendirmesi (Mutfak / Kasa Fişi İş-Türü Filtresi)

- **Durum**: Accepted (2026-07-05, Session 83 — işletme sahibi/kullanıcı onayı; Design B seçildi; architect taslağı + main-context claim-query doğrulaması)
- **Tarih**: 2026-07-05 (Session 83)
- **İlişki**: ADR-004 (Print Agent Mimarisi) genişletmesi. ADR-004 §5 + `enqueue-kitchen-job.ts:114` yorumu "secondary printer routing v5.1" olarak ERTELEMİŞTİ. Restoran sahibi pilot go-live için bu ayrımı ZORUNLU ilan etti → erteleme geri alınıyor, pilota çekiliyor (kapsam büyümesi → yeni ADR ile gerekçelendirildi, CLAUDE.md core directive 6). Yeni ADR olarak numaralandı (ADR-004 Amendment değil) çünkü: (a) yeni bir runtime kontratı (claim query param + config alanı) getiriyor, (b) ADR-022 v5.1+ backlog'undan bir kalemi öne çekiyor — bağımsız izlenebilirlik değerli. ADR-004 hâlâ üst mimari; bu ADR onun altında dar bir yönlendirme kararı.

### Bağlam

Print job'lar tek bir tenant-başına kuyruğa (`print_jobs`) yazılır. Tablonun yönlendirme/rol/kind kolonu YOK; tek anlamsal etiket `payload.kind ∈ {'kitchen','bill'}` (JSONB).
- `enqueueKitchenJob` → `payload.kind='kitchen'` (kitchen_dest_label sabit 'MUTFAK'); `enqueueBillJob` → `payload.kind='bill'`. İkisi de `status='queued'`, aynı tenant.
- Claim endpoint `GET /print/v1/jobs/next` (print-jobs.ts:200-258): atomik `UPDATE print_jobs SET status='printing' WHERE id = (SELECT ... WHERE tenant_id=$1 AND (queued OR retry-hazır OR printing-stale) ORDER BY (status='printing'), created_at FOR UPDATE SKIP LOCKED LIMIT 1)`. **Yalnız tenant_id + status'a göre filtreler. İş-türü / yazıcı-rolü filtresi YOK.** Üç dal: queued, retry (backoff geçmiş), reclaim-stale-printing.
- Model 1:1 agent↔yazıcı (ADR-004 §5). 2 yazıcı = 2 Print Agent instance. Her ikisi de aynı `/jobs/next`'i poll eder.

**Sorun:** İki agent (mutfak + kasa) aynı kuyruktan job yarışır. Kasa agent'ı bir mutfak fişini kapıp yanlış yazıcıda basabilir (ve tersi). Pilot için mutfak fişleri mutfak yazıcısına, adisyon/kasa fişleri kasa yazıcısına gitmek ZORUNDA.

**Kapsam kilidi:** Bu, v3'ün tam "kategori→yazıcı" eşleme tablosu DEĞİL (o v5.1'de kalır). Yalnız iş-türü (mutfak vs adisyon) → agent yönlendirmesi. Yönetim UI'si YOK (ADR-004 Amendment 2 ile v5.1'e ertelenmişti — burada da ertelenmiş kalır). Tek-tenant pilot.

### Karar

**Design B — Claim-anında iş-türü filtresi (migration'sız).** Yönlendirme, agent'ın zaten okuduğu config dosyasına eklenen bir `jobKinds` listesi ile yapılır; agent poll ederken bunu query param olarak gönderir; claim sorgusunun iç SELECT'ine tek bir predikat eklenir.

**1. Agent config şeması (`print-agent.json`) — `jobKinds` alanı eklenir:**
- `PrintJobKindSchema = z.enum(['kitchen','bill'])`.
- `AgentConfigSchema`'ya `jobKinds: z.array(PrintJobKindSchema).nonempty().optional()`.
- Mutfak yazıcısı config: `"jobKinds": ["kitchen"]`. Kasa yazıcısı config: `"jobKinds": ["bill"]`.
- Alan yoksa (undefined) → agent hiçbir `kind` param göndermez → HER ŞEYİ claim eder (mevcut davranış, kırılma yok).
- `.nonempty()`: `[]` boş dizi anlamsız → config hatası olarak boot'ta fail-fast.

**2. Agent poll davranışı (`apps/print-agent/src/index.ts`):** `jobKinds` varsa `GET /print/v1/jobs/next?wait=N&kind=kitchen` (tekrarlı query param; `?wait=` zaten var). Yoksa param eklenmez.

**3. Claim query değişikliği (`apps/api/src/routes/print-jobs.ts`):** Endpoint `req.query['kind']`'i okur → `string[]` normalize (tek/CSV/tekrarlı) → `PrintJobKindSchema` ile doğrular (geçersiz → 400 VALIDATION_ERROR); boş/eksik → `null`. İç SELECT'in WHERE'ine **tek satır** eklenir — status-OR bloğunun DIŞINDA AND ile → üç dalı da (queued/retry/printing-stale) otomatik kapsar:

```sql
WHERE tenant_id = ${tenantId}
  AND (${kinds}::text[] IS NULL OR payload->>'kind' = ANY(${kinds}::text[]))   -- ← EKLENEN
  AND ( status = 'queued'
        OR (status = 'retry' AND retry_at IS NOT NULL AND retry_at <= now())
        OR (status = 'printing' AND updated_at < now() - make_interval(secs => ${RECLAIM_STALE_SECONDS})) )
```

**4. Register API kontratı — DEĞİŞMEZ** (`{ apiKey, deviceFingerprint }`). Yönlendirme server-authoritative DEĞİL (pilot); agent kendi config'iyle beyan eder (bilinçli ödünleşim).
**5. Enqueue — DEĞİŞMEZ** (`payload.kind` zaten discriminator).

### Kritik kenar durumlar

1. **Üç dalın hepsi filtrelenir** (predikat status-OR DIŞINDA AND ile). Kasa agent'ı (`kind=bill`) stale bir MUTFAK job'unu **reclaim EDEMEZ** → en tehlikeli cross-role yanlış-basım kapatılır. Test explicit doğrulamalı.
2. **Geriye dönük uyumluluk.** `jobKinds`/param yok → `kinds IS NULL` → filtre yok → her şeyi alır. Tek-yazıcı kurulumlar + prod'daki mevcut bootstrap agent AYNEN çalışır.
3. **Rol-eşleşen agent offline** → o `kind` `queued`'da birikir; cross-role fallback YOK (yanlış yazıcıda basmak geç basmaktan kötü). Agent dönünce FIFO basar. Belgelendi.
4. **Yönetim UI'si YOK** — yönlendirme yalnız agent config dosyasıyla (v5.1'de kalır).
5. **Migration YOK** → ADR-003 forward-only / ADR-031 K12 CONCURRENTLY-gate TETİKLENMEZ (DDL yok). db-migration-guard'a iş düşmez.
6. **Mevcut bootstrap agent:** config'ine dokunulmazsa her şeyi alır; ikinci yazıcı eklenince config'ine doğru `jobKinds` yazılır (backfill/UPDATE gerekmez — dosya düzenlemesi).

### Alternatifler

- **Design A — server-side `agents.printer_role` (migration):** enum + kolon + register API rol kabul + claim'de agent-rol lookup. **Reddedildi (pilot):** 1:1 + UI'siz modelde rol yine config'e yazılıyor; A bu bilgiyi ek migration + register değişikliği + hot-path per-claim lookup'a zorluyor → net maliyet, sıfır fayda. **v5.1 promosyon yolu:** yönetim UI'si gelince rol server-authoritative+revoke-edilebilir → o zaman A. `payload.kind` korunduğu için A sonradan üstüne bindirilebilir.
- payload'a `printerRole` gömmek (kind zaten var) / iki ayrı kuyruk tablosu (reclaim/retry ikiye katlanır) / hiç yönlendirme (sahip ZORUNLU ilan etti) — hepsi reddedildi.

### Sonuçlar

- **(+)** Migration/şema/prod-DDL yok → go-live öncesi en düşük risk. Dosya-tabanlı config modeliyle birebir tutarlı. Tek SQL predikatı üç dalı kapsar (cross-role reclaim kapatılır). Default permissive (mevcut agent kırılmaz). v5.1'e ileri-uyumlu.
- **(−)** Server-authoritative DEĞİL — agent kendi filtresini beyan eder; yanlış-config'li agent yanlış kind çekebilir. Tek-tenant, kendi donanımı, agent JWT var → tehdit düşük (server-authoritative = v5.1 Design A). Rol-eşleşen agent offline → kind birikir. `jobKinds` yanlış yazılırsa (iki agent de `["bill"]`) mutfak hiç basmaz → kurulum runbook'unda "her kind'a en az bir agent" kontrolü (operasyonel).

### Definition of Done (implementer)

- [ ] `packages/shared-types/src/print-agent.ts`: `PrintJobKindSchema` export + `AgentConfigSchema.jobKinds` (optional, nonempty).
- [ ] `apps/api/src/routes/print-jobs.ts`: `?kind` param oku+normalize+zod (geçersiz→400); iç SELECT'e `AND (${kinds}::text[] IS NULL OR payload->>'kind' = ANY(${kinds}::text[]))`.
- [ ] `apps/print-agent/src/printer/config.ts`: `jobKinds` parse+expose.
- [ ] `apps/print-agent/src/index.ts`: `jobKinds` varsa `?kind=` param(lar)ı ekle.
- [ ] Test (LOKAL, pos_test): (a) `kind=bill` agent `kind='kitchen'` queued ALMAZ; (b) stale `kind='kitchen'` printing RECLAIM ETMEZ (üç-dal); (c) `kind` yok → hepsi (backward-compat); (d) retry-hazır kitchen yalnız kitchen'a; (e) geçersiz `?kind=foo`→400.
- [ ] Kurulum runbook notu: ikinci yazıcıda doğru `jobKinds` + "her kind'a en az bir agent".
- [ ] ADR-022 (v5.1) güncelle: tam kategori→yazıcı + server-authoritative rol (Design A) + yönetim UI hâlâ v5.1.
- [ ] i18n/UI YOK (config dosyası) → hci gate uygulanmaz. security-reviewer: agent-beyan-rol ödünleşimi tek-tenant pilotta onay.

<!-- ADR-032 Accepted (2026-07-05, Session 83) — İKİNCİL YAZICI YÖNLENDİRMESİ (mutfak/kasa fişi iş-türü filtresi); ADR-004 §5 + enqueue-kitchen-job.ts:114 "secondary printer routing v5.1" ERTELEMESİ pilota çekildi (kullanıcı ZORUNLU ilan etti, kapsam-büyümesi→yeni ADR). Design B SEÇİLDİ (migration'sız): agent config `jobKinds:["kitchen"]|["bill"]` (optional/nonempty, yoksa=hepsi backward-compat) → agent `/jobs/next?kind=` gönderir → claim iç-SELECT'e `AND (kinds IS NULL OR payload->>'kind' = ANY(kinds))` TEK predikat, status-OR DIŞINDA→3 dalı da (queued/retry/reclaim-stale) kapsar (kasa agent stale mutfak job RECLAIM edemez=en tehlikeli cross-role kapandı). Register/enqueue DEĞİŞMEZ. Design A (agents.printer_role migration+server-authoritative rol) REDDEDİLDİ→v5.1 (yönetim UI ile). MIGRATION YOK→K12 CONCURRENTLY-gate tetiklenmez. Kapsam: yalnız iş-türü(mutfak vs adisyon)→agent; tam kategori→yazıcı tablosu+UI v5.1. Ödünleşim(−): agent kendi kind'ını beyan (server-auth değil, tek-tenant pilotta kabul); rol-agent offline→kind birikir; yanlış-config(iki agent ["bill"])→mutfak basmaz→runbook "her kind'a ≥1 agent". DoD: shared-types+api claim+print-agent config/poll+5 test(reclaim dahil)+runbook+ADR-022 v5.1 not. Bağlı: ADR-004 §5/Amd2 · ADR-022 · ADR-003 · ADR-031 K12 -->

---

## ADR-004 Amendment 3 — Fiş-Türü Bazlı CP857 Codepage Seçici (ESC t index; mutfak 29 / kasa 61)

- **Durum**: Accepted (2026-07-06, Session 84)
- **Güncelleme (2026-07-08, S87 → ADR-004 Amendment 4):** Aşağıdaki tarihsel `Doğrulanmamış:` (kasa ESC t 61 / codepage 61) ifadeleri artık **GEÇERSİZ** — S87'de spooler RAW smoke ile POS-80'de `renderBillReceipt` PAGE61 byte'ları Türkçe'yi (ç/ğ/ş/ı/ö/ü) kusursuz bastı → codepage 61 **ampirik DOĞRULANDI** (Amd4 Çözülen soru #2). Metindeki `Doğrulanmamış` etiketleri yazıldığı günün (S84) durumunu yansıtır; tarihsel kayıt olarak korunur.
- **Tarih**: 2026-07-06 (Session 84)
- **İlişki**: ADR-004 (Print Agent Mimarisi) §7 amendment'ı. `esc-pos.ts:16-23` yorumu bu ihtiyacı ("farklı yazıcı modeli farklı indeks isteyebilir → v5.1'de per-yazıcı config'e taşınabilir") zaten ERTELEMİŞTİ. Pilot go-live için ikinci fiziksel yazıcı (kasa POS-80) zorunlu olunca erteleme geri alınıp pilota çekiliyor — **ADR-032 ile birebir aynı emsal** (ertelenmiş bir yazıcı yeteneğini kullanıcı ZORUNLU ilan edince kısa bir ADR ile öne çekmek; CLAUDE.md core directive 6 kapsam kilidi). Amendment olarak numaralandı (yeni ADR değil) çünkü yeni runtime kontratı getirmiyor: mevcut `payload.kind` discriminator'ına tek byte'lık bir seçim ekliyor ve ADR-004'ün kendi ertelediği notu kapatıyor.

### Bağlam

Pilotta ADR-004 tek-tenant/tek-model varsayımıyla **tek global sabit** kullanıyor: `ESC_POS.CODEPAGE_CP857 = Uint8Array([0x1b,0x74,0x1d])` (ESC t 29), `esc-pos.ts:24`. Bu sabit iki template tarafından koşulsuz stream'e basılıyor — `renderKitchenReceipt` (`kitchen-receipt.ts:88`) ve `renderBillReceipt` (`bill-receipt.ts:96`) — her ikisi de `RESET` (ESC @) sonrası prepend ediyor. RESET codepage'i bilinen bir değere döndürmüyor (`codepage-scan.ps1:53` ampirik kanıtı), bu yüzden codepage her job'da yeniden seçiliyor.

Pilota ikinci fiziksel yazıcı girdi ve **iki model iki farklı CP857 indeksi istiyor**:
- **MUTFAK — JP80H-UE** (Ethernet 192.168.1.120): CP857 = **ESC t 29** (0x1d). Ampirik doğrulandı (S83, `codepage-scan.ps1`), CANLI çalışıyor.
- **KASA — POS-80 / PrinterPOS-802BC2** (USB-only): CP857 = **codepage 61** (0x3d). Self-test kanıtı (yazıcının default code page'i zaten Page61). `Doğrulanmamış:` fiziksel POS-80'de ESC t 61 basımı henüz teyit edilmedi — kasa yazıcısı ŞU AN canlı Adisyo tarafından kullanılıyor; Zadig/WinUSB ve ampirik `codepage-scan.ps1` CUTOVER'a kadar YAPILAMAZ. Bu amendment YALNIZ kod/tasarım işi; 0x3d cutover-sonrası scan ile teyit edilecek (aynı süreç mutfak 13→29 varsayımını düzeltmişti).

Tek global sabit iki modeli aynı anda karşılayamaz: mutfak 29 doğru basarken, kasa (Page61) yazıcısına 29 gönderildiğinde Türkçe karakterler yanlış tabloda basılır (ğ/ş/ı bozulur).

**S84 bağlamı (Adisyo paralel kullanım):** Restoran cutover'a kadar Adisyo'yu paralel kullanıyor; kasa yazıcısı Adisyo'nun elinde. Dolayısıyla bu oturum **salt kod/tasarım** — fiziksel doğrulama cutover'da.

**KRİTİK MİMARİ DÜZELTME (izleme bulgusu; brief'in premise'ini reddeder):** Codepage byte'ı **API render-anında** stream'e baked ediliyor; **print-agent codepage'i asla görmez**. Agent yalnız `@restoran-pos/shared-types`'a bağımlı (`print-agent/package.json`), `@restoran-pos/shared-domain`'i (ESC/POS builder + encoder) import ETMEZ; `bytesBase64`'ü decode edip transport'a HAM yazar (`index.ts:332,346-350`) — render/inject yeteneği YOK. Bu nedenle **codepage alanı `AgentConfigSchema`'ya konamaz** (agent'ın üzerinde işlem yapacağı byte yok; ESC t byte'ını opaque stream içinde patch'lemek kırılgan ve ADR-004 "agent dumb byte-writer" ilkesini bozar). Doğru seam, byte'ın üretildiği ve `payload.kind`'ın (`kitchen`/`bill`) zaten bilindiği **API render/enqueue katmanı**.

### Karar

**Codepage seçimi API render-anında, `payload.kind`'a keyed yapılır.** Agent config ve `print_jobs` payload şeması DEĞİŞMEZ.

**1. `shared-domain` — tek YENİ sabit (`esc-pos.ts`):**
Mevcut `CODEPAGE_CP857 = Uint8Array([0x1b,0x74,0x1d])` sabiti **AYNEN KALIR** (JP80H/29 = geriye-dönük default; `esc-pos.test.ts:13-15` hiç dokunulmadan yeşil). Yanına tek yeni kardeş sabit eklenir (magic `0x3d` yasak; kapsam-kilidi → abstraction/factory/index-N builder YOK):

```ts
CODEPAGE_CP857: new Uint8Array([0x1b, 0x74, 0x1d]),   // ESC t 29 — JP80H-UE (mutfak). Default.
// ESC t 61 — POS-80 / Page61 (kasa) CP857 indeksi. Doğrulanmamış (cutover-scan bekliyor).
CODEPAGE_CP857_PAGE61: new Uint8Array([0x1b, 0x74, 0x3d]),
```

*Not (C3#2 çözümü):* İkinci bir `CODEPAGE_CP857_JP80H` adı EKLENMEZ — aynı byte'a iki isim (`CODEPAGE_CP857` + `_JP80H`) sürüklenme/okunabilirlik kokusudur. Var olan `CODEPAGE_CP857` zaten JP80H(29) değeridir; JP80H açıklaması yalnızca yorumda yer alır, ayrı export olarak değil. **Encoder DEĞİŞMEZ** — `encode-cp857.ts` standart CP857 kod noktaları (Ğ=0xA6, ğ=0xA7) her iki indeks tablosunda da aynı; yalnız ESC t seçici byte'ı (triplet'in 3. byte'ı) değişir.

**2. Render imzası — YALNIZ `renderBillReceipt` parametrelenir (default 29):**

```ts
renderBillReceipt(params, codepage = ESC_POS.CODEPAGE_CP857)
```

Template içinde `parts.push(ESC_POS.CODEPAGE_CP857)` → `parts.push(codepage)`. Default = mevcut `CODEPAGE_CP857` (29) → param verilmeyen çağrı BYTE-IDENTICAL kalır.
*Not (C1#1 / C3#1 çözümü):* `renderKitchenReceipt` DOKUNULMAZ — mutfak yolu kaynak-seviyesinde de birebir aynı kalır; hiçbir çağıran ona codepage geçmediği için oraya param eklemek ölü/test edilmemiş yüzey olurdu (directive 7 cerrahi). Simetri istenirse v5.1'de.

**3. Enqueue seçim noktası — `payload.kind` = fiziksel yazıcı:**
- `enqueueKitchenJob` (`enqueue-kitchen-job.ts:96`, `payload.kind='kitchen'`): DOKUNULMAZ → default 29 (mutfak).
- `enqueueBillJob` (`enqueue-bill-job.ts:71`, `payload.kind='bill'`): `renderBillReceipt({...}, ESC_POS.CODEPAGE_CP857_PAGE61)` → 61 (kasa). ADR-032 ile `kind='bill'` job'ları zaten kasa agent'ına (`jobKinds:["bill"]`) yönlendiriliyor → `kind → fiziksel yazıcı → codepage` eşlemesi pilotta 1:1 tutarlı.

**4. `print-agent` — DEĞİŞMEZ** (config, index.ts, transport). `AgentConfigSchema`'ya codepage EKLENMEZ.
**5. `shared-types` payload şeması — DEĞİŞMEZ** (byte opaque kalır, `kind` zaten var; dist rebuild GEREKMEZ).
**6. MSI/nssm — DEĞİŞMEZ.** Bu salt kaynak değişikliğidir (shared-domain dist'siz + apps/api server-side render); print-agent binary/config/env dokunulmadığından yeniden MSI deploy TETİKLENMEZ, çalışan mutfak agent'ının env'i bozulmaz.

### Alternatifler

- **(Brief'in önerisi) Agent config'e `codepage` alanı → agent ESC t byte'ını stream'de patch'ler.** **REDDEDİLDİ:** (a) agent shared-domain'i import etmez, render/ESC-POS bilgisi yok; (b) opaque byte stream içinde ESC t triplet aramak/mutasyona uğratmak kırılgan (encoder payload'ında 0x1b 0x74 dizisi tesadüfen görünebilir); (c) ADR-004 "agent = dumb byte-writer" ilkesini bozar; (d) alan `AgentConfigSchema`'ya konsa render zaten API'de olduğundan ÖLÜ olurdu. Codepage byte içeriğini etkiler, byte içeriği API'de üretilir → knob API'de olmalı.
- **Server-side `agents.printer_model`/codepage kolonu (migration).** REDDEDİLDİ (pilot): 1:1 + UI'siz modelde `kind` zaten fiziksel yazıcıyı belirtiyor; migration + register değişikliği net maliyet, sıfır fayda (ADR-032 Design A ile aynı gerekçe). v5.1 promosyon yolu açık.
- **Tek sabiti global 61'e değiştirmek.** REDDEDİLDİ: mutfağı (29) kırar, testler kırmızıya döner, mutfak CANLI GO-LIVE blocker'ını bozar.
- **`renderBillReceipt` içine 61'i param'sız gömmek.** REDDEDİLDİ: template'i tek modele bağlar, açık-default simetrisini kaybeder; opsiyonel-param-default doğru seam.
- **İkinci `CODEPAGE_CP857_JP80H` adı eklemek.** REDDEDİLDİ (C3#2): aynı byte'a iki live isim = sürüklenme riski; mevcut `CODEPAGE_CP857` zaten JP80H değeri.
- **Codepage abstraction / index-N factory / string-enum ('jp80h'|'page61') / yönetim UI.** REDDEDİLDİ (kapsam kilidi): iki model için önceden-inşa iki Uint8Array sabiti yeterli. Sabit-Uint8Array geçmek (ham index sayısı veya string enum değil) invalid-index/out-of-range kenar durumlarını YAPISAL olarak imkânsız kılar → runtime validation gerekmez. Genel `codepage(n)` builder + per-model server config + UI v5.1 (ADR-022).

### Kritik kenar durumlar

1. **Mutfak byte-identical (kaynak + byte seviyesi)** — `renderKitchenReceipt` hiç dokunulmadı, `CODEPAGE_CP857` sabiti değişmedi, encoder değişmedi. 3 test aynen yeşil (aşağıda).
2. **`kind → codepage` statik eşleme** pilotta 1:1 (kitchen→29, bill→61). İkinci mutfak / üçüncü model gelirse eşleme yetersiz kalır → o zaman v5.1 (per-agent/per-model server-authoritative config). Belgelenir.
3. **Kasa 61 `Doğrulanmamış:`** — kod 0x3d der; fiziksel teyit cutover'da `codepage-scan.ps1` POS-80'de koşunca. O ana kadar bill fişi kasa yazıcısında Türkçe için doğrulanmış değildir. Cutover runbook'una ampirik-teyit ayağı eklenir; sapma çıkarsa (61 değil başka indeks) `CODEPAGE_CP857_PAGE61` tek-satır güncellenir.
4. **₺/TL güvenliği** — her iki indeks de CP857 tablosu; standart-CP857 encoder byte'ları aynı map'lenmeli; POS-80 self-test-sonrası ampirik teyit (`Doğrulanmamış:` cutover'a kadar).
5. **Payload/agent değişmediği için** ADR-032 claim/routing, retry/reclaim, transport AYNEN çalışır; hiçbir başka tüketici `payload.kind`'ı byte değiştirmek için okumaz.

### Backward-compat garantisi (byte kanıtı)

Mevcut `CODEPAGE_CP857` (29) sabiti + `renderBillReceipt` default'u 29 + `renderKitchenReceipt` dokunulmadı → mutfak yolu BYTE-IDENTICAL. Koruyan/yeşil kalan testler:
- `esc-pos.test.ts:13-15` (`CODEPAGE_CP857 toEqual [0x1b,0x74,0x1d]`) — sabit değişmedi, geçer.
- `esc-pos.test.ts:83-85` (`concat(RESET,CODEPAGE_CP857) === [0x1b,0x40,0x1b,0x74,0x1d]`) — geçer.
- `kitchen-receipt.test.ts:42-48` (ilk 5 byte `[0x1b,0x40,0x1b,0x74,0x1d]`) — template dokunulmadı, geçer.
- **Değişen tek test:** `bill-receipt.test.ts:41-48` (şu an ilk-5-byte 29 bekliyor) → **61** beklemeye güncellenir (`[0x1b,0x40,0x1b,0x74,0x3d]`). Bu, kararın kasıtlı ve tek beklenen test değişikliğidir.
- **Eklenen test:** `esc-pos.test.ts` — `CODEPAGE_CP857_PAGE61 toEqual [0x1b,0x74,0x3d]` (yeni sabit byte assert'i).

### Definition of Done (implementer)

- [ ] `packages/shared-domain/src/printer/esc-pos.ts`: mevcut `CODEPAGE_CP857` (=29) DEĞİŞMEZ; yalnız `CODEPAGE_CP857_PAGE61` (=61) sabiti EKLENİR. Yorum: her iki indeks CP857, encoder ortak; 61 `Doğrulanmamış` cutover-scan. (İkinci `_JP80H` adı EKLENMEZ.)
- [ ] `apps/api/src/print/templates/bill-receipt.ts`: opsiyonel `codepage` param (default `ESC_POS.CODEPAGE_CP857`); `parts.push(codepage)` (:96). Header JSDoc (:13) + `:96` yakınındaki inline yorum `CODEPAGE_CP857_PAGE61 / ESC t 61 (POS-80, Doğrulanmamış cutover-scan)` diyecek şekilde güncellenir (stale-but-wrong comment düzeltmesi).
- [ ] `apps/api/src/print/templates/kitchen-receipt.ts`: **DOKUNULMAZ** (imza + `:10` yorumu + `:88` push aynen; hâlâ 29, doğru).
- [ ] `apps/api/src/print/enqueue-bill-job.ts:71`: `renderBillReceipt({...}, ESC_POS.CODEPAGE_CP857_PAGE61)`. `enqueue-kitchen-job.ts` DOKUNULMAZ (default 29).
- [ ] Typecheck: `apps/api` build/typecheck koş → `ESC_POS.CODEPAGE_CP857_PAGE61` mevcut `import { ESC_POS }` üzerinden çözülüyor (yeni sabit ESC_POS objesinin property'si; barrel/re-export değişikliği GEREKMEZ).
- [ ] `bill-receipt.test.ts:41-48`: ilk-5-byte beklentisi `[0x1b,0x40,0x1b,0x74,0x3d]` (61). Yeni test: `renderBillReceipt(params)` (param'sız) → hâlâ 29 basar (geriye-dönük default). `esc-pos.test.ts`: yeni assert `CODEPAGE_CP857_PAGE61 === [0x1b,0x74,0x3d]`; `CODEPAGE_CP857` assert'i DOKUNULMAZ.
- [ ] `apps/print-agent/**` DEĞİŞMEZ (config/index/transport) — DoD'de explicit "agent + payload şeması + AgentConfigSchema dokunulmadı".
- [ ] `apps/print-agent/installer/codepage-scan.ps1` rehber metni (:13 ve :78): cutover operatörüne hangi sabiti hangi yazıcı için düzenleyeceğini söyle — mutfak → `CODEPAGE_CP857` / kasa → `CODEPAGE_CP857_PAGE61`. Yalnız yorum/rehber metni; mantık değişmez.
- [ ] `shared-types` dist rebuild GEREKMEZ (payload şeması değişmedi); `shared-domain` source-consumed → apps/api canlı tüketir. MSI/nssm redeploy TETİKLENMEZ.
- [ ] **Cutover-sonrası (ayrı ayak, kod dışı, runbook):** POS-80'de `codepage-scan.ps1` koş → 61 (0x3d) ampirik teyit; teyitle `esc-pos.ts` yorumundaki `Doğrulanmamış` kaldır. Sapma çıkarsa `CODEPAGE_CP857_PAGE61` tek satır güncellenir.
- [ ] i18n/UI YOK (yazıcı byte'ı) → hci gate uygulanmaz. security-reviewer: byte/codepage değişikliği PII/auth dokunmaz → gerekmez. db-migration-guard: migration YOK → tetiklenmez.
- [ ] ADR-022 (v5.1) not: genel `codepage(index)` builder + per-model server config + yönetim UI hâlâ v5.1.

### Sonuçlar

- **(+)** Migration/şema/prod-DDL/payload/agent/MSI/nssm değişikliği YOK → go-live öncesi en düşük risk. Mutfak byte-identical hem kaynak hem byte seviyesinde (`renderKitchenReceipt` + `CODEPAGE_CP857` dokunulmadı; 3 test aynen yeşil). Seam mimari olarak doğru yerde (byte'ın üretildiği API render katmanı, `kind` zaten biliniyor). Tek yeni adlandırılmış sabit (magic byte yok, aynı byte'a iki isim yok). Önceden-inşa Uint8Array sabiti geçmek invalid-index kenar durumlarını yapısal olarak eler. ADR-032 routing'iyle 1:1 tutarlı. Cerrahi diff: bir template + bir enqueue site + bir yeni sabit + bir değişen test.
- **(−)** `kind → codepage` statik eşleme yalnız 2-model pilotu için geçerli — üçüncü model/ikinci mutfak v5.1 gerektirir. Kasa 61 fiziksel olarak `Doğrulanmamış` (cutover-scan bekliyor) → 0x3d yanlışsa tek-satır düzeltme. Codepage bilgisi API'de (fiziksel yazıcı kimliğini bilen agent'ta değil) → server-authoritative değil, ama pilotta `kind` yeterli discriminator.

<!-- ADR-004 Amd3 Accepted (2026-07-06, S84) — FİŞ-TÜRÜ BAZLI CP857 CODEPAGE SEÇİCİ. 2. yazıcı modeli: kasa POS-80 CP857=ESC t 61(0x3d, Doğrulanmamış/cutover-scan) vs mutfak JP80H=29(0x1d, canlı). esc-pos.ts:24 tek global sabit iki modeli karşılayamaz; esc-pos.ts:21 zaten v5.1'e ertelemişti→kullanıcı ZORUNLU ilan etti→pilota çekildi (ADR-032 emsali, directive 6). KRİTİK DÜZELTME: brief "agent config'e codepage" ÖLÜ — agent shared-domain import etmez, opaque byte forward eder (index.ts:332,346); codepage API RENDER-anında baked (bill-receipt.ts:96), payload.kind zaten biliniyor→seam API'de. KARAR: esc-pos.ts mevcut CODEPAGE_CP857(29) AYNEN + tek yeni sabit CODEPAGE_CP857_PAGE61(61) [ikinci _JP80H adı YOK]; YALNIZ renderBillReceipt opsiyonel codepage param default CODEPAGE_CP857; renderKitchenReceipt DOKUNULMAZ (kaynak+byte identical); enqueue-bill-job.ts:71 PAGE61 geçer, enqueue-kitchen DOKUNULMAZ. Encoder DEĞİŞMEZ (Ğ=0xA6 ğ=0xA7 iki tabloda ortak; yalnız ESC t seçici 3.byte). Agent+payload+migration+MSI+nssm DEĞİŞMEZ. Byte-identical mutfak: esc-pos.test.ts:13-15/83-85 + kitchen-receipt.test.ts:42-48 yeşil; DEĞİŞEN TEK test bill-receipt.test.ts:41-48→[0x1b,0x40,0x1b,0x74,0x3d]; EKLENEN test esc-pos PAGE61 byte assert + bill default-param 29. bill-receipt.ts:13 header + codepage-scan.ps1:13/78 rehber metni güncellenir. Cutover-sonrası codepage-scan.ps1 POS-80'de 61 ampirik teyit. REDDEDİLEN: agent-config codepage(ölü/kırılgan), server-side migration(v5.1), tek-sabit-61(mutfak kırar), param'sız-gömme(model-coupling), ikinci _JP80H adı(iki isim tek byte), abstraction/string-enum/UI(kapsam). Bağlı: ADR-004 §7 · ADR-032 · ADR-022 v5.1 -->

---

## ADR-004 Amendment 4 — Windows Spooler RAW Pass-Through Transport (Zadig'siz kasa/USB baskı; Adisyo cutover koruması)

- **Durum**: **Accepted** (İlhan onayı 2026-07-08, Session 87 — implementasyon bilinçli olarak sonraki oturuma ertelendi)
- **Tarih**: 2026-07-08 (Session 87)
- **İlişki**: ADR-004 (Print Agent Mimarisi) **§5 amendment'ı** — mevcut transport ailesine (TCP 9100 + USB libusb) **üçüncü transport** (`type: 'spooler'`) ekler. Amendment olarak numaralandı (yeni ADR değil): bu kodbanının kendi belirlediği numaralandırma kriterine göre. **ADR-032** yeni-ADR-numarası aldı çünkü **yeni bir server/cross-service runtime kontratı** getiriyordu (`GET /jobs/next?kind=` claim query param + claim SQL predikatı). Bu değişiklik ise server/API/`print_jobs` payload/enqueue kontratına **HİÇ dokunmaz** — tamamen agent-içidir (bir config-union dalı + bir transport modülü + bir dispatch dalı + bir yardımcı exe). Bu, **ADR-004 Amendment 3'ün amendment kriteriyle birebir aynıdır** ("yeni runtime kontratı getirmiyor"). Ayrıca spooler transport **ADR-022 v5.1+ backlog'unda (M1–M6) YOKTUR** → oradan "öne çekme" gerekçesine ihtiyaç duyulmaz; bu, ADR-004 §5'in kendi sahiplendiği transport listesinin doğal genişlemesidir.
- **Bağlı ADR'lar**: ADR-004 §5 (transport ailesi), ADR-004 Amendment 3 (kasa CP857/ESC t 61 render — spooler bu byte'ları TAŞIYAN katman, üretmez), ADR-032 (jobKinds routing — DEĞİŞMEDEN çalışır), ADR-022 (v5.1+ backlog — spooler orada değil; vendor-in-repo binary + pkg native-addon öğretileri referans).

### Bağlam

Pilot cutover planı (ADR-004 Amendment 3 + Session 84) kasa yazıcısı için şu yolu öngörüyordu: POS-80 (USB) yazıcısını **Zadig ile WinUSB** sürücüsüne çevir → agent'ın `usb` (libusb) transport'uyla bas. Bu yol iki kanıtlanmış soruna yol açıyor:

1. **`Kullanıcı gözlemi:` Zadig, Adisyo'nun kullandığı Windows print sürücüsünü söküyor.** Kasa yazıcısı Windows'ta **`KASA-2026` adlı print queue** olarak kurulu ve halen **canlı ticari POS (Adisyo)** ona spooler/sürücü üzerinden basıyor. Zadig sürücüyü WinUSB'e çevirince Adisyo o yazıcıya **basamaz** hâle geliyor. Session 84'te bu **canlı kazaya** yol açtı ve geri alındı (`feedback_destructive_op_live_hardware_warn_hard`). Dahası, 2–4 haftalık **rollback penceresi** boyunca Adisyo yedek olarak kullanılamaz olur — bu, ADR öncelik #2 (veri bütünlüğü) ve #3 (yoğun saatte iş akışı) ile çelişir.
2. **`Kodda tespit:` libusb USB transport'u gerçek donanımda hiç doğrulanmadı** (ADR-022: "PR-5b USB lokal donanım eşliğine ertelendi"). Kitchen yazıcısı zaten Ethernet/TCP 9100 ile canlı; USB transport pilotta yalnız kasa için düşünülmüştü ama fiziksel teyit hiç yapılmadı.

**Bu oturumun ampirik kanıtı (veri — yeniden keşfedilmez):** `renderBillReceipt`'in ürettiği **TAM byte akışı** (ESC t 61 / CP857, ADR-004 Amendment 3), Windows spooler'a **RAW datatype** ile gönderilince POS-80'de **kusursuz bastı** — DİLAN PİDE (İ), ADİSYON, Fiş No (ş), Kıymalı/Çoban (ı/Ç), Teşekkür ederiz (ş/ü), düzen + kâğıt kesme hepsi doğru. **Zadig gerekmedi, sürücü değişmedi, Adisyo etkilenmedi** (round-trip sonrası Adisyo hâlâ basıyor, doğrulandı). Kanıtlanan Win32 çağrı zinciri: `winspool.drv` → `OpenPrinter(name)` → `StartDocPrinter(level=1, DOCINFO{ pDatatype = "RAW" })` → `StartPagePrinter` → `WritePrinter(bytes)` → `EndPagePrinter/EndDocPrinter/ClosePrinter`. Config girdisi = **Windows queue adı** (VID/PID değil).

**İkincil kazanım:** Bu test aynı zamanda Amendment 3'ün `Doğrulanmamış:` etiketli **kasa ESC t 61 (0x3d)** varsayımını fiili olarak **doğruladı** (renderBillReceipt PAGE61 byte'larıyla Türkçe doğru bastı). Amendment 3'ün cutover-scan ayağı bu ADR ile örtüşür (bkz. Açık sorular).

**Sorun cümlesi:** Cutover'ın en kırılgan + en riskli adımı (Zadig sürücü değişimi) hem Adisyo'yu bozuyor hem de rollback güvenliğini yok ediyor. Spooler RAW transport bu adımı **komple eler**: aynı yazıcıya, aynı sürücü üzerinden, Adisyo'yu bozmadan basar.

### Karar

**Print Agent'a `spooler` adında üçüncü bir transport eklenir: byte akışını Windows print spooler'a `RAW` datatype ile yollar.** Byte üretimi (render / encode-cp857 / codepage — `shared-domain`) ve server/API/payload/enqueue kontratları **DEĞİŞMEZ**; yalnız yeni bir **çıkış yolu** eklenir. Agent'ın "dumb byte-writer" ilkesi (ADR-004) korunur — spooler transport da opaque `bytesBase64`'ü decode edip HAM yazar, içeriğe bakmaz.

**1. Config şeması (`apps/print-agent/src/printer/config.ts`) — üçüncü discriminated-union dalı:**
```ts
const SpoolerPrinterConfigSchema = z.object({
  type: z.literal('spooler'),
  /** Windows print queue adı (Denetim Masası > Yazıcılar), örn. 'KASA-2026'. VID/PID DEĞİL. */
  printerName: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(60000).default(10000),
});
export const PrinterConfigSchema = z.discriminatedUnion('type', [
  TcpPrinterConfigSchema,
  UsbPrinterConfigSchema,
  SpoolerPrinterConfigSchema, // ← EKLENEN 3. dal
]);
```
- **Geriye dönük uyumlu:** discriminated union'a dal eklemek mevcut `tcp`/`usb` config dosyalarını BOZMAZ; onları parse eden hiçbir alan değişmez.
- `AgentConfigSchema.jobKinds` (ADR-032) **aynen çalışır** — printer transport'undan bağımsız ortogonal alan. Kasa örneği: `{ "printer": { "type": "spooler", "printerName": "KASA-2026" }, "jobKinds": ["bill"] }`.
- Env-compose yolu (`PRINT_AGENT_PRINTER_HOST/_PORT`, TCP-only) DEĞİŞMEZ; spooler yalnız config **dosyasıyla** tanımlanır (integer/isim ayrımı yok, string doğrudan). İstenirse `PRINT_AGENT_PRINTER_NAME` env eklenebilir (implementer takdiri, YAGNI).

**2. ⭐ KRİTİK TEKNİK KARAR — winspool'a RAW nasıl gönderilir: bundled runtime-bağımsız yardımcı exe (byte'lar stdin ile). [Seçenek (b)]**

Node'da yerleşik winspool yok. **Karar: küçük, runtime-bağımsız bir native yardımcı exe** paketlenir; agent bunu `child_process` ile spawn edip **byte'ları stdin'den** geçirir, printer queue adını `argv[1]` ile verir. Yardımcı yalnız `winspool.drv` (her Windows'ta var olan sistem DLL'i) ile linklenir: `OpenPrinter → StartDocPrinter(RAW) → StartPagePrinter → WritePrinter(stdin bytes) → EndPagePrinter/EndDocPrinter/ClosePrinter`. Bu oturumda kanıtlanan C# RawPrinter **davranış olarak** referanstır — **kod kopyalanmaz** (CLAUDE.md v3/kopya-yasağı ruhu; sıfırdan yazılır).

Neden (a) native npm modülü (ör. `@thiagoelg/printer` benzeri winspool wrapper) **REDDEDİLDİ:** agent `@yao-pkg/pkg` ile tek `.exe`'ye derleniyor ve `usb` addon'unu `pkg.assets`'e `node_modules/usb/**/*` olarak gömüyor — bu **yalnızca `usb` sağlam N-API prebuild'leri (node22-win-x64) sunduğu için** çalışıyor. İkinci bir native addon eklemek: prebuild'i node22-win-x64 için garanti değil (çoğu printer modülü NAN/eski, Node 22'de yüklenmez veya MSVC toolchain ister), pkg native-addon acısını **ikiye katlar** (`feedback_pkg_yao_migration` = pkg node18'de kaldı; `feedback_pkg_shared_types_cjs_export` = ERR_PACKAGE_PATH_NOT_EXPORTED). Yardımcı exe bu risk sınıfını **tamamen atlar** — Node tarafında sıfır yeni native addon.

Neden **stdin** (temp-file değil): disk'e fiş byte'ı yazmaz (temizlik + KVKK-hijyen; ADR öncelik #1), race/cleanup yok, atomik. Fiş byte'ları birkaç KB — stdin sığar.

Neden **runtime-bağımsız** (self-contained .NET DEĞİL): framework-bağımlı .NET exe restoran PC'sinde .NET kurulumu varsayar (kırılgan); self-contained .NET ~60–70MB (MSI'yı şişirir). Hedef: **birkaç KB, sıfır-runtime** native exe — C/C++ (MSVC/clang, yalnız `winspool.lib`) veya Rust (statik) tercih; C# **NativeAOT** kabul edilebilir (~birkaç MB, runtime kurulumu gerektirmez) ama daha büyük. Toolchain seçimi Açık soru #1.

**Binary tedarik + paketleme — vendor-in-repo (nssm.exe emsali):** Yardımcı exe **prebuilt olarak repo'ya `vendor/` altında commit edilir** (`feedback_vendor_in_repo_binary` — nssm.exe paterni: offline + deterministik CI, toolchain'i CI'ya sokmadan). Kaynağı + build script'i de repo'da (audit/tekrar-üretilebilirlik). MSI, yardımcıyı agent binary'sinin **yanına (sibling)** kurar; agent onu **exe-komşusu sabit yoldan** çözer (`PRINT_AGENT_SPOOLER_HELPER_PATH` env override → default: agent exe dizininde). Böylece **pkg'ın virtual FS'inden spawn sorunu** (pkg snapshot yolundan `CreateProcess` yapılamaz) hiç doğmaz — yardımcı gerçek diskte, MSI payload'ı olarak. `pkg.assets`'e yardımcıyı gömüp runtime'da `%TEMP%`'e çıkarma yolu (b1) yalnız MSI-dışı dev/`tsx` çalıştırması için fallback; birincil yol MSI-sibling.

**3. Windows-only guard.** Spooler transport yalnız Windows'ta anlamlı. Schema **platform-agnostik kalır** (config CI/Linux'ta parse + test edilebilir); guard **transport çağrısında** yapılır: `process.platform !== 'win32'` ise açıklayıcı `Error` fırlar (`SPOOLER_ERROR_UNSUPPORTED_PLATFORM`) — usb-transport'un tipli-hata paterniyle aynı. Fail-fast, ama boot'u schema-seviyesinde platforma bağlamaz. Agent zaten Windows hedefli (pkg `node22-win-x64`, MSI).

**4. Coexist — libusb USB transport KALIR (silinmez).** Spooler **yeni bir opsiyondur**, replace değil. Windows print queue'su olan yazıcılar için (KASA-2026 + Adisyo-paylaşımlı yazıcılar) **spooler önerilen/dokümante default**; libusb yolu, kasıtlı WinUSB'e çevrilmiş veya Windows sürücüsü olmayan cihazlar için opsiyon olarak durur. libusb transport'u SİLMEK CLAUDE.md "önceden var olan dead code sorulmadan silinmez" + cerrahi-değişiklik ilkesine aykırı olurdu; ayrıca gelecekteki WinUSB senaryosu için değerli. Pratik pilot sonucu: kasa → spooler (kanıtlı), mutfak → TCP (canlı), libusb → tutulur-ama-kullanılmaz.

**5. Hata/retry paritesi.** Yardımcı exe hatayı **non-zero exit code + stderr mesajı** ile bildirir; agent bunu tipli hataya map'ler (usb-transport'un `LIBUSB_ERROR_*` ve tcp-transport'un `ECONNREFUSED/ETIMEDOUT` paternine denk):
- `SPOOLER_ERROR_PRINTER_NOT_FOUND` — `OpenPrinter` başarısız / yanlış queue adı (Win32 `ERROR_INVALID_PRINTER_NAME` 1801).
- `SPOOLER_ERROR_ACCESS_DENIED` — `ERROR_ACCESS_DENIED` (5); queue izinleri / başka process kilidi.
- `SPOOLER_ERROR_WRITE` — `WritePrinter` kısmi/başarısız (sürücü/queue hatası).
- `SPOOLER_ERROR_TIMEOUT` — yardımcı `config.timeoutMs`'i aştı → agent child'ı **öldürür** (tcp/usb'deki tek-bütçe timeout paritesi).
- `SPOOLER_ERROR_SPAWN` — yardımcı exe bulunamadı/başlatılamadı (yol/kurulum sorunu).
Transport **tek deneme** yapar ve hata fırlatır (tcp/usb ile aynı; server-side retry Migration 036 requeue eder). Ana döngü sözleşmesi **DEĞİŞMEZ**: `pollOnce` try/catch zaten transport hatasını yakalayıp `reportResult(..., 'failed', errorText)` yolluyor (`index.ts:355-358`) — sadece yeni dispatch dalı eklenir. Aynı `settled`-flag / tek-settle race önlemi (child exit vs timeout kill) usb/tcp'deki gibi uygulanır.

**6. Dispatch (`apps/print-agent/src/index.ts`) — exhaustive switch'e çevrilir.** Mevcut `if (type==='usb') … else sendToTcpPrinter` **yanlış olur** (spooler config'i `else` dalından TCP'ye düşer). Dispatch, `printerConfig.type` üzerinde **exhaustive `switch`** (veya `never` tükenmişlik kontrollü if/else-if) yapılır → gelecekte 4. varyant eklenirse **derleme kırılır** (sessiz yanlış-yönlendirme önlenir). `describePrinter()` (`index.ts:367-374`) bir `spooler <printerName>` dalı alır (log paritesi).

**7. MSI/config wiring + kapsam kilidi.**
- `print-agent.json` örneği (kasa): `{ "printer": { "type": "spooler", "printerName": "KASA-2026" }, "jobKinds": ["bill"] }`.
- İkinci agent kurulumu (`install-second-agent.ps1`, ADR-032): script'e **printer spec** (spooler `printerName`) param'ı eklenir; `-JobKinds bill` ile birlikte config dosyasını yazar. Yardımcı exe **tek kez** (agent binary yanına) kurulur; her iki agent instance aynı sibling yardımcıyı kullanır. Detaylar implementer'a; ADR yön verir: yardımcı = MSI payload sibling; config = `printerName` alanı; helper yolu = env-override → exe-komşusu default.
- **Kapsam kilidi:** Bu **yeni bir kullanıcı özelliği DEĞİLDİR.** MEVCUT ve v5.0-kapsamındaki **kasa fiş-baskı** yeteneğinin gerçek donanımda **güvenli** (Adisyo'yu bozmadan, Zadig'siz) çalışmasını sağlayan **pilot-enabling altyapıdır** — ADR-032 ve Amendment 3 ile birebir aynı emsal (ertelenmiş/kırılgan bir yazıcı yolunu pilot go-live için sertleştirmek). ADR-022 backlog'unda değildir (çekme çatışması yok). **Yönetim UI'si / genel per-yazıcı config YOKTUR** (v5.1). Config-dosyası-only.

### Değerlendirilen alternatifler

- **Numaralandırma: bağımsız ADR-033.** REDDEDİLDİ (Amendment 4 seçildi). Gerekçe: bu kodbanının numaralandırma kriteri *kod büyüklüğü* değil *kontrat yüzeyi*dir. ADR-032 yeni numara aldı çünkü **server-side API kontratı** (claim query param) değiştirdi; spooler **hiçbir server/API/payload/enqueue kontratı** değiştirmez — ADR-004 §5'in kendi transport ailesine bir üye ekler (Amendment 3'ün "yeni runtime kontratı yok → amendment" kriteriyle aynı). Bağımsız keşfedilebilirlik argümanı zayıf: değişiklik cerrahi ve tümüyle ADR-004 §5 kapsamında. Tutarlılık → Amendment 4.
- **(a) Native npm printer modülü (winspool wrapper).** REDDEDİLDİ: ikinci native addon → pkg native-addon riskini ikiye katlar (node22-win-x64 prebuild garantisi yok; NAN/eski modüller Node 22'de yüklenmez; MSVC toolchain riski). Yardımcı exe bu sınıfı tümüyle atlar.
- **(c) PowerShell shell-out (her işte `Add-Type` winspool P/Invoke).** REDDEDİLDİ: her çağrıda C# derleme → yüzlerce ms startup/iş; ExecutionPolicy kırılganlığı (`Restricted`/`AllSigned` engeller, `-ExecutionPolicy Bypass` bazı sertleştirilmiş ortamlarda yasak); PowerShell sürüm varyansı; binary byte'ı pipe'tan geçirmek PS'de sorunlu (stdout mangling). Slow + fragile + binary-hostile.
- **Self-contained / framework-bağımlı .NET yardımcı.** REDDEDİLDİ: self-contained ~60–70MB (MSI şişer); framework-bağımlı restoran PC'sinde .NET kurulumu varsayar (kırılgan). Runtime-bağımsız tiny native tercih.
- **Byte'ı temp-file ile geçirmek.** REDDEDİLDİ (stdin tercih): disk'e fiş byte'ı yazımı + cleanup + KVKK-hijyen; küçük payload stdin'e sığar.
- **libusb transport'u kaldırıp spooler ile değiştirmek.** REDDEDİLDİ: coexist tercih (dead-code silme yasağı + gelecek WinUSB senaryosu + cerrahi ilke).
- **Yardımcıyı CI'da build etmek (vendor yerine).** REDDEDİLDİ: CI'ya C/Rust/dotnet toolchain sokar; nssm.exe emsali (`feedback_vendor_in_repo_binary`) = prebuilt vendor-in-repo, offline + deterministik.

### Kritik kenar durumlar

1. **Adisyo koruması (birincil hedef):** spooler aynı Windows sürücüsünü kullanır → cutover'da sürücü değişmez → Adisyo o yazıcıya basmaya devam eder → 2–4 haftalık rollback penceresi güvenli. Zadig kazası (S84) yapısal olarak imkânsızlaşır.
2. **Non-Windows host** (`type: 'spooler'` CI/dev/Linux'ta): transport `SPOOLER_ERROR_UNSUPPORTED_PLATFORM` fırlatır; schema yine parse eder (test edilebilir).
3. **Yardımcı exe eksik/başlatılamaz:** `SPOOLER_ERROR_SPAWN` → job `failed` → server requeue. Kurulum runbook'u yardımcının sibling kurulduğunu doğrular.
4. **Queue adı yanlış / yazıcı silinmiş:** `SPOOLER_ERROR_PRINTER_NOT_FOUND` (1801) → `failed`; operatör queue adını (Denetim Masası) düzeltir.
5. **Timeout:** yardımcı `timeoutMs` aşarsa agent child'ı öldürür → `SPOOLER_ERROR_TIMEOUT`; dangling process kalmaz (tcp/usb settle paritesi).
6. **ADR-032 routing DEĞİŞMEZ:** `jobKinds: ["bill"]` kasa agent'ı spooler transport'la basar; `kind` filtresi + retry/reclaim + `bytesBase64` payload aynen çalışır. Codepage (Amendment 3, ESC t 61) render-anında baked → spooler onu opaque taşır.
7. **byte-identical baskı:** render/encode/codepage dokunulmadığı için spooler ile basılan fiş, aynı byte'ların TCP/USB ile basılanıyla birebir aynıdır; yalnız çıkış transport'u farklı.

### Sonuçlar

- **(+)** Cutover'ın en riskli+kırılgan adımı (Zadig sürücü değişimi) **komple elenir**; Adisyo rollback penceresinde çalışır kalır (ADR öncelik #2/#3). Bu oturumda **ampirik kanıtlı** yol (POS-80'de kusursuz Türkçe baskı). Byte üretimi + server/API/payload/enqueue/ADR-032 routing **DEĞİŞMEZ** (cerrahi: 1 config dalı + 1 transport modülü + 1 dispatch switch + 1 vendored yardımcı exe). Node tarafında **sıfır yeni native addon** → pkg native-addon riski atlanır. Amendment 3'ün kasa ESC t 61 varsayımını fiili doğrular. Windows print queue'su olan her yazıcı için Zadig'siz genel yol (gelecek yazıcılar da).
- **(−)** Yeni bir **vendored native binary** (yardımcı exe) + onu üreten toolchain (build-time, CI'da değil) → supply-chain yüzeyi büyür (nssm.exe ile aynı sınıf; audit için kaynak+build-script repo'da). Node dışı bir process spawn'ı = ekstra failure mode (spawn/exit-code mapping). Windows-only (macOS/Linux out-of-scope, zaten sabit). MSI payload'ına yeni dosya → installer + smoke güncellemesi gerekir (Phase 3 MSI E2E'yi tekrar koşmak).

### Çözülen sorular (İlhan onayı, 2026-07-08 — Session 87)

1. **Yardımcı exe toolchain → C# NativeAOT.** Bu oturumda kanıtlanan winspool C# mantığı yeniden kullanılır; ekip .NET 8'e (caller-bridge) aşina, repo'da mevcut toolchain; ~birkaç MB, runtime-kurulumsuz. Minimal C/Rust en küçük binary'yi verirdi ama vendored-prebuilt olduğu için boyut önemsiz → proven-reuse + toolchain-tutarlılığı için C# NativeAOT seçildi. (NativeAOT native linker/MSVC gerektirir — build-time, dev makinesinde; CI'ya girmez, vendored.)
2. **Amendment 3 `Doğrulanmamış:` (ESC t 61) → DOĞRULANDI.** Bu oturumun spooler testi renderBillReceipt PAGE61 byte'larıyla Türkçe'yi fiilen doğru bastı → varsayım kanıtlandı. Etiketin `esc-pos.ts` yorumu + `docs/ops/cutover-gunu-runbook.md` + Amendment 3 metninden resmen kaldırılması **implementasyon DoD'una** eklendi (aşağıda; sonraki oturum).
3. **Dokümante default → EVET.** Windows print queue'su olan USB yazıcılar için spooler = önerilen default; libusb "yalnız WinUSB/sürücüsüz cihaz" olarak dokümante edilir (kod her ikisini tutar). Implementer runbook'ta belgeler.
4. **Helper yol çözümü → env-override + exe-komşusu default.** `PRINT_AGENT_SPOOLER_HELPER_PATH` env → yoksa agent exe dizini (sibling). MSI sabit yol tercih edilmedi (esneklik).

### Definition of Done (implementer — bu ADR Accepted olduktan SONRA)

- [ ] `apps/print-agent/src/printer/config.ts`: `SpoolerPrinterConfigSchema` (`type:'spooler'`, `printerName: z.string().min(1)`, `timeoutMs` default 10000); `PrinterConfigSchema` discriminatedUnion'a 3. dal; `SpoolerPrinterConfig` type export. Mevcut tcp/usb config'ler byte-uyumlu (backward-compat test).
- [ ] `apps/print-agent/src/printer/spooler-transport.ts` (YENİ): `sendToSpoolerPrinter(bytes, config): Promise<void>` — `process.platform` guard; sibling/env yardımcı exe'yi spawn; byte'lar stdin; `printerName` argv; `timeoutMs` kill; exit-code→tipli hata (§5). usb-transport'un settle/tek-settle race paterni.
- [ ] `apps/print-agent/src/index.ts`: dispatch → exhaustive `switch(printerConfig.type)` (`never` tükenmişlik); `describePrinter` spooler dalı. Ana döngü `failed`-raporlama kontratı DEĞİŞMEZ.
- [ ] Yardımcı exe: kaynak + build script repo'da; **prebuilt `.exe` `vendor/` altına commit** (nssm.exe `!vendor/` negation paterni). Node native addon EKLENMEZ; `pkg.assets`'e Node-addon eklenmez.
- [ ] MSI/`installer`: yardımcı exe payload'a (agent sibling); `install-second-agent.ps1` printer-spec param (`printerName`) + config yazımı. Lokal MSI smoke (`feedback_local_msi_smoke_faster`) + Phase 3 install/uninstall E2E tekrar.
- [ ] Test (LOKAL): (a) config parse — spooler variant + backward-compat tcp/usb; (b) transport — spawn mock: stdin=bytes, argv=printerName, exit 0→resolve, non-zero→tipli hata, timeout→kill+`SPOOLER_ERROR_TIMEOUT`; (c) non-win32 guard fırlatır; (d) dispatch exhaustiveness (type coverage).
- [ ] Kurulum runbook: kasa `print-agent.json` spooler örneği (`printerName:"KASA-2026"`, `jobKinds:["bill"]`); yardımcı exe sibling doğrulaması; queue-adı bulma (Denetim Masası).
- [ ] i18n/UI YOK (config dosyası + arka plan servis) → hci gate uygulanmaz. security-reviewer: yeni native binary spawn + supply-chain (vendored exe) + auth/PII dokunmaz (byte opaque) → binary-provenance + spawn-input hijyeni gözden geçirir. db-migration-guard: migration YOK → tetiklenmez.
- [ ] ADR-022 (v5.1) not: genel per-yazıcı transport config + yönetim UI + auto-discovery hâlâ v5.1.
- [ ] Amendment 3 `Doğrulanmamış:` ESC t 61 etiketini kaldır (`esc-pos.ts` yorumu + `docs/ops/cutover-gunu-runbook.md` + Amd3 metni) — S87 spooler testi doğruladı (Çözülen soru #2).
- [x] **Durum `Accepted`** (İlhan onayı 2026-07-08, S87). Implementasyon bilinçli olarak sonraki oturuma ertelendi (uzun [KOD] işi → taze oturumda implementer + qa + MSI E2E).

<!-- ADR-004 Amd4 ACCEPTED (2026-07-08, S87; İlhan onayı, impl sonraki oturuma) — WINDOWS SPOOLER RAW PASS-THROUGH TRANSPORT. Amendment(yeni-ADR değil): ADR-032 yeni-numara aldı çünkü SERVER API kontratı(claim ?kind) değiştirdi; spooler HİÇ server/API/payload/enqueue kontratı değiştirmez → agent-içi, ADR-004 §5 transport ailesine 3. üye (Amd3 kriteriyle aynı: "yeni runtime kontratı yok"). ADR-022 backlog'unda YOK→çekme argümanı gerekmez. MOTİVASYON(kanıt S87): renderBillReceipt TAM byte(ESC t 61/CP857) Windows spooler RAW ile POS-80'de KUSURSUZ Türkçe bastı, ZADIG GEREKMEDİ+sürücü değişmedi+ADİSYO ETKİLENMEDİ(round-trip doğrulandı); Zadig yolu Adisyo sürücüsünü söküyor(S84 canlı kaza)+2-4hf rollback penceresini bozuyor. KANITLI ZİNCİR: winspool.drv OpenPrinter→StartDocPrinter(DOCINFO pDatatype=RAW)→StartPagePrinter→WritePrinter→End/Close; config=WINDOWS QUEUE ADI(VID/PID değil). KARAR 1)config.ts 3.dal SpoolerPrinterConfigSchema{type:'spooler',printerName:string.min1,timeoutMs} discriminatedUnion(backward-compat); jobKinds(ADR-032) aynen. 2)⭐WINSPOOL MEKANİZMASI=BUNDLED RUNTIME-BAĞIMSIZ YARDIMCI EXE[(b)] byte'lar STDIN, printerName argv, winspool-only; (a)native-npm-modül REDDEDİLDİ(2. native addon=pkg risk ikiye katlanır, node22-win-x64 prebuild garantisi yok, feedback_pkg_yao/shared_types_cjs); (c)PowerShell-Add-Type REDDEDİLDİ(startup+ExecutionPolicy+binary-hostile); self-contained/framework .NET REDDEDİLDİ(60-70MB/kırılgan)→tiny C/Rust/C#-NativeAOT; VENDOR-IN-REPO prebuilt exe(nssm emsali feedback_vendor_in_repo_binary, kaynak+build repo'da, CI'da build YOK); MSI-SIBLING kurulum(pkg virtual-FS spawn sorunu doğmaz), env-override PRINT_AGENT_SPOOLER_HELPER_PATH→exe-komşusu default. 3)Windows-only: schema portable, transport'ta process.platform guard→SPOOLER_ERROR_UNSUPPORTED_PLATFORM. 4)COEXIST: libusb KALIR(silinmez), spooler=Windows-queue-yazıcılar için önerilen default. 5)hata paritesi: exit-code+stderr→tipli SPOOLER_ERROR_{PRINTER_NOT_FOUND(1801)/ACCESS_DENIED(5)/WRITE/TIMEOUT(kill)/SPAWN}; tek-deneme, main-loop failed-rapor DEĞİŞMEZ(index.ts:355). 6)dispatch: if/else→EXHAUSTIVE switch(never)(spooler else'ten TCP'ye düşmesin)+describePrinter dalı. 7)MSI: install-second-agent.ps1 printerName param; KAPSAM=pilot-enabling altyapı(mevcut kasa-baskıyı Zadig'siz güvenli kıl), yeni user-feature DEĞİL, UI/per-yazıcı-config YOK(v5.1). İKİNCİL: ESC t 61(Amd3 Doğrulanmamış) fiilen doğrulandı. Açık sorular: helper toolchain(C/Rust/C#-AOT), Amd3-Doğrulanmamış kapanışı, spooler-default dokümantasyonu, helper-yol. REDDEDİLEN: ADR-033(kontrat-yüzeyi kriteri→amendment), native-npm, PowerShell, .NET-framework, temp-file(stdin tercih), libusb-replace(coexist), CI-build(vendor tercih). Bağlı: ADR-004 §5 · ADR-004 Amd3(ESC t 61 taşınan byte) · ADR-032(jobKinds aynen) · ADR-022 v5.1 -->

---

