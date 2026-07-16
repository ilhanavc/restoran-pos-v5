# Cutover Günü Runbook — Adisyo → v5 (TASLAK, Faz B)

> ⚠️ **TASLAK** — cutover'a yakın gözden geçirilip kesinleştirilecek. Dayanak: `active-plan.md` Faz B + `.claude/memory/decisions.md` ADR-031 K6/K10 + **ADR-031 Amendment 1 (iki-platform pilot: iOS + Android)** + ADR-004 Amd3/Amd4/Amd6 + memory [[project_kasa_printer_adisyo_shared]] / [[feedback_destructive_op_live_hardware_warn_hard]].
>
> **Ne zaman:** **gün sonunda** (Adisyo'nun son siparişleri kapandıktan sonra; ADR-031 K6). **Adisyo aboneliği 2-4 hafta AÇIK kalır** — geri dönüş garantisi. Bu bir "tek yön" değil, geri-alınabilir geçiş.

---

## 0. Ön-koşullar (cutover gününe girmeden)

- [ ] **Gece yedeği taze** — `rclone lsl storagebox:restoran-pos-backups | tail -3` bugünün `.age` dosyasını gösteriyor (off-site). age private key kasada.
- [ ] **Personel eğitildi** + **kağıt-fallback 1-sayfa** elde (`docs/ops/go-live-kagit-fallback-ve-egitim.md`).
- [ ] **Menü/masa/kullanıcı canlı** ✅ (67 ürün · 25 masa · 2 admin+1 garson).
- [ ] **Çekirdek akış kanıtlı** ✅ (S86: mobil→mutfak fişi + web kasiyer + senkron; S97: iptal-fişi ailesi JP80H kağıt-smoke ✓✓).
- [ ] **Prod sağlıklı** — `https://restoranpos.org/api/health` 200 + `pm2 describe pos-api` uptime stabil, restart 0.
- [x] **Yazıcılar CANLI** ✅ (S89: mutfak **ve kasa** agent'ları register + fiziksel basıyor; S97: exe **0.0.3** cutover — Amd6 ack-dayanıklılığı devrede). Cutover günü yalnız §2 smoke-teyidi.
- [x] Caller ID **CANLI** ✅ (S86 kurulum; **S97: yeni build #307+#362 + C12-A-01 donanım-teyidi kapandı** — SetEvents ampirik, maskeli-log KVKK ✓). Cutover'da yalnız teyit: paket servis çağrısında popup düşüyor mu (§3). Dayanıklılık reçetesi `caller-bridge-kurulum-smoke.md §5.1`. Arızası cutover'ı bloklamaz (opsiyonel).
- [x] **Hesap hijyeni** ✅ (S97: admin-şifre değiştirildi + EAS keystore kasada).
- [ ] **📱 Mobil güncel-build dalgası (S98 SONRASI GEREKLİ):** ADR-026 Amd1 resync-sağlamlaştırma (#383) canlı cihazlara **yeni build'le** biner — cutover'dan önce: **(a)** yeni Android APK (aynı keystore, üstüne-kurulum, `mobile-release.md` §1-8) garson telefonuna; **(b)** iOS ad-hoc IPA (aşağıdaki iOS gate'i geçerse) → ilk IPA zaten Amd1'i içerir.
- [ ] **🍎 iOS gate (ADR-031 Amendment 1 K3):** Apple Developer üyeliği [USER] → `eas device:create` → ad-hoc IPA kuruldu + §11.8 iOS smoke geçti. **Üyelik cutover gününe kadar YOKSA:** pilot **Android-only başlar** (Amd1 K3: "Android pilotu bağımsız ilerler"), iOS hazır olduğunda pilota sonradan eklenir — cutover'ı BLOKLAMAZ. Karar cutover-öncesi toplantıda netleşir.
- [ ] **🖥️ Kasiyer istasyonu [USER karar]:** hangi cihaz/tarayıcı (dükkan-PC'de Chrome mi, ayrı mini-PC mi) + tam-ekran/kiosk modu + oturum açık kalma düzeni. (Şu an karar YOK — cutover-öncesi netleşmeli.)
- [ ] KDS **yok** (kağıt fiş — kullanıcı kararı S86).

---

## 1. Test verisi temizliği + `order_no` 1'den

Prod'da pilot testlerinden kalan veri var (miktar oturumdan oturuma değişti — S96'da bir kısmı void/iptal ile ₺0'a çekildi; **cutover günü güncel sayım yapılır**, tahmine güvenilmez).

- [ ] **Güncel envanter (read-only):** `SELECT count(*) FROM orders;` + payments/print_jobs sayımı → temizlenecek kümenin listesi çıkarılır, kullanıcıya gösterilir.
- [ ] **[OPS + kullanıcı onayı]** Test order'ları temizle (SQL, dikkatli — yalnız test kayıtları; müşteri 1469/menü/masa KORUNUR). Karar: hard-delete mi, `order_no` sıfırlama mı yeterli.
- [ ] **`order_no` sequence 1'den** başlasın (canlı ilk sipariş `#1`). ADR-031 K6 forward-ref. **Uygulama günü küçük karar-kaydı gerekir** (sequence-reset + hard-delete kapsamı — audit/FK zinciri etkisiyle birlikte; ADR-031'e mini-amendment veya §1'e as-built not).
- [ ] Temizlik SONRASI sayım doğrula (read-only): `customers=1469`, `products=67`, `orders=0` (veya beklenen).

> ⚠️ Bu bir **canlı-veri DB işlemi** → önce yedek teyidi (§0), tercihen migration/script + kullanıcı onayı. Sessiz `DELETE` yok.

---

## 2. KASA YAZICISI — ✅ CUTOVER S89'DA YAPILDI (spooler, Zadig'siz); cutover günü yalnız TEYİT

> ✅ **Bu bölümün kurulum kısmı TAMAMLANDI:** S88 ADR-004 Amd4 implementasyonu → **S89'da kasa spooler-agent'ı CANLI** (2. nssm servisi kuruldu, kasa + mutfak fiziksel basıyor, register OK) → **S97'de iki servis exe 0.0.3'e** yükseltildi (Amd6 ack-dayanıklılığı + iptal fişleri). Sürücü hiç değişmedi → **Adisyo paylaşımı korunuyor** (S87 round-trip + S89 canlı işletim kanıtlı). Codepage 61 ampirik teyitli (S87).

### Geri dönüş (hâlâ geçerli, gerekirse)
`install-second-agent.ps1 -Uninstall` → 2. nssm servisi durur/kalkar (config + log korunur). Yazıcının Windows sürücüsü **hiç değişmediği** için Adisyo kesintisiz basmaya devam eder — donanım/sürücü müdahalesi YOK.

### Cutover günü teyit adımları
- [ ] İki print-agent servisi **Running** + sürüm **0.0.3** (dükkan-PC: `nssm status` / Hizmetler).
- [ ] **Adisyon fiş smoke:** web'den öde → kasa fişi fiziksel bassın, Türkçe doğru + tutar/kalemler doğru. Ardından **Adisyo'dan da bir test bas** → hâlâ basıyor mu (paylaşım korundu mu) doğrula.
- [ ] (Sapma görülürse) `apps/print-agent/installer/codepage-scan.ps1` + `CODEPAGE_CP857_PAGE61` tek-satır fix elde.

---

## 3. Go-live smoke (tam akış)

- [ ] **Web kasiyer:** masa aç → sipariş → mutfak fişi (✅ kağıt) → öde → **kasa adisyon fişi** (§2).
- [ ] **Web müdür:** raporlar/menü/masa erişimi.
- [ ] **Mobil garson (iki-platform — ADR-031 Amd1):** Android APK'da sipariş → mutfak fişi <2sn + realtime iki-yön (mobil↔web); **iOS kuruluysa aynı akış iOS'ta da** (+ arka-plan→ön-plan dönüşünde board tazeleniyor — ADR-026 Amd1).
- [ ] **İptal akışı (ADR-004 Amd6):** bir kalem iptal et → mutfakta **"KALEM İPTAL"** fişi; masa kapat-iptal → **"ADİSYON İPTAL"** (S97 kağıt-smoke'un canlı-gün teyidi).
- [ ] **Paket servis:** takeaway sipariş + (varsa) Caller ID popup.
- [ ] **Realtime:** iki cihazda masa/sipariş senkronu anlık.

---

## 4. Go/no-go ölçümleri (ADR-031 K10; charter :125/:129-136)

- [ ] **p95 < 200ms:** önce Nginx `log_format`'a `$request_time` ekle → `apps/api/scripts/ops/go-live-p95-check.sh --setup` sonra ölç.
- [ ] **pm2 restart 0:** `pm2 describe pos-api` → uptime stabil, restart sayısı artmıyor.
- [ ] **Hata yok:** `pm2 logs pos-api --lines 50 --nostream` temiz; Nginx 5xx yok.
- [ ] Yazıcı(lar) job kuyruğu birikmiyor (`queued` düşük).
- [ ] **İki-platform mobil kriteri (ADR-031 Amd1):** go/no-go smoke'u kurulu her platformda geçer (Android şart; iOS kuruluysa iOS da). iOS kurulmadıysa go/no-go **Android-only** değerlendirilir (Amd1 K3), iOS sonradan eklenirken §11.8 smoke'u tekrarlanır.

---

## 5. Rollback eşiği (ADR-031 K10)

**>30 dk sipariş alınamıyor** VEYA **veri kaybı/şüphesi** → **Adisyo'ya dön** (abonelik açık). Kasa yazıcısı geri-alma reçetesi §2. Küçük sorun → kağıt-fallback + fix-forward; büyük arıza → Adisyo.

---

## 6. Cutover sonrası (Faz C — stabilizasyon 2-4 hafta)

- [ ] Günlük `pm2 describe` + haftalık `rclone lsl` (yedek akıyor mu) + p95 spot + aylık restore drill.
- [ ] Kriterler (charter :129-136) 2-4 hafta sağlanırsa → **Adisyo iptali = PİLOT BİTİŞ** → charter :124/:194-201 + forward-ref doc güncellemeleri + anchor §2.

---

*Taslak — Session 86 (2026-07-07); S87 (2026-07-08) gözden geçirildi. **S98 (2026-07-16) güncellendi:** kasa-cutover §2 tamamlandı-teyide indirildi (S89 canlı + S97 exe 0.0.3) · iki-platform pilot (ADR-031 Amd1: iOS gate + Android-only fallback) · §0'a mobil güncel-build dalgası (#383 resync) + kasiyer-istasyonu kararı + hesap-hijyeni ✓ · §1 sayım-önce + order_no karar-kaydı notu · §3'e iptal-fişi & iOS smoke. Cutover'a yakın kesinleştirilecek.*
