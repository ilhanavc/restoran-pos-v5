# Restoran POS Print Agent — Kurulum

Bu belge, restoran PC'sine **Print Agent** Windows servisinin kurulumu, yapılandırması ve kaldırılmasını açıklar.

## 1) Sistem Gereksinimleri

- **İşletim sistemi:** Windows 10 x64 veya Windows 11 x64
- **Yetki:** Kurulum sırasında **Yönetici (Administrator)** hakları zorunludur. Servis kaydı için gerekli.
- **Ağ:** Cloud API erişimi (HTTPS dışa doğru) + yazıcının LAN üzerindeki IP'sine TCP 9100 erişimi
- **Disk:** ~60 MB (binary + nssm + config)
- **.NET / Node kurulum gerekmez** — tüm bağımlılıklar MSI içinde paketlenmiştir.

## 2) Kurulum

1. `print-agent-<sürüm>.msi` dosyasını indirin.
2. Dosyaya **sağ tıklayın → Yönetici olarak çalıştır** (veya yönetici PowerShell'den `msiexec /i print-agent-<sürüm>.msi`).
3. Kurulum sihirbazını izleyin: **İleri → Bitir**.
4. Kurulum tamamlandığında servis otomatik başlar; ancak ilk başlangıçta `printer config yok` hatası verir — bu beklenen davranıştır. 3. adım'a geçin.

### Sessiz kurulum (komut satırı)

```powershell
msiexec /i print-agent-0.0.1.msi /qb
```

## 3) İlk Yapılandırma

Kurulum sonrası yapılandırma dosyasını düzenleyin:

```
%PROGRAMDATA%\restoran-pos\print-agent.json
```

Notepad ile yönetici olarak açın ve yazıcı bilgilerini girin:

```json
{
  "printer": {
    "type": "tcp",
    "host": "192.168.1.100",
    "port": 9100,
    "timeoutMs": 10000
  }
}
```

**Alanlar:**
- `printer.host` — Termal yazıcının LAN IP adresi
- `printer.port` — TCP port (genellikle `9100`)
- `printer.timeoutMs` — Bağlantı timeout (varsayılan 10000 ms)

### USB Yazıcı Yapılandırması

USB üzerinden bağlı ESC/POS yazıcı kullanılıyorsa `printer` bölümü aşağıdaki gibi olur:

```json
{
  "printer": {
    "type": "usb",
    "vendorId": 1046,
    "productId": 20497,
    "timeoutMs": 10000
  }
}
```

**Vendor ID ve Product ID nasıl bulunur?**

1. **Aygıt Yöneticisi**ni açın (Windows + R → `devmgmt.msc`).
2. **Universal Serial Bus controllers** (Evrensel Seri Veri Yolu denetleyicileri) altında yazıcıyı bulun. Yazıcı genellikle "USB Printing Support" veya marka adıyla görünür.
3. Yazıcıya **sağ tıklayın → Özellikler → Ayrıntılar** sekmesine geçin.
4. **Özellik** açılır menüsünden **Donanım Kimlikleri** (Hardware Ids) seçin.
5. Değer şu formatta görünür: `USB\VID_0416&PID_5011`
   - `VID_0416` → `vendorId = 0x0416` (hex) = `1046` (decimal)
   - `PID_5011` → `productId = 0x5011` (hex) = `20497` (decimal)
6. Config dosyasına **decimal** değerleri girin (hex değil).

**Hex → decimal dönüşüm:** Windows Hesap Makinesi'nde **Programcı** modunu açın, HEX'e geçin, değeri yazın, DEC'e geçin.

**Çoklu aynı-model yazıcı için `serialNumber`:**

Aynı vendorId+productId'ye sahip birden fazla yazıcı bağlıysa (örn. iki adet Epson TM-T20III) hangi cihazın kullanılacağını `serialNumber` ile belirleyin:

```json
{
  "printer": {
    "type": "usb",
    "vendorId": 1046,
    "productId": 20497,
    "serialNumber": "X8F012345678",
    "timeoutMs": 10000
  }
}
```

Serial number Aygıt Yöneticisi'nde **Özellikler → Ayrıntılar → Üst Veri Yolu Genişletilmiş Donanım Kimlikleri** veya `USBView` (Microsoft Store ücretsiz) yardımcı programı ile bulunur. Ucuz/klon yazıcılarda serial number boş veya `0` dönebilir; bu durumda alanı eklemeyin.

**USB sürücü çakışması (Windows):**

Genel "USB Printing Support" sürücüsü cihazı kilitlerse Agent `LIBUSB_ERROR_ACCESS` hatası verir (`stderr.log`'da görünür). Çözüm: [Zadig](https://zadig.akeo.ie/) aracı ile yazıcıyı **WinUSB** sürücüsüne çevirin:

1. Zadig indirin, **yönetici** olarak çalıştırın.
2. **Options → List All Devices** işaretleyin.
3. Listeden ESC/POS yazıcıyı seçin.
4. Hedef sürücü olarak **WinUSB** seçin → **Replace Driver**.
5. Servisi yeniden başlatın: `Restart-Service RestoranPosPrintAgent`.

> **Uyarı:** Zadig yazıcının Windows yazdırma kuyruğuyla (örn. Word'den yazdırma) ilişkisini koparır — Agent doğrudan ESC/POS byte stream gönderir, sürücü gerekmez. Sadece kasada ESC/POS yazıcı olarak kullanılacaksa Zadig uygundur.

### İkincil yazıcı: mutfak / kasa ayrımı (ADR-032)

Birden fazla yazıcı için (örn. **mutfak fişi** ayrı, **müşteri adisyonu/fişi** ayrı) **her yazıcıya bir Print Agent instance'ı** kurulur (1:1 agent↔yazıcı). Hangi agent'ın hangi iş türünü basacağı, o agent'ın config dosyasındaki **`jobKinds`** alanıyla belirlenir:

- **Mutfak yazıcısı** config'i:
  ```json
  {
    "printer": { "type": "tcp", "host": "192.168.1.100", "port": 9100 },
    "jobKinds": ["kitchen"]
  }
  ```
- **Kasa / adisyon yazıcısı** config'i:
  ```json
  {
    "printer": { "type": "usb", "vendorId": 1046, "productId": 20497 },
    "jobKinds": ["bill"]
  }
  ```

**Kurallar:**
- `jobKinds` **yoksa** agent TÜM iş türlerini basar (tek-yazıcı kurulum — geriye dönük varsayılan; mevcut bootstrap agent bu şekilde çalışır).
- Geçerli değerler: `"kitchen"` (mutfak fişi), `"bill"` (müşteri adisyonu/fişi).
- ⚠️ **Her iş türüne en az bir agent atanmalı.** İki agent de aynı türü alırsa (örn. ikisi de `["bill"]`) diğer tür (mutfak) **hiç basılmaz** — bu config hatası kod tarafından yakalanmaz, kurulumda elle doğrulanmalıdır.
- İki agent farklı `PRINT_AGENT_DEVICE_FINGERPRINT` kullanmalı (aynı PC'de iki instance ise); ikisi de aynı `PRINT_AGENT_API_KEY` ile register olabilir (tek-tenant).
- Dev/test için `jobKinds` env ile de verilebilir: `PRINT_AGENT_JOB_KINDS=kitchen` (CSV).
- Rol-eşleşen agent offline ise o türün job'ları kuyrukta bekler (cross-role fallback YOK — yanlış yazıcıda basmak geç basmaktan kötü); agent dönünce FIFO basılır.

### Cloud bağlantısı (ortam değişkenleri)

Cloud API erişimi için ortam değişkenleri **Sistem Özellikleri → Gelişmiş → Ortam Değişkenleri** menüsünden ayarlanır:

| Değişken | Açıklama |
|---|---|
| `PRINT_AGENT_API_URL` | Cloud API kök URL (örn. `https://api.restoran-pos.example`) |
| `PRINT_AGENT_API_KEY` | Manager UI'dan üretilen apiKey (`pk_<tenant>_<random>` formatı) |
| `PRINT_AGENT_DEVICE_FINGERPRINT` | (opsiyonel) cihaz tanımlayıcısı, varsayılan `hostname-platform` |

> **Güvenlik notu:** apiKey **plaintext olarak MSI içine gömülmez**. Kurulum sonrası Manager UI'dan üretip ortam değişkenine elle ekleyin. Bu PR-3a auth backbone kararıdır.

### Servisi yeniden başlatma

Yapılandırmayı kaydettikten sonra servisi yeniden başlatın (yönetici PowerShell):

```powershell
Restart-Service RestoranPosPrintAgent
```

### Servis durumu kontrolü

```powershell
Get-Service RestoranPosPrintAgent
```

Çıktıda `Status: Running` görünmelidir.

## 4) Log Dosyaları

Servis çıktıları aşağıdaki dizine yazılır:

```
%PROGRAMDATA%\restoran-pos\logs\
  stdout.log
  stderr.log
```

> Phase 4+ event log entegrasyonu eklenecek. Şu an `nssm` stdout/stderr redirect kullanır.

## 5) Doğrulama (Smoke Test)

Kurulumun başarılı olduğunu doğrulamak için:

1. **Yönetici PowerShell** aç.
2. `Get-Service RestoranPosPrintAgent` — Status `Running` olmalı.
3. `Test-Path "$env:PROGRAMDATA\restoran-pos\print-agent.json"` — `True` dönmeli.
4. `Test-Path "$env:PROGRAMFILES\Restoran POS\Print Agent\print-agent.exe"` — `True` dönmeli.
5. **Denetim Masası → Program Ekle/Kaldır** — listede "Restoran POS Print Agent" satırı görünmeli.
6. Geçerli `apiKey` + `printer.host` doldurulduktan sonra servisi yeniden başlat → `stdout.log` içinde `register OK: agentId=...` satırı görünmeli.

## 6) Kaldırma

**Denetim Masası → Program Ekle/Kaldır → "Restoran POS Print Agent" → Kaldır**

Veya yönetici PowerShell:

```powershell
msiexec /x print-agent-0.0.1.msi /qb
```

### Tam temizlik (config dosyasını da sil)

Uninstall **konfigürasyon dosyasını korur** (re-install dostu). Tam temizlik için manuel:

```powershell
Remove-Item "$env:PROGRAMDATA\restoran-pos\print-agent.json"
Remove-Item "$env:PROGRAMDATA\restoran-pos\logs" -Recurse
```

## 7) Sorun Giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Servis başlamıyor / "Stopped" donuyor | Config dosyası eksik veya geçersiz JSON | `%PROGRAMDATA%\restoran-pos\print-agent.json` dosyasını doğrula; zod schema hataları `stderr.log`'da |
| `register failed HTTP 401` | apiKey hatalı veya iptal edilmiş | Manager UI'dan yeni apiKey üret; ortam değişkenini güncelle; servisi yeniden başlat |
| `printer fail ECONNREFUSED` | Yazıcı IP / port erişimsiz | `Test-NetConnection 192.168.1.100 -Port 9100` ile bağlantıyı test et; yazıcı açık ve aynı LAN'da mı? |
| Olay Görüntüleyici'de servis çökme | Network hatası, JSON parse hatası | `stderr.log` ve `stdout.log` dosyalarını incele |
| MSI kurulum "publisher unknown" uyarısı | Authenticode imzası v5.1'de eklenecek | Yönetici onayıyla devam et |

## 8) Sürüm Yükseltme

Yeni MSI dosyasını çalıştırmanız yeterli — eski sürüm otomatik kaldırılır ve config dosyası korunur. **Major upgrade** WiX `MajorUpgrade` direktifi ile gerçekleşir.

Sürüm yükseltme öncesi servisi durdurmanız **gerekmez** — installer otomatik yapar.

---

**Sürüm:** Phase 3 PR-5b (Session 69, 2026-05-14) — USB transport eklendi
**ADR referansı:** `.claude/memory/decisions.md` L4516-L4762 (ADR-004 §Phase 3 PR-6 + PR-5b)
