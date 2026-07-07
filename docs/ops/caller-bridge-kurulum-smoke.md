# Caller ID Bridge — Kurulum & Smoke Runbook (A5)

> Donanım (CIDShow C812A USB-HID) elindeyken **bu dosyayı sırayla takip et.** Kutucukları işaretle. Caller ID **opsiyoneldir** — arızası sipariş/mutfak/kasa akışını bloklamaz.
>
> **Kaynaklar:** `apps/caller-bridge/README.md` (komut detayı) · `.claude/memory/decisions.md` ADR-016 §12 (Amd2 + Amd3).
>
> ⚠️ **Cihaz kodu donanımda henüz KANITLANMADI** (ADR-016 §12 Amd3): `cid.dll` `SetEvents` modeli vendor örneğinden çıkarım; v3'ün gerçek üretim yolu `node-hid`'di. **İlk fiziksel çağrı gerçek testtir.** Çalışmazsa → Bölüm 6 (fallback).

---

## 0. Ön-koşullar (başlamadan)

- [ ] Cihaz **USB-HID CIDShow C812A** ve restoran PC'sine (aramaların geldiği bilgisayar) **USB ile takılı**. *(Seri-modem ise DUR — kod desteklemiyor, Claude'a söyle.)*
- [ ] `cid.dll` (x64) elde: `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\cidshow_x64\cid.dll` (+ `cidshow_x86\cid.dll`). *(v3 kopyası hazır; yeni indirmeye gerek yok.)*
- [ ] Prod **`BRIDGE_TOKEN`** ayarlı. Değilse → Claude'a **"BRIDGE_TOKEN'ı ayarla"** de (SSH ile API tarafına üretip set eder; kısa `pos-api` restart). Aynı değer hem API env'inde hem bridge `appsettings.json`'ında olacak. **Token'ı sohbete yapıştırma** — `/root/pos-secrets.env`'den alınır.
- [ ] Prod **tenant UUID** (`TENANT_ID`) — `/etc/restoran-pos/api.env`'de. (Claude verebilir / SSH ile bakılır.)

> **Hangi PC?** Bridge, **C812A'nın takılı olduğu** PC'de çalışmalı. O PC'de .NET SDK + repo varsa orada publish et; yoksa SDK'lı bir makinede publish edip **çıktı klasörünü** o PC'ye kopyala (self-contained exe, hedefte .NET gerekmez).

---

## 1. Publish (self-contained tek exe)

SDK'lı makinede (repo kökünde):

```powershell
cd apps\caller-bridge\src
dotnet publish -c Release -r win-x64 --self-contained -o C:\restoran-pos\caller-bridge
```

> ⚠️ **Single-file KULLANMA** (`-p:PublishSingleFile` / `IncludeAllContentForSelfExtract`): appsettings.json'u exe'ye gömüp düzenlenebilir dosyayı görmezden gelir → servis başlangıçta `Bridge:ApiBaseUrl is required` ile çöker (S86 ampirik). Klasör-publish appsettings'i düzenlenebilir bırakır.

- [ ] `C:\restoran-pos\caller-bridge\CallerBridge.exe` (+ ~230 runtime dosyası) oluştu.

## 2. cid.dll yerleştir (⚠️ ALT-KLASÖR)

- [ ] `cid.dll` (x64) → **`C:\restoran-pos\caller-bridge\cidshow_x64\cid.dll`** (klasörü oluştur; exe ile aynı kökte **`cidshow_x64\`** alt-klasörü). *32-bit ise `cidshow_x86\`.*
- [ ] ⚠️ Düz köke (`...\caller-bridge\cid.dll`) KOYMA — kod `cidshow_x64\` bekler (ADR-016 §12 Amd3).

## 3. appsettings.json doldur

`C:\restoran-pos\caller-bridge\appsettings.json` → `Bridge` bölümü:

```json
{
  "Bridge": {
    "ApiBaseUrl": "https://restoranpos.org/api",
    "BridgeToken": "<prod BRIDGE_TOKEN ile AYNI>",
    "TenantId": "<prod TENANT_ID UUID>",
    "LineCount": 1,
    "UseMockDevice": false
  }
}
```

- [ ] **`ApiBaseUrl` `/api` ile bitiyor** (Nginx strip — çıplak domain SPA'ya düşer/404).
- [ ] `BridgeToken` = API env `BRIDGE_TOKEN` ile birebir aynı.
- [ ] `TenantId` = prod `TENANT_ID` UUID.

## 4. Servisi kur

Yönetici PowerShell:

```powershell
cd C:\restoran-pos\caller-bridge
.\install-service.ps1 -ExePath "C:\restoran-pos\caller-bridge\CallerBridge.exe"
```

- [ ] `services.msc` → **"Restoran POS — Caller ID Bridge"** durumu *Running*.

---

## 5. Smoke checklist (go/no-go — ADR-016 §12)

> Log dosyası: `C:\restoran-pos\caller-bridge\logs\caller-bridge-YYYYMMDD.log`

- [ ] **(opsiyonel) Mock ön-test** — `appsettings.json` `UseMockDevice:true` + `MockEmitEverySeconds:30` yapıp servis restart → 30 sn'de bir web'de popup + `call_log` yazılıyor mu? *(Donanımsız uçtan-uç doğrular. Sonra `UseMockDevice:false`'a geri al + restart.)*
- [ ] **Servis çökme YOK** — başlarken `FileNotFoundException` (cid.dll `cidshow_x64\`'te yok) veya `EntryPointNotFoundException` (SetEvents export yok → SDK uyumsuz) **görmemelisin**. Görürsen → Bölüm 6.
- [ ] **Tenant header 200** — gerçek bir çağrı/mock POST'unda API **400 DEĞİL** dönüyor (400 → `BridgeToken`/`TenantId` yanlış).
- [ ] **Kendini ara** → log'da **`Ring detected (phone=055******67 line=1)`** + **web'de doğru müşteri / "Bilinmeyen arayan" popup** (`tenant:{id}:caller-station` odası).
- [ ] **Maskeli platform no** (0850…) ara → **popup YOK, call_log YOK** (API bypass).
- [ ] **KVKK log denetimi** — log dosyasında **ham numara YOK**, yalnız maskeli (`055******67`).
- [ ] **Servis restart** → otomatik başlıyor + tekrar bağlanıyor.

**✅ Hepsi geçti → Caller ID CANLI.** active-plan A5 kapandı; Claude'a bildir (anchor/plan güncellenir).

---

## 6. Başarısızsa (fallback)

`EntryPointNotFoundException` **veya** cihaz doğru takılı + kendini arıyorsun ama **çağrı yakalanmıyor** (log'da `Ring detected` yok):

1. Log dosyasının ilgili kısmını **Claude'a ver** (ham numara maskeli olduğu için paylaşılabilir).
2. Bu, **`SetEvents` modelinin bu cihaz/SDK sürümünde çalışmadığı** anlamına gelir → v3'ün gerçek üretim yolu olan **`node-hid` doğrudan HID-read** muadili gerekir.
3. Bu **ayrı bir amendment + implementasyon** (ADR-016 §12 Amd3 fallback). Caller ID opsiyonel olduğundan pilot bundan etkilenmez; ister o zaman ister pilot sonrası yapılır.

---

## Notlar

- **Uzak-PC (RustDesk):** PowerShell'e uzaktan yapıştırma **karakterleri çiftleyebilir** — özellikle token/UUID'yi elle kontrol et ([[feedback_windows_service_env_visibility]]).
- **`cid.dll` repoya girmez** (lisans + ikili). Bu runbook yalnız yerleşimi tarif eder.
- **Popup sadece primary station'a** gider (broadcast yok); garson mobiline düşmez (ADR-016 Karar 5).
