# Restoran PC Kurulum Runbook — Print Agent (3 yazıcı) + Fiş Smoke

> Kaynak: ADR-004 (Print Agent, **Amd4 spooler** + **Amd9 raster**) + ADR-032 (iş-türü yönlendirmesi, **Amd1 fırın/ızgara bölünmesi**) + ADR-031 K8 (istasyon). Detaylı installer notları: `apps/print-agent/installer/README.md`.
> Hedef: restoran PC'sine **üç Print Agent servisi** kur — **FIRIN** `kitchen` (TCP `192.168.1.120`) + **IZGARA** `grill` (TCP `192.168.1.87`, S101'de eklendi) + **KASA** `bill` (USB, spooler-RAW; Adisyo ile paylaşımlı) — ve fişler doğru yazıcıdan, Türkçesi bozulmadan bassın (go-live blocker, charter :125).
>
> ⚠️ **S103 (2026-07-22) notu:** Bu belgedeki **CP857 / `codepage-scan.ps1` / `ESC t N`** yönergeleri **ADR-004 Amd9 (raster render) ile birlikte GEÇERSİZ kaldı** — fiş artık sunucuda bitmap çizilip `GS v 0` ile basılıyor, yazıcının codepage'i ilgisiz. Tarihsel kayıt olarak bırakıldı; **teşhiste kullanma** (§6/§8'deki güncel karşılıkları izle).

## 0. Ön koşullar

- Windows 10/11 x64, **Yönetici (Administrator)** hakları.
- **FIRIN** ve **IZGARA** yazıcıları Ethernet ile ağa bağlı; **LAN IP'leri** biliniyor (yazıcı self-test çıktısında veya router'da) — canlı: `192.168.1.120` (FIRIN) · `192.168.1.87` (IZGARA).
- **KASA** yazıcısı USB ile PC'ye bağlı; Windows kuyruğu üzerinden basılır (spooler-RAW) — **sürücü değiştirilmez**, Adisyo aynı yazıcıyı kullanmaya devam eder.
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

## 6. Fiş smoke (üç yazıcı + istasyon bölünmesi) — go-live blocker

> Ön koşul: en az **1 menü ürünü + 1 masa** girilmiş olmalı (P5-2). Yoksa önce onları web'den ekle.

1. Web'de (restoranpos.org) bir masaya **sipariş gir** (Türkçe karakterli ürün/not: "çğ ışöü") → **Mutfağa gönder**.
   - **FIRIN yazıcısı** fişi basmalı; Türkçe karakterler doğru çıkmalı (raster render — bozulma beklenmez).
2. **Bölünme testi (ADR-032 Amd1):** aynı adisyona bir **ızgara kategorisi** kalemi ekle (DÜRÜMLER / IZGARA ÇEŞİTLERİ / KARIŞIK IZGARA) → **IZGARA yazıcısından ayrı fiş** çıkmalı, her fişte yalnız kendi kalemleri olmalı. İçecek eklendiyse hiçbir mutfak fişinde görünmemeli (`kitchen_print=false`).
3. Aynı masada **Adisyon yazdır** → **KASA yazıcısı** adisyonu basmalı. Ardından **Adisyo'dan da bir test bas** → paylaşım korundu mu (kasa yazıcısının sürücüsüne dokunulmadığı için basmalı).
4. Üç fiş de doğru yazıcıdan ve okunaklı çıktıysa **fiş kriteri ✅**.

**Yanlış yazıcıdan çıkarsa:** artık ilk bakılacak yer config değil, **`/tanimlamalar/yazicilar` ekranı** (ADR-032 Amd2) — kategori→istasyon ataması oradan yapılır ve orada görünür. Config tarafında `jobKinds` da doğru olmalı (FIRIN `["kitchen"]`, IZGARA `["grill"]`, KASA `["bill"]`); her kind'ı beyan eden **en az bir** çalışan agent olmalı (yoksa ekranda **yetim-kuyruk uyarısı** yanar).
**Hiç basmıyorsa:** `print_jobs` kuyruğuna bak (`queued`/`failed` birikiyor mu) + servis Running mi + TCP yazıcılar için `Test-NetConnection <IP> -Port 9100`. Uçtan uca zincir sınaması: `apps/api/scripts/ops/smoke-station-routing.ts`.

## 7. İstasyon ayarları (kasiyer)

- **KDS ekranı kullanılmıyor** (S86 kullanıcı kararı: mutfak **kağıt fiş** ile çalışır). Aynı PC kasiyer istasyonudur: Chrome tam-ekran/kiosk otomatik başlatma + ekran **uyku/güç-tasarrufu KAPALI** — kurulum reçetesi `kasiyer-kiosk-kurulum.md`.

## 8. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `register failed HTTP 401` | `PRINT_AGENT_API_KEY` yanlış/iptal; değeri kontrol et, servisi yeniden başlat |
| `register` yok / `api=localhost:4001` | Env servise **nssm** ile girildi mi (Adım 2)? Sistem env servise görünmez (reboot ister). İnternet? |
| `printer fail ECONNREFUSED` | `Test-NetConnection <IP> -Port 9100`; yazıcı açık + aynı LAN mı? |
| Servis "Stopped" | Config JSON geçersiz; `stderr.log`'da zod hatası |
| Fiş yanlış yazıcıda | Önce **`/tanimlamalar/yazicilar`** kategori ataması; sonra config `jobKinds` (her türe ≥1 agent) |
| Bir kind hiç basmıyor / uyarı yanıyor | O kind'ı beyan eden agent yok veya durmuş (**yetim kuyruk**) → servisi başlat; işler kuyrukta bekler, kaybolmaz |
| Türkçe karakter bozuk | **Codepage DEĞİL** — render **raster**'dır (Amd9). Sorun render veya transport'tadır: `smoke-station-routing.ts` ile zinciri sına, `stderr.log`'a bak. *(Eski `codepage-scan.ps1` / `ESC t 29` reçetesi bu mimaride geçersiz.)* |

Kaldırma: MSI → Denetim Masası'ndan; ek servisler → `.\install-second-agent.ps1 -Uninstall`.
