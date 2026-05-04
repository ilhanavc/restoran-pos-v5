# Caller Bridge (.NET 8 Worker Service)

CIDShow **C812A** USB-HID caller-id donanımını dinler, gelen her aramayı POS API'sine iletir.

- ADR: `.claude/memory/decisions.md` — ADR-016 §Karar 1
- Servis adı (Windows): `restoran-pos-caller-bridge`
- Endpoint: `POST {ApiBaseUrl}/bridge/caller-id/incoming` — `X-Bridge-Token` header
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

CIDShow SDK'sından (`update_DLL_x64-x86\cidshow_x64\`) **x64** sürümünü `C:\restoran-pos\caller-bridge\` klasörüne kopyala. `CallerBridge.exe` ile aynı dizinde olmalı.

> ⚠️ `cid.dll` repoya commit'lenmez (lisans + ikili dosya). Operasyon notu: SDK CD'sinden veya satıcı portalından alınır.

### 3. appsettings.json düzenle

```json
{
  "Bridge": {
    "ApiBaseUrl": "https://api.restoran.example",
    "BridgeToken": "<API tarafından üretilen tenant-bound token>",
    "LineCount": 1,
    "UseMockDevice": false
  }
}
```

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

## P/Invoke notu (önemli)

`Devices/CidShowDevice.cs` içindeki dört export — `cidOpen`, `cidClose`, `cidIsRing`, `cidGetCallerNumber` — vendor C# örneklerinden (`cidshow_CSharp_x64_x86\cidshow_CSharpAnyCPU\`) türetildi. SDK güncellemesinde imza değişirse **sadece bu dosyayı** güncelle; çağıran kod aynı kalır.

İlk donanım bağlantısında `cidOpen` `rc != 0` döndürürse:
- `cid.dll` x64 (32-bit değil) yerleştirildi mi?
- USB cihaz bağlı, sürücü yüklü mü? (`Device Manager` → HID-compliant device)
- Servis hesabının USB'ye erişim hakkı var mı? (LocalSystem yeterli)

## Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Servis 1 sn sonra durur | `appsettings.json`'da `BridgeToken` veya `ApiBaseUrl` eksik | Doldur, `Restart-Service restoran-pos-caller-bridge` |
| Logda `cidOpen failed (rc=...)` | DLL bulunamadı / USB yok | x64 cid.dll yerleştir, USB'yi yeniden tak |
| API'ye gidiyor ama 401 | Token tenant ile uyuşmuyor | Admin paneli → Bridge Token regenerate |
| Log dosyası büyümüyor | Serilog conf eksik veya yazma izni yok | Servis hesabı `logs\` klasörüne yazabiliyor mu? |
