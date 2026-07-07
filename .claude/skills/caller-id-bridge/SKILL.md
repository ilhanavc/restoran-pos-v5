---
name: caller-id-bridge
description: Use when integrating or troubleshooting the Caller ID hardware bridge (CIDShow C812A USB-HID → POS API). v5 = .NET 8 Windows Service in apps/caller-bridge (NOT the v3 PowerShell/clipboard pattern). Covers the API contract (X-Bridge-Token + X-Tenant-Id, /api prefix), KVKK phone masking, and the pilot go/no-go gate.
---

# Caller ID Köprüsü (v5)

Paket servis için gelen aramalardan ham telefon numarasını çekip POS API'sine iletir; API müşteriyi eşleştirip primary station'a popup push eder.

> **Tek doğru kaynak:** [`apps/caller-bridge/README.md`](../../../apps/caller-bridge/README.md) (as-built + deploy) ve `.claude/memory/decisions.md` → **ADR-016 Karar 1 + §12 Amendment 2** (pilot cutover + donanım kilidi). Bu skill yalnız hızlı yönlendirme; çelişki olursa README + ADR kazanır.

## ⚠️ v3 → v5 değişti — eski varsayımlar YANLIŞ

Bu skill v3 hafızasına dayanıyordu; v5'te geçersiz. Aşağıdakileri **YAPMA**:

| v3 (artık geçersiz) | v5 gerçeği |
|---|---|
| PowerShell clipboard-poll bridge | **.NET 8 Worker Service** (`apps/caller-bridge/`), `cid.dll` P/Invoke event modeli — clipboard yok (ADR-016 §12 A2.1) |
| `apps/desktop/...` Express (Electron) | Electron yok (CLAUDE.md); API = `apps/api` (Express, cloud/Hetzner) |
| Endpoint `POST /api/caller-id/incoming` | Gerçek: `POST {ApiBaseUrl}/bridge/caller-id/incoming` (`/caller-id/*` = web CRUD, ayrı) |
| Body `{ phoneNumber, deviceId }` | Gerçek: `{ rawPhone, lineNumber?, receivedAt }` (`BridgeIncomingCallSchema`) |
| Broadcast to all clients | Tek primary station room (`tenant:{id}:caller-station`); broadcast yok (Karar 5) |
| Açık rıza + 6 ay / opt-in 2 yıl retention | Ham telefon 30 gün retention cron; rıza-kapısı yok, maskeleme + minimizasyon |

## Mimari (v5)

```
[CIDShow C812A USB-HID] ──cid.dll (P/Invoke poll)──▶ CidShowDevice
        │                                               │ IncomingCallEvent
        │ (mock: MockCallerIdDevice, non-Windows/dev)   ▼
        │                                    Channel<>(128, DropOldest)
        │                                               ▼
        │                            BridgeApiClient ──HTTPS──▶ POS API
        │                            (Polly retry 1s/2s/4s, timeout 10s)
```

Filtreleme/normalize/dedupe **API'de** (`isMaskedNumber` bypass, `findRecentDuplicate` 5s) — köprü HAM gönderir, güvenilmez. Köprü yalnız **log'da** maskeler (`PhoneMasking` → `055******67`); KVKK: ham numara asla `Log*` çağrısına girmez.

## Donanım kilidi (go/no-go — [USER] doğrular)

- Varsayım: **USB-HID CIDShow C812A**, `cid.dll` (`cidOpen/cidClose/cidIsRing/cidGetCallerNumber`). COM/serial port AÇMAZ, AT/`RING`/`NMBR=` parse ETMEZ.
- **⚠️ Restoranda RJ11 seri-modem çıkarsa DUR:** `cid.dll` yolu geçersiz → yeni `ICallerIdDevice` (`SerialPort` + AT parse) = **ayrı amendment** (kapsam kilidi). Pilot bu teyit olmadan başlamaz (ADR-016 §12 A2.2).
- `cid.dll` P/Invoke imzaları vendor örneğinden türetildi, fiziksel C812A'da **`Doğrulanmamış:`** — ilk donanım bağlantısında teyit edilecek.

## API iletim kontratı

- `POST {ApiBaseUrl}/bridge/caller-id/incoming`
- Header: `X-Bridge-Token` (shared secret) **+** `X-Tenant-Id` (tenant UUID) — **ikisi de zorunlu**; biri eksikse **400** (`requireBridgeToken` + `requireTenantHeader` zinciri). Bu S85'te düzeltilen sessiz kontrat kırığıydı (ADR-016 §12 A2.3).
- Body: `{ rawPhone: string(1..30), lineNumber?: int(1..8), receivedAt: ISO-8601 }`. Yanıt her durumda **200** `{ accepted, reason?, callLogId? }` — köprü yalnız `IsSuccessStatusCode`'a bakar.
- **`ApiBaseUrl` `/api` ile biter** (örn `https://restoranpos.org/api`): Nginx `/api` strip'ler (`deploy.md` §1). Çıplak domain → SPA'ya düşer, sessiz fail.

## Deploy + go/no-go

`README.md` §Production deploy: `dotnet publish -c Release -r win-x64 --self-contained` → `cid.dll` x64 elle kopyala → `install-service.ps1`. Prod env: `BRIDGE_TOKEN` + `TENANT_ID` (`/etc/restoran-pos/api.env`; bridge `appsettings.json` ile eşleş). WiX bundle (Print Agent + bridge tek installer) = **v5.1**.

Pilot go/no-go checklist (donanım eşliğinde): ADR-016 §12 A2 sonundaki 8 kalem — mock smoke → tenant-header 200 → `cidOpen rc==0` → kendini ara (masked log + popup) → maskeli-no bypass → KVKK log denetimi → servis restart auto-start.
