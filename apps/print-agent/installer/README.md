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

**Sürüm:** Phase 3 PR-6 (Session 67, 2026-05-17)
**ADR referansı:** `.claude/memory/decisions.md` L4516-L4638 (ADR-004 §Phase 3 PR-6)
