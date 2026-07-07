# Caller Bridge (.NET 8 Worker Service)

CIDShow **C812A** USB-HID caller-id donanımını dinler, gelen her aramayı POS API'sine iletir.

- ADR: `.claude/memory/decisions.md` — ADR-016 §Karar 1
- Servis adı (Windows): `restoran-pos-caller-bridge`
- Endpoint: `POST {ApiBaseUrl}/bridge/caller-id/incoming` — `X-Bridge-Token` + `X-Tenant-Id` header (ikisi de zorunlu — API `requireBridgeToken` + `requireTenantHeader`, ADR-016 §12 Amd2)
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

`Logging/PhoneMasking.cs` → telefon her zaman `055******67` formatında loglanır. Log dosyası `logs/caller-bridge-YYYYMMDD.log` (Serilog rolling, 14 gün retention, 10 MB rollover).

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
dotnet publish -c Release -r win-x64 --self-contained `
  -p:PublishSingleFile=true `
  -p:IncludeAllContentForSelfExtract=true `
  -o C:\restoran-pos\caller-bridge
```

### 2. cid.dll yerleşimi

CIDShow SDK'sından `cid.dll`'i **`CallerBridge.exe` yanındaki `cidshow_x64\` alt-klasörüne** kopyala (32-bit ise `cidshow_x86\`). ⚠️ Kod bu alt-klasör yolunu bekler (`cidshow_x64\cid.dll`), düz kök DEĞİL (ADR-016 §12 Amd3). Not: v3 kopyası hazır — `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\cidshow_x64\cid.dll` (+x86).

> ⚠️ `cid.dll` repoya commit'lenmez (lisans + ikili dosya). Operasyon notu: SDK CD'sinden veya satıcı portalından alınır.

### 3. appsettings.json düzenle

```json
{
  "Bridge": {
    "ApiBaseUrl": "https://restoranpos.org/api",
    "BridgeToken": "<BRIDGE_TOKEN — API env ile aynı>",
    "TenantId": "<tenant UUID — API env TENANT_ID ile aynı>",
    "LineCount": 1,
    "UseMockDevice": false
  }
}
```

> ⚠️ **`ApiBaseUrl` sonundaki `/api` ŞART.** Nginx `/api/` prefix'ini strip eder (`deploy.md` §1), API route'ları root-mount edilir → istek `…/api/bridge/caller-id/incoming` gider, API `/bridge/caller-id/incoming` görür. Çıplak `https://restoranpos.org` verilirse istek SPA'ya düşer (404) ve köprü **sessizce** başarısız olur.
>
> ⚠️ `TenantId` eksik/geçersizse API `requireTenantHeader` → **400** döner (ADR-016 §12 Amd2). Prod'da `BridgeToken` = `/etc/restoran-pos/api.env` `BRIDGE_TOKEN`, `TenantId` = aynı dosyadaki `TENANT_ID` UUID.

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

> ⚠️ **Doğrulanmamış:** SetEvents cdecl/BStr imzası vendor örneklerinden çıkarım; donanımda henüz kanıtlanmadı. İlk fiziksel çağrı gerçek testtir. Çalışmazsa fallback = doğrudan HID-read (ayrı amendment).

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
| API'ye gidiyor ama **400** | `TenantId` eksik/geçersiz (`requireTenantHeader`) | `appsettings.json` `TenantId` = API `TENANT_ID` UUID; servisi yeniden başlat |
| API'ye gidiyor ama 401/403 | `BridgeToken` API `BRIDGE_TOKEN` ile uyuşmuyor | Token'ları eşitle; `Restart-Service restoran-pos-caller-bridge` |
| Log dosyası büyümüyor | Serilog conf eksik veya yazma izni yok | Servis hesabı `logs\` klasörüne yazabiliyor mu? |
