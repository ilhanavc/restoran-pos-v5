# F4e consumer envanteri — `users` · `agents` · `refresh_tokens`

> **Üretim tarihi:** 2026-09-30 (Session 135)
> **Yöntem:** `apps/api/src` + `packages/db/src` + `packages/shared-domain/src` üzerinde
> statik tarama (test dosyaları ve `packages/db/migrations/` hariç). Her erişimin
> executor'ı (`deps.db` / `db` / `trx`) ve tenant filtresinin varlığı tek tek okundu.
> **Amaç:** ADR-041 Amendment 7 (dar F4e) için kanıt tabanı.
> [[feedback_rls_consumer_completeness_audit]] — RLS öncesi TAM consumer envanteri.

---

## 0. Baş bulgu — Amendment 2 Karar 2'nin gerekçesi bugünkü kodla çelişiyor

Amendment 2, üç tabloyu birden **"pre-context / chicken-and-egg"** diye F4'ten
çıkarmış ve bir **login-resolution ADR'sine** bağlamıştı. Kod okunduğunda bu
gerekçe **yalnız bir tablo için** geçerli:

| Tablo | Amd2'nin varsayımı | Kodda doğrulanan gerçek | Sonuç |
|---|---|---|---|
| `users` | pre-context | `routes/auth.ts:117-120` → `findByEmail(deps.tenantId, email)`. Tenant **sunucu-taraflı sabitten** gelir, login'den ÖNCE bilinir. `/me` (`auth.ts:276-279`) JWT'den (`req.user.tenantId`). Repo'nun her metodu zaten `tenantId` parametresi alıyor (`repositories/users.ts:109,120,132`). | ❌ chicken-and-egg **yok** |
| `agents` | pre-context → "tüm agent auth 401, baskı sessizce durur" | `middleware/print-agent-auth.ts:103-113` → tenant **doğrulanmış JWT payload'ından** (`payload['tid']`) gelir ve sorguda zaten `.where('tenant_id','=',tenantId)` var. | ❌ chicken-and-egg **yok** (register hariç, §3) |
| `refresh_tokens` | pre-context | `repositories/refresh-tokens.ts:83` `findByTokenHash(tokenHash)` ve `:95` `findActiveByFamilyForUpdate(familyId)` — **tenant filtresi HİÇ YOK**; tenant satırın kendisinden öğreniliyor. Rotasyon `auth/refresh.ts:167` düz `.transaction()` içinde koşuyor. | ✅ **gerçek** chicken-and-egg |

**Çıkarım:** F4e bir "çok-tenant login mimarisi" işi değil. Yüzey iki parçaya
ayrılıyor: (A) mekanik `withTenant` sarımı, (B) yalnız refresh-rotasyonu ve agent
register için dar bir pre-context kararı. Tek-tenant MVP'de (A) bugün yapılabilir.

---

## 1. `agents` — 13 erişim (10'u context'siz)

> ⚠️ Amendment 4 Karar 4'te **4 satır** önceden yazılıydı
> (`print-agent-auth.ts:107` + `print-jobs.ts:597/623/734`).
> Gerçek sayı **10**. Envanter **%40 tamdı** — eksik 6 satır aşağıda ✚ ile işaretli.

### 1a. Post-auth — tenant BİLİNİYOR, `withTenant` ile sarılabilir

| # | Yer | İşlem | Tenant kaynağı |
|---|---|---|---|
| 1 | `middleware/print-agent-auth.ts:108` | `selectFrom('agents')` | JWT `payload['tid']` — sorguda zaten filtreli |
| 2 ✚ | `middleware/print-agent-auth.ts:128` | `updateTable('agents')` `last_seen_at` | aynı istek; **fire-and-forget + `.catch(()=>{})`** |
| 3 ✚ | `routes/orders.ts:1001` | `selectFrom('agents')` | istek context'i |
| 4 ✚ | `routes/print-jobs.ts:265` | `updateTable('agents')` `declared_kinds` | **fire-and-forget + `.catch(()=>{})`** (Amd4 Karar 4'te "gözlem alanı" olarak kayıtlı) |
| 5 ✚ | `routes/printers.ts:149` | `selectFrom('agents')` | yazıcı yönetim ekranı |
| 6 ✚ | `routes/printers.ts:206` | `selectFrom('agents')` | yazıcı yönetim ekranı |
| 7 | `routes/print-jobs.ts:734` | `selectFrom('agents')` | refresh — §3'e bak |

**Zaten sarılı (3):** `routes/printers.ts:393`, `:403`, `:465` — executor `trx`
(`withTenant` içinde, opener `printers.ts:462`).

> **⚠️ İki sessiz-yutma sitesi (#2, #4).** İkisi de `.catch(() => {})`. RLS
> geldiğinde sarım eksik kalırsa hata **hiç görünmez**: `last_seen_at` ve
> `declared_kinds` sessizce donar → yazıcı yönetim ekranı yanlış bilgi gösterir,
> uyarı yanmaz. Bu, S134'ün "sessiz bozulma" sınıfının aynısıdır.

### 1b. Pre-auth — register akışı (§3)

| Yer | İşlem | Neden pre-context |
|---|---|---|
| `routes/print-jobs.ts:597` | `selectFrom('agents')` | register/refresh, JWT'den önce |
| `routes/print-jobs.ts:623` | `selectFrom('agents')` | **fingerprint oracle** — Amd4'te kayıtlı açık bulgu |
| `routes/print-jobs.ts:648` ✚ | `insertInto('agents')` | yeni agent kaydı |

---

## 2. `users` — 14 erişim

### 2a. ~~4 context'siz erişim~~ → ❌ **YANLIŞ ALARM — ÇÜRÜTÜLDÜ (S135, aynı oturum)**

> Bu bölümün ilk hâli `print/enqueue-{bill,cancel,kitchen,packing}-job.ts`'teki
> dört `users` okumasını "context'siz" ilan ediyordu. **Yanlıştı.** Düzeltme
> Amendment 7 yazımı sırasında yakalandı ve bağımsız olarak doğrulandı.

| Yer | İşlem | Gerçek durum |
|---|---|---|
| `print/enqueue-bill-job.ts:131` | `selectFrom('users')` | ✅ context'li |
| `print/enqueue-cancel-job.ts:147` | `selectFrom('users')` | ✅ context'li |
| `print/enqueue-kitchen-job.ts:182` | `selectFrom('users')` | ✅ context'li |
| `print/enqueue-packing-job.ts:140` | `selectFrom('users')` | ✅ context'li |

**Neden yanlış alarmdı — üç bağımsız kanıt:**

1. **`db` bir parametre adı, bare pool değil.** `enqueueBillJob(db: Kysely<DB>, input)`
   (`enqueue-bill-job.ts:51-52`) — executor **enjekte** ediliyor. Statik tarama
   yalnız tanımlayıcı adına baktığı için `deps.db` ile aynı kovaya düştü.
2. **Çağıranların tamamı `trx` geçiyor.** Üretim çağrılarında bare `db` geçen
   **sıfır** site var.
3. **Ampirik kanıt (belirleyici).** Aynı executor `print_jobs`'a INSERT atıyor;
   `print_jobs` migration 062'den beri **force-RLS** ve baskı prod'da çalışıyor
   (S134 gece cron'u 176 iş temizledi). Context'siz olsalardı bu yol zaten
   kırılmış olurdu.

Ayrıca sorgunun kendisinde `.where('tenant_id', '=', tenantId)` **zaten var** —
app-katmanı scoping tam.

> **Ders:** executor adına bakan grep, **enjekte edilmiş** executor'ı bare pool'dan
> ayıramaz. Kovalar ayrılmalı: `deps.db` (kesin bare) ≠ `db` (imzaya bakmadan
> karar verilemez). Bu, `audit-tenant-scope.guard.test.ts`'in kendi doc'unda
> yazdığı "grep guard, veri-akışı analizi değil" sınırının diğer yönü: guard
> yanlış-negatif de verebilir, **yanlış-pozitif de**.

**Bu dört dosyaya Amendment 7 kapsamında DOKUNULMAYACAK.**

### 2a-bis. ⚠️ Gerçek bug (Amendment 7 yazımında bulundu)

`middleware/print-agent-auth.ts:127-131` — `last_seen_at` UPDATE'inde
`tenant_id` filtresi **hiç yok** (`.where('id', '=', agentId)` tek başına).
Bu bir RLS eksiği değil, **app-katmanı scoping bug'ı**; Amd7 K3'te düzeltiliyor.

### 2b. Repository katmanı — executor **enjekte**, context çağırana bağlı

`packages/db/src/repositories/users.ts` → satır 111, 121, 133, 144, 182, 205, 214, 226 (8 erişim).
Factory: `createUsersRepository(db: DbExecutor)` (`users.ts:107`). Her metod zaten
`tenantId` parametresi alıp `.where('tenant_id','=',tenantId)` uyguluyor — yani
**app-katmanı scoping tam**; eksik olan yalnız GUC context'i.

### 2c. Seed (prod dışı)

`packages/db/src/seed.ts:118`, `:133` — migration/seed yolu, `migrator` rolü.

---

## 3. `refresh_tokens` — 9 erişim, tek gerçek pre-context yüzey

`packages/db/src/repositories/refresh-tokens.ts` → satır 59, 83, 95, 111, 129, 140, 149, 158, 166.
Factory: `createRefreshTokensRepository(db: DbExecutor)` (`:52`).

**Kritik:** `findByTokenHash(tokenHash)` (`:83`) ve
`findActiveByFamilyForUpdate(familyId)` (`:95`) **tenant parametresi almıyor** —
diğer repo'ların aksine. Tenant, bulunan satırın `tenant_id`'sinden öğreniliyor.

Rotasyon akışı `auth/refresh.ts:150-200`:
- `:156` ön-okuma `repo.findByTokenHash(oldHash)` — **transaction dışında, context'siz**
- `:167` `params.db.transaction().execute(...)` — **tüm apps/api/src'teki TEK düz `.transaction()`**, `withTenant` değil
- `:170` `createUsersRepository(trx)` — aynı context'siz transaction içinde `users`'a da dokunuyor

> Yani `users` force-RLS'e alınırsa **refresh rotasyonu da kırılır** — iki tablo
> bu transaction üzerinden birbirine bağlı. Fazlama bunu hesaba katmalı.

---

## 4. Yan bulgu — `writeAudit` sarım borcu KAPALI (takip maddesi (b))

S134 devrinde açık bırakılan *"yeni sarılan yollar canlıda tetiklenmedi, 500
verirlerse sarım eksik"* maddesi **statik olarak kapatıldı**:

- `apps/api/src` içinde **71** `writeAudit` çağrısı (test dışı).
- **69**'u `withTenant` callback'i içinde (6'sı opener'dan >60 satır uzakta olduğu
  için ilk taramada yanlış-pozitif çıktı; opener'ları tek tek doğrulandı:
  `customers/index.ts:500`, `orders.ts:2713`, `printers.ts:462`, `products.ts:398`).
- **2**'si `cron/ttl-cleanup.ts:295` ve `:456` — belgeli `cron_purger` istisnası
  (guard testi bu dosyayı zaten muaf tutuyor).
- Tüm `apps/api/src`'te düz `.transaction()` **tek** yerde: `auth/refresh.ts:167`,
  ve o dosya `writeAudit` **çağırmıyor** → gölgeleme (shadowing) riski yok.

Mevcut guard'ın (`audit/audit-tenant-scope.guard.test.ts`) kendi doc'unda yazdığı
sınır — *"`withTenant` dışında açılmış düz bir `trx` hâlâ geçebilir"* — bu sayımla
ampirik olarak kapandı: öyle bir `trx` üreten tek site `writeAudit` kullanmıyor.

**Sonuç:** prod'da 500 beklemeye gerek yok; sarım eksiği yok.

---

## 5. Amendment 7'nin cevaplaması gereken sorular

1. **Fazlama.** `users` ile `refresh_tokens` `auth/refresh.ts:167` üzerinden bağlı
   (§3) — ayrı fazlara bölünebilir mi, yoksa tek migration mı?
2. **Pre-context mekanizması.** Refresh rotasyonu + agent register için:
   S134'te kanıtlanmış **sınırlı BYPASSRLS pool** deseni (`cron_purger` gibi) mi,
   yoksa tek-tenant'ta `deps.tenantId`'yi repo imzasına geçirmek mi?
   İkincisi çok-tenant'ta çalışmaz; birincisi yeni rol + prod adımı getirir.
3. **Sessiz-yutma siteleri.** `print-agent-auth.ts:128` ve `print-jobs.ts:265`
   `.catch(()=>{})` — sarımdan sonra da yutmaya devam mı, yoksa log'a mı?
4. **Fingerprint oracle** (`print-jobs.ts:623`, Amd4'te açık kayıt) bu amendment'ta
   kapatılıyor mu — tenant-scoped sorgu **veya** jenerik 409?
5. **Negatif kontrol.** Her sarım için "sarımı sök → `app_tenant` testi kırmızı"
   ampirik kanıtı ([[feedback_rls_test_harness_app_tenant_role]]).
6. **Watchdog etkisi.** Baskı hattı `agents` üzerinden kırılırsa retention
   watchdog'u (Amd6) bunu yakalar mı, yoksa Amd4 K6'da reddedilen
   "baskı-durması dedektörü" sorusu geri mi geliyor?
