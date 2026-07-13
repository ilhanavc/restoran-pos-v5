# Blok 6 — apps/api: diğer iş route'ları

> Derin denetim serisi Blok 6. **Tarih:** 2026-07-11 · **Branch:** `audit/06-api-routes` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: security-reviewer — customers/caller-id/users KVKK+privilege · B: security-reviewer — tables/areas/products/menu/attribute/settings IDOR+validation · C: qa-engineer — print-jobs/kds/domain + **canlı IDOR/PII testleri**) + ana-context çapraz doğrulama.
> **Canlı test:** SADECE `pos_test` — prod/pos_dev'e HİÇ dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** **4 yeni test dosyası, 15 test (14 yeşil + 1 kasıtlı KIRMIZI).** (Hat A/B read-only.)
> **Ham bulgu:** 19 (A:8, B:8, C:3, response-PII üç hatta ortak) → konsolide **17 bulgu: 0 BLOCKER · 1 HIGH · 7 MEDIUM · 6 LOW · 3 NIT.**

---

## 0. Yönetici özeti

**Üç büyük güvenlik korkusu da temiz çıktı — bu bloğun ana sonucu pozitif:**

**✅ Cross-tenant IDOR YOK** (11 route, ~40 endpoint, 3 hat bağımsız + 7/7 canlı test doğruladı): tüm endpoint `req.user.tenantId`'yi **JWT'den** alıyor (spoofable değil — `authenticate.ts:38` doğrulanmış `payload.tenant_id`); body/param'dan tenant ALINMIYOR; nested link'ler (product/category attribute) Migration 010/011 **composite FK** ile DB'de de korunuyor.
**✅ Validasyonsuz mutation YOK** — body'si olan her mutation `validateBody`/zod'lu (tek istisna: attribute-groups path param'ları uuid-doğrulamasız → 500, R6-ATTR-01).
**✅ print-jobs güvenli** — agent JWT tenant'ı `tid` claim'inden (header'dan değil); revoked agent `/jobs/next`'te de 401; `FOR UPDATE SKIP LOCKED` 9-eşzamanlı claim'de duplicate/kayıp üretmedi.
**✅ KVKK red-line korunmuş** — caller telefon/isim application-log'a yazılmıyor; audit payload'ları PII-free; retention cron 30g.

**🟠 Tek HIGH — üç hat da aynı bulguya yakınsadı (response-PII):** `errors.ts` `toHttpError` unique/check dalları ham PG `detail`/`constraint`'i 409 gövdesine koyuyor → e-posta (users), telefon (customers repo yolu), iç kolon/index adları + tenant_id UUID sızıyor. Serinin en tekrar eden bulgusu: **DB-SEC-01 (Blok 3) → API-CORE-01 (Blok 4, yalnız POST) → Blok 6'da kesinleşti** (POST+PATCH, tüm unique-constraint route'ları). Tek merkezi fix (`errors.ts`) hepsini kapatır.

### En kritik 3
1. **R6-CORE-01** (HIGH) — response-PII, `errors.ts` unique/check dalı ham detail sızdırıyor (canlı kırmızı, tüm route'lar). Tek-dosya fix.
2. **R6-ATTR-01** (MEDIUM) — attribute-groups tüm route'larda `validateParams` yok → malformed UUID `22P02` → 500.
3. **R6-USER-02** (MEDIUM) — parola değişimi/rol düşürme hedefin refresh token'larını revoke etmiyor → ele geçirilen oturum expiry'ye kadar geçerli.

---

## 1. Kapsam & yöntem

**Denetlenen:** `apps/api/src/routes/` — tables(365), areas(361), products(566), menu(377), users(468), settings(175), kds(214), print-jobs(691), attribute-groups(425), customers/index(1026), caller-id/index(314) + domain/{attributes×3, areas} + bridge-token/validate/authorize/errorHandler. ~5000 LOC route.
**Devir doğrulamaları:** API-CORE-01 (Blok 4), SD-T-C-02 (Blok 2 customers PATCH), DB-ROB-02/03 (Blok 3 search/limit), DB-MIG-01 (Blok 3 display_no), SD-T-C-05 (Blok 2 priceDeltaCents).

---

## 2. Bulgular

### 2.1 HIGH (1)

### [HIGH] [SEC/KVKK] `errors.ts` unique/check dalı ham PG detail'i response'a sızdırıyor — tüm route'larda (ID: R6-CORE-01; = API-CORE-01 kesinleşme)
- **Dosya:** kök `packages/db/src/errors.ts:68-69` (23505→`RepositoryError('unique',_,pgErr.detail)`), `:72-77` (check→constraint) · yüzey `apps/api/src/errors.ts:235` (`details:{field:err.detail}`), `:262` (`details:{constraint:err.detail}`)
- **Kanıt (3 hat + canlı kırmızı):** PG detail `Key (tenant_id, lower(email))=(<uuid>, kirmizi@ornek.com) already exists` → 409 body `details.field`'da aynen. `api-core-01-response-pii.findings.test.ts` KIRMIZI (canlı). Tetikleyici envanteri: users(email), customers repo(telefon — ama customers route'u `mapCustomerRepoError` ile intercept ediyor ✓), tables(code/display_no), areas, categories, products, attributeGroups, attributeOptions — hepsi `RepositoryError('unique',...,mapped.detail)` fırlatıyor.
- **Etki:** Bilgi ifşası (PII e-posta + iç SQL şema + tenant UUID); `errors.ts:7` kendi kontratını ("serbest metin asla zarfta dönmez") ihlal. Blok 4'te yalnız POST /users bulunmuştu; Blok 6 **PATCH /users'a + tüm CRUD route'larına genişletti.** Admin-only endpoint'ler → şiddet orta, ama sistemik.
- **Öneri:** Kök tek-nokta: `toHttpError` unique/check dallarından ham `err.detail`/`constraint`'i KALDIR (gerekirse repo katmanında whitelist'li güvenli `field:"code"`). Bir fix tüm route'ları + PII tablolarını kapatır.
- **Etiket:** MVP-fix (Blok 4 API-CORE-01 ile tek PR)

### 2.2 MEDIUM (7)

### [MEDIUM] [SEC/ROB] attribute-groups hiçbir route'ta `validateParams` yok → malformed UUID 500 (ID: R6-ATTR-01)
`attribute-groups.ts` tüm handler'lar `req.params['id'] as string`; diğer 4 modül `validateParams` kullanıyor. `PATCH /attribute-groups/not-a-uuid/...` → PG 22P02 → mapPgError tanımaz → 500 (beklenen 400/404). SQL injection değil, tenant izolasyonu bozulmaz. · **Öneri:** her route'a uuid `validateParams`. · **Etiket:** MVP-fix

### [MEDIUM] [SEC] Parola değişimi/rol düşürme hedef oturumları invalide etmiyor (ID: R6-USER-02)
`users.ts:432-453` + `repositories/users.ts:203-210` updatePassword yalnız hash günceller; refresh_tokens revoke edilmiyor (hard-delete CASCADE var, password-change'te yok). Ele geçirilen hesabın parolası resetlense bile saldırganın refresh+access token'ı expiry'ye kadar geçerli; admin→cashier düşürmede eski access token 30dk admin taşır. · **Öneri:** password-change tx'inde hedefin refresh_tokens'ını revoke et. · **Etiket:** MVP-fix

### [MEDIUM] [BUG] Nested option route'u `:id` (groupId) segmentini yok sayıyor → tenant-içi BOLA (ID: R6-ATTR-02)
`attribute-groups.ts:187-223` option `findById(tenantId, optionId)` ile bulunuyor, path `:id` doğrulanmıyor → `DELETE /attribute-groups/<grupA>/options/<grupB-optId>` grupB'nin option'ını siler. **Cross-tenant DEĞİL** (tenant-içi), ihlal değil ama URL hiyerarşisi correctness. · **Öneri:** `existing.group_id===groupId` değilse 404; ya da flat route. · **Etiket:** MVP-fix

### [MEDIUM] [SEC/A09] `POST /menu/categories` audit yazmıyor (ID: R6-MENU-01)
`menu.ts:81-105` `writeAudit` YOK — oysa area/table/product/attribute create + menu'nün kendi PATCH/DELETE/reorder'ları yazıyor. ADR-002 §10.4 audit kontratı ihlali ("kim kategori ekledi" izlenemez); tek-INSERT tx'e de sarılmamış. · **Öneri:** tx + `writeAudit('menu_category.created', ...)`. · **Etiket:** MVP-fix

### [MEDIUM] [BUG] tables `display_no`/auto-code non-atomik MAX()+1 çakışması (ID: R6-TBL-01; DB-MIG-01 teyit)
`tables repo:231-243,392-437` ayrı SELECT MAX + INSERT, `(tenant_id,area_id,display_no)` UNIQUE yok → eşzamanlı sync/area aynı max'ı okur → duplicate display_no (constraint yakalamaz); auto-code collision → 23505 → 409 (+R6-CORE-01 detail sızar). Repo yorumu itiraf: "sync yarışı #13 v5.1". · **Öneri:** partial unique index + advisory-lock/`INSERT…SELECT` atomikleştir. · **Etiket:** MVP-fix (Blok 3 DB-MIG-01 ile ortak migration)

### [MEDIUM] [SEC] customers arama ILIKE wildcard escape yok (ID: R6-CUST-01; DB-ROB-02 teyit)
`repositories/customers.ts:347,373` `%${trimmed}%` — Kysely parametrize (injection YOK) ama `%_\` escape'siz: search=`%`→tüm tenant müşterisi; sonda `\`→22025 500. Aynı-tenant içi → veri-ifşa yükseltmesi yok, hafif DoS+500. · **Öneri:** `escapeLikePattern()` + `ESCAPE '\'`. · **Etiket:** MVP-fix

### [MEDIUM] [SEC] Bridge X-Tenant-Id global shared-secret — cross-tenant call injection (ID: R6-CALL-01)
`bridge-token.ts:40-70` tenant `X-Tenant-Id` header'ından, auth tek global `X-Bridge-Token`. Token ele geçirilirse istenen tenant_id'ye call_logs (arayan PII) enjekte + popup tetiklenebilir. **Tek-tenant MVP'de kabul**; multi-tenant'ta per-tenant token gerek. · **Etiket:** v5.1-backlog (ADR-016 notu)

### 2.3 LOW (6)
- **R6-CUST-02** [BUG] PATCH /customers/:id route-local `CustomerPatchSchema` (fullName/notes) shared `CustomerUpdateSchema` (phones/addresses) kullanmıyor → phones gönderilirse sessiz no-op 200 (SD-T-C-02 teyit). Blok 2 ile tek karar.
- **R6-CALL-02** [SEC/KVKK] logger redact'te `rawPhone`/`normalizedPhone` yok — MEVCUT DURUM güvenli (global body-logging yok + safeErrSerializer + yalnız 500 log), latent kırılganlık. Öneri: redact'e ekle.
- **R6-ATTR-03** [SEC/ROB] Attribute link'te category/product tenant-sahipliği app'te doğrulanmıyor — composite FK (Mig 010/011) savunuyor (cross-tenant IDOR YOK), ama 404 yerine 409 + başarısız girişim audit'lenmez. Öneri: assign öncesi findById.
- **R6-PRD-01** [SEC] `ProductVariantWriteSchema.priceDeltaCents` sınırsız int (extraPriceCents ±10000 capped iken) → int4 aşımı 22003 500 (SD-T-C-05 teyit). Öneri: ±100000 cap.
- **R6-PRD-02** [QUAL] `replaceVariants` caller-supplied id ile INSERT → tenant-içi PK-collision oracle (cross-tenant yazma yok); is_default promote dokümante dead-code. Öneri: bilinmeyen id'de daima randomUUID.
- **R6-PJ-01** [QUAL] print-jobs `errorText` sınırsız uzunluk kabul ama hiç kullanılmıyor/yazılmıyor (Phase 4+ audit borcu). Öneri: `.max()`.

### 2.4 NIT (3)
- **R6-CUST-03** `CustomerListQuerySchema.page` üst sınırsız (limit clamp'leri temiz — DB-ROB-03 OK) → offset unbounded.
- **R6-CUST-04** `GET /customers/export` toplu PII egress — admin-only + audit'li (meşru KVKK portability), maskeleme/rate-limit yok. Opsiyonel: rate-limit + alert.
- **R6-ATTR-TEST** attribute-groups (425 LOC) denetim öncesi sıfır test kapsamındaydı → 3 yeni testle kapatıldı (bug bulunmadı).

---

## 3. Temiz çıkan alanlar (3 hat + canlı doğrulanmış)

- **🎯 Cross-tenant IDOR YOK** — ~40 endpoint, hepsi `req.user.tenantId` (JWT, spoofable değil); **7/7 canlı cross-tenant testi 404/409** (customers/tables/products/kds/print-jobs/attribute-groups); nested link'ler composite FK ile DB'de de korunuyor; enumeration savunması (cross-tenant=404).
- **🎯 print-jobs güvenli** — agent JWT tenant `tid` claim'inden; revoked agent `/jobs/next`'te 401; `FOR UPDATE SKIP LOCKED` 9-eşzamanlı claim'de duplicate/kayıp yok; cross-tenant job claim/result 204/404 (mutasyon yok).
- **🎯 KVKK red-line korunmuş** — caller telefon/isim app-log'a yazılmıyor; audit payload PII-free (id+count+changed_fields, ham değer yok); retention 30g; masked-bypass call_log yazmaz.
- **Validasyonsuz mutation YOK** — tüm body'li mutation `validateBody`/zod; bound'lar sağlam (sync≤100, reorder≤500/200, variants≤50, import≤20000, delete≤10000).
- **RBAC Blok 4 matrisiyle tutarlı** (CUD admin, read 4-rol, settings PATCH admin); privilege escalation yok (users admin-only + ABAC: waiter başkasının parolasını değiştiremez).
- **SQL injection YOK** (Kysely parametreli; ham `sql\`\`` binding'li; concat yok); para integer kuruş; `any`/eval/innerHTML yok; cascade tasarımı sağlam (area/category/product/group delete zincirleri).

## 4. Eklenen test envanteri (4 dosya, 15 test)

| Dosya | Test | Sonuç |
|---|---|---|
| `print-jobs-audit.test.ts` (R6-PJ-01..07) | 7 | ✅ yeşil |
| `route-idor-audit.test.ts` (R6-KDS-01, R6-IDOR-01/02/03) | 4 | ✅ yeşil |
| `attribute-groups-audit.test.ts` (R6-ATTR-01/02/03) | 3 | ✅ yeşil |
| `api-core-01-response-pii.findings.test.ts` (R6-CORE-01) | 1 | 🔴 kırmızı |

**Kırmızı → bulgu (1):** R6-CORE-01 (response-PII, canlı 409 body'de ham email).
**Koşu (pos_test):** 15 test → 14 yeşil + 1 kırmızı; tsc + eslint temiz; canlı yalnız pos_test.
**Not:** Hat A/B read-only → test yazamadı; tarifledikleri cross-tenant/privilege/escape testleri Hat C'nin canlı IDOR seti + Blok 13 fix fazına bırakıldı (HIGH tek kırmızı ile temsil ediliyor; IDOR'lar yeşil-audit ile kilitlendi).

## 5. Etiket özetleri
- **MVP-fix:** R6-CORE-01 (errors.ts — Blok 4 ile tek PR), R6-ATTR-01 (validateParams), R6-USER-02 (session invalidation), R6-ATTR-02 (nested groupId), R6-MENU-01 (audit), R6-TBL-01 (display_no — Blok 3 ile), R6-CUST-01 (ILIKE escape).
- **v5.1-backlog:** R6-CALL-01 (per-tenant bridge token), R6-CUST-02 (SD-T-C-02 ile), R6-CALL-02, R6-ATTR-03, R6-PRD-01/02, R6-PJ-01, NIT'ler.

## 6. Sonraki bloklara devir
- **Blok 7 (reports):** customers export + reports CSV cashier drift (Blok 4 API-AZ-04) — PII egress + maskeleme; caller-id/customers PII rapor yollarında.
- **Blok 13 (fix fazı):** R6-CORE-01 + Blok 4 API-CORE-01 tek "response-PII" PR'ı (errors.ts merkezi); R6-TBL-01 + DB-MIG-01 tek migration; validateParams + audit + session-invalidation "route-sertleştirme" PR'ı.

## 7. Blok DoD durumu
- [x] 11 route + domain okundu (3 hat + ana-context)
- [x] **IDOR/cross-tenant denetimi — sızıntı YOK** (7/7 canlı + 3 hat envanteri; brief'in ana ekseni temiz)
- [x] **KVKK/PII denetimi — log sızması YOK** (caller red-line korunmuş)
- [x] Bulgular A.4 (19 ham → 17 konsolide; response-PII üç-hat yakınsaması)
- [x] Her HIGH için kırmızı test (R6-CORE-01 canlı); IDOR'lar yeşil-audit ile kilitli
- [x] Canlı testler yalnız pos_test; prod kod değişmedi; bağımlılık yok
- [ ] BLOCKER yok; HIGH + MEDIUM'lar Blok 13 sentezine (response-PII + route-sertleştirme PRّları)
