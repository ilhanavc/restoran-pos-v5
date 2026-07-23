# Aktif Plan — Phase 5: Pilot Go-Live + Adisyo→v5 Geçişi + v3 Müşteri Taşıma

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.
> Bu fazın tam kararları: `.claude/memory/decisions.md` → **ADR-031** (14 karar + sprint + DoD).

**Son güncelleme:** 2026-07-23 (**Session 104** — 2 PR #444/#445 · **PROD DEPLOY** (`eea396c`, migration 050 değişmedi) · 🔥🔥 **cutover blokeri kapandı**: paket siparişte porsiyon **ve özellik** kaybı = para kaybı (#444, kapsam sanılandan geniş) + kasa fişi porsiyonu basıyor (#445, ADR-027 Amd3; karar gerçek renderer'la kâğıt-eşdeğeri PNG karşılaştırmasıyla verildi) · S103'ten devreden **#440 deploy borcu** aynı turda kapandı · **ürün sahibi canlıda doğruladı**. Cutover'ın önünde teknik engel kalmadı.)

<details><summary>Önceki güncelleme (S103, 2026-07-22) — tarihsel</summary>

**Son güncelleme:** 2026-07-22 (**Session 103 kapanış** — 11 PR #425-435 · **PROD DEPLOY YAPILDI** (`f30f882`, migration **050**) · ürün sahibinin canlıda bulduğu **3 bug** kapandı (özellik grubu kaldırma `22P02` · ek ücret tavanı ±100→±1.000 TL çift-katman · mobil hızlı ödemede kasa fişi) · **yetim-kuyruk göstergesi canlı sınandı** (ADR-032 Amd2 son `[USER]` borcu) · **web parti modeli** (ADR-013 Amd2) · **OTA kapsama alındı** (ADR-031 Amd2, `expo-updates`) · cutover belgeleri gerçeğe oturtuldu · mobil paketler basıldı: iOS `f7f325d4` (6 UDID doğrulandı) + Android `4e0b2411`.)

</details>

**▶ SIRADAKİ (S105):**
**(1) 🎯 CUTOVER GÜNÜ (24-26 Tem) — teknik önkoşulların HEPSİ kapandı.** Runbook güncel ve güvenilir: `docs/ops/cutover-gunu-runbook.md`. Kalemler: ADR-031 go/no-go · test verisi temizliği (`cutover-test-temizligi.md`) · `order_no` 1'den · Adisyo'nun bırakılması. **Cutover gecesi: deploy YOK · OTA YOK · kasada `admin` hesabı.**
**(2) 📌 `42501` izi** — prod log'unda `insufficient_privilege` (21 Tem ×4, 22 Tem ×1). Hâlâ **incelenmedi**; bloklamıyor ama cutover öncesi bakılmalı. Nginx access log'unda o saatlerin 5xx'leri yeterli.
**(3) v5.1 planlama** — `docs/audit/low-nit-devir.md` · 91 unused-exported-types · ADR-032 Dilim C/D/E · kişi-bazlı `cashier` rolü · 13 eski draft audit PR (#329-341) kapatılmalı.

<details><summary>S104'te kapanan (2026-07-23)</summary>

- ✅ **(1) 🔥🔥 Paket siparişte porsiyon kaydedilmiyor — #444 CANLI.** Kapsam sanılandan genişti: `variantId` **ve `selectedAttributes`** birlikte düşüyordu (ikinci para-kaybı yolu); ayrıca cross-product variant `201` ile kabul ediliyordu. Takeaway handler ortak `resolveItemSnapshots()` + `insertItemsAndRecalc()`'a alındı → asimetri **kaldırıldı** (−75 satır). Fiş tarafında iş yoktu (şablonlar boş tablodan okuyordu).
- ✅ **(2) Kasa fişi + ödeme ekranı porsiyonu — #445 CANLI (ADR-027 Amendment 3).** Adet kolonunda `"2 Bir buçuk"`; karar iki adayın **gerçek renderer'la PNG'ye basılıp** karşılaştırılmasıyla verildi. Yan ürün: `itemRow` tırtıklı sol kenarı düzeltildi (opsiyonel `qtyColPx`). Ödeme ekranında eksik olan yalnız `SplitPaymentModal`'dı — `DetailedPaymentModal` zaten gösteriyordu (devir notu bayattı).
- ✅ **(3) #440 deploy borcu** — #444/#445 ile aynı turda prod'a indi.
- ✅ **PROD DEPLOY:** `f30f882` → **`eea396c`**, migration 050 (değişmedi), pm2 restart 51→52, health/web/socket ✓. **Ürün sahibi canlıda doğruladı ("evet düzeldi").**

</details>

<details><summary>Önceki güncelleme (S100, 2026-07-20) — tarihsel</summary>

**Son güncelleme:** 2026-07-20 (Session 100 kapanış — 4 PR #403-406, **deploy YOK** · **🔥 ADR-032 Amd1 MUTFAK İSTASYON YÖNLENDİRMESİ** (#405: `grill` kind + `categories.print_station` Migration **048** additive-only + `resolveItemStations()` mutfak&iptal ortak + istasyon etiketi/parça göstergesi; 6-lens denetim 32 bulgu; ızgara donanımı TCP/raster/576px **fiziksel tam doğrulandı**, `KITCHEN_TAIL_FEED_LINES=8` kâğıtta bulundu — kesici yok) + **📱 GARSON UX TURU + ADR-027 Amd2 SİPARİŞ İPTALİ GARSONA AÇILDI** (#406: 8 UX bulgusu + parti-modeli sepet + web-mobil tam eşitlik; **koruma rolde değil PARA DURUMUNDA** — aktif ödemesi olan adisyonu admin dahil kimse iptal edemez) + **3 canlı açık kapandı** (öksüz ödeme dine-in&paket + `merged` guard) + #404 p95 uzun-poll sahte-NO-GO fix + #403 Amd7/8/9 fiziksel DoD. `install-second-agent.ps1` BOM'suzluktan **çalışmıyordu** — düzeltildi.)
**main kod başı:** `3e706e9` (S100; #403-406 merged; sonrası yalnız docs commit'i) · migration head **048** · **⚠️ prod code `b335212` — S100'ün HİÇBİR ŞEYİ DEPLOY EDİLMEDİ** (prod migration head **047**). Prod'a dokunulan tek şey: Nginx `log_format` + `rt=$request_time` (yedek `nginx.conf.bak-20260720`).
**▶ SIRADAKİ (S101) — sıra kritik:** (1) **PROD DEPLOY** (Migration 048 + API + web; `shared-types` build ŞART) → mobil iptal + para-kapısı canlı doğrula. (2) **Mutfak bölünmesini AÇ:** yeni exe → IZGARA agent kur (`-PrinterHost 192.168.1.87 -JobKinds grill`) → **üç yazıcıda fiziksel smoke** → smoke yeşilse **kategori atama SQL'i** (iki fazlı; UUID ile, ad-eşleme YASAK). (3) ADR-032 Amd1 + ADR-027 Amd2 → `decisions.md`. (4) **Mobil yayın dalgası** (Apple onaylandı 2026-07-20; ad-hoc, `eas device:create` UDID). (5) Cutover hazırlığı — runbook **bayat** (§2 CP857 reçetesi Amd9 K3 ile geçersiz). Detay: `.claude/plans/session-101-kickoff.md`. **Açık chip:** SplitPaymentModal i18n (`task_20f0e0c9`) · dine-in iptal audit (`task_219e7c0a`).

</details>

**main kod başı:** **`eea396c`** · migration head **050** · **prod code `eea396c` + migration 050 — TAM GÜNCEL, deploy borcu YOK** (S104'te #440+#444+#445 birlikte indi).

## Durum: Phase 0-4 ✅ · Phase 5 🔄 **P5-1 ✅ · P5-2 ✅** (menü 68 · müşteri 1470 · masa 25/25 · **kullanıcı 8**; A4 KVKK ⛔ **kapsam dışı** — ADR-031 Amd3) · **P5-3 BACKUP TAM ✅** · **P5-4 ✅ TAMAM** (mobil + **üç yazıcı** FIRIN/IZGARA/KASA + Caller ID + kasiyer kiosk — hepsi canlı) · P5-5 ⏳ (p95 altyapısı aktif; **pm2 restart tabanı 51** — S103 deploy sonrası) · P5-6 ⏸

**Gerçeklik değişimi (ADR-031):** Restoran ŞU ANDA **Adisyo** kullanıyor, v3 kullanım dışı. Charter'ın "2 hafta paralel (v3 ana/v5 yedek)" varsayımı GEÇERSİZ → geçiş **Adisyo→v5 doğrudan go-live**. Kod yazılmadı; her KOD işi aşağıda PR olarak planlı, taze oturumlara bırakıldı.

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| Phase 4 Mobil + Caller ID + Audit + Yedek | ✅ (mobil operasyonel terminal + masa-yönetimi ailesi ADR-027/028/029; Faz B kalanı = ADR-030 rezerv v5.1) |
| **Phase 5 Pilot + Migration** | 🔄 **P5-1 ✅** (restoranpos.org CANLI) · P5-2 kısmen · P5-3..6 bekliyor |

## Pilot bitiş yol haritası (Session 84 denetimi — BU SIRAYLA)

> Dayanak: S84 denetimi — prod canlı sayım: `products=1 · tables=25 ✅ · areas=1 · users=2 · customers=1469 · agents=2 · queued=0`.
> Kritik yol: **menü girişi → backup ön-koşulu → cutover günü → 2-4 hafta → Adisyo iptali = pilot bitiş.**

### A — Cutover hazırlığı (A1-A2 sıralı; A3/A4 paralel yürür)
| # | İş | Sahip | Not |
|---|---|---|---|
| A1 | ~~**Menü girişi**~~ ✅ **CANLI GİRİLDİ (S84)** — 67 ürün / 9 kategori (55'i Adisyo fotolarından SQL ile prod'a + 12 çorba/dürüm kullanıcı; test KIYMALI PİDE soft-delete) | [USER]→✅ | 🟢 KRİTİK YOL AÇILDI — fiş smoke + eğitim artık yapılabilir. Bölge: areas=1 (ayrım isteniyorsa ekle) |
| A2 | ~~Personel kullanıcıları (kasiyer/garson/mutfak) + kara liste~~ → **[USER] ÜSTLENDİ (S85)** — Claude tarafı KAPALI: mekanizma haritalandı+doğrulandı (web `/users` CRUD; **login=email**, username=görünen ad; kara liste 409 atama-engeli çalışıyor), rehber verildi | [USER] ✅ (S86) | **S86 ✅ gerçek kullanıcılar girildi** (prod salt-okunur teyit: 2 admin + 1 garson); kara liste boş (0), ihtiyaç oldukça elle |
| A3 | **Storage Box BX11 al** → backup 6 ayağı: rclone config + age-keygen (**key KASAYA+offline, sunucudan SİL**) + backup.env (`PGDATABASE=pos_prod`, PGHOST boş) + systemd timer + ilk gerçek yedek + SUNUCU restore drill + retention doğrula → §9 yeşil | [USER alım+kasa] + [OPS Claude] | Go/no-go ÖN-KOŞULU (ADR-031 K7); kod hazır (#284) |
| A4 | ~~KVKK m.9 dayanak + aydınlatma metni~~ | — | ⛔ **KAPSAM DIŞI (S103 [USER] kararı — ADR-031 Amendment 3):** *"kendi işletmem dışında kullanıma kapalı"*. **Cutover'ı beklemez, go/no-go kapısı değildir** (kapı olan **KVKK envanteri** S82'de yazıldı ✅). ⚠️ Yükümlülük ortadan kalkmadı, **ertelendi** — 1469 müşteri PII'si Almanya'da; teknik önlemler (maskeleme/age/retention) yerinde. Geri döner: **başka işletmeye açılırsa** · veri talebi gelirse · avukat onaylarsa. Paket execute-hazır: `aydinlatma-metni-taslak.md` |
| A5 | ~~KDS ekranı~~ + kasiyer istasyonu (kiosk) + Caller Bridge | [OPS] ✅ | **KAPANDI:** KDS düştü (kağıt fiş) · Caller ID canlı (S86) · **kasiyer kiosk S99'da kuruldu** (`kasiyer-kiosk-kurulum.md`) |
| A6 | Ön-smoke (Adisyo'ya DOKUNMADAN): mobil sipariş→mutfak fişi Türkçe + web kasiyer + realtime; p95 script | [OPS] | **S86 ✅ kullanıcı canlı doğruladı:** mobil→mutfak fişi Türkçe + web kasiyer + mobil↔web senkron. p95 script hazır (cutover'da koşulur). Kasa fişi HARİÇ (Adisyo'da) |
| A7 | Personel eğitimi + kağıt-fallback 1-sayfa şablonu | [USER; şablon Claude'da ✅] | 📄 **Şablon hazır ve S103'te tazelendi** (`go-live-kagit-fallback-ve-egitim.md` — mutfak bölümü **KDS ekranı → kâğıt fiş + iki istasyon** olarak düzeltildi; iptal fişi davranışı eklendi). **Kalan: eğitimin kendisi [USER]** — cutover ön-koşulu |
| A9 | **Mobil paket dağıtımı (S103)** — iOS `f7f325d4` (6 UDID **IPA'dan sayıldı**) + Android `4e0b2411` | [USER] ✅ | ✅ **TAMAM — kurulum + HER İKİ doğrulama yapıldı:** (1) **hızlı öde → kasa fişi kâğıtta çıktı** (ADR-014 Amd2 fiziksel DoD); (2) **ilk OTA turu BAŞARILI** — ama ilk denemede inmedi: `eas update` "Published!" dediği hâlde **kanal hiçbir branch'e bağlı değildi** (sessiz başarısızlık, ADR-031 Amd2 **K7** olarak kayda geçti). `channel:edit` sonrası cihazda göründü. Bu **elle kurulan son paket** — bundan sonra JS düzeltmeleri OTA ile iner |

### A8 — 🔥 MUTFAK İSTASYON BÖLÜNMESİ — ✅ **KAPANDI (S101, 2026-07-21)**

> **Üç yazıcı canlı ve fiş bölünmesi prod'da kanıtlandı** (masa **ve** paket): FIRIN `kitchen` TCP `.120` · IZGARA `grill` TCP `.87` · KASA `bill` spooler. Kategori ataması **ekrandan** yapılıyor (ADR-032 Amd2 `/tanimlamalar/yazicilar`) — aşağıdaki "atama SQL'i" adımı **bayattır**. S103'te yetim-kuyruk göstergesi de canlı sınandı. Aşağısı tarihsel kayıttır.

<details><summary>A8 özgün planı (tarihsel)</summary>
> Restoranda **üç** yazıcı var: FIRIN + IZGARA + KASA (Adisyo ekranlarından ortaya çıktı). v5 tek mutfak hattı taşıyordu → bölünme olmadan geçilirse **ızgaracı kendi kalemlerini hiçbir yerden göremez** (ızgarada KDS ekranı da yok). Kod ✅ (#405), donanım ✅ fiziksel doğrulandı; kalan yalnız deploy+kurulum+atama.
> **Sıra değişmez:** deploy → yeni exe → IZGARA agent → **fiziksel smoke** → *(yeşilse)* atama SQL'i. Atama EN SON; ondan öncesi davranış-nötr.
- [OPS] Migration 048 + API/web deploy (`shared-types` build ŞART)
- [OPS] Yeni print-agent exe → dükkan PC (K7: `Stop-Service`→kopyala(SHA+`.bak`)→`Start-Service`→üç servisin boot log'u). ⛔ **MSI upgrade YAPILMAZ** (nssm `AppEnvironmentExtra` silinir → canlı mutfak agent'ı sessizce ölür)
- [OPS] Mevcut mutfak agent `jobKinds:["kitchen"]` üçlü teyit (dosya YETMEZ — `loadJobKinds()` önce env'e bakar)
- [OPS] IZGARA agent: `install-second-agent.ps1 -JobKinds grill -PrinterHost 192.168.1.87 -ConfigPath …-grill.json -ApiUrl https://restoranpos.org/api` (`-ConfigPath`+`-ApiUrl` ZORUNLU; **yeni key üretilmez**, mevcut `PRINT_AGENT_API_KEY`, ayrışma `device_fingerprint` ile)
- [OPS] Fiziksel smoke: üç yazıcı, çapraz-kontaminasyon yok
- [OPS] **Smoke yeşilse** atama SQL'i, iki fazlı (önce yalnız KARIŞIK IZGARA → uçtan uca test → kalanlar). FIRIN: PİDE·LAHMACUN·ÇORBALAR·SALATALAR·TATLI · IZGARA: KARIŞIK IZGARA·IZGARA ÇEŞİTLERİ·DÜRÜMLER · İÇECEKLER `kitchen_print=false`. **UUID ile eşle — ad/`ILIKE`/`lower()` YASAK** (Türkçe İ/I)
- **Geri alma (K10):** tek SQL DEĞİL — önce uçuştaki `grill` job'ları `kitchen`'a döndür (yoksa yetim; kind filtresi yüzünden reclaim de edilemez), sonra `print_station=NULL`, sonra doğrula
- **DoD:** üç agent canlı · üç yazıcı doğru kalemleri basıyor · geri-alma reçetesi denendi

</details>

### B — Cutover günü (24-26 Tem, gün sonunda — ADR-031 K6)

> 📕 **Tek kaynak: `docs/ops/cutover-gunu-runbook.md`** — S103'te tazelendi ve **artık güvenilir** (üç yazıcı tablosu + Windows servis adları + dükkan-PC erişim gerçeği + kademeli geri alma). Aşağısı özettir; gece o belge elde tutulur.

0. **Ön-koşullar:** A8 ✅ (üç yazıcı canlı) · **mobil paket cihazlarda** (iOS `f7f325d4` / Android `4e0b2411` — S103'te basıldı, **kurulum [USER]**) · A7 eğitim · taze gece yedeği
1. **Test verisi temizliği + `order_no` 1'den** — SQL taslağı hazır: `docs/ops/cutover-test-temizligi.md` (ADIM 0 envanter → onay → tek-tx hard-delete → doğrulama). `order_no` sayacı **günlüktür**, ayrı sıfırlama gerekmez. [OPS + kullanıcı onayı]
2. ~~Kasa agent kurulumu~~ ✅ **S89'DA YAPILDI** (spooler-RAW, Zadig'siz; S97'de exe 0.0.3, S101'de 0.0.4). Cutover günü yalnız **teyit**: üç servis Running + sürüm.
3. **Fiş smoke:** öde → kasa fişi + **Adisyo round-trip** (paylaşım korundu mu) + **istasyon bölünmesi** (ızgara/fırın ayrı fiş) + paket fişi. ~~CP857/codepage reçetesi~~ **GEÇERSİZ** (ADR-004 Amd9 raster) — S103'te belgelerden çıkarıldı.
4. **Kasa hesabı: `admin`** ile girilir (S103 [USER] kararı) — `waiter` rolüne çağrı listesi/müşteri arama/paket aşaması kapalı, garson hesabıyla **paket servis çalışmaz**.
5. Tam go-live smoke (P5-5 listesi) + go/no-go ölçümleri başlar (**pm2 restart tabanı 51**; kriter "0" değil "artmıyor")
6. **Deploy YOK · OTA YOK** (ADR-031 + Amd2 K6) — cutover gecesi değişken sayısı artırılmaz
7. Rollback hazır: >30dk sipariş alınamıyor / veri şüphesi → Adisyo'ya dön (K10; abonelik açık). **Kademeli geri alma** runbook §5: yalnız ızgara sorunluysa kategori atamaları geri alınır, cutover devam eder

### C — Stabilizasyon (2-4 hafta) → PİLOT BİTİŞ
- Günlük pm2 + haftalık `rclone lsl` + p95 izleme + aylık restore drill
- Kriterler (charter :125/:129-136) sağlanınca → **Adisyo iptali** (açık soru #6 tarih) → charter :124/:194-201 + forward-ref doc güncellemeleri (P5-5 DOCS) → **PİLOT KAPANIŞ**

### D — Pilot sonrası: v5.1 derin denetim programı (Fable 5 + ultracode 🔶)
Pilot kapanınca AYRI kickoff (kendi planı/ADR'si) ile: (1) derinlemesine kod analizi + **bug denetimi** (multi-agent adversarial, tüm kod tabanı), (2) **güvenlik denetimi/testi + güçlendirme** (RLS, alerting, rate-limit gözden geçirme — v5.1 backlog buradan beslenir), (3) **ağır yük testi** (ADR-031 bilinçli v5.1'e ertelemişti — tam sırası). Hepsi ultracode-worthy; kapsam kilidi gereği pilotta BAŞLANMAZ.

## Phase 5 sprint listesi (ADR-031)

Etiket: **[KOD]**=PR/implementer · **[DOCS]**=doküman · **[USER]**=kullanıcı aksiyonu · **[OPS]**=sunucu/kurulum
Kural: her [KOD] işi kendi PR'ı + DoD + (dokunduğu alana göre) hci/security/db-migration-guard gate; merge öncesi CI poll.

### P5-1 — Altyapı envanteri + provisioning + env/secret ✅ **KAPANDI (Session 81, 2026-07-04)**
- [USER] ✅ Hetzner hesabı mevcuttu (proje `restoran-pos` açıldı); domain **restoranpos.org** Namecheap'ten alındı (~$8.68/yıl; A `@`+`www` → `167.233.78.127`)
- [OPS] ✅ **CX23** provision (CX22 satıştan kalkmış — aynı kademe; ~$7.09/ay) + firewall (yalnız 22/80/443; PG localhost-only) + fail2ban; **Storage Box P5-3'e** (backup ayağıyla birlikte alınacak)
- [OPS] ✅ PG 17.10 + Node 22 + PM2 `pos-api` (tek instance, systemd kalıcı) + Nginx path-based (`/api` strip + `/socket.io` upgrade) + Let's Encrypt (auto-renew)
- [DOCS] ✅ `docs/ops/deploy.md` (#259) — as-built, komutlar canlı sunucuda test edilerek doğrulandı; ADR-001 §7.1 checklist taşındı (prod'da `f` ✓) + §7.2 manuel-rotasyon amendment'ı in-place
- **DoD ✅:** TLS yeşil · `https://restoranpos.org/api/health` 200 · socket.io handshake sid ✓ · migrations sıfır DB'ye koştu head `043` (41/41)
- Deploy modeli: lokal `git push prod` (bare repo) — GitHub deploy key bilinçli eklenmedi (erişim-yetkisi değişikliği kullanıcıya bırakıldı)

### P5-2 — Prod bootstrap + KVKK inventory + veri taşıma 🔄 **BÜYÜK ÖLÇÜDE ✅ (müşteri taşıma CANLI, Session 82)**
- [KOD] ✅ **Bootstrap script (#260 `3cd09f4`)**: `apps/api/scripts/bootstrap-prod.ts` — idempotent (slug doğal anahtar, sabit UUID yok), 9/9 test; **prod'da koşuldu**: tenant **DİLAN PİDE** (`dilan-pide`, `TENANT_ID=e94739ac-...`) + admin (`ilhanavci499@gmail.com`) + tenant_settings(timezone) + ilk `agents` satırı; agent API key `/root/pos-secrets.env` → `PRINT_AGENT_API_KEY` (P5-4 kurulumunda kullanılacak); `TENANT_ID` api.env'e eklendi ✓; **canlı login smoke ✓** (curl 200 + doğru tenant/role token)
- [DOCS] ✅ `docs/compliance/kvkk-data-inventory.md` (#262) — go/no-go kapısı yazıldı (fan-out envanter + 3 adversarial mercek); §11 açık 🔴: m.9 aktarım(#2)/aydınlatma(#3)/backup(#4)/phone-kardinalite(#6)/dry-run(#7); §12 v5.1 KABUL boşluk (anonymizeCustomer/VERBIS/aydınlatma/açık-rıza)
- [USER] ✅ v3 `Müşteriler.xlsx` export sağlandı (1475 satır; başlıklar v5 import ile birebir). Analiz: `docs/v3-reference/customer-data-and-export.md`
- [OPS] ✅ **MÜŞTERİ IMPORT CANLI** — kullanıcı web-UI "Excel'den İçe Aktar" ile prod'a import etti; prod doğrulandı (read-only): **1469 müşteri / 1008 telefon / 124 adres**, `customer_import.completed` audit (created 1469, errors 0). go/no-go #6 (kardinalite: tek telefon, 87 mükerrer skip) + #7 (dry-run temiz) + #8 (audit) ✅
- [OPS/USER] **Masalar 25/25 ✅ · Menü ✅ CANLI (S103 prod sayımı: **68 ürün**; `areas=1`)** · ✅ **personel 8 kullanıcı** (S103: 2 admin + 6 waiter — Ceren/Sıraç/Emir eklendi; **prod'da `cashier` YOK**, kasada admin ile girilir) · ✅ kara liste boş
- [USER/hukuki] ⛔ **KAPSAM DIŞI (S103, ADR-031 Amd3)** — KVKK aydınlatma + m.9 dayanağı ertelendi (ürün tek işletmeye kapalı). Yükümlülük ortadan kalkmadı; teknik önlemler yerinde, paket execute-hazır. Başka işletmeye açılırsa **geri gelir**
- **DoD:** ✅ `TENANT_ID` env · ✅ müşteri import (1469, prod doğrulandı) · ✅ menü/masa/kullanıcı canlıda · ✅ **KVKK envanteri** (go/no-go kapısı, S82) · ⛔ aydınlatma metni kapsam dışı

### P5-3 — Backup sunucu ayakları (hedef: `backup-strategy.md` §9 yeşil)
**Durum (S84): kod tarafı ✅ (#284, ADR-023 Amd1)** — DR adversarial 4 sorun buldu+düzeltildi: DB adı `pos_prod` + systemd yolu `apps/api/scripts/backup/` + **rclone sync→COPY** (sync off-site'ı 14 güne düşürüp eskiyi siliyordu = DR veri-kaybı tuzağı; copy+`--min-age 180d` prune) + PGHOST boş=socket/peer (gece sessiz auth-fail riski). Kalan 6 sunucu ayağı Storage Box'a bloke (yol haritası A3).
- [OPS] script sunucuda `.age` üretimi + `rclone` copy Storage Box
- [OPS] systemd timer aktif + retention silme doğrulaması
- [OPS] ilk SUNUCU restore drill (throwaway DB) → §8 tabloya işle
- [USER] age private key kasa + offline + sunucudan kaldır
- **DoD:** gece dump→age→off-site otomatik, sunucu restore drill exit 0, key kasada

### P5-4 — Restoran istasyonu + mobil dağıtım — ✅ **TAMAM**
**Durum (S103):** **üç yazıcı canlı** (FIRIN `.120` · IZGARA `.87` · KASA spooler; print-agent 0.0.4) · Caller ID canlı · kasiyer kiosk kuruldu (S99) · KDS **düştü** (kâğıt fiş kararı) · mobil **iki platform** dağıtıldı (iOS 6 cihaz + Android). **Kalan yalnız [USER] kurulum:** S103 paketleri (`f7f325d4`/`4e0b2411`) cihazlara + 2 doğrulama → yol haritası **A9**.
- ✅ [KOD] Mobil prod API URL config + EAS release APK (#275/#276); sideload + canlı smoke GEÇTİ; keystore kasada
- ✅ [OPS] **MUTFAK agent** MSI kur + config (JP80H Ethernet 192.168.1.120, jobKinds:["kitchen"]) + API env nssm ile + Türkçe fiş DOĞRU (#280 CP857 fix: **ESC t 29**, 13 değil). ADR-032 ikincil routing (#277) + install-second-agent.ps1 (#278)
- ✅ [OPS] **KASA agent — SPOOLER CANLI KURULDU (S89, Zadig'siz):** restoran PC'sine (DESKTOP-12RF81K, RustDesk) spooler agent kuruldu → **register OK `agentId=acfa506c`, kasa fişi (KASA-2026 spooler) + mutfak fişi fiziksel BASIYOR** (kullanıcı canlı doğruladı; Adisyo bozulmadı, round-trip ✓). Kurulum yol-dersleri: yeni exe deploy (eski `print-agent.exe` spooler bilmiyordu → "Invalid discriminator") + `PRINT_AGENT_API_URL` nssm-env (sistem env'de yalnız KEY vardı) + ASCII script (Türkçe `.ps1` PS5.1 mojibake) + config BOM'suz. [[feedback_print_agent_new_transport_cutover_deploy]]. Kalan: kasiyer istasyonu (cutover günü).
- ✅ [KOD] **Ödeme→otomatik fiş (PR-7c, #283 PROD'DA)** — `pay_and_print`/`pay_and_print_close` otomatik `bill` enqueue (post-commit best-effort + `!replayed` çift-baskı guard + CP857-throw izolasyonu; web "fiş yazdır" sessiz no-op bug'ı kapandı). Kasa agent kurulunca fiziksel basar. Ayrı chip: zaten-tam-ödenmiş PATCH-kapanış yolu fiş basmaz
- ✅ [OPS] **CALLER ID CANLI (S86)** — dükkan PC `C:\restoran-pos\caller-bridge` servis + 4 prod fix (#300-303) + istasyon=İlhan + canlı popup ✓; ~~KDS~~ (S86 karar: kağıt fiş) · ⏳ kasiyer istasyonu (kiosk) cutover'da
- **DoD:** ✅ mutfak fişi Türkçe doğru (charter :125) · ✅ garson cihazından sipariş→mutfak<2sn (mobil smoke) · ⏳ kasa adisyon (cutover) · ✅ **Caller ID popup smoke (S86 canlı — arayan müşteri eşleşmeli popup)**

### P5-5 — Go-live + stabilizasyon (hedef: v5 ana sistem)
- [OPS] Deploy sonrası smoke: web kasiyer/müdür/mutfak KDS + mobil + yazıcı + realtime iki-yön + Caller ID popup
- [OPS] Go/no-go: charter :125/:129-136 canlıda doğrula (Nginx `$request_time` p95 script + `pm2 describe` restart 0)
- [USER] Personel eğitimi + kağıt-fallback 1-sayfa şablonu + prosedürü
- [OPS] Cutover **gün sonunda** (order_no 1'den; ADR-031 K6)
- [DOCS] charter :124 (paralel-koşum kriteri) + :194-201 güncelle · ADR-003 §14.1.B.3 / ADR-001 §7.1/§7.2 + order_no/takeaway forward-ref in-place notları · context-anchor §2
- [USER] Adisyo 2-4 hafta açık tut → kriterler sağlanınca iptal (rollback eşiği: >30dk sipariş yok / veri şüphesi → Adisyo'ya dön)
- **DoD:** ADR-031 DoD (a-j) tamam; monitoring minimal (pino+Nginx log+günlük pm2+haftalık `rclone lsl`)

### P5-6 — CONCURRENTLY gate (yalnız go-live SONRASI ilk canlı-veri migration'ı gerektiğinde)
- [KOD] Enforcement gate PR (002-005 index whitelist + CI regex) + db-migration-guard kuralı: canlı-veri ilk migration PR'ı bu gate merge edilmeden merge edilemez (ADR-031 K12)
- **DoD:** gate CI'da aktif; ilk canlı index migration'ı CONCURRENTLY ile geçti

## Açık sorular / kullanıcı aksiyonları (ADR-031)

1. ~~Hetzner hesabı/domain envanteri~~ ✅ **KAPANDI (S81):** Hetzner hesabı vardı; restoranpos.org alındı
2. **v3 taze Excel export** — güncel v3 DB'den `Müşteriler.xlsx`; v3 PC'de açılıyor mu + export yolu
3. **v3 defteri bayatlık teyidi** — Adisyo dönemi müşterileri taşınmaz (bilinçli kabul)
4. **Kara liste kaynağı** — v3 export'unda ayrı kolon var mı; yoksa canlıda elle
5. ~~Garson cihaz envanteri~~ ✅ **KAPANDI (S81)** — 1 Android + 5 iOS. **S100: Apple Developer üyeliği ONAYLANDI (2026-07-20) → iOS açıldı.** Dağıtım **ad-hoc** (ADR-031 Amd1; TestFlight gerekçeli reddedilmişti) → `eas device:create` ile 5+ cihazın UDID'i kaydedilmeli. Bekleyen EAS dalgası: ADR-026 Amd3 + Amd4 + S100'ün 8 UX bulgusu + sipariş iptali (garson telefonundaki APK `ebf43e53` bunların hiçbirini içermiyor)
6. **Adisyo iptal tarihi** — go-live kriterleri + 2-4 hafta
7. **age key + APK keystore kasası** — parola yöneticisi + offline

## Kapsam dışı (v5.1+) — ADR-031

CI/CD otomasyonu + `rotate-migrator.yml` · alerting/metrics/APM/uptime · yük testi · WAL/PITR · restore UI · code signing · Print Agent Manager UI · Caller Bridge WiX bundle · RLS · Redis Socket.IO adapter · PM2 cluster · veresiye · KVKK `anonymizeCustomer` · store/TestFlight + Play App Signing · menü/masa/kara-liste import scripti · CX32.

## Ortam & dev-loop (Session 74/76 reçetesi)

- **Windows native PostgreSQL 17.10** `D:\PostgreSql` (servissiz → `Start-Process pg_ctl` detach + WAL-recovery poll [[feedback_native_postgres_detached_start]]). İki DB: **`pos_dev`** (dev/device) / **`pos_test`** (test — `DELETE FROM tenants`, ayrı [[feedback_local_test_db_separate]]).
- Dev-loop: API `pnpm --filter @restoran-pos/api dev` (:3001) · web `pnpm --filter @restoran-pos/web dev` (:5173) · Metro `EXPO_NO_DEPENDENCY_VALIDATION=1 EXPO_OFFLINE=1 REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.88 expo start --lan` → `exp://192.168.1.88:8081` (Expo Go [[feedback_mobile_expo_go_devloop]]).
- Login: admin@local.test/admin1234 · garson@local.test/garson1234.
- Lokal test: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test` (~627 PASS, bu oturumda koşulmadı). **CI hâlâ tek otorite** — kod PR'ında merge öncesi CI yeşilini POLL et [[feedback_merge_wait_ci_no_required_checks]].

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- UI → hci+turkish-ux+i18n. Auth/payment/PII → security-reviewer. DB şema → db-migration-guard (enum migration'da incremental senaryoyu lokalde test et [[feedback_enum_migration_incremental_test]]).
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR.
- Ultracode açıksa: substantive iş → Workflow ile implement → adversarial verify.
