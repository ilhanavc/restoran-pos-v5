# Caller Bridge (.NET 8 Worker Service)

CIDShow **C812A** USB-HID caller-id donanımını dinler, gelen her aramayı POS API'sine iletir.

- ADR: `.claude/memory/decisions.md` — ADR-016 §Karar 1
- Servis adı (Windows): `restoran-pos-caller-bridge`
- Endpoint: `POST {ApiBaseUrl}/bridge/caller-id/incoming` — `X-Bridge-Token` + `X-Tenant-Id` header. **`cb1_` köprü anahtarıyla** (ADR-052, tenant'a bağlı): tenant anahtarın kendisinden çözülür, `X-Tenant-Id` isteğe bağlıdır ama gelirse anahtarın tenant'ına **eşit olmalı** (değilse 401). **Geçiş dönemi — eski ortak `BRIDGE_TOKEN`:** `X-Tenant-Id` zorunlu ve yalnız API'nin `TENANT_ID`'si (canlı restoran) kabul edilir; ADR-052 PR-5'te kalkar. Köprü başlığı her zaman gönderir (`TenantId` yapılandırmada zorunlu).
- Body: `{ rawPhone, lineNumber, receivedAt }` — telefon **normalize edilmez**, API normalize eder

## Mimari

```
[C812A USB-HID] ──cid.dll──▶ CidShowDevice (P/Invoke poll)
                                 │ event
                                 ▼
                          Channel<Incoming>  (bounded, drop-oldest)
                                 │
                                 ▼
                          BridgeApiClient ──HTTPS──▶ POS API
                          (Polly retry: 1s/2s/4s)
```

`ICallerIdDevice` arayüzü iki implementasyonla: gerçek `CidShowDevice` (Windows-only, P/Invoke) ve `MockCallerIdDevice` (dev/test, opsiyonel periyodik fake call). Linux/macOS host otomatik mock'a düşer.

## KVKK / loglama

`Logging/PhoneMasking.cs` → telefon her zaman `055******67` formatında loglanır. Log dosyası **servis çalıştırılabilirinin yanındaki** `logs/caller-bridge-YYYYMMDD.log` (Serilog rolling, 14 gün retention, 10 MB rollover). Windows servis olarak çalışırken CWD `System32` olur; `Program.cs` başlangıçta CWD'yi exe klasörüne sabitler, aksi halde loglar `System32\logs`'a düşerdi.

> **Loglar `C:\Windows\System32\logs`'ta çıkıyorsa** (bu düzeltmeden önce publish edilmiş eski bir sürüm): ya yeniden publish et (kalıcı çözüm) ya da dükkan PC'sinde `appsettings.json` → `Serilog:WriteTo:File:Args:path` değerini mutlak yola çevir + `Restart-Service restoran-pos-caller-bridge`:
>
> ```json
> "path": "C:\\restoran-pos\\caller-bridge\\logs\\caller-bridge-.log"
> ```

## Geliştirme

### Önkoşullar

- .NET 8 SDK (`dotnet --version` ≥ 8.0)
- Windows 10+ (gerçek donanım için); Linux/macOS sadece mock modda

### Build & test

```bash
cd apps/caller-bridge
dotnet restore
dotnet build
dotnet test
```

### Mock modda çalıştır (dev)

```bash
cd apps/caller-bridge/src
dotnet run --environment Development
```

`appsettings.Development.json` içinde:
- `UseMockDevice: true`
- `MockEmitEverySeconds: 30` → 30 sn'de bir sahte arama emit eder

## Production deploy (Windows)

### 1. Self-contained publish

```powershell
cd apps\caller-bridge\src
dotnet publish -c Release -r win-x64 --self-contained -o C:\restoran-pos\caller-bridge
```

> ⚠️ **Single-file KULLANMA** (`-p:PublishSingleFile` / `IncludeAllContentForSelfExtract`): appsettings.json'u exe'ye gömüp exe yanındaki düzenlenebilir dosyayı görmezden gelir → servis başlangıçta `Bridge:ApiBaseUrl is required` ile çöker (S86'da ampirik doğrulandı). Klasör-publish appsettings'i exe yanında **düzenlenebilir** bırakır.

### 2. cid.dll yerleşimi

CIDShow SDK'sından `cid.dll`'i **`CallerBridge.exe` yanındaki `cidshow_x64\` alt-klasörüne** kopyala (32-bit ise `cidshow_x86\`). ⚠️ Kod bu alt-klasör yolunu bekler (`cidshow_x64\cid.dll`), düz kök DEĞİL (ADR-016 §12 Amd3). Not: v3 kopyası hazır — `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\cidshow_x64\cid.dll` (+x86).

> ⚠️ `cid.dll` repoya commit'lenmez (lisans + ikili dosya). Operasyon notu: SDK CD'sinden veya satıcı portalından alınır.

### 3. appsettings.json düzenle

```json
{
  "Bridge": {
    "ApiBaseUrl": "https://restoranpos.org/api",
    "BridgeToken": "<cb1_… — caller-bridge-key.ts ile üretilen dosyadan>",
    "TenantId": "<bu restoranın tenant UUID'si — anahtarın tenant'ıyla aynı>",
    "LineCount": 1,
    "UseMockDevice": false
  }
}
```

> ⚠️ **`ApiBaseUrl` sonundaki `/api` ŞART.** Nginx `/api/` prefix'ini strip eder (`deploy.md` §1), API route'ları root-mount edilir → istek `…/api/bridge/caller-id/incoming` gider, API `/bridge/caller-id/incoming` görür. Çıplak `https://restoranpos.org` verilirse istek SPA'ya düşer (404) ve köprü **sessizce** başarısız olur.
>
> ⚠️ **`BridgeToken` = o restoranın `cb1_` anahtarı** (ADR-052): sunucuda `apps/api/scripts/caller-bridge-key.ts issue` ile üretilir, yalnız **dosyaya** yazılır, dükkân PC'sine RustDesk **dosya aktarma** ile taşınır, `.ps1` ile yazılır — **asla yapıştırılmaz** (reçete `docs/ops/deploy.md` §12.5). Biçim: `cb1_<32 küçük harf hex>_<43 karakter>` = 80 karakter. `TenantId` = aynı restoranın tenant UUID'si; anahtarın tenant'ından farklıysa **401**. Köprü `TenantId` boşsa açılmaz (ctor guard).
>
> ℹ️ **Geçiş dönemi:** canlı restoran (ADR-052 K7 C adımına kadar) hâlâ eski ortak `BRIDGE_TOKEN` ile çalışabilir; o dalda `TenantId` = `/etc/restoran-pos/api.env` `TENANT_ID` olmak **zorunda** (başka tenant → 401, eksik/bozuk başlık → 400). Yeni müşteriye eski ortak değer **verilmez**.

### 4. Servis kur

Yönetici PowerShell:

```powershell
cd C:\restoran-pos\caller-bridge
.\install-service.ps1 -ExePath "C:\restoran-pos\caller-bridge\CallerBridge.exe"
```

`services.msc` → "Restoran POS — Caller ID Bridge" görünmeli, durum *Running*.

### 5. Doğrulama

- C812A USB'yi tak, telefondan kendini ara
- `logs\caller-bridge-YYYYMMDD.log`'da `Ring detected (phone=055******67 line=1)` ve `Incoming call posted` görmelisin
- API tarafında `tenant:{id}:caller-station` Socket.IO room'una emit gitmeli

## P/Invoke notu (önemli — ADR-016 §12 Amendment 3)

`Devices/CidShowDevice.cs` gerçek `cid.dll` modelini kullanır: **tek export `SetEvents(callerIdCb, signalCb)`** (cdecl, BSTR, callback-push). DLL her çağrıyı callback ile **iter** — poll yok. İmzalar v3 StoreBridge helper'ının kanıtlı yüzeyini yansıtır. (Eski `cidOpen/cidIsRing/...` polling yüzeyi UYDURMAYDI, kaldırıldı.)

> ✅ **Donanımda DOĞRULANDI (2026-07-16, C12-A-01 kapandı):** SetEvents cdecl/BStr imzası fiziksel **C812A (seri 4C27A9624)** üzerinde gerçek çağrılarla ampirik teyit edildi — `CidShowDevice registered SetEvents` + `Ring detected (phone=053******NN line=2)` + `Incoming call posted` + `call_logs` satırı + web popup, uçtan uca. Bu build (#294 SetEvents + #307 Serilog-CWD + #362 W12) dükkan PC'sinde canlı. Gözlem: cihaz her çalmada `Ring detected`'ı çift tetikleyebiliyor (ms-arayla); API 5s dedupe tek kayda indirir — davranış doğru. Kullanılmayan hat aktivitesi (ahize/dış arama) `CidShow signal` logu üretir ama çağrı POST edilmez — tasarım gereği.

İlk donanım bağlantısında servis başlarken hata verirse:
- `cid.dll` `cidshow_x64\` alt-klasörüne (x64, 32-bit değil) yerleşti mi? (`FileNotFoundException`)
- `SetEvents` export bulunamadı → SDK sürümü uyumsuz (`EntryPointNotFoundException`)
- USB cihaz bağlı, sürücü yüklü mü? (`Device Manager` → HID-compliant device)
- Servis hesabının USB erişimi var mı? (LocalSystem yeterli)

## Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Servis 1 sn sonra durur | `appsettings.json`'da `ApiBaseUrl`/`BridgeToken`/`TenantId` eksik (ctor guard atar) | Üçünü de doldur, `Restart-Service restoran-pos-caller-bridge` |
| Servis başlarken `FileNotFound`/`EntryPointNotFound` | `cid.dll` `cidshow_x64\`'te yok / SDK uyumsuz | x64 cid.dll'i `cidshow_x64\` alt-klasörüne koy; `SetEvents` export'unu doğrula |
| API'ye gidiyor ama **400** | Yalnız eski ortak `BRIDGE_TOKEN` dalında: `TenantId` eksik/biçimce bozuk (`requireTenantHeader`) | `appsettings.json` `TenantId` = API `TENANT_ID` UUID; servisi yeniden başlat. Kalıcı çözüm: `cb1_` anahtarına geç (`deploy.md` §12.5) |
| API'ye gidiyor ama **401** (`BRIDGE_TOKEN_INVALID`) | Tek tip hata, sebebini bilerek söylemez: `cb1_` anahtarı **iptal edilmiş** (`revoke`) · rotasyon sonrası **grace'i dolmuş** eski anahtar · biçim bozuk (kopyala-yapıştır/boşluk) · `TenantId` anahtarın tenant'ından **farklı** · eski ortak token'la `TenantId` ≠ canlı `TENANT_ID` | Sunucuda o tenant'ın anahtarlarına bak (`deploy.md` §12.5 sorgusu): kullanılabilir anahtar yoksa `issue`, varsa ama köprüdeki o değilse `rotate` → yeni dosyayı `.ps1` ile yaz → `Restart-Service restoran-pos-caller-bridge` → test araması + `last_used_at` taze. API log'unda (`pos-api-out.log`) `caller_id.bridge.key_rejected` / `caller_id.bridge.legacy_tenant_rejected` satırı görünür || Log dosyası büyümüyor | Serilog conf eksik veya yazma izni yok | Servis hesabı `logs\` klasörüne yazabiliyor mu? |
