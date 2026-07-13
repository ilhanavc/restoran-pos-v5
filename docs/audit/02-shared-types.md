# Blok 2 — packages/shared-types (zod şemaları)

> Derin denetim serisi Blok 2. **Tarih:** 2026-07-11 · **Branch:** `audit/02-shared-types` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: qa-engineer — money/order/payment/table/area/attribute · B: security-reviewer — permissions/realtime/auth/print-agent/call-logs/audit · C: qa-engineer — reports/customers/menu/settings/user + 19-dosya gevşeklik-sweep) + ana-context çapraz doğrulama (tüm HIGH adayları kaynak üzerinde ikinci kez teyit edildi; Hat B read-only olduğundan tariflediği kırmızı testleri ana context yazdı).
> **Kurallar:** Prod kod DEĞİŞTİRİLMEDİ. **24 yeni test dosyası, 278 test (246 yeşil + 32 kasıtlı KIRMIZI karakterizasyon).** Mevcut 2 test dosyası (permissions.test.ts, realtime.test.ts) değişmedi.
> **Ham bulgu:** 26 (A:9, B:8, C:9) → çapraz-hat duplikeler ve aynı-aile bulgular birleştirilince **22 konsolide bulgu: 0 BLOCKER · 7 HIGH · 7 MEDIUM · 6 LOW · 2 NIT.**

---

## 0. Yönetici özeti

Paketin çekirdek disiplini **sağlam**: `.passthrough()` sıfır, `z.any()` sıfır (3 kasıtlı `z.record(z.unknown())` serbest-JSON alanı hariç), tüm ID'ler `.uuid()`, enum↔migration paritesi birebir, `UserPublicSchema`'da parola sızıntısı yok, para alanları float/negatif reddediyor. Bulgular üç temada:

1. **🔴 "Şema var ama kablo yok / şema yalan" ailesi (en kritik tema):** Paketin en güvenlik-kritik iki kontratı fiilen bağlantısız — `permissions.ts` matrisi hiçbir route'ta enforce edilmiyor (SD-T-B-02) ve `kitchen.orderSent` şeması gerçek tel formatından farklı (`qty`≠`quantity`, `tableId` yok — SD-T-B-01). Aynı sınıfta: `CustomerUpdateSchema` gerçek PATCH route'unun kullandığı şema değil (SD-T-C-02), 6+ response şeması runtime'da hiç `.parse` edilmiyor. **Blok 1'in "yazılmış ama bağlanmamış" temasının şema-katmanı devamı** — tip güvencesi yanılsaması üretiyor.
2. **🟠 Sınır eksikleri ailesi:** Para üst sınırı yok (INT4 taşması → 500), yazma-yolu 11 string alanında `.max()` yok (user/customers/settings/auth.password), `payment_items.quantity` sınırsız. Tek PR'lık mekanik fix seti.
3. **🟡 İnce doğrulama tuzakları:** `min(1).max(N).trim()` zincir SIRASI 8 sitede boşluk-yalnız girdiyi geçiriyor (SD-T-A-04); tarih regex'i takvim doğrulamıyor — `"2026-02-30"` Z-raporunu sessizce 2 Mart'a kaydırabilir (SD-T-C-01).

### En kritik 3 bulgu
1. **SD-T-B-01** — realtime `kitchen.orderSent` sessiz kontrat kırığı (şema `qty`+zorunlu `tableId`; tel `quantity`+tableId'siz; emit parse-bypass). ADR-gerekli.
2. **SD-T-B-02** — permissions matrisi enforcement'a bağlı değil + ADR-033 drift'i (`payments.void` matriste yok, route cashier'a açık). ADR-gerekli.
3. **SD-T-A-04 + SD-T-C-01** — canlı admin/rapor yollarında iki ince doğrulama tuzağı (boş-string sızması + yanlış-güne yuvarlanan tarih). İkisi de tek satırlık MVP-fix.

---

## 1. Kapsam & yöntem

**Denetlenen:** `packages/shared-types/src/` 19 dosya (~2 570 LOC): money, order, payment, table, area, attribute, permissions, realtime, auth, print-agent, call-logs, audit, reports, customers, menu, settings, user, index (barrel).
**Çapraz-doğrulama okumaları (değiştirilmedi):** `packages/db/migrations/{000,001,021,023,025,042}`, `apps/api/src/routes/{orders,payments,customers/index,settings,users}.ts`, `apps/api/src/middleware/authorize.ts`, `apps/api/src/realtime/emit.ts`, `apps/web/src/features/{customers,kds}/**`, ADR-002/003/010/012/015/016/033.
**Sınır-zorlama:** boş/aşırı-uzun(10k)/unicode/emoji/null-byte/negatif/NaN/float/string-coercion girdiler; enum'lara tanımsız değer; ters tarih aralığı; gerçek emit-payload'ının şemadan geçirilmesi (kontrat round-trip).

**Severity kalibrasyon notları (şeffaflık):**
- *Money üst-sınır* bulgusunu Hat A HIGH, Hat C MEDIUM puanladı (aynı bulgu, iki hat) → **MEDIUM'da birleştirildi**: sessiz yanlış para YOK (PG 22003 reddeder), etki temiz-400 yerine 500. Blok 1 SD-M-11 emsaliyle tutarlı.
- *Sınırsız parola* Hat B'de LOW (auth.ts), Hat C'de HIGH (user.ts) → **tek MEDIUM aileye birleştirildi**: bcrypt 72-byte keser + Express body-limit 100kb blast-radius'u sınırlar; savunma-derinliği eksiği, akut DoS değil.
- SD-T-A-03 (payment qty) HIGH→**MEDIUM**: money-max ile aynı 500-sınıfı; kardeş şemadaki `.max(99)` emsali fix'i trivial yapıyor.

---

## 2. Bulgular

### 2.1 HIGH (7)

### [HIGH] [SEC/ROB] `kitchen.orderSent` emit ↔ şema SESSİZ KONTRAT KIRIĞI (ID: SD-T-B-01)
- **Dosya:** `packages/shared-types/src/realtime.ts:126-138` vs `apps/api/src/routes/orders.ts:599,1013,1147`
- **Kanıt (ana-context doğrulandı):** Şema: item `qty: z.number().int().positive()` + top-level `tableId: z.string().uuid().nullable()` (key ZORUNLU). Gerçek emit: `items.map(k => ({id, productName, quantity: k.quantity}))` — alan adı **`quantity`**, `tableId` **hiç gönderilmiyor**. Emit'ler zod-parse'lı `realtime/emit.ts` helper'ını KULLANMIYOR (`deps.io.of('/realtime').to(...).emit(...)` doğrudan); `deps.io` ham `Server` tipinde → compile-time kontrol de devre dışı. Tüketici (apps/web KDS `KdsOrderCard.tsx:203`) `quantity` okuyor → **çalışan gerçek kontrat şemadakinden farklı; şema yalan söylüyor.**
- **Senaryo:** Şemaya güvenen ilk yeni tüketici (örn. ileride mobil KDS) `qty` okur → undefined; veya emit helper'a taşınırsa `.parse` anında fırlatır → KDS push crash.
- **Etki:** 13 realtime event'inden 11'i parse-garantili ve uyumlu; 2 kitchen.* event'i parse-bypass sınıfında. S74 dersinin ("realtime kontratı sessizce kırık olabilir") şema-katmanı örneği.
- **Kanıt testi (KIRMIZI):** `realtime.findings.test.ts` SD-T-B-01a/01b — gerçek emit şekli şemadan geçmiyor.
- **Öneri:** İki seçenek: (a) şemayı tele hizala (`qty`→`quantity`, `tableId` `.optional()`), (b) emit'i parse'lı helper'a taşı + `deps.io`'yu `Server<..., ServerToClientEvents>` tiple. ADR-010 §11.3 "tek emit path" ilkesi (b)'yi işaret ediyor — **ADR-gerekli** (Blok 4 realtime denetimiyle birlikte karara bağlanmalı).
- **Etiket:** ADR-gerekli

### [HIGH] [SEC] permissions.ts matrisi hiçbir enforcement'a bağlı değil + ADR-033 drift'i (ID: SD-T-B-02)
- **Dosya:** `packages/shared-types/src/permissions.ts` (tüm modül) vs `apps/api/src/middleware/authorize.ts` + 80+ route çağrısı
- **Kanıt (ana-context doğrulandı):** `hasPermission`/`PERMISSIONS` grep → `apps/**`'de **sıfır import** (yalnız kendi test dosyası). Gerçek enforcement: route'larda hardcoded `authorize(['admin','cashier'])` dizileri (action kavramı yok). **Drift kanıtı:** matris `payments.refund`=admin-only der ve `payments.void` aksiyonu HİÇ yok; gerçekte [payments.ts:465-467] `POST /:paymentId/void` cashier'a açık (ADR-033 tasarımı — ürün kararı doğru olabilir, matris bayat).
- **Senaryo:** "İzin matrisi tek kaynak" varsayımıyla yapılacak her gelecek değişiklik (yeni rol, izin daraltma) yalnız matrisi günceller → gerçek route davranışı DEĞİŞMEZ; iki yönlü sessiz drift birikir.
- **Etki:** Bugün aktif escalation YOK (matris içeriği tutarlı: kitchen en dar, admin superset; route dizileri de makul). Risk "tek-kaynak yanılsaması".
- **Öneri:** ADR ile karar: (a) route'ları `hasPermission`'a bağla (action-map), (b) matrisi "dokümantasyon" ilan edip route⇄matris parite CI testi ekle, (c) matrisi sil. Parite testi apps/api tarafında → **Blok 4'e devir**.
- **Etiket:** ADR-gerekli

### [HIGH] [BUG] `.min(1).max(N).trim()` zincir sırası — boşluk-yalnız girdi "dolu" kabul ediliyor (ID: SD-T-A-04)
- **Dosya:** `table.ts:29,47` · `area.ts:27,41` · `attribute.ts:33,45,83,95` (8 site)
- **Kanıt (ana-context doğrulandı):** zod check'leri EKLEME SIRASIYLA koşar: `min(1)` HAM veride değerlendirilir (`"   "` → 3≥1 geçer), `.trim()` en sonda çıktıyı `""` yapar → `safeParse.success===true, data.code===""`.
- **Senaryo:** Admin masa koduna/bölge adına yalnız boşluk girerse: DB CHECK varsa (area) ham 23514 → 500; yoksa (table.code) **isimsiz masa sessizce kaydolur** — kasiyer ekranında boş etiket.
- **Kanıt testi (KIRMIZI ×6):** `table/area/attribute.findings.test.ts`.
- **Öneri:** 8 sitede sırayı çevir: `.trim().min(1).max(N)`. · **Etiket:** MVP-fix

### [HIGH] [BUG] Takvim-geçersiz tarih zod'dan geçip sessizce yuvarlanıyor — Z-raporu yanlış güne kayabilir (ID: SD-T-C-01)
- **Dosya:** `reports.ts:45` (`yyyyMmDd` regex) + `reports.ts:428-433` (`DailyCloseQuerySchema.date`)
- **Kanıt (ana-context doğrulandı):** `/^\d{4}-\d{2}-\d{2}$/` yalnız şekil kontrol eder. `"2026-02-30"` geçer; route `new Date(...)`'e verirse JS sessizce `2026-03-02`'ye yuvarlar. Range şemasında 90-gün refine'ı AY-taşmasını kazara yakalar (NaN diff) ama GÜN-taşmasını yakalamaz; `DailyCloseQuerySchema.date`'te refine hiç yok.
- **Etki:** Günlük ciro/Z-raporu penceresi kullanıcının istediğinden farklı güne kayar — finansal rapor doğruluğu (ADR-015), sessiz veri hatası sınıfı.
- **Kanıt testi (KIRMIZI ×2):** `reports.findings.test.ts`. · **Öneri:** Takvim round-trip refine'ı (parse→format→eşitlik). Route-side etkisi **Blok 7'de** ayrıca doğrulanacak. · **Etiket:** MVP-fix

### [HIGH] [BUG/DEAD] `CustomerUpdateSchema` gerçek PATCH route'uyla uyuşmuyor — yanıltıcı public sözleşme (ID: SD-T-C-02)
- **Dosya:** `customers.ts:49` vs `apps/api/src/routes/customers/index.ts:106,727`
- **Kanıt (ana-context doğrulandı):** Route shared şemayı import etmiyor; yerel dar `CustomerPatchSchema = z.object({fullName, notes})` kullanıyor. `apps/web .../customers.ts:111` ise PATCH body'sini TAM `CustomerUpdate` tipiyle (phones/addresses dahil) tipliyor.
- **Senaryo:** Shared tipe güvenen geliştirici `{phones:[...]}` yollar → backend tanımaz, zod-strip sessizce düşürür → **200 OK ama veri değişmedi** (sessiz veri kaybı; S77 "mutation yanıt-şekli sessiz patlar" dersinin istek-tarafı ikizi).
- **Kanıt testi (KIRMIZI ×3):** `customers.findings.test.ts`. · **Öneri:** `CustomerUpdateSchema`'yı route gerçeğine daralt (`.pick({fullName,notes})`) veya route'u shared şemaya geçir — **Blok 6'da** route tarafıyla birlikte karara bağla. · **Etiket:** MVP-fix (+Blok 6 devri)

### [HIGH] [BUG] `OrderCreateApiRequestSchema` refine tek yönlü — takeaway/delivery'de dolu tableId kabul (ID: SD-T-A-02)
- **Dosya:** `order.ts:113-116`
- **Kanıt (ana-context doğrulandı):** Refine yalnız `dine_in ⇒ tableId≠null`; ters yön yok, DB CHECK de yok. `{orderType:'takeaway', tableId:'<dolu-masa-uuid>'}` şemadan geçer.
- **Etki:** Masa durumu orders JOIN'inden türetildiği için paket sipariş yanlışlıkla masayı "dolu" gösterebilir. Route'un takeaway'de tableId'yi yok sayıp saymadığı **Blok 5'te** doğrulanacak — şema-kontrat boşluğu olarak geçerli.
- **Kanıt testi (KIRMIZI ×2):** `order.findings.test.ts`. · **Öneri:** Refine'a ikinci kol: `orderType==='dine_in' || tableId===null`. · **Etiket:** MVP-fix

### [HIGH] [SEC] `ProductVariantWriteSchema.priceDeltaCents` sınırsız işaretli — negatif nihai fiyat mümkün (ID: SD-T-C-05)
- **Dosya:** `menu.ts:183` (`priceDeltaCents: z.number().int()` — alt/üst sınır yok)
- **Kanıt:** İşaretli olması bilinçli (ADR-003 §8.6 Amd); sınırsızlık değil. `-999_999_999_999` kabul → base+delta negatif birim fiyat.
- **Etki:** "Para asla negatif/anlamsız olmaz" ilkesine şema boşluğu; admin typo'su (örn. -100000 girip -1000,00 TL kastetmek) sipariş toplamını bozabilir. Route/order-create tarafında clamp var mı — **Blok 5/6'da** doğrulanacak.
- **Kanıt testi (KIRMIZI ×2):** `menu.findings.test.ts`. · **Öneri:** `.min(-10_000_000).max(10_000_000)` sağduyu sınırı (±100.000 TL). · **Etiket:** MVP-fix

### 2.2 MEDIUM (7)

### [MEDIUM] [ROB] Para şemalarında üst sınır yok → PG INT4 taşması = 400 yerine 500 (ID: SD-T-A-01, Hat C duplikesiyle birleşik)
- **Dosya:** `money.ts:3,6`; yayılım order/payment/menu/reports tüm `*Cents` alanları. DB kolonları INTEGER (`000_init.sql:257,287,289,305`).
- **Kanıt:** `z.number().int().nonnegative()` — max yok; `2_147_483_648` zod'dan geçer, PG 22003 fırlatır. **Kalibrasyon:** Hat A HIGH / Hat C MEDIUM önerdi → MEDIUM (sessiz yanlış para yok; hata-UX sınıfı; ~21,4M TL girdi ancak typo ile ulaşılır).
- **Kanıt testi (KIRMIZI ×6):** `money.findings.test.ts`(4) + `order.findings.test.ts`(2). · **Öneri:** `MoneyCentsSchema`/`PositiveCentsSchema`'ya `.max(2_147_483_647)`. · **Etiket:** MVP-fix (tek satır, iki şema)

### [MEDIUM] [BUG] `payment_items` quantity sınırsız — kardeş şema `.max(99)` iken (ID: SD-T-A-03)
- **Dosya:** `payment.ts:55,64` vs `order.ts:64` (`.max(99)`). `quantity×unit_price` çarpımı INT4 CHECK aritmetiğini taşırabilir → 500. **Kalibrasyon:** HIGH→MEDIUM (SD-T-A-01 ile aynı 500-sınıfı).
- **Kanıt testi (KIRMIZI ×2):** `payment.findings.test.ts`. · **Öneri:** `.max(99)` paritesi. · **Etiket:** MVP-fix

### [MEDIUM] [ROB] `hasPermission` bilinmeyen rolde TypeError — "default-deny" sözü tutmuyor (ID: SD-T-B-03)
- **Dosya:** `permissions.ts:123-125` — `PERMISSIONS[role].has(action)`; tanımsız rol → `undefined.has` throw. JWT'den beklenmedik rol sızarsa 403 yerine 500.
- **Kanıt testi (KIRMIZI):** `permissions.findings.test.ts` SD-T-B-03. · **Öneri:** `PERMISSIONS[role]?.has(action) ?? false`. · **Etiket:** MVP-fix (tek satır)

### [MEDIUM] [SEC] Yazma-yolu sınırsız-string ailesi — 11 alan / 4 dosya (ID: SD-T-STR-01; birleşik: SD-T-B-05 + SD-T-C-03 + SD-T-C-04 + C-customers + C-settings)
- **Dosyalar:** `user.ts:17-63` (name×3, email×3, password/newPassword/currentPassword — DB kolonları TEXT, backstop yok) · `auth.ts:6` (LoginRequest.password `min(1)` — RefreshRequest `.max(512)` almışken) · `customers.ts:22,25,36` (addressLine/addressNote/notes) · `settings.ts:27` (timezone regex uzunluksuz).
- **Kalibrasyon:** Hat C parola alanlarını HIGH (bcrypt DoS), Hat B LOW önerdi → **MEDIUM aile**: bcrypt 72 byte'ta keser + Express body-limit 100kb blast-radius'u sınırlar; kalan risk depolama şişmesi + savunma-derinliği eksiği. Login unauthenticated ama loginLimiter mevcut.
- **Kanıt testi (KIRMIZI ×6):** `user.findings.test.ts`(5) + `auth.findings.test.ts`(1). · **Öneri:** Tek PR: name `.max(120)`, email `.max(254)`, password `.max(128)`, addressLine/notes `.max(500)`, tz `.max(64)`. · **Etiket:** MVP-fix

### [MEDIUM] [SEC/PERF] `CustomerSearchQuerySchema.search` sınırsız + wildcard-açık (ID: SD-T-C-06)
- **Dosya:** `customers.ts:72` — `min(1)` yalnız; 10k karakter veya `%%%%%%` ILIKE'a gider (Caller ID popup + manuel arama). · **Öneri:** `.max(100)` + backend `%`/`_` escape (escape tarafı **Blok 6**). · **Etiket:** MVP-fix (şema) + Blok-6 devri (escape)

### [MEDIUM] [QUAL] `PaymentVoidResponseSchema` JSDoc'u `{payment, order, reopened}` vaat ediyor, şema `order`'ı içermiyor; üstelik şema hiç tüketilmiyor (ID: SD-T-A-05)
- **Dosya:** `payment.ts:175-186`. Dead+drift kombinasyonu. · **Kanıt testi (YEŞİL belge):** `payment.audit.test.ts`. · **Öneri:** `order` ekle veya JSDoc düzelt; tüketilmiyorsa ADR-033 Faz-2 frontend'ine kadar karar. · **Etiket:** v5.1-backlog

### [MEDIUM] [ROB] Serbest-metin alanlarında null-byte/kontrol-karakteri filtresi yok (ID: SD-T-A-06)
- **Dosya:** order/payment/table note/label alanları — yalnız `.max()`. ` ` PG'de 22021 → 500. · **Öneri:** Merkezi "safe-text" refine helper — **ADR-gerekli** (Blok 1 SD-P-03 kontrol-baytı bulgusuyla aynı ailede tek karar). · **Etiket:** ADR-gerekli / v5.1-backlog

### 2.3 LOW (6)

- **SD-T-A-07** [QUAL] `OrderListQuerySchema.storeDate` regex takvim doğrulamıyor (`"9999-99-99"` geçer) — SD-T-C-01'in düşük-etkili kardeşi (liste filtresi, rapor değil). v5.1-backlog.
- **SD-T-A-08** [ROB] `z.coerce.number()` hex/bilimsel gösterimi sessizce kabul (`"0x1F"`→31, `"1e2"`→100) — `TakeawayListQuerySchema.limit/offset`; order.ts `offset`'te `.max()` de yok. v5.1-backlog.
- **SD-T-A-09 + SD-T-C-07** [DEAD] Kullanılmayan export'lar — birleşik tablo §5: **10 gerçek DEAD** (`TableRowSchema`/`TablePublicSchema`/`TableStatusSchema`/`PositiveCentsSchema` + `CategorySchema`/`ProductSchema`/`ProductVariantSchema`/`TenantSettingsSchema`/`UserCreateSchema`/`UserListResponseSchema`). Silme önerisi v5.1 (CLAUDE.md cerrahi kuralı — sorulmadan silinmedi).
- **SD-T-B-04** [SEC/KVKK] `IncomingCallEvent` ham telefon+adres taşıyor; tek koruma caller-station room-scoping (emit.ts:82'de doğru — tenant broadcast yok). Bulgu değil tasarım; "asla tenant odasına gitmez" regresyon testi **Blok 4'e devir**. v5.1-backlog.
- **SD-T-B-06** [ROB] Input şemalarında `.strict()` yok (yalnız order.ts'te 1 kullanım) — zod default-strip güvenli (sızıntı yok), ama bilinmeyen-alan drift'ini sessiz gizler. Informational. v5.1-backlog.
- **SD-T-C-08** [QUAL] Response şemaları yalnız type-level tüketiliyor; backend hiçbir response'unu `.parse` etmiyor — şema↔gerçeklik drift'i (SD-T-B-01, SD-T-C-02) tam bu yüzden sessiz kalıyor. Sistemik desen; çözüm önerisi (dev-ortamda response-parse middleware) **ADR-gerekli**, Blok 13 sentezine.

### 2.4 NIT (2)

- **SD-T-B-07** call-logs.ts:74 yorumu bayat event adı (`caller_id.incoming` → gerçek `caller.incoming`).
- **SD-T-B-08** audit.ts:7 `eventType` serbest regex; `AuditEventTypeSchema` enum'u varken kullanılmıyor (yazma tarafı writeAudit enum-enforced → düşük etki).

---

## 3. Temiz çıkan alanlar

- **Gevşeklik sweep (19 dosya):** `.passthrough()` **0** · `z.any()` **0** · `z.unknown()` yalnız 3 kasıtlı serbest-JSON metadata alanı (audit/print-agent/realtime payload) · `z.coerce` 9 kullanım, biri hariç (`order.offset`) hepsi bounded.
- **Enum ↔ DB paritesi tam:** `OrderStatusSchema`(9) Migration 000+001+042 birebir; `PaymentType/ScopeSchema` 001-RENAME sonrası adlarla birebir (eski adlar reddediliyor — test kanıtlı).
- **UUID disiplini:** Tüm ID alanları `.uuid()` (dört hat de taradı, istisna yok).
- **Parola sızıntısı yok:** `UserPublicSchema`'da password/hash alanı yok; Login/Refresh response'ları onu kullanıyor (test kanıtlı).
- **Realtime 11/13 event uyumlu + parse-garantili** (orders/tables/areas/products/categories.* — emit helper'dan geçiyor); sorun yalnız 2 kitchen.* direct-emit'te (SD-T-B-01).
- **Permissions matris İÇERİĞİ tutarlı:** kitchen en dar, admin superset, escalation yok — sorun içerik değil kablosuzluk.
- **reports.ts guard'ları:** ters-aralık reddi, 90-gün üst sınırı, preset+from/to çakışma reddi, `.length(24)` saat-bucket kilidi — hepsi doğru (40 yeşil testle kilitlendi).
- **`patch:empty_body` refine deseni** tüm PATCH şemalarında tutarlı; `extraPriceCents ±10000` (ADR-012 K4) iki şemada tutarlı; menu `is_default` superRefine + icon/color whitelist doğru.
- **NaN/Infinity/string/boolean/array** para şemalarında tamamı reddediliyor.

## 4. Eklenen test envanteri (24 dosya, 278 test)

| Hat | Dosyalar | Test | Sonuç |
|---|---|---|---|
| A | money/order/payment/table/area/attribute `.audit` (6) | 118 | ✅ yeşil |
| A | aynı 6 modül `.findings` (6) | 17 | 🔴 16 kasıtlı kırmızı + 1 yeşil referans |
| C | reports/customers/menu/settings/user `.audit` (5) | 127 | ✅ yeşil |
| C | reports/customers/menu/user `.findings` (4) | 12 | 🔴 12 kasıtlı kırmızı |
| B (ana-context yazdı) | realtime/permissions/auth `.findings` (3) | 4 | 🔴 4 kasıtlı kırmızı |

**Kırmızı → bulgu eşlemesi (32):** SD-T-A-01×6 · A-02×2 · A-03×2 · A-04×6 · B-01×2 · B-03×1 · B-05×1 · C-01×2 · C-02×3 · C-03×3 · C-04×2 · C-05×2.
**Suite (bu branch beklenen):** paket 404 test → **32 kırmızı (hepsi `.findings.`) / 372 yeşil**; mevcut 126 test regresyonsuz. `tsc --noEmit` temiz (üç hat ayrı ayrı doğruladı + final koşu).

## 5. DEAD-export tablosu (silinmedi — karar v5.1)

**Gerçek DEAD (10):** `TableRowSchema` · `TablePublicSchema` · `TableStatusSchema` · `PositiveCentsSchema` · `CategorySchema` · `ProductSchema` · `ProductVariantSchema` · `TenantSettingsSchema` · `UserCreateSchema` · `UserListResponseSchema` (+ karşılık gelen tipler).
**Yanlış-sözleşme (1):** `CustomerUpdateSchema` — web tip olarak kullanıyor, backend farklı şema koşuyor (SD-T-C-02).
**Type-only (6):** Customer response şemaları — runtime `.parse` sıfır (SD-T-C-08 sistemik notu).
**İç-kompozisyon (2):** `PhoneSchema`, `ImportRowStatusSchema`.

## 6. Etiket özetleri

- **MVP-fix (onay bekliyor):** SD-T-A-01, A-02, A-03, A-04 (8 site), B-03, STR-01 ailesi (11 alan), C-01, C-02(şema tarafı), C-05, C-06(şema tarafı).
- **ADR-gerekli:** SD-T-B-01 (emit tek-path — Blok 4 ile) · SD-T-B-02 (permissions kablolama stratejisi) · SD-T-A-06 (merkezi safe-text; Blok 1 SD-P-03 ile ortak karar) · SD-T-C-08 (response-parse deseni; Blok 13 sentezi).
- **v5.1-backlog:** A-05, A-07, A-08, DEAD listesi, B-04(test), B-06, B-07, B-08.

## 7. Sonraki bloklara devir notları

- **Blok 4 (api core/realtime):** SD-T-B-01 emit-bypass'ının kök çözümü (tek emit path + tipli `deps.io`); route⇄matris parite testi (SD-T-B-02); caller-station room-izolasyon regresyon testi (SD-T-B-04).
- **Blok 5 (orders/payments):** Takeaway+tableId route davranışı (SD-T-A-02); priceDeltaCents negatif-fiyat clamp'i var mı (SD-T-C-05); payment_items qty route-level üst kontrol.
- **Blok 6 (api routes):** customers PATCH kontrat kararı (SD-T-C-02); search ILIKE escape (SD-T-C-06); Blok 1 SD-S-08 export-maskeleme ADR'ı ile birlikte customers rotası tek kalemde.
- **Blok 7 (reports):** SD-T-C-01'in route-side etkisi (daily-close tarih parse'ı gerçekte nasıl davranıyor); `yyyyMmDd` fix'i sonrası tz sınır testleri.

## 8. Blok DoD durumu

- [x] Kapsamdaki 19 dosya okundu (3 hat + ana-context doğrulaması; tüm HIGH'lar kaynak üzerinde teyitli)
- [x] Bulgular A.4 şemasıyla raporlandı (26 ham → 22 konsolide; kalibrasyonlar şeffaf)
- [x] Her BLOCKER/HIGH için kırmızı karakterizasyon testi (32 kırmızı; B-02 gibi yapısal/grep-tabanlı bulgular hariç — kanıtları raporda)
- [x] permissions + realtime kontratına özel bölüm (brief gereği) — ikisi de "kablo yok" temasında kritik bulgu verdi
- [x] Prod kod değişmedi; mevcut testler değişmedi; bağımlılık eklenmedi
- [ ] BLOCKER yok; HIGH'lar Blok 13 sentezinde (`00-summary.md`) önceliklendirilecek
