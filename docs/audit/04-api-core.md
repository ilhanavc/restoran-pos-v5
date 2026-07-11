# Blok 4 — apps/api çekirdeği (bootstrap, auth, middleware, realtime)

> Derin denetim serisi Blok 4. **Tarih:** 2026-07-11 · **Branch:** `audit/04-api-core` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: security-reviewer — auth/JWT/refresh/cookie · B: security-reviewer — middleware/authz/route-guard-kapsama/rate-limit/permissions-parite · C: qa-engineer — realtime/bootstrap/errorHandler + **canlı pos_test auth/socket/PII testleri**) + ana-context çapraz doğrulama + severity kalibrasyonu.
> **Canlı test:** SADECE `pos_test` (head 044) — prod/pos_dev'e HİÇ dokunulmadı (doğrulandı, 0 artık). Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** **5 yeni test dosyası, 27 test (22 yeşil + 5 kasıtlı KIRMIZI).** Tam apps/api paketi: 728 test → 723 yeşil (mevcut 48 dosya regresyonsuz) + 5 kırmızı.
> **Ham bulgu:** 31 (A:6, B:14, C:11) → duplike (/refresh rate-limit A+B) + emit-ailesi birleşince **26 konsolide: 0 BLOCKER · 4 HIGH · 9 MEDIUM · 9 LOW · 4 NIT.**

---

## 0. Yönetici özeti

**Auth/authz katmanı olgun ve sağlam — korumasız endpoint yok, JWT güvenliği tam.** Blok 1-3'ün "yazılmış-ama-bağlanmamış / şema-yalan" teması burada da baskın: gerçek bulgular *savunma katmanlarının bağlantısızlığında*.

**✅ Güçlü çıkanlar:** ~90 endpoint'in hepsi `authenticate`+`authorize`'dan geçiyor (korumasız yok); JWT `alg=none` reddi + `aud/iss/exp` + refresh reuse-detection (family-nuke) + cookie `Path=/api/auth/refresh` (S82 dersi doğru) + bcrypt cost 12 + hardcoded-secret yok; **socket room izolasyonu canlı doğrulandı** (cross-tenant/cross-role/cross-tenant-same-role hepsi kapalı); logger PII-redaksiyonu + errorHandler log-gate (`status>=500`) sağlam.

**🟠 Ana tema — üç savunma katmanının üçü de emit kontratında delik (HIGH):** Blok 2 SD-T-B-01'in kök nedeni burada kanıtlandı: `kitchen.*` emit'leri (4 site, orders.ts) zod-parse'lı helper'ı bypass ediyor (`deps.io.of().to().emit()` doğrudan) — VE bunu yakalaması gereken (a) ESLint guard 3-seviye zinciri görmüyor, (b) `deps.io` tipsiz olduğu için TS de görmüyor. Üç kontrol de aynı anda devre dışı. Bugün KDS çalışıyor (tüketici `quantity` okuyor) → BLOCKER değil HIGH, ama latent.

**🟠 İkinci tema — permissions matrisi ölü (HIGH, Blok 2 kesinleşmesi):** `permissions.ts` RBAC matrisi apps/api'de HİÇ tüketilmiyor; route'lar rolleri hardcode ediyor → 3 canlı parite drift'i (payments.void matriste yok, caller PATCH & reports CSV cashier'a açık ama matris admin-only).

**🟠 Üçüncü tema — response body PII (HIGH, KVKK):** duplicate email → 409 response'ta ham email (Blok 3 DB-SEC-01'in uçtan-uca tezahürü; log tarafı temiz, response sızıyor; users.ts customers.ts paternini uygulamıyor).

### En kritik 3
1. **API-CORE-01** — duplicate email → response body'de ham e-posta (canlı kanıtlı; users.ts intercept etmiyor). MVP-fix.
2. **API-RT-01/04/05** — emit kontratının üç savunma katmanı da delik (helper-bypass + eslint-gap + tipsiz io). ADR-gerekli.
3. **API-AZ-01** — permissions matrisi hiç enforce edilmiyor + 3 parite drift. ADR-gerekli (Blok 2 SD-T-B-02 ile ortak).

### Severity kalibrasyon notu (şeffaflık)
Hat C 5 bulguyu BLOCKER önerdi. A.4 tanımıyla ("aktif veri kaybı/güvenlik ihlali/para hatası") kalibre edildi: realtime-emit (API-RT-01/02/03) → **HIGH** (bugün KDS çalışıyor, latent — Blok 2 SD-T-B-01 ile tutarlı); eslint-guard-gap (API-RT-04) → **MEDIUM** (araç eksikliği); response-PII (API-CORE-01) → **HIGH** (sızan veri talep-eden admin'in kendi girdiği email, cross-user/tenant leak değil, endpoint admin-only). Hat A/B bağımsız 0 BLOCKER verdi — kalibrasyonla uyumlu.

---

## 1. Kapsam & yöntem

**Denetlenen:** `apps/api/src/` — auth/{jwt,password,refresh,cookie} · middleware/{authenticate,authorize,validate,errorHandler,bridge-token,print-agent-auth} · realtime/{server,emit,handshake,errors} · app/index/logger/errors + 13 route (guard kapsama). Çapraz: shared-types/{auth,permissions,realtime}, db/errors+refresh-tokens, eslint.config.js.
**Canlı:** pos_test + supertest + socket.io-client (mevcut fixture deseni: skipIf + IP-izolasyon + FK-cleanup + pool.end).

---

## 2. Bulgular

### 2.1 HIGH (4)

### [HIGH] [SEC/KVKK] Duplicate email → 409 response body'de ham e-posta sızıyor (ID: API-CORE-01)
- **Dosya:** `apps/api/src/errors.ts:235-236` (`case 'unique'` → `details:{field: err.detail}`) ← `db/errors.ts:69` (mapPgError 23505 ham detail) ← `routes/users.ts:159-162` (intercept YOK)
- **Kanıt (ana-context + canlı):** `errors.ts:235` doğrulandı; `POST /users` duplicate email → gerçek 409 body `details.field: "Key (tenant_id, lower(email))=(...,pii@example.com) already exists"` (`error-handler-pii.findings.test.ts`, KIRMIZI).
- **Etki & kalibrasyon:** Blok 3 DB-SEC-01 uçtan-uca — **log TEMİZ** (errorHandler `status>=500` gate + logger whitelist, canlı doğrulandı), **response SIZIYOR**. Sızan veri talep-eden admin'in kendi girdiği email + tenant UUID + constraint adı → bilgi ifşası + enumeration; cross-user leak değil (admin-only, aynı tenant). `customers/index.ts:136` aynı sınıfı DOĞRU intercept ediyor (detail'siz domainError) — users.ts etmiyor.
- **Öneri:** users.ts'te customers paterniyle intercept, VEYA kök: `toHttpError` 'unique' dalından `details.field`'i kaldır (tüm route'lar). · **Etiket:** MVP-fix

### [HIGH] [SEC/QUAL] Emit kontratının ÜÇ savunma katmanı da delik — kitchen.* helper-bypass (ID: API-RT-01, Blok 2 SD-T-B-01 kök)
- **Dosya:** `routes/orders.ts:599,1013,1147` (+1954 itemStatusChanged) — `deps.io.of('/realtime').to(room).emit(...)` doğrudan; `realtime/emit.ts` helper (zod parse) BYPASS
- **Kanıt (ana-context + canlı socket round-trip):** Gerçek `POST /orders` (dine-in) → telde `{items:[{...quantity:2}]}` → `KitchenOrderSentPayloadSchema.safeParse().success===false` (şema `qty`+zorunlu `tableId` bekliyor). `realtime-emit-contract.findings.test.ts` 3 KIRMIZI (gerçek client, mock değil). Üç savunma katmanı:
  - **Runtime:** emit helper (parse) atlanıyor → 4 site (`API-RT-02/03/06` kardeşleri).
  - **Lint (API-RT-04, MEDIUM):** `eslint.config.js:132` selector 2-seviye `X.of(ns).emit()` yakalıyor, kodun kullandığı 3-seviye `X.of(ns).to(room).emit()` YAKALAMIYOR (ampirik: `eslint orders.ts` exit 0).
  - **Tip (API-RT-05, HIGH):** 7 route dosyası `deps.io: Server` (parametresiz default generic) → `emit('herhangi', herhangi-şekil)` derleme-hatasız (tsc 0 hata).
- **Etki:** Bugün web KDS `quantity` okuduğu için çalışıyor → görünür kırılma yok; şemaya güvenen ilk yeni tüketici (mobil KDS) `undefined` alır, hiçbir katman uyarmaz.
- **Öneri:** 4 emit'i `emitToRole` helper'ına taşı + şema-tel hizala (`qty`↔`quantity`, `tableId` optional) + eslint selector'ı 3-seviye kapsayacak genelleştir + `deps.io`'yu `Server<..., ServerToClientEvents>` tiple. · **Etiket:** ADR-gerekli (ADR-010 §11.3 "tek emit path"; API-RT-04/05 alt-katmanlarıyla tek karar)

### [HIGH] [SEC] permissions.ts RBAC matrisi apps/api'de hiç tüketilmiyor + 3 parite drift (ID: API-AZ-01, Blok 2 SD-T-B-02 kesinleşme)
- **Dosya:** `shared-types/permissions.ts` vs `middleware/authorize.ts` + 90+ route çağrısı
- **Kanıt (ana-context doğrulandı):** grep `hasPermission|PERMISSIONS` → apps/** sıfır isabet; authorize.ts yalnız `UserRole` tipini kullanıyor, route'lar rolleri hardcode. **3 canlı drift:** (1) payments void [payments.ts:467] `authorize(['admin','cashier'])` ama matriste `payments.void` YOK; (2) caller-id PATCH cashier'a açık, matris `caller.manage`=admin; (3) reports [reports/*:*] `authorize(['admin','cashier'])` ama matris `reports.run`=admin-only. Ayrıca matris-dışı 16 customers eylemi (PII).
- **Etki:** Bugün escalation yok (route dizileri makul, matris içeriği tutarlı) — risk "tek-kaynak yanılsaması": matris değişince route davranışı değişmez.
- **Öneri:** ADR — route'ları `hasPermission`'a bağla / matrisi doküman ilan et + parite CI testi / sil. Reports & void'in cashier'a açık olması ürün kararı → doğrula. · **Etiket:** ADR-gerekli (Blok 2 SD-T-B-02 ile ortak)

### [HIGH] [SEC/QUAL] Route `deps.io` tipsiz — emit tip-güvencesi tamamen devre dışı (ID: API-RT-05)
*(API-RT-01 ailesinin tip-katmanı — yukarıda gömülü; ayrı ID korundu: 7 dosya `import type { Server } from 'socket.io'` parametresiz. Fix API-RT-01 ile birlikte.)* · **Etiket:** ADR-gerekli

### 2.2 MEDIUM (9)

### [MEDIUM] [BUG] authenticate/authorize middleware `message_key` yazmıyor — 11 router'da UI `t(undefined)` (ID: API-CORE-02)
- **Dosya:** `middleware/authenticate.ts:26,31,43` + `authorize.ts:11,15` · **Kanıt (canlı):** `GET /auth/me` (token yok) → `{error:{code:'AUTH_TOKEN_INVALID'}}`, `message_key` YOK (`ErrorEnvelope`'ta zorunlu). Bu iki middleware `toHttpError`'ı atlayıp doğrudan `res.json` yazıyor. `error-handler-pii.findings.test.ts` KIRMIZI. · **Etki:** authenticate/authorize kullanan 11 router'da 401/403'te UI `t(undefined)` alır. · **Öneri:** `AUTH_MESSAGE_KEYS`'ten message_key ekle. · **Etiket:** MVP-fix

### [MEDIUM] [ROB] index.ts graceful shutdown yok (SIGTERM/SIGINT handler eksik) (ID: API-CORE-03)
- **Dosya:** `index.ts` (yalnız `unhandledRejection`, SIGTERM/SIGINT yok) · **Kanıt:** grep tek eşleşme. · **Etki:** Prod PM2 `pos-api` restart/reload/deploy'da SIGTERM → Node anında sonlanır → in-flight HTTP/socket/pool temiz kapanmaz; canlı restoranda deploy penceresinde sipariş/ödeme yarıda kalma ("asla veri kaybı" ilkesiyle gerilim). · **Öneri:** SIGTERM/SIGINT → `realtime.shutdown()→httpServer.close()→pool.end()`. · **Etiket:** MVP-fix

### [MEDIUM] [SEC] `/auth/refresh` + `/auth/logout` rate-limit yok (ID: API-CORE-04; Hat A API-AUTH-01 + Hat B API-AZ-06 birleşik)
- **Dosya:** `routes/auth.ts` — loginLimiter yalnız `/login:113`; `/refresh:177`, `/logout:251` limiter'sız · **Kanıt (ana-context doğrulandı).** `/refresh` unauthenticated + her istek SHA-256+DB rotation → DoS amplifikasyonu (token 256-bit random olduğundan guessing değil). · **Öneri:** /refresh'e 30/dk/IP limiter. · **Etiket:** MVP-fix

### [MEDIUM] [SEC] Parite drift'leri: payments.void / caller PATCH / reports CSV cashier'a açık (ID: API-AZ-02/03/04)
API-AZ-01'in somut semptomları. Reports CSV cashier drift'i KVKK açısından **Blok 7'de** (rapor PII içeriği) doğrulanmalı. · **Etiket:** ADR-gerekli (API-AZ-01 kararıyla)

### [MEDIUM] [BUG] kitchen.itemStatusChanged aynı bypass, payload bugün doğru (ID: API-RT-06)
`orders.ts:1954` helper/parse yok; şekil gözlemsel uyumlu ama guard-gap altında. Fix API-RT-01 ile. · **Etiket:** MVP-fix

### [MEDIUM] [ROB/DoS] Global `express.json({limit:'10mb'})` auth öncesi tüm route'larda (ID: API-AZ-07)
Kimliksiz `/login`'e büyük gövde; Nginx `client_max_body_size` önden sınırlıyor (hafifletici). Excel bulk-import 10mb gerektiriyor. · **Öneri:** /auth/* için ayrı küçük limit; Nginx ≤10mb doğrula. · **Etiket:** v5.1-backlog

### [MEDIUM] [SEC] enumeration dummy-compare guard'ı kilitleyen test yok (ID: API-AUTH-04)
`routes/auth.ts:44,125` DUMMY_HASH bozulursa unknown-email=500 vs wrong-pass=401 = enumeration oracle. Literal bugün geçerli. · **Öneri:** unknown-email→401 test + dummy-hash boot'ta random. · **Etiket:** MVP-fix (test)

*(+ API-AZ-11 XFF-spoof (ikinci proxy eklenirse) — MEDIUM/LOW sınırı, konfig notu.)*

### 2.3 LOW (9)
- **API-AUTH-02** [DEAD] `JwtPayloadSchema` (shared-types/auth.ts) tüketilmiyor + gerçek payload'dan drift (tenant_id vs tenantId) — gelecekte yanlış-import auth-bug tohumu. v5.1.
- **API-AUTH-03** [ROB] Login `password` `.max()` yok (bcrypt 72-byte trunc + 10mb JSON sınır) — `.max(200)`. v5.1.
- **API-AUTH-05** [info] RTR reuse-detection grace-window yok — benign retry tüm-cihaz logout; güvenli default, zaaf değil. v5.1.
- **API-AZ-08** [ROB] DATABASE_URL/TENANT_ID sessiz default (JWT secret hard-required ama bunlar değil). v5.1.
- **API-AZ-09** [SEC] cookie Secure NODE_ENV'e bağlı — prod'da doğru, test-config karışırsa risk. v5.1.
- **API-AZ-10** [ROB] login rate-limit IP-only key (email değil) — paylaşımlı NAT arkasında yanlış-pozitif. v5.1.
- **API-AZ-14** [QUAL] orders `next('route')` çift-handler'ları authorize'ı duplike ediyor — bugün açık yok, bakım tuzağı. v5.1.
- **API-CORE-05** [QUAL] toHttpError 'unique' özel messageKey'i yalnız `code`'a, `message_key` hep jenerik — UI spesifik metin gösteremez. v5.1.
- **API-AUTH-06** [QUAL] refresh-tokens `deleteExpired` doc/impl drift (yorum "revoked" der, impl yalnız expired). v5.1.

### 2.4 NIT (4)
- **API-AZ-12** `/health` pg_version sızıntısı · **API-AZ-13** global JSON 404 handler yok · **API-CORE-06** authenticate/authorize envelope-tutarsızlığı (API-CORE-02 alt-notu) · Hat A NIT'leri (dummy-hash boot-random önerisi).

---

## 3. Temiz çıkan alanlar (canlı doğrulanmış)

- **Auth çekirdeği 25/26 ✅:** JWT HS256 pinned (alg=none/confusion kapalı) + aud/iss/exp/nbf; secret env min-32 hard-required, **hardcoded fallback yok**; payload'da PII/secret yok; bcrypt cost 12 + timing-safe; plain parola loglama yok; refresh SHA-256 hash + UNIQUE(token_hash) + atomik rotation + **family-nuke reuse-detection**; cookie HttpOnly+Secure(prod)+SameSite=Strict+**Path=/api/auth/refresh (S82)**+SET=CLEAR path-match; CSRF-lite X-Refresh-Request + body/cookie kaynak-gate.
- **Korumasız endpoint YOK:** ~90 endpoint authenticate+authorize; bilinçli public'ler (login/refresh/logout/health/bridge-incoming/agent-register) ayrı; authorize default-deny (boş dizi→403, user yok→401).
- **Socket room izolasyonu SAĞLAM (canlı):** cross-tenant, aynı-tenant-farklı-rol, **aynı-rol-farklı-tenant** (yeni kapatılan matris hücresi), caller-station — sızıntı yok. JWT handshake tampered/alg=none/wrong-secret/expired hepsi reddediliyor.
- **emit.ts merkezi helper'ları HEPSİ `.parse()` çağırıyor** (11 emit grubu güvenli); sorun yalnız 4 kitchen.* bypass sitesi.
- **Login rate-limit gerçek çalışıyor** (5/15dk, 6. deneme 429 + reset header, canlı). **CORS sabit origin (wildcard değil)**; helmet aktif; **trust proxy:1** Nginx tek-hop doğru.
- **logger PII-redaksiyonu + errorHandler log-gate sağlam:** `status>=500` gate 409/PII-unique'i loglamıyor; safeErrSerializer `.detail`/`.message`'ı serileştirmiyor (whitelist). **DB-SEC-01 log-tarafı TEMİZ.**
- **bridge-token `timingSafeEqual` + fail-closed; Caller-ID loglama PII-güvenli** (telefon/ad loglanmıyor, CLAUDE.md uyumlu).
- **Ham pg hataları (40001/40P01/25P02) → generic 500, body tamamen temiz** (Blok 3 DB-TX-03: ham hata response'a SIZMIYOR — statik doğrulandı). zod → 400 + fields.

## 4. Eklenen test envanteri (5 dosya, 27 test)

| Dosya | Tip | Test | Sonuç |
|---|---|---|---|
| `realtime-handshake-security.audit` | YEŞİL (saf socket) | 5 | ✅ |
| `auth-jwt-rest.audit` | YEŞİL (pos_test) | 7 | ✅ |
| `bootstrap-error-handler.audit` | YEŞİL (pos_test) | 10 | ✅ |
| `error-handler-pii.findings` (API-CORE-01, API-CORE-02) | 🔴 | 2 | kırmızı |
| `realtime-emit-contract.findings` (API-RT-01/02/03) | 🔴 | 3 | kırmızı |

**Kırmızı → bulgu (5):** API-CORE-01 (response email) · API-CORE-02 (message_key) · API-RT-01/02/03 (emit ×3).
**Tam apps/api paketi:** 728 test → **5 kırmızı (hepsi yeni findings) / 723 yeşil** (mevcut 48 dosya regresyonsuz). `tsc --noEmit` temiz. Canlı testler yalnız pos_test.
**Not:** Hat A/B read-only olduğundan test yazamadı; tarifledikleri route⇄matris parite + /refresh-429 + enumeration testleri "yazılacak" olarak Blok 13 fix fazına bırakıldı (HIGH'lar Hat C'nin 5 kırmızısı + Blok 2 permissions.findings ile temsil ediliyor).

## 5. Etiket özetleri

- **MVP-fix:** API-CORE-01 (response PII intercept), API-CORE-02 (message_key), API-CORE-03 (graceful shutdown), API-CORE-04 (/refresh rate-limit), API-RT-06, API-AUTH-04 (enum test).
- **ADR-gerekli:** API-RT-01+04+05 (emit üç-katman savunma — tek karar), API-AZ-01+02/03/04 (permissions kablolama + parite — Blok 2 SD-T-B-02 ile ortak).
- **v5.1-backlog:** API-AZ-07/08/09/10/11/14, API-AUTH-02/03/05/06, API-CORE-05, NIT'ler.

## 6. Sonraki bloklara devir notları

- **Blok 5 (orders/payments):** API-RT-01 emit-fix orders.ts'te (para-akışıyla birlikte); Blok 3 iki BLOCKER (DB-TX-01/05) burada kök-çözülür.
- **Blok 6 (api routes):** API-CORE-01 pattern'i customers dışındaki tüm route'larda tara (users teyitli sızıyor); parite drift'leri route bazında.
- **Blok 7 (reports):** reports CSV cashier drift'i (API-AZ-04) + rapor PII/finansal içeriği — cashier'ın ne export edebildiği.
- **Blok 13 (sentez):** permissions kablolama ADR'ı (Blok 2+4 birleşik); emit tek-path ADR'ı; graceful-shutdown + rate-limit + response-PII fix'leri tek "api-sertleştirme" PR'ında toplanabilir.

## 7. Blok DoD durumu

- [x] auth/middleware/realtime/bootstrap + 13 route guard-kapsama okundu (3 hat + ana-context; HIGH'lar kaynak/canlı teyitli)
- [x] **Korumasız endpoint denetimi tamamlandı — YOK** (brief'in ana SEC ekseni temiz)
- [x] Bulgular A.4 (31 ham → 26 konsolide; Hat C 5-BLOCKER kalibrasyonu şeffaf)
- [x] Her HIGH için kırmızı karakterizasyon testi (API-CORE-01, API-RT-01 Hat C kırmızıları; API-AZ-01 Blok 2 permissions.findings; API-RT-05 API-RT-01'e gömülü)
- [x] Canlı auth/socket/PII testleri **yalnız pos_test** (prod/pos_dev dokunulmadı, 0 artık)
- [x] Prod kod değişmedi; mevcut testler değişmedi; bağımlılık eklenmedi
- [ ] BLOCKER yok; HIGH'lar Blok 13 sentezine (permissions + emit ADR'ları, api-sertleştirme PR'ı)
