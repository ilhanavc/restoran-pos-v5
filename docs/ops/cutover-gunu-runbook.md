# Cutover Günü Runbook — Adisyo → v5 (Faz B)

> ✅ **S103'te (2026-07-22) tazelendi — cutover-gecesi sürümü.** Dayanak: `active-plan.md` Faz B + `.claude/memory/decisions.md` ADR-031 K6/K10 + **ADR-031 Amendment 1 (iki-platform pilot: iOS + Android)** + ADR-004 Amd3/Amd4/**Amd6**/**Amd9 (raster)** + **ADR-032 Amd1 (fırın/ızgara bölünmesi) · Amd2 (yazıcı yönetim ekranı) · Amd3 (paket fişi)** + memory [[project_kasa_printer_adisyo_shared]] / [[feedback_destructive_op_live_hardware_warn_hard]].
>
> **Ne zaman:** **gün sonunda** (Adisyo'nun son siparişleri kapandıktan sonra; ADR-031 K6). **Adisyo aboneliği 2-4 hafta AÇIK kalır** — geri dönüş garantisi. Bu bir "tek yön" değil, geri-alınabilir geçiş.
>
> **🗓️ Hedef: 24-26 Tem 2026 (Cum-Pzr) bir akşam** (S99 kararı; S103'te [USER] tarafından teyit edildi). Apple onayı geldi ve iOS dağıtımı yapıldı → **iOS gate artık kritik yolda değil** (§0).
>
> ⚠️ **Bu belgedeki "✅ doğrulandı" işaretlerinin tarihi vardır.** S103'te ölçülenler `(22 Tem)` etiketlidir; cutover gecesi **yeniden ölç**, geçmiş ölçüme güvenme.

---

## 0. Ön-koşullar (cutover gününe girmeden)

- [ ] **Gece yedeği taze** — `rclone lsl storagebox:restoran-pos-backups | tail -3` bugünün `.age` dosyasını gösteriyor (off-site). age private key kasada. *(22 Tem ölçümü: `pos_prod-20260722-030448.dump.age` ✓ — gece yedeği akıyor.)*
- [ ] **Personel eğitildi** + **kağıt-fallback 1-sayfa** elde (`docs/ops/go-live-kagit-fallback-ve-egitim.md`).
- [ ] **Menü/masa canlı** ✅ (22 Tem prod sayımı: **68 ürün** · 25 masa).
- [x] **🔑 Personel hesapları tam** ✅ (22 Tem, prod'da doğrulandı) — **8 kullanıcı**: İlhan/İsmail (`admin`) · Kadir · Recep · Fırat · **Ceren** · **Sıraç** · **Emir** (`waiter`). Doğrulama: `SELECT username, role FROM users ORDER BY role`.
- [ ] **💳 KASA HESABI — [USER kararı S103]: kasada oturan kişi, kim olursa olsun, `admin` hesabıyla (İlhan/İsmail) girer.** Prod'da **hiç `cashier` rolü yok** (Fırat da `waiter` oldu, sahada mobil kullanacak).
  **Neden önemli — `waiter` rolüne kapalı uçlar:** `GET /caller-id/logs` (çağrı listesi) · `GET /customers/search` (müşteri arama) · `PATCH /orders/:id/takeaway-stage` (paket aşaması) · `POST /payments/:paymentId/void` (ödeme iptali) · `PATCH /orders/:id` (Masayı Kapat — ADR-027 Amd2'de garsona **bilerek** kapalı). Yani kasada `waiter` hesabıyla oturulursa **paket servis çalışmaz**: telefon çalar, popup düşer, ama çağrı listesi ve müşteri arama açılmaz.
  **Kabul edilen risk:** admin yetkisi geniştir (menü/kullanıcı yönetimi, raporlar) ve şifre kasada paylaşılmış olur. Azaltım: kiosk oturumu (`kasiyer-kiosk-kurulum.md`) + gün sonu ekran kilidi. Kişi-bazlı `cashier` rolüne geçmek v5.1'de yeniden değerlendirilebilir.
- [ ] **Çekirdek akış kanıtlı** ✅ (S86: mobil→mutfak fişi + web kasiyer + senkron; S97: iptal-fişi ailesi JP80H kağıt-smoke ✓✓; **S101: fırın/ızgara bölünmesi gerçek siparişte DB+kağıt kanıtlı**).
- [ ] **Prod sağlıklı** — `https://restoranpos.org/api/health` 200 + `pm2 describe pos-api` uptime stabil. *(22 Tem: health **200** ✓ · `restart=50` — bu sayı **kümülatif deploy geçmişidir, sıfır değildir**. Cutover gecesi bu değeri **baseline** al; kriter "0" değil "**artmıyor**" — §4.)*
- [x] **Yazıcılar CANLI — ÜÇ servis** ✅ (S89 kasa+mutfak → **S101 ızgara eklendi**; hepsi print-agent **0.0.4**, Amd6 ack-dayanıklılığı + Amd9 raster devrede). 22 Tem prod `agents` teyidi: `{grill}` · `{kitchen}` · `{bill}` üçü de `last_seen_at` = bugün. Cutover günü yalnız §2 smoke-teyidi.
- [x] Caller ID **CANLI** ✅ (S86 kurulum; **S97: yeni build #307+#362 + C12-A-01 donanım-teyidi kapandı** — SetEvents ampirik, maskeli-log KVKK ✓). Cutover'da yalnız teyit: paket servis çağrısında popup düşüyor mu (§3). Dayanıklılık reçetesi `caller-bridge-kurulum-smoke.md §5.1`. Arızası cutover'ı bloklamaz (opsiyonel).
- [x] **Hesap hijyeni** ✅ (S97: admin-şifre değiştirildi + EAS keystore kasada).
- [x] **📱 Mobil güncel-build dalgası** ✅ **S102 (21 Tem) TAMAMLANDI — her iki platform sevk edildi:** Android APK + **iOS ad-hoc IPA `4e29245a`**, ikisi de main `2b5f7909`'dan (kod olarak `275250a` ile aynı). Sipariş akışı **gerçek iPhone'da kâğıtla doğrulandı**.
- [x] **🍎 iOS gate (ADR-031 Amendment 1 K3) — ✅ KAPANDI (S102).** Apple Developer üyeliği onaylandı (S100) → **5 iPhone `eas device:list`'te kayıtlı** (22 Tem teyidi) → ad-hoc IPA kuruldu, iOS smoke geçti. iOS **artık kritik yolda değil**; cutover tarihi mobilden bağımsız (`.claude/plans/mobil-kullanima-acilis-plani.md` §0).
- [ ] **📲 Cihaz-başı kurulum kalanı (bloklayıcı DEĞİL, kişi-bazlı):** Kadir · İsmail kurulum + **Geliştirici Modu** (iOS 26 şartı: Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu → aç → yeniden başlat). Sıraç · Fırat cihaz kaydı yapılırsa **`eas build:resign` + IPA içindeki `ProvisionedDevices` SAYIMI** zorunlu ([[feedback_eas_resign_profile_stale]]) — "başarılı" çıktısı kanıt değildir.
- [x] **🖥️ Kasiyer istasyonu — [USER kararı S98]: dükkan-PC'de Chrome tam-ekran/kiosk** (ek donanım yok; yazıcı-agent'larıyla aynı makine). **✅ S99 (18 Tem) KURULDU** (`kasiyer-kiosk-kurulum.md` §1-5: `--app=` kısayolu + shell:startup + güç/ekran hijyeni + kasiyer-girişi yapıldı). Kalan gözlem: ertesi-sabah oturum-açık-mı (§4 refresh-cookie teyidi) + cutover-günü reboot-smoke (§6).
- [ ] KDS **yok** (kağıt fiş — kullanıcı kararı S86). *(İstasyon-bazlı KDS de yok: fırıncı+ızgaracı aynı birleşik ekranı paylaşır — ADR-032 Amd1 K3; bölünme **yalnız kağıtta**.)*
- [x] **Yetim-kuyruk uyarısı GERÇEK OLAYLA SINANDI** ✅ (S103, 22 Tem — ADR-032 Amd2'nin açık [USER] borcu kapandı). Izgara servisi durduruldu → sipariş → uyarı **yandı** (*"Izgara işleri basılmıyor"*, kart "1 bekliyor", rozet GECİKMELİ) → servis kaldırıldı → uyarı **söndü**, iş **189 sn** kuyrukta bekleyip bastı (`attempts=0` — retry bütçesi tüketilmedi). **Cutover gecesi bu göstergeye güvenilebilir.**

---

## 1. Test verisi temizliği + `order_no` 1'den

Prod'da pilot testlerinden kalan veri var (miktar oturumdan oturuma değişti — S96'da bir kısmı void/iptal ile ₺0'a çekildi; **cutover günü güncel sayım yapılır**, tahmine güvenilmez).

- [ ] **SQL taslağı HAZIR: `cutover-test-temizligi.md`** — ADIM 0 envanter (sayımlar + silinecek-liste + orders'a-FK teyidi) → İlhan onayı → ADIM 1 tek-tx hard-delete → ADIM 2 doğrulama. **[USER kararı S98]: EVET — hard-delete + temiz başlangıç.** Audit kayıtları default KORUNUR (silme yalnız açık onayla — taslak ADIM 3).
- **22 Tem prod sayımı (referans, cutover gecesi TEKRAR sayılacak):** `orders=56` · `payments=55` · `customers=1470` · `products=68`. ⚠️ Korunacak tarafın sayısı **artıyor** (menü/müşteri canlı düzenleniyor) — bu yüzden hedef sayı **sabit yazılmaz**, temizlik öncesi envanterden alınır.
- [x] ~~`order_no` sequence 1'den~~ **AYRI İŞLEM GEREKMEZ (S98 şema-doğrulandı):** sayaç GÜNLÜKtür (`order_no_counters(tenant_id, business_date, last_no)`) — temizlik sayaç satırlarını da siler, canlı ilk sipariş otomatik **#1** olur. Mini-amendment ihtiyacı düştü.
- [ ] Temizlik SONRASI sayım doğrula (read-only): `orders=0` + `customers`/`products` **ADIM 0'da sayılan değerle aynı** (silinmemiş olmalı).

> ⚠️ Bu bir **canlı-veri DB işlemi** → önce yedek teyidi (§0), tercihen migration/script + kullanıcı onayı. Sessiz `DELETE` yok.

---

## 2. YAZICILAR — ✅ ÜÇÜ DE CANLI (kurulum bitti); cutover günü yalnız TEYİT

> ✅ **Kurulum tamamlandı:** S88/S89 kasa (spooler-RAW, **Zadig'siz**) + mutfak → **S101'de IZGARA hattı eklendi** (ADR-032 Amd1, fiziksel DoD kapandı). Üç nssm servisi, hepsi print-agent **0.0.4**. Kasa yazıcısının Windows sürücüsü hiç değişmedi → **Adisyo paylaşımı korunuyor**.

### Canlı yazıcı haritası (22 Tem prod `agents` teyitli)

| kind | istasyon | donanım / transport | Windows servisi (dükkan-PC) |
|---|---|---|---|
| `kitchen` | **FIRIN** | JP80H-UE · **doğrudan TCP `192.168.1.120:9100`** | `RestoranPosPrintAgent` *(MSI birincil)* |
| `grill` | **IZGARA** | POS80 (`IZGARA2025`) · **doğrudan TCP `192.168.1.87:9100`** | `RestoranPosPrintAgentGrill` |
| `bill` | **KASA** | POS-80 · **USB, spooler-RAW** (Adisyo ile **paylaşımlı** — sürücüye dokunulmaz) | `RestoranPosPrintAgentBill` |

> ⚠️ **Servis adı = istasyon eşlemesi tahmin edilemez** — birincil servisin adında "Kitchen" geçmez, düz `RestoranPosPrintAgent`'tır ve **FIRIN**'a basar. Cutover gecesi yanlış servisi durdurmamak için önce `Get-Service *PrintAgent* | Select-Object Name, Status` çalıştır.
>
> **Dükkan-PC:** `DESKTOP-12RF81K` = **`192.168.1.143`**. **Uzaktan yönetim KAPALI** (S103'te ölçüldü: RPC 135 · SMB 445 · RDP 3389 · WinRM 5985/5986 hepsi kapalı) → servis işlemleri **makinenin başında** yapılır, uzaktan komut çalışmaz. Yazıcıların 9100 portları LAN'dan erişilebilir (S103: `.87` ✓ `.120` ✓).

**Kategori yönlendirmesi (canlı, S101):** IZGARA ← DÜRÜMLER · IZGARA ÇEŞİTLERİ · KARIŞIK IZGARA · **FIRIN ← taban (atanmamış kategoriler)** + PİDELER · LAHMACUN · ÇORBALAR · SALATALAR · TATLI · **İÇECEKLER `kitchen_print=false`** (hiç fiş çıkmaz, KDS'te de görünmez — hesapta kalır).
Atama artık **SQL değil**, `/tanimlamalar/yazicilar` ekranından yapılır (ADR-032 Amd2, audit'li).

> 🚫 **CP857 / `codepage-scan.ps1` reçetesi bu belgeden ÇIKARILDI.** Render **ADR-004 Amd9 ile raster'dır** (sunucuda bitmap → `GS v 0`); yazıcı codepage'i **ilgisizdir**. Çöp-karakter/Türkçe sorunu bu mimaride ortaya çıkmaz — çıkarsa sorun codepage değil, **render veya transport**'tadır.

### Geri dönüş (hâlâ geçerli, gerekirse)
`install-second-agent.ps1 -Uninstall` → ilgili nssm servisi durur/kalkar (config + log korunur). Kasa yazıcısının Windows sürücüsü **hiç değişmediği** için Adisyo kesintisiz basmaya devam eder — donanım/sürücü müdahalesi YOK.
ADR-032 Amd1 K10: ızgara hattı **deploy'suz, veri-seviyesinde** geri alınabilir (kategori atamaları geri alınır → her şey FIRIN'a düşer).

### Cutover günü teyit adımları
- [ ] **Üç** print-agent servisi **Running** + sürüm **0.0.4** (dükkan-PC: `nssm status` / Hizmetler; sürüm boot log'unda basılır — DB'de `agent_version` kolonu **yoktur**, prod'dan doğrulanamaz).
- [ ] **Yazıcı ekranı temiz:** `/tanimlamalar/yazicilar` → üç yazıcı da **çevrimiçi**, kuyruk derinliği düşük, **yetim-kuyruk uyarısı yanmıyor**.
- [ ] **Adisyon fiş smoke:** web'den öde → kasa fişi fiziksel bassın (Türkçe + tutar/kalemler doğru). Ardından **Adisyo'dan da bir test bas** → paylaşım korundu mu.
- [ ] **Bölünme smoke:** biri ızgara biri fırın kategorisinden iki kalemli sipariş → **iki ayrı fiş, iki ayrı yazıcı** (§3).
- [ ] (Sapma görülürse) zinciri uçtan uca sınayan ops aracı: `apps/api/scripts/ops/smoke-station-routing.ts` — işi kuyruğa yazar, `print_jobs → claim(kind filtresi) → transport → kağıt` yolunu doğrular (`render-station-test-receipt.ts` yalnız render'ı kanıtlar, transport'u değil).

---

## 3. Go-live smoke (tam akış)

- [ ] **Web kasiyer:** masa aç → sipariş → mutfak fişi (✅ kağıt) → öde → **kasa adisyon fişi** (§2).
- [ ] **🔀 İstasyon bölünmesi (ADR-032 Amd1 — S101'de canlı kanıtlandı):** aynı adisyonda **ızgara + fırın** kalemi ver → **IZGARA'dan bir fiş, FIRIN'dan ayrı bir fiş** çıksın; her fişte **yalnız kendi kalemleri** olsun. İçecek eklendiyse **hiçbir mutfak fişinde görünmemeli**, ama **adisyonda/hesapta olmalı**.
- [ ] **📦 Paket servis (ADR-032 Amd3):** takeaway sipariş → mutfak/ızgara fişleri **aynı şekilde bölünsün** (K4b geri alındı; bölünme paket siparişte de geçerli) + **kasadan paketleme fişi** (`kind='bill'`, `meta.variant='packing'`) + (varsa) Caller ID popup. Adresi olmayan kayıtlı müşteride **kayıtlı adres** basılır (#418).
- [ ] **Web müdür:** raporlar/menü/masa erişimi + `/tanimlamalar/yazicilar` açılıyor.
- [ ] **Mobil garson (iki-platform — ADR-031 Amd1; ikisi de kurulu):** **Android APK ve iOS ad-hoc IPA'da** sipariş → mutfak fişi <2sn + realtime iki-yön (mobil↔web) + arka-plan→ön-plan dönüşünde board tazeleniyor (ADR-026 Amd1).
- [ ] **İptal akışı (ADR-004 Amd6 + Amd1 K14):** bir kalem iptal et → **kalemin kendi istasyonundan** "KALEM İPTAL" fişi (ızgara kalemi iptal edilirse fiş **IZGARA'dan** çıkar, fırından değil); masa kapat-iptal → **"ADİSYON İPTAL"**. İptal fişi **fiyatsızdır** ve **kasa kopyası yoktur**.
- [ ] **Realtime:** iki cihazda masa/sipariş senkronu anlık.

---

## 4. Go/no-go ölçümleri (ADR-031 K10; charter :125/:129-136)

- [ ] **p95 < 200ms:** önce Nginx `log_format`'a `$request_time` ekle → `apps/api/scripts/ops/go-live-p95-check.sh --setup` sonra ölç.
- [ ] **pm2 restart ARTMIYOR:** cutover başında `pm2 describe pos-api` → restart sayısını **not al** (22 Tem'de 50; kümülatif deploy geçmişi). Kriter mutlak sıfır değil, **gece boyunca bu sayının sabit kalması**.
- [ ] **Hata yok:** `pm2 logs pos-api --lines 50 --nostream` temiz; Nginx 5xx yok.
- [ ] **Üç yazıcının kuyruğu birikmiyor** — `/tanimlamalar/yazicilar` ekranından bak (ADR-032 Amd2 K10: kind başına `queued`+`failed` derinliği + **yetim-kuyruk uyarısı**). SQL karşılığı: `SELECT status, count(*) FROM print_jobs GROUP BY status` *(22 Tem: 121 success · 0 failed · 0 queued)*.
- [ ] **İki-platform mobil kriteri (ADR-031 Amd1):** iOS **ve** Android kurulu → go/no-go smoke'u **her ikisinde** geçmeli (Amd1 K3'teki Android-only fallback artık gündemde değil).

---

## 5. Rollback eşiği (ADR-031 K10)

**>30 dk sipariş alınamıyor** VEYA **veri kaybı/şüphesi** → **Adisyo'ya dön** (abonelik açık). Kasa yazıcısı geri-alma reçetesi §2. Küçük sorun → kağıt-fallback + fix-forward; büyük arıza → Adisyo.

**Kademeli geri alma — her arıza tüm cutover'ı geri almaz:**
- **Yalnız ızgara hattı sorunlu** → kategori atamaları geri alınır (§2, deploy'suz veri işlemi) → her şey **FIRIN'dan** basar, S100 öncesi tek-mutfak davranışına dönülür. Cutover devam eder.
- **Yalnız bir yazıcı ölü** → o kind'ın işleri kuyrukta bekler (kaybolmaz); kağıt-fallback ile devam, servis kalkınca kuyruk boşalır.
- **Mobil sorunlu** → web kasiyerden sipariş girilir; garson telefonu kritik yol değildir.

---

## 6. Cutover sonrası (Faz C — stabilizasyon 2-4 hafta)

- [ ] Günlük `pm2 describe` + haftalık `rclone lsl` (yedek akıyor mu) + p95 spot + aylık restore drill.
- [ ] Kriterler (charter :129-136) 2-4 hafta sağlanırsa → **Adisyo iptali = PİLOT BİTİŞ** → charter :124/:194-201 + forward-ref doc güncellemeleri + anchor §2.

---

**S103 (2026-07-22) — TAZELEME (S99'dan beri dokunulmamıştı; S100-S102'nin hiçbirini bilmiyordu).** Prod'dan ölçülerek düzeltilenler: (1) **§2 kasa-merkezliydi → üç yazıcı** (`kitchen` FIRIN · `grill` IZGARA TCP · `bill` KASA) + canlı kategori haritası + sürüm 0.0.3→**0.0.4**; (2) **CP857/`codepage-scan.ps1` reçetesi ÇIKARILDI** — ADR-004 Amd9 raster'da codepage ilgisiz, belge yanlış teşhise götürüyordu; (3) **§3'e istasyon bölünmesi + paket fişi (Amd3) + istasyona göre iptal fişi (Amd1 K14)** smoke'ları eklendi; (4) **iOS gate KAPANDI** (Apple onayı S100 + IPA `4e29245a` S102 + 5 cihaz kayıtlı); (5) **§1 sabit hedef sayılar kaldırıldı** (1469/67 bayattı — 22 Tem'de 1470/68); (6) **§0'a personel-hesabı kalemi** (Ceren + Sıraç yok) ve **pm2 `restart=50` baseline** açıklaması; (7) **§5'e kademeli geri alma** (ızgara hattı deploy'suz geri alınır — Amd1 K10). Ölçüm anı: prod `275250a` · migration 049 · health 200 · print_jobs 121 success/0 failed/0 queued · yedek `20260722-030448`.

**S103 — aynı gün, canlı sınama.** Yetim-kuyruk göstergesi dükkan-PC + canlı prod üzerinde **gerçek olayla sınandı** (ADR-032 Amd2'nin açık [USER] borcu): ızgara servisi durduruldu → sipariş → uyarı yandı → servis kaldırıldı → uyarı söndü + iş 189 sn bekleyip bastı. Sınamadan çıkan ve belgeye giren iki operasyonel gerçek: **(1)** servis adları istasyonlara sezgisel eşlenmiyor (`RestoranPosPrintAgent` = FIRIN, adında "Kitchen" yok) — §2'ye tablo olarak eklendi; **(2)** dükkan-PC uzaktan komut kabul etmiyor (RPC/SMB/RDP/WinRM kapalı) → cutover gecesi servis işleri için **makinenin başında olmak gerekir**, uzaktan destek yolu yok.

*Önceki tarihçe — Session 86 (2026-07-07); S87 (2026-07-08) gözden geçirildi. **S99 (2026-07-18):** hedef **24-26 Tem'e (Cum-Pzr) daraltıldı** [USER] · §0 mobil-build (a) Android ✅ (APK `ebf43e53` kuruldu, yeşil-nokta teyitli) · kiosk KURULDU ✅ · Apple kimlik-belgeleri gönderildi · #387 audit-paritesi prod'a indi + canlı davranışsal-smoke DB-kanıtlı. **S98-devamı-2 (2026-07-17) ön-hazırlık paketi:** `cutover-test-temizligi.md` (tx'li SQL taslağı + FK-teyit + audit-default-koru) + `kasiyer-kiosk-kurulum.md` eklendi; order_no sayacının GÜNLÜK olduğu doğrulandı → sequence-reset kalemi düştü. **S98-devamı (2026-07-17) kullanıcı kararları işlendi:** hedef-hafta 20-26 Tem · iOS-beklenir/iki-platform-birlikte · kasiyer=dükkan-PC-Chrome-kiosk · temiz-başlangıç-EVET (hard-delete + order_no-1'den). **S98 (2026-07-16) güncellendi:** kasa-cutover §2 tamamlandı-teyide indirildi (S89 canlı + S97 exe 0.0.3) · iki-platform pilot (ADR-031 Amd1: iOS gate + Android-only fallback) · §0'a mobil güncel-build dalgası (#383 resync) + kasiyer-istasyonu kararı + hesap-hijyeni ✓ · §1 sayım-önce + order_no karar-kaydı notu · §3'e iptal-fişi & iOS smoke. Cutover'a yakın kesinleştirilecek.*
