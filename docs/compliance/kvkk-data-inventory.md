# KVKK Kişisel Veri Envanteri — Restoran POS v5

> Bu doküman, v3 POS'tan (Müşteriler.xlsx) v5 canlı prod veritabanına müşteri kişisel verisi (PII) taşınmadan **ÖNCE** yazılması zorunlu go/no-go ön-koşuludur (ADR-031 Karar 11); v5 sistemindeki tüm kişisel veri lokasyonlarını, işleme amaçlarını ve mevcut/eksik tedbirleri kayıt altına alır.

**Statü:** Taslak — import gate'i açmadan önce sorumlu (işletme sahibi) onayı gerekir.
**Kapsam:** v5.0 tek tenant **DİLAN PİDE** (prod: `https://restoranpos.org`).
**Dayanak kararlar:** ADR-016 (Caller ID + Müşteri Yönetimi, Accepted 2026-05-03) · ADR-031 (Faz 5 Pilot Go-Live + v3 Müşteri Taşıma, Accepted 2026-07-04) — `.claude/memory/decisions.md`.
**Not:** Bu bir dokümantasyon işidir. §12'deki boşluklar (anonymizeCustomer, VERBIS, aydınlatma metni, açık rıza mekanizması) **bilinçli olarak v5.1'e ertelenmiş KABUL EDİLMİŞ boşluklardır** — bu belge kapsamında yeni özellik önerilmez.

---

## 1. Amaç & Kapsam

**Amaç:** v3 müşteri defterinin (ad-soyad, telefon, adres) v5 canlı prod PostgreSQL'ine idempotent import'u öncesinde, sistemde işlenen tüm kişisel verileri envanterlemek ve KVKK açısından go/no-go ön-koşulunu karşılamak. ADR-031 Karar 11: "gerçek müşteri PII'si prod'a taşınmadan ÖNCE yazılır — docs işi, go/no-go ön-koşulu" (`.claude/memory/decisions.md:10945-10948`).

**Kapsam içi:**
- v5.0 prod tek tenant DİLAN PİDE.
- Müşteri PII (ad/telefon/adres/not/kara-liste), Caller ID telefon kaydı, personel (kullanıcı) verisi, sipariş-müşteri bağlantısı, denetim (audit) log'ları.
- v3 → v5 müşteri import script'i (`apps/api/scripts/import-v3-customers.ts`).

**Kapsam dışı (bilinçli, §12):** anonymizeCustomer domain servisi, VERBIS kaydı, aydınlatma metni yayını, açık rıza toplama UI'ı. Bunlar v5.1 backlog'undadır ve bu belge tarafından kabul edilmiş boşluk olarak raporlanır — inşa edilmez.

**Uyarı (Charter drift):** `docs/project-charter.md:194-201`'deki "v3 ana / v5 yedek 2 hafta paralel koşum" varsayımı ADR-031 Karar 10 ile GEÇERSİZ kılındı — restoran hâlihazırda Adisyo (ticari cloud POS) kullanıyor, v3 kullanım dışı. Cutover doğrudan Adisyo→v5. Charter revizyonu ayrı docs işi (P5-5).

---

## 2. Veri Sorumlusu & Veri İşleyenler

| Rol (KVKK) | Taraf | Açıklama |
|---|---|---|
| **Veri sorumlusu** | İşletme (DİLAN PİDE — tenant sahibi) | Kişisel verinin işlenme amaç ve vasıtalarını belirler; ilgili kişi taleplerinin muhatabı. |
| **Veri işleyen (barındırma)** | Hetzner Online GmbH — Falkenstein/**Almanya** | Sunucu barındırma. Hetzner Cloud CX23, IP `167.233.78.127`, Ubuntu 24.04 (`docs/ops/deploy.md:9-30`). |
| **Alt-işleyen (yedek depolama)** | Hetzner Storage Box (Almanya) | age-şifreli off-site yedek deposu (ADR-023; backup-strategy.md §9). |
| **Alt-işleyen (TLS sertifika)** | Let's Encrypt | HTTPS sertifikası (certbot --nginx, `docs/ops/deploy.md:14`). |
| **Alan adı kaydı** | Namecheap | `restoranpos.org` DNS (`docs/ops/deploy.md`). |
| **Geliştirme/bakım** | Yazılım geliştirici (tek kişi) | Kod ve deploy erişimi (manuel SSH runbook, ADR-031 Karar 3). |

**Not (Adisyo):** Adisyo (mevcut ticari POS) verisi v5'e **taşınmaz** (ADR-031 Karar 5) — bu belge Adisyo'yu veri işleyen olarak kapsamaz.

**m.12/3 veri işleyen sözleşmesi (belgelenmemiş):** KVKK m.12/3 gereği veri sorumlusu ile veri işleyen (Hetzner) arasında yazılı sözleşme / talimat güvencesi bulunmalıdır. Hetzner'in AVV (Auftragsverarbeitungsvertrag / DPA) kapsamı ToS içinde mi geldiği yoksa ayrı imza mı gerektirdiği HENÜZ teyit edilmemiştir. Bu import-blocker seviyesinde değildir ancak belgelenmelidir (bkz §11 madde #12).

---

## 3. Kişisel Veri Kategorileri Envanteri

Aşağıdaki her satırın "nerede saklanır" sütunu doğrulanmış dosya yolu ile verilmiştir.

| Veri kategorisi | Nerede saklanır (tablo.kolon + dosya) | İşleyen app | Hassas mı? | Notlar |
|---|---|---|---|---|
| Müşteri ad-soyad | `customers.full_name` — `packages/db/migrations/000_init.sql:220` | api, web | Hayır (kimlik/iletişim) | TEXT NOT NULL. Import'ta 'Ad Soyad'dan gelir. |
| Müşteri notu | `customers.note` — `packages/db/migrations/000_init.sql:221` | api, web | Potansiyel (serbest metin) | Nullable; import'ta doldurulmaz, elle girilir. Denetim/redaction'a dahil değil. |
| Müşteri soft-delete damgası | `customers.deleted_at` — `packages/db/migrations/000_init.sql:222` | api, web | Hayır (meta) | Nullable TIMESTAMPTZ. Soft-delete işareti; kalıcı imha değil (bkz §5). |
| Müşteri anonimleştirme damgası | `customers.anonymized_at` — **ŞEMADA YOK** | — | — | 🔴 Boşluk: anonymizeCustomer domain servisi uygulanınca TIMESTAMPTZ olacak. v5.1 (§12.1). |
| Kara liste durumu + gerekçe | `customers.is_blacklisted`, `customers.blacklist_reason` — `packages/db/migrations/027_caller_id_and_customers.sql:21-22` | api, web | Potansiyel (serbest metin gerekçe) | ADR-016 Karar 6: kara listede UI'da kırmızı uyarı zorunlu. Import HİÇ dokunmaz; kolon DB DEFAULT ile false (027:21). Canlıda elle işaretlenir. |
| v3 legacy no | `customers.legacy_v3_no` — `packages/db/migrations/027_caller_id_and_customers.sql:25,32-34` | api (import) | Hayır | BIGINT; idempotency anahtarı, UNIQUE(tenant_id, legacy_v3_no). |
| Müşteri telefon (normalize) | `customer_phones.normalized_phone` — `packages/db/migrations/000_init.sql:238` | api, web | **Evet** (iletişim/tanımlayıcı) | Düz metin (kolon-şifreleme yok). UNIQUE(tenant_id, normalized_phone). |
| Müşteri telefon (ham giriş) | `customer_phones.raw_phone` — `packages/db/migrations/027_caller_id_and_customers.sql:42` | api (import) | **Evet** | Düz metin. Import'ta cleanRawPhone() sonrası saklanır. |
| Müşteri adresi (satır) | `customer_addresses.address_line` — `packages/db/migrations/027_caller_id_and_customers.sql:63` | api, web | **Evet** (konum) | Soft-delete (`is_deleted`) — eski sipariş referansı için korunur. |
| Adres alt-alanları | `customer_addresses.district / neighborhood / address_note` — `packages/db/migrations/027_caller_id_and_customers.sql:64-66` | api, web | **Evet** (konum + serbest not) | Import'ta yalnız district ('Mahalle') dolar; diğerleri NULL. |
| Caller ID telefon (ham/normalize) | `call_logs.raw_phone`, `call_logs.normalized_phone` — `packages/db/migrations/000_init.sql:386-387` | api, caller-bridge | **Evet** | 30 gün saklama; cron ile silinir (bkz §5). |
| Personel e-posta | `users.email` — `packages/db/migrations/003_users_add_email.sql:7` | api, web, mobile | **Evet** (iletişim) | Nullable; tenant başına lower() UNIQUE. Düz metin. |
| Personel kullanıcı adı | `users.username` — `packages/db/migrations/000_init.sql:151` | api, web, mobile | Hayır | NOT NULL; login/görüntü. |
| Personel parola hash | `users.password_hash` — `packages/db/migrations/000_init.sql:152`; `apps/api/src/auth/password.ts` | api | Kimlik bilgisi (hash) | bcrypt cost=12; düz parola asla saklanmaz. |
| Personel soft-delete damgası | `users.deleted_at` — `packages/db/migrations/000_init.sql:153` | api, web | Hayır (meta) | Nullable TIMESTAMPTZ. Denetim sürekliliği için hard-delete yasak (ADR-003). |
| Sipariş-müşteri bağlantısı | `orders.customer_id` — `packages/db/migrations/000_init.sql:251` | api, web, mobile | Hayır (yalnız UUID) | Ad/telefon burada tutulmaz. |
| Sipariş notu | `orders.note` — `packages/db/migrations/000_init.sql:258` | api, web | Potansiyel (serbest metin) | Nullable; teslimat talimatı / müşteri notu içerebilir. `customers.note` ile aynı muamele — varsayılan olarak denetim/redaction'a dahil değil. |
| Teslimat adresi snapshot | `orders.delivery_address_snapshot` — `packages/db/migrations/031_orders_takeaway_stage.sql:21` | api, web | **Evet** (konum) | Sipariş anında dondurulur; kalıcı (fatura/teslim delili). |
| Teslimat notu | `orders.delivery_note` — `packages/db/migrations/031_orders_takeaway_stage.sql` | api, web | Potansiyel (serbest metin) | Bina/erişim bilgisi içerebilir. |
| Personel atıf (garson) | `orders.waiter_user_id` — `packages/db/migrations/005_orders_add_waiter_user_id.sql:7-21` | api, web, mobile | Hayır (UUID) | Ad FK join ile çözülür; ON DELETE SET NULL. |
| Kalem oluşturan personel snapshot | `order_items.created_by_name`, `created_by_user_id` — `packages/db/src/generated.ts:220-221` | api | Hayır (personel adı) | Denetim için değişmez snapshot. |
| Ödeme yapan etiketi (payment) | `payments.payer_label` — `packages/db/migrations/024_payments_split_v3_parity.sql:25` | api, web | Potansiyel (misafir adı içerebilir) | VARCHAR(80) NULL; serbest metin. |
| Ödeme yapan etiketi (payment_items) | `payment_items.payer_label` — `packages/db/migrations/024_payments_split_v3_parity.sql:50` | api, web | Potansiyel (misafir adı içerebilir) | VARCHAR(80) NULL; serbest metin, denormalize. |
| Refresh token cihaz/IP | `refresh_tokens.ip_address`, `user_agent`, `device_label` — `packages/db/src/generated.ts:372,380,368` | api | **Evet** (IP = PII, m.7) | Düz metin IP; anonimleştirme v5.1 (kabul edilmiş boşluk). Retention için bkz §5. |
| Denetim log aktörü | `audit_logs.actor_user_id`, `audit_logs.actor` (JSONB) — `packages/db/migrations/000_init.sql:355-379` | api | Hayır (PII deny-list korumalı) | Payload'a ad/telefon/adres YAZILMAZ; deny-list + whitelist zorlar. |

**Özel nitelikli veri (KVKK m.6) — negatif teyit:** Sistemde KVKK m.6 kapsamında özel nitelikli kişisel veri (sağlık, din, etnik köken, biyometrik, genetik, ceza mahkumiyeti vb.) **işlenMEZ**. Tek risk noktası kara-liste gerekçesi (`customers.blacklist_reason`) ve serbest not alanlarıdır (`customers.note`, `orders.note`): operatöre bu alanlara özel-nitelikli veri (sağlık/etnik/dini bilgi) GİRMEME talimatı verilir — idari tedbir (bkz §7 [aslında §9 tablosu]).

**Depolama özelliği notları:** telefonlar kolon-düzeyi şifrelemesiz düz E.164 saklanır (`packages/shared-domain/src/phone.ts`; `packages/db/migrations/000_init.sql:238`). Denetim log'u INSERT-only, mutasyon trigger ile engellenir (`packages/db/migrations/000_init.sql:354-392`).

---

## 4. İşleme Amaçları & Hukuki Dayanak (KVKK m.5/6)

| İşleme faaliyeti | Amaç | Hukuki dayanak (m.5/2) |
|---|---|---|
| Müşteri ad/telefon/adres saklama | Paket/teslimat siparişinin alınması, hazırlanması, teslimi | (c) Sözleşmenin ifası + (f) meşru menfaat (müşteri tanıma) |
| Teslimat adresi snapshot | Teslimat delili / fatura kaydı | (c) Sözleşmenin ifası + (e) hakkın tesisi/korunması |
| Kara liste (is_blacklisted + gerekçe) | Sahte sipariş/taciz riskinin yönetimi (operasyonel güvenlik) | (f) Meşru menfaat |
| Personel e-posta/ad/rol | Kimlik doğrulama, yetkilendirme, sipariş atfı | (c) Sözleşmenin ifası (iş) + (ç) hukuki yükümlülük |
| Denetim log'u (aktör UUID) | Hesap verebilirlik / güvenlik izlenebilirliği | (f) Meşru menfaat |
| Refresh token IP/UA | Oturum güvenliği, kötüye kullanım tespiti | (f) Meşru menfaat |

Yukarıdaki işlemelerde KVKK m.6 kapsamında özel nitelikli veri işlenmez (bkz §3 negatif teyit).

**Caller ID özel notu:** Gelen arama telefonu (`call_logs`) meşru menfaat kapsamında **anlık** müşteri tanıma için işlenir; ham telefon 30 gün sonra silinir (m.5 orantılılık — §5). Maskeli platform numaraları (Yemeksepeti/Getir/Trendyol Yemek) hiç kaydedilmez — girişte filtrelenir (ADR-016 §8, `.claude/memory/decisions.md:8639-8653`). CLAUDE.md:125 kuralı: "Asla: Caller ID verisini KVKK onayı olmadan log'lamak" — uygulama log'unda ham telefon yasak; yalnız DB'ye (30 gün retention'lı) yazılır. Kod bunu onurlandırır: `apps/api/src/routes/caller-id/index.ts:277-286` yalnız callLogId/tenantId/hasStation loglar.

**Açık rıza gereken haller:** Mevcut işlemeler sözleşmenin ifası + meşru menfaat ile karşılanmaktadır; standart operasyon açık rıza gerektirmez. Pazarlama/SMS kampanyası, müşteri segmentasyonu gibi ikincil amaçlar (ADR-016 v5.1 backlog) açık rıza gerektirir ve v5.0'da UYGULANMAMIŞTIR (§12).

---

## 5. Saklama Süreleri & İmha (KVKK m.7)

| Veri | Saklama süresi | İmha mekanizması | Statü |
|---|---|---|---|
| `call_logs.raw_phone` + `normalized_phone` | 30 gün | Cron gecelik toplu DELETE — `apps/api/src/cron/ttl-cleanup.ts:31` (`CALL_LOG_RETENTION_DAYS=30`) | ✅ Otomatik |
| `audit_logs` | 2 yıl (730 gün) | Cron gecelik 03:30 Europe/Istanbul — `apps/api/src/cron/ttl-cleanup.ts:30` (`AUDIT_LOG_RETENTION_DAYS=365*2`) | ✅ Otomatik |
| `refresh_tokens` (IP/UA dâhil) | Belirsiz — token expiry/rotation politikasına bağlı | **Otomatik expired-token temizliği belgelenmemiş** | 🔴 Belgesiz |
| `customers` (ad/telefon/adres) | Süresiz (hesap ömrü) | **Otomatik imha/anonimleştirme YOK** | 🔴 Manuel |
| `customer_addresses` | Süresiz (soft-delete `is_deleted`) | Soft-delete; kalıcı imha manuel | 🔴 Manuel |
| `orders.delivery_address_snapshot` | Kalıcı (append-only) | İmha yok — fatura/teslim delili retention'ı | Kabul (belge saklama) |
| `users` | Soft-delete (`deleted_at`, `000_init.sql:153`) | Denetim sürekliliği için hard-delete yasak (ADR-003) | Tasarım gereği |

**FLAG — refresh_tokens IP/UA retention'ı belgesiz.** `refresh_tokens.ip_address`/`user_agent` düz metin IP+UA tutar (IP KVKK'da kişisel veridir). Bu kayıtların ne kadar saklandığı ve expired token'ların temizlenip temizlenmediği bu belgede TEYİT EDİLEMEMİŞTİR; m.7 orantılılık için token yaşam döngüsü + imha politikası belgelenmelidir (v5.1 anonimleştirme boşluğundan ayrı bir izleme maddesi — §12.5).

**FLAG — mevcut durumda otomatik müşteri imha/anonimleştirme YOKTUR.** `customers` tablosunda `deleted_at` soft-delete kolonu vardır (`packages/db/migrations/000_init.sql:222`) ancak otomatik TTL/anonymize devrede değildir. Silme talebi geldiğinde **geçici manuel imha prosedürü** uygulanır:

1. Admin, müşteriyi web UI'dan tespit eder (GET /customers/search).
2. Kalıcı silme gerekiyorsa admin-only `DELETE /customers/bulk` endpoint'i gerçek DELETE yapar (`apps/api/src/routes/customers/index.ts:599-630`) — kayıt DB'den tamamen kaldırılır (anonimleştirme değil, hard-delete).
3. İşlem `audit_logs`'a sanitize edilmiş payload ile (yalnız id + adet) kaydedilir.
4. Silme kararı ve tarihi işletme tarafından KVKK imha kaydına (kağıt/dış) işlenir.

anonymizeCustomer (ad→'Anonim', telefon/adres hard-delete, `anonymized_at` damgası) domain servisi UYGULANMAMIŞTIR (ADR-003 §8.3 tasarım deseni; v5.1) — §12.

---

## 6. Veri Aktarımı — Yurt İçi / Yurt Dışı (KVKK m.9)

**KRİTİK:** Prod sunucu **Almanya'da (Hetzner, Falkenstein)** barındırıldığı için tüm müşteri PII'si (ad/telefon/adres) **yurt dışına aktarılmaktadır** (`docs/ops/deploy.md:9`). Bu, KVKK m.9 kapsamında değerlendirilmesi gereken bir yurt dışı aktarımdır.

**Mevcut durum:**
- Sunucu + PostgreSQL 17 Almanya (AB — GDPR yeterlilik bölgesi).
- Off-site yedek: Hetzner Storage Box, Almanya (age-şifreli) — aktarım AB içinde kalır (`docs/ops/deploy.md`, ADR-023).
- PostgreSQL yalnız localhost dinler, internete kapalı (`docs/ops/deploy.md`).
- Aktarım TLS (Let's Encrypt) ile şifreli.

**Gap (belgelenen boşluk):** m.9 yurt dışı aktarım için KVKK'nın öngördüğü ilgili kişiye açık rıza VEYA taahhütname/uygun güvenceler dokümantasyonu HENÜZ tamamlanmamıştır. AB'nin GDPR yeterlilik statüsü m.9 için otomatik yeterlilik sağlamaz — Türkiye KVKK açısından ayrı değerlendirme gerekir. **Bu, import gate'inde işletme sahibinin hukuki teyidini gerektiren bir maddedir** (bkz §11 GO/NO-GO). Aydınlatma metninde aktarımın Almanya'ya yapıldığı açıkça belirtilmelidir (bkz §7 m.10).

---

## 7. Aydınlatma Yükümlülüğü (KVKK m.10)

İlgili kişilere (müşteriler) sunulacak aydınlatma metni, KVKK m.10'un beş zorunlu unsurunu bir arada içermelidir. Metnin **YAYINI** v5.0'da mevcut değildir — kabul edilmiş v5.1 boşluğu (§12.3); import öncesi ayrı/manuel süreçle yürütülür (bkz §10, §11 madde #3).

| m.10 zorunlu unsur | Bu sistemde karşılığı |
|---|---|
| 1. Veri sorumlusunun kimliği | İşletme (DİLAN PİDE) — iletişim bilgileri (§2). |
| 2. Kişisel verinin işlenme amaçları | Sipariş alma/hazırlama/teslim, operasyonel güvenlik, kimlik doğrulama (§4). |
| 3. Aktarılan taraf + ülke | Hetzner (Almanya) — **yurt dışı aktarım** açıkça belirtilir (§6, m.9). |
| 4. Toplama yöntemi + hukuki sebep | Telefon/şahsen sipariş sırasında toplanır; Caller ID ile anlık; hukuki sebep m.5/2 (c) sözleşmenin ifası + (f) meşru menfaat (§4). |
| 5. İlgili kişi hakları (m.11) | §8'de listelenen erişim/düzeltme/silme/itiraz/taşınabilirlik hakları. |

**Not:** Aydınlatma yükümlülüğü açık rızadan ayrıdır ve rızadan bağımsız olarak (sözleşme/meşru menfaat dayanaklı işlemelerde de) yerine getirilmelidir. Açık rıza toplama mekanizması (UI) v5.0'da yoktur (§12.4) ve standart operasyon için gerekmez (§4).

---

## 8. İlgili Kişi Hakları (KVKK m.11)

| Hak | Mevcut karşılama | Gap |
|---|---|---|
| Bilgi talebi / erişim | Admin+kasiyer: GET /customers, /customers/:id, /customers/search (`apps/api/src/routes/customers/index.ts:180-235`); admin-only toplu dışa aktarım GET /customers/export (`apps/api/src/routes/customers/index.ts:467-575`) | DSAR'ı otomatik toplayan tekil rapor yok; manuel derleme. |
| Düzeltme | Web UI müşteri düzenleme (PATCH endpoint'leri) | — |
| Silme / yok etme | Admin-only hard-delete `DELETE /customers/bulk` (`apps/api/src/routes/customers/index.ts:599-630`); adres soft-delete (`apps/api/src/routes/customers/index.ts:1002-1023`) | Anonimleştirme (anonymizeCustomer) YOK — yalnız tam silme; §5 manuel prosedür. |
| İşleme itiraz / kısıtlama | Kara liste toggle ile sipariş reddi (operasyonel) | Genel işleme itirazı için özel mekanizma yok — manuel. |
| Veri taşınabilirliği | GET /customers/export JSON çıktısı (admin) | Standart taşınabilir format garantisi belgelenmemiş. |

Erişim kontrolü (RBAC): müşteri PII'sini yalnız **admin + kasiyer** okuyabilir; garson ve mutfak rolleri müşteri ve caller-id endpoint'lerinden bloklanır (`apps/api/src/routes/customers/index.ts:180-203`; `apps/api/src/routes/caller-id/index.ts:97-118`). Caller ID popup'ı yalnız `tenant_settings.caller_id_station_user_id` atanmış tek kullanıcıya socket.io ile gider (`apps/api/src/realtime/handshake.ts:138-197`).

---

## 9. Teknik & İdari Tedbirler (KVKK m.12)

| Tedbir | Durum | Kaynak |
|---|---|---|
| TLS/HTTPS (dış trafik) | ✅ Let's Encrypt, HTTP→HTTPS zorunlu redirect | `docs/ops/deploy.md:14` |
| Parola hash | ✅ bcrypt cost=12 | `apps/api/src/auth/password.ts` |
| Kimlik doğrulama | ✅ JWT (access + refresh); refresh token DB'de SHA-256 hash | `packages/db/src/repositories/refresh-tokens.ts:12-13` |
| Print-agent kimlik | ✅ API key bcrypt hash; düz anahtar tek sefer gösterilir | `packages/db/migrations/037_create_agents_table.sql:25` |
| Ağ güvenlik duvarı | ✅ UFW: yalnız 22/80/443 | `docs/ops/deploy.md` (Prod envanteri) |
| Brute-force koruma | ✅ fail2ban aktif; login rate-limiter (E2E_BYPASS prod'da SET EDİLMEZ) | `docs/ops/deploy.md`; ADR-031 Karar 3 |
| DB internet erişimi | ✅ PostgreSQL yalnız localhost dinler | `docs/ops/deploy.md` |
| İşletim sistemi güncelleme | ✅ unattended-upgrades kurulu | `docs/ops/deploy.md` |
| Log redaction (uygulama) | ⚠️ Kısmi — `req.body.phone/email/password/tckn/pan/iban` redakte; ham Caller ID zaten hiç loglanmaz | `apps/api/src/logger.ts:29-60` |
| Denetim log PII engeli | ✅ deny-list (write-time sanitize, EN/TR/PCI anahtarlar) + event-bazlı whitelist; DB CHECK constraint backup | `packages/shared-domain/src/audit/deny-list.ts:2-14`; DB CHECK `packages/db/migrations/000_init.sql:367-378` |
| Özel nitelikli veri (m.6) girme yasağı | ⚠️ İdari tedbir — operatöre serbest-metin alanlarına (not/kara-liste gerekçe) sağlık/etnik/dini bilgi girmeme talimatı | §3 negatif teyit |
| Yedek şifreleme | ⚠️ age-encryption tasarlandı; §9 6-ayak checklist (P5-3) tamamlanmalı; age private key kasa go/no-go ön-koşulu | ADR-023; `docs/ops/backup-strategy.md §9`; ADR-031 Karar 7 |
| Çok-kiracılı izolasyon | ✅ Her sorgu `tenant_id` filtreli; auth middleware tenant eşleşmesi doğrular | `apps/api/src/routes/customers/index.ts` |
| Veri işleyen sözleşmesi (m.12/3) | ⚠️ Hetzner AVV/DPA durumu belgelenmemiş | §2 (m.12/3 notu); §11 #12 |
| Kolon-düzeyi şifreleme (PII) | ⚠️ YOK — telefon/adres düz metin; TDE etkin değil | `packages/db/migrations/000_init.sql:238` |
| IP/User-Agent anonimleştirme | 🔴 YOK — refresh_tokens ve audit.actor'da düz metin (v5.1) | `packages/db/src/generated.ts:372` |

---

## 10. v3 → v5 Müşteri Taşıma Özel Değerlendirmesi

**Script:** `apps/api/scripts/import-v3-customers.ts` (idempotent, dedup, normalizePhoneTr). Kaynak SADECE v3 Müşteriler.xlsx; **Adisyo verisi KULLANILMAZ** (ADR-031 Karar 5, `.claude/memory/decisions.md:10897-10908`).

**Taşınan alanlar (yalnız):**
| v3 Excel kolonu | v5 hedef | Kaynak satır |
|---|---|---|
| No | `customers.legacy_v3_no` | `apps/api/scripts/import-v3-customers.ts:133-166` |
| Ad Soyad | `customers.full_name` | `apps/api/scripts/import-v3-customers.ts:379-390` |
| Telefon | `customer_phones.raw_phone` + `normalized_phone` + `is_mobile` | `apps/api/scripts/import-v3-customers.ts:105-121, 397-418` |
| Mahalle | `customer_addresses.district` | `apps/api/scripts/import-v3-customers.ts:419-434` |
| Adres | `customer_addresses.address_line` (title='Ev', is_default=true) | `apps/api/scripts/import-v3-customers.ts:362-370` |
| Toplam Sipariş Sayısı | `customers.total_orders` (denormalize sayaç) | parse `apps/api/scripts/import-v3-customers.ts:187-191` · write `:389` |

**Taşınmaz (ADR-031 Karar 5):** kara liste (script okumaz), menü (elle girilir), geçmiş sipariş/ödeme/raporlar, veresiye/bakiye (ADR-016 §11.1 v5.1), Adisyo-dönemi müşterileri (Adisyo export kullanılmaz — Adisyo döneminde eklenen müşteriler v5'e alınmaz).

**Dedup / idempotency:** `UNIQUE(tenant_id, legacy_v3_no)` (`packages/db/migrations/027_caller_id_and_customers.sql:32-34`) + ON CONFLICT DO NOTHING. Re-run'da mevcut legacy_v3_no atlanır (`customersSkippedAlreadyExists`). NULL legacy_v3_no satırları "yeni" sayılır → her koşuda duplike (tasarım gereği, `apps/api/scripts/import-v3-customers.ts:329-343`). **Dry-run DB durumunu kontrol etmez** → prod raporu dry-run'dan farklı olur.

**Kara liste:** Import script `is_blacklisted` kolonuna **HİÇ dokunmaz** — insertCustomer yalnız id/tenant_id/full_name/legacy_v3_no/total_orders yazar (`apps/api/scripts/import-v3-customers.ts:384-390`); false değeri migration DB DEFAULT'undan gelir (`027_caller_id_and_customers.sql:21`). Canlıda **ELLE** işaretlenir (birkaç kayıt beklenir, operasyonel olarak uygulanabilir; ADR-016 Amendment 1: kod tespiti "kara liste kolonu YOK").

**Telefon veri-kaybı — DENETLENDİ (Session 82):** v3 telefonları `customer_phones` 1-to-many'de (bir müşteride birden çok numara mümkün). Kullanıcının sağladığı aktif export'ta (1475 müşteri) TEK 'Telefon' kolonu var → v3'ün 2. numaraları **export anında** düşürülmüş (import'un değil). v3'te `Müşteri Telefonu 2` içeren AYRI export route'u var (`D:\dev\restoran-pos-v3\server\routes\customers.js:447-501`) ama farklı format → dönüşüm gerektirir, MVP-dışı. Ek: 87 müşteri aynı telefonu paylaşıyor → `UNIQUE(normalized_phone)` ile 2.si skip. **Karar: pilot için tek-telefon KABUL.** Detay: `docs/v3-reference/customer-data-and-export.md`.

**Veri doğruluğu & güncelliği (m.4/2-d) + minimizasyon (m.4/2-ç):** v3 defterinin güncelliği bilinmiyorsa (eski/ölü kayıtlar, taşınmış/değişmiş numaralar), import edilen kayıtların ilk temas/sipariş anında doğrulanması operasyonel not olarak benimsenir (m.4/2-d doğruluk ve güncellik ilkesi). Taşınan alan seti (ad/telefon/adres/legacy_no/sipariş sayacı) operasyon için gerekli olanla sınırlıdır (m.4/2-ç veri minimizasyonu) — geçmiş sipariş/ödeme/bakiye taşınmaz.

**Aydınlatma / açık rıza durumu:** Import script **hiçbir** aydınlatma/açık rıza/consent-audit mantığı içermez. Import müşteriye yönelik veri toplama değil, iç operasyonel taşımadır; aydınlatma AYRI yürütülür (ilgili kişilere önceden bildirim — §7). Açık rıza UI'ı ve VERBIS v5.1'e ertelendi (§12). Not: import script şu an `audit_logs`'a "toplu müşteri import" event'i YAZMAZ — go-live öncesi manuel audit event eklenmesi bir DoD maddesidir (bkz §11).

**Aydınlatma metnindeki gerekli ifadeler:** verinin Almanya'da (yurt dışı) işlendiği (§6), saklama süresi (§5), veri sorumlusu iletişimi (§2), m.11 hakları — tam unsur seti §7'de.

---

## 11. GO / NO-GO Checklist

Import'u fiilen gate'leyen maddeler:

| # | Madde | Durum | Sorumlu | Not |
|---|---|---|---|---|
| 1 | Bu envanter dokümanı yazılı + onaylı | ⚠️ Taslak | İşletme sahibi | ADR-031 Karar 11 ön-koşulu. |
| 2 | m.9 yurt dışı (Almanya) aktarım hukuki teyidi + aydınlatma metninde belirtim | 🔴 EKSİK | İşletme sahibi (hukuki) | §6 — gate'i açan kritik madde. |
| 3 | İlgili kişilere aydınlatma (ön-bildirim) planı — m.10 unsurları | 🔴 EKSİK | İşletme sahibi | §7, §10 — ayrı yürütülür. |
| 4 | backup-strategy.md §9 — 6 sunucu ayağı YEŞİL + age key kasada | 🔴 EKSİK | Geliştirici | ADR-031 Karar 7; key kaybı = tüm yedek kaybı. |
| 5 | Prod TENANT_ID = bootstrap tenant UUID (env eşleşir) | ✅ OK | Geliştirici | Session 81 bootstrap: DİLAN PİDE, api.env'de. |
| 6 | v3 DB phone_2/phone_3 kardinalite denetimi (veri-kaybı riski) | ✅ DENETLENDİ (S82) | Geliştirici | v3 telefon 1-to-many; gerçek export TEK 'Telefon' (2. numaralar export'ta yok) + 87 mükerrer→skip. Kabul (pilot); alt-export ayrı iş. `docs/v3-reference/customer-data-and-export.md`. |
| 7 | Dev/staging'de dry-run + satır sayısı Excel ile eşleşir | ✅ OK (S82) | Geliştirici | Gerçek dosyada dry-run temiz: 1475→1469 geçerli, 1094 telefon, 126 adres. Başlıklar birebir uyar. |
| 8 | Import için audit event kaydı eklendi (toplu import) | ✅ OK | Geliştirici | #263: `customer_import.completed` (counts-only), müşteri INSERT'leriyle aynı transaction. |
| 9 | Deploy smoke geçti (web/mobil/yazıcı/KDS/Caller ID popup) | ✅ OK | Geliştirici | ADR-031 Karar 10; login canlı doğrulandı. |
| 10 | TLS + UFW + fail2ban + PG localhost aktif | ✅ OK | Geliştirici | §9 doğrulandı. |
| 11 | Log redaction aktif + ham Caller ID loglanmıyor doğrulandı | ✅ OK | Geliştirici | `apps/api/src/logger.ts:29-60`; `apps/api/src/routes/caller-id/index.ts:277-286`. |
| 12 | Hetzner AVV/DPA (m.12/3 veri işleyen sözleşmesi) durumu belgelendi | 🔴 EKSİK | İşletme sahibi | §2 — import-blocker değil ama belgelenmeli. |

**Karar:** Yukarıdaki 🔴 maddeler kapatılmadan import ÇALIŞTIRILMAZ (NO-GO). **Session 82 sonrası kalan kritik gate: #2 (m.9 hukuki), #3 (aydınlatma), #4 (yedek/P5-3)** — hepsi işletme sahibi/hukuki/P5-3. Teknik ayaklar TAMAM: export sağlandı + dry-run temiz (#6/#7), audit event eklendi (#8). #12 belge-gerekliliğidir, blocker seviyesinde değildir.

---

## 12. Açık Riskler / Bilinçli Kabul Edilen v5.1 Boşlukları

Aşağıdakiler **KAPSAM DIŞIDIR** — v5.0'da inşa EDİLMEZ, v5.1 backlog'undadır (active-plan; ADR-016 kapsam kilidi; ADR-031 Karar 5). Bu belge kapsamında yeni özellik önerilmez; bunlar bilinçli kabul edilmiş boşluk olarak kayıt altındadır.

1. **anonymizeCustomer domain servisi — YOK.** KVKK unutulma hakkı için ad→'Anonim' + telefon/adres hard-delete + `anonymized_at` damgası deseni (ADR-003 §8.3) uygulanmamıştır. Geçici çözüm: manuel hard-delete (§5). `customers.anonymized_at` kolonu şemada yoktur (§3).
2. **VERBIS kaydı — YOK.** Türkiye Veri Sorumluları Sicili entegrasyonu/başvuru akışı uygulanmamıştır; hukuki şablon bekliyor.
3. **Aydınlatma metni (disclosure) yayını — YOK.** İlgili kişi bildirimi metni ve yayın mekanizması v5.0'da yoktur; manuel/dış süreç (unsurları §7).
4. **Açık rıza (rıza toplama) UI mekanizması — YOK.** Consent-recording tablosu ve toplama arayüzü yoktur. İkincil amaçlar (pazarlama/SMS, segmentasyon — ADR-016 v5.1) açık rıza gerektirir; v5.0'da bu amaçlar zaten işlenmez.
5. **IP adresi hashing/retention — YOK.** `refresh_tokens.ip_address` ve `audit_logs.actor` düz metin IP tutar; refresh_tokens retention/imha politikası da belgesizdir (§5). v5.1.
6. **User-Agent hashing — YOK.** `audit_logs.actor` / `refresh_tokens.user_agent` düz metin UA tutar (v5.1).
7. **Kolon-düzeyi PII şifrelemesi / TDE — YOK.** Telefon/adres düz metin saklanır; disk düzeyi + backup age-encryption ile korunur.
8. **Veresiye / bakiye — YOK.** ADR-016 §11.1 v5.1; import bakiye alanlarını okumaz/yazmaz.

---

Final doküman şuraya yazıldı: `D:\restoran-pos-v5\docs\compliance\kvkk-data-inventory.md`