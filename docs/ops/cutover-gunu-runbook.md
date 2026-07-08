# Cutover Günü Runbook — Adisyo → v5 (TASLAK, Faz B)

> ⚠️ **TASLAK** — cutover'a yakın gözden geçirilip kesinleştirilecek. Dayanak: `active-plan.md` Faz B + `.claude/memory/decisions.md` ADR-031 K6/K10 + ADR-004 Amd3 (kasa codepage) + memory [[project_kasa_printer_adisyo_shared]] / [[feedback_destructive_op_live_hardware_warn_hard]].
>
> **Ne zaman:** **gün sonunda** (Adisyo'nun son siparişleri kapandıktan sonra; ADR-031 K6). **Adisyo aboneliği 2-4 hafta AÇIK kalır** — geri dönüş garantisi. Bu bir "tek yön" değil, geri-alınabilir geçiş.

---

## 0. Ön-koşullar (cutover gününe girmeden)

- [ ] **Gece yedeği taze** — `rclone lsl storagebox:restoran-pos-backups | tail -3` bugünün `.age` dosyasını gösteriyor (off-site). age private key kasada.
- [ ] **Personel eğitildi** + **kağıt-fallback 1-sayfa** elde (`docs/ops/go-live-kagit-fallback-ve-egitim.md`).
- [ ] **Menü/masa/kullanıcı canlı** ✅ (67 ürün · 25 masa · 2 admin+1 garson).
- [ ] **Çekirdek akış kanıtlı** ✅ (S86: mobil→mutfak fişi + web kasiyer + senkron).
- [ ] **Prod sağlıklı** — `https://restoranpos.org/api/health` 200 + `pm2 describe pos-api` uptime stabil, restart 0.
- [ ] **Mutfak yazıcısı kayıtlı** — JP80H agent register + son job başarılı (kasa agent §2'de kurulacak).
- [ ] Caller ID **CANLI** ✅ (S86 — dükkan PC servisi Running, canlı popup doğrulandı). Cutover'da yalnız teyit: paket servis çağrısında popup düşüyor mu (§3). Dayanıklılık reçetesi `caller-bridge-kurulum-smoke.md §5.1`. Arızası cutover'ı bloklamaz (opsiyonel).
- [ ] KDS **yok** (kağıt fiş — kullanıcı kararı S86).

---

## 1. Test verisi temizliği + `order_no` 1'den

Prod'da pilot testlerinden kalan veri var (~8 test order + 1 soft-deleted test ürün).

- [ ] **[OPS + kullanıcı onayı]** Test order'ları temizle (SQL, dikkatli — yalnız test kayıtları; müşteri 1469/menü/masa KORUNUR). Karar: hard-delete mi, `order_no` sıfırlama mı yeterli.
- [ ] **`order_no` sequence 1'den** başlasın (canlı ilk sipariş `#1`). ADR-031 K6 forward-ref.
- [ ] Temizlik SONRASI sayım doğrula (read-only): `customers=1469`, `products=67`, `orders=0` (veya beklenen).

> ⚠️ Bu bir **canlı-veri DB işlemi** → önce yedek teyidi (§0), tercihen migration/script + kullanıcı onayı. Sessiz `DELETE` yok.

---

## 2. ⛔ KASA YAZICISI CUTOVER (en riskli adım — DUR ve OKU)

> 🛑 **STOP.** Kasa yazıcısı (POS-80, USB) **canlı Adisyo ile paylaşımlı.** Zadig ile WinUSB sürücüsü yüklemek **Adisyo'nun basmasını durdurur** — bu bilinçli cutover adımıdır AMA yanlış giderse Adisyo basamaz (S84'te kaza oldu). **Geri-alma reçetesini ÖNCE oku, sonra başla.**

### Geri-alma reçetesi (önden — [[project_kasa_printer_adisyo_shared]])
Zadig sonrası Adisyo/kasa bozulursa: **Aygıt Yöneticisi → cihazı Kaldır → "sürücü yazılımını da sil" → donanımı yeniden tara** (orijinal sürücü geri gelir) → Adisyo tekrar basar. Cutover'ı ertele, sorunu çöz.

### Adımlar (yalnız Adisyo BIRAKILDIĞINDA — ⛔ Adisyo yaşarken YASAK)
- [ ] Zadig → kasa yazıcısına **WinUSB** sürücüsü yükle. **VID/PID** not al.
- [ ] `install-second-agent.ps1 -ApiUrl https://restoranpos.org/api -ApiKey <PRINT_AGENT key> -JobKinds bill` (aynı PC'de 2. nssm servisi; #278). USB VID/PID config'e.
- [ ] **Codepage teyidi:** kasa fişi ESC t **61** üretir (ADR-004 Amd3, #282 prod'da — ama **`Doğrulanmamış`**). `apps/print-agent/installer/codepage-scan.ps1` ile ampirik bas → Türkçe (ç/ğ/ş/ı/ö/ü) doğru mu? Yanlışsa doğru sayfayı bul → `CODEPAGE_CP857_PAGE61` tek-satır fix + deploy.
- [ ] **Adisyon fiş smoke:** web'den öde → kasa fişi fiziksel bassın, Türkçe doğru + tutar/kalemler doğru.

---

## 3. Go-live smoke (tam akış)

- [ ] **Web kasiyer:** masa aç → sipariş → mutfak fişi (✅ kağıt) → öde → **kasa adisyon fişi** (§2).
- [ ] **Web müdür:** raporlar/menü/masa erişimi.
- [ ] **Mobil garson:** sipariş → mutfak fişi <2sn + realtime iki-yön (mobil↔web).
- [ ] **Paket servis:** takeaway sipariş + (varsa) Caller ID popup.
- [ ] **Realtime:** iki cihazda masa/sipariş senkronu anlık.

---

## 4. Go/no-go ölçümleri (ADR-031 K10; charter :125/:129-136)

- [ ] **p95 < 200ms:** önce Nginx `log_format`'a `$request_time` ekle → `apps/api/scripts/ops/go-live-p95-check.sh --setup` sonra ölç.
- [ ] **pm2 restart 0:** `pm2 describe pos-api` → uptime stabil, restart sayısı artmıyor.
- [ ] **Hata yok:** `pm2 logs pos-api --lines 50 --nostream` temiz; Nginx 5xx yok.
- [ ] Yazıcı(lar) job kuyruğu birikmiyor (`queued` düşük).

---

## 5. Rollback eşiği (ADR-031 K10)

**>30 dk sipariş alınamıyor** VEYA **veri kaybı/şüphesi** → **Adisyo'ya dön** (abonelik açık). Kasa yazıcısı geri-alma reçetesi §2. Küçük sorun → kağıt-fallback + fix-forward; büyük arıza → Adisyo.

---

## 6. Cutover sonrası (Faz C — stabilizasyon 2-4 hafta)

- [ ] Günlük `pm2 describe` + haftalık `rclone lsl` (yedek akıyor mu) + p95 spot + aylık restore drill.
- [ ] Kriterler (charter :129-136) 2-4 hafta sağlanırsa → **Adisyo iptali = PİLOT BİTİŞ** → charter :124/:194-201 + forward-ref doc güncellemeleri + anchor §2.

---

*Taslak — Session 86 (2026-07-07); S87 (2026-07-08) gözden geçirildi: Caller ID canlı teyidine güncellendi + prod-health & yazıcı ön-koşulları + `codepage-scan.ps1` tam yolu. Cutover'a yakın kesinleştirilecek.*
