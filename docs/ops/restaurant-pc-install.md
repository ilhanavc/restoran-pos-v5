# Restoran PC Kurulum Runbook — Print Agent (2 yazıcı) + Fiş Smoke

> Kaynak: ADR-004 (Print Agent) + ADR-032 (mutfak/kasa iş-türü yönlendirmesi) + ADR-031 K8 (istasyon). Detaylı installer notları: `apps/print-agent/installer/README.md`.
> Hedef: restoran PC'sine **iki Print Agent** kur — **mutfak** (Ethernet, mutfak fişi) + **kasa** (USB, müşteri adisyonu) — ve Türkçe fiş (CP857) doğru bassın (go-live blocker, charter :125).

## 0. Ön koşullar

- Windows 10/11 x64, **Yönetici (Administrator)** hakları.
- Mutfak yazıcısı Ethernet ile ağa bağlı; **LAN IP'si** biliniyor (yazıcı self-test çıktısında veya router'da).
- Kasa yazıcısı USB ile PC'ye bağlı.
- İnternet (cloud API'ye HTTPS) + yazıcıya TCP 9100 erişimi.
- Bu dev PC'den **2 dosya** ve **değerler**:
  - MSI: `apps\print-agent\installer\dist\print-agent-0.0.2.msi`
  - Helper: `apps\print-agent\installer\install-second-agent.ps1`
  - `PRINT_AGENT_API_URL = https://restoranpos.org/api`
  - `PRINT_AGENT_API_KEY = pk_e94739ac_...` (kasadan)

## 1. Dosyaları taşı

İki dosyayı restoran PC'sine kopyala (USB / e-posta / ağ). Örn. `C:\Kurulum\` altına.

## 2. Cloud env — servise **nssm ile göm** (MSI kurulumundan = Adım 3'ten SONRA)

> ⚠️ **Sistem ortam değişkeni YETMEZ (S83 dersi):** Windows servisleri boot'taki env'i kullanır; sonradan eklenen sistem env'ini servis **REBOOT'a kadar görmez** (agent `localhost:4001`'e düşüp döngüye girer). Güvenilir yol: env'i **nssm ile doğrudan servise gömmek** ([[feedback_windows_service_env_visibility]]).

Adım 3'teki MSI kurulumundan **sonra**, Yönetici PowerShell'de — **Ctrl+V ile TEK yapıştır** (sağ tık çiftliyor):

```powershell
$n="C:\Program Files\Restoran POS\Print Agent\nssm.exe"; & $n set RestoranPosPrintAgent AppEnvironmentExtra "PRINT_AGENT_API_URL=https://restoranpos.org/api" "PRINT_AGENT_API_KEY=pk_e94739ac_..."; & $n restart RestoranPosPrintAgent
```

- `PRINT_AGENT_API_KEY` tam değeri prod `/root/pos-secrets.env` → `PRINT_AGENT_API_KEY` (kasadan).
- ⚠️ **MSI upgrade uyarısı:** MSI güncellenirse servis yeniden kaydolur → bu nssm env **SİLİNİR**, komut tekrar çalıştırılmalı. (İkinci agent için `install-second-agent.ps1 -ApiUrl/-ApiKey` env'i baştan gömer.)

## 3. MSI kur (Agent 1 = MUTFAK)

1. `print-agent-0.0.2.msi`'ye **sağ tık → Yönetici olarak çalıştır**. ("Bilinmeyen yayıncı" uyarısı normal — devam.)
2. İleri → Bitir. Servis (`RestoranPosPrintAgent`) kurulur ve başlar; ilk anda "config yok" hatası verir — **normal** (sonraki adım).

## 4. Mutfak config (Ethernet)

`%PROGRAMDATA%\restoran-pos\print-agent.json` dosyasını **Notepad (yönetici)** ile aç, şununla değiştir:

```json
{
  "printer": { "type": "tcp", "host": "192.168.1.120", "port": 9100, "timeoutMs": 10000 },
  "jobKinds": ["kitchen"]
}
```

- `host` = **mutfak yazıcısının gerçek LAN IP'si**.
- Kaydet → yönetici PowerShell'de: `Restart-Service RestoranPosPrintAgent`

**Doğrula:** `%PROGRAMDATA%\restoran-pos\logs\stdout.log` içinde `register OK: agentId=...` satırı görünmeli. Yoksa `stderr.log`'a bak (§8).

## 5. Kasa agent (Agent 2 = USB)

Yönetici PowerShell'de, helper'ın olduğu klasörde:

```powershell
.\install-second-agent.ps1
```

- `RestoranPosPrintAgentBill` servisini kaydeder + `%PROGRAMDATA%\restoran-pos\print-agent-bill.json` taslağı yazar (`jobKinds:["bill"]` + USB placeholder).

**USB vendorId/productId bul** (Aygıt Yöneticisi → yazıcı → Özellikler → Ayrıntılar → **Donanım Kimlikleri** → `USB\VID_XXXX&PID_YYYY`; hex → decimal). `print-agent-bill.json`'da doldur:

```json
{
  "printer": { "type": "usb", "vendorId": 1046, "productId": 20497, "timeoutMs": 10000 },
  "jobKinds": ["bill"]
}
```

- Kaydet → `Restart-Service RestoranPosPrintAgentBill`
- USB sürücü çakışması (`LIBUSB_ERROR_ACCESS`) olursa Zadig → WinUSB (bkz. `installer/README.md` §USB sürücü çakışması).

**Doğrula:** `logs\RestoranPosPrintAgentBill-stdout.log` içinde `register OK`.

## 6. Fiş smoke (CP857 Türkçe) — go-live blocker

> Ön koşul: en az **1 menü ürünü + 1 masa** girilmiş olmalı (P5-2). Yoksa önce onları web'den ekle.

1. Web'de (restoranpos.org) bir masaya **sipariş gir** (Türkçe karakterli ürün: "çğ ışöü" içeren bir not/ürün) → **Mutfağa gönder**.
   - **Mutfak yazıcısı** fişi basmalı; Türkçe karakterler (ç, ş, ğ, ı, ö, ü) **doğru** çıkmalı (CP857).
2. Aynı masada **Adisyon yazdır** → **Kasa yazıcısı** adisyonu basmalı.
3. Her iki fiş de doğru yazıcıdan + Türkçe karakterler doğru ise **fiş kriteri ✅**.

Yanlış yazıcıdan çıkarsa: config `jobKinds` değerlerini kontrol et (mutfak `["kitchen"]`, kasa `["bill"]`). Türkçe bozuksa: yazıcı codepage'i CP857 değil — `installer/codepage-scan.ps1` ile doğru `ESC t N`'i bul. **JP80H'de CP857 = `ESC t 29`** (13 değil — 13 bu firmware'de boş!); [[feedback_escpos_jp80h_codepage]].

## 7. İstasyon ayarları (KDS/kasiyer)

- Tarayıcı otomatik başlatma + KDS tam ekran; ekran **uyku/güç-tasarrufu KAPALI** (rush saatinde KDS kararırsa mutfak siparişi görmez).

## 8. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `register failed HTTP 401` | `PRINT_AGENT_API_KEY` yanlış/iptal; değeri kontrol et, servisi yeniden başlat |
| `register` yok / `api=localhost:4001` | Env servise **nssm** ile girildi mi (Adım 2)? Sistem env servise görünmez (reboot ister). İnternet? |
| `printer fail ECONNREFUSED` | `Test-NetConnection <IP> -Port 9100`; yazıcı açık + aynı LAN mı? |
| Servis "Stopped" | Config JSON geçersiz; `stderr.log`'da zod hatası |
| Fiş yanlış yazıcıda | `jobKinds` ters/eksik (her türe ≥1 agent) |
| Türkçe karakter bozuk | Codepage yanlış; `codepage-scan.ps1` ile doğru N (JP80H: **ESC t 29**) |

Kaldırma: MSI → Denetim Masası'ndan; ikinci servis → `.\install-second-agent.ps1 -Uninstall`.
