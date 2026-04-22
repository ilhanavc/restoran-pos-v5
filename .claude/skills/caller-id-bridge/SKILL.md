---
name: caller-id-bridge
description: Use when integrating Caller ID hardware devices with the POS system. Covers PowerShell-based bridge pattern (proven from v3), local HTTP endpoint, broadcast mode duplicate filtering, and future C# SDK migration path.
---

# Caller ID Entegrasyonu

Paket servis operasyonu için gelen aramalardan telefon numarasını çekip müşteriyi tanımlama altyapısı.

## Mimari

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Caller ID cihazı│────▶│  CIDSHOW TEST    │────▶│ PowerShell bridge│
│  (USB/seri)      │     │  (vendor app)    │     │ (watch + forward)│
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                            │
                                                            ▼ HTTP POST
                                         ┌──────────────────────────────┐
                                         │ Ana bilgisayar local Express │
                                         │ POST /api/caller-id/incoming │
                                         └──────────────────────────────┘
                                                            │
                                         ┌──────────────────▼───────────┐
                                         │ Match customer / show popup  │
                                         │ in waiter & cashier UI       │
                                         └──────────────────────────────┘
```

## PowerShell bridge script

v3'ten proven solution. CIDSHOW TEST uygulaması clipboard'a telefon numarasını yazar. PowerShell script'i clipboard'ı izler ve değişiklik olduğunda local endpoint'e iletir.

`scripts/caller-id-bridge.ps1`:

```powershell
param(
    [string]$Endpoint = "http://localhost:3001/api/caller-id/incoming",
    [string]$DeviceId = "main-pc"
)

Add-Type -AssemblyName System.Windows.Forms

$lastValue = ""
$lastTime = [DateTime]::MinValue
$dedupeWindow = [TimeSpan]::FromSeconds(3)

Write-Host "Caller ID Bridge başlatıldı"
Write-Host "Endpoint: $Endpoint"

while ($true) {
    try {
        $currentValue = [System.Windows.Forms.Clipboard]::GetText()
        $now = Get-Date

        # Telefon numarası formatında mı? (basit check)
        if ($currentValue -match '^\+?\d{10,15}$' -or $currentValue -match '^0\d{10}$') {
            $elapsed = $now - $lastTime

            # Duplicate filter: aynı numara 3 saniye içinde tekrarlarsa yok say
            if ($currentValue -ne $lastValue -or $elapsed -gt $dedupeWindow) {
                Write-Host "Yeni çağrı: $currentValue"

                $body = @{
                    phoneNumber = $currentValue
                    deviceId = $DeviceId
                    receivedAt = $now.ToUniversalTime().ToString("o")
                } | ConvertTo-Json

                try {
                    Invoke-RestMethod -Uri $Endpoint `
                        -Method POST `
                        -Body $body `
                        -ContentType "application/json" `
                        -TimeoutSec 5
                    Write-Host "İletildi"
                } catch {
                    Write-Warning "İletim başarısız: $_"
                    # Kuyruğa alma: local dosyaya yaz, sonra tekrar dene
                    $failPath = "$env:LOCALAPPDATA\RestoranPOS\caller-id-failed.log"
                    Add-Content -Path $failPath -Value "$now | $currentValue"
                }

                $lastValue = $currentValue
                $lastTime = $now
            }
        }
    } catch {
        Write-Warning "Hata: $_"
    }

    Start-Sleep -Milliseconds 250
}
```

## Neden clipboard pattern?

v3'te HID, C# DLL ve UI Automation yaklaşımları denendi. Hepsinde sorun:
- HID: donanıma özel driver uyumsuzlukları
- C# DLL: yönetim zor, signature verification karmaşık
- UI Automation: yavaş, frame kaybı

Clipboard pattern işe yaradı çünkü:
- CIDSHOW TEST (yaygın Türk pazarı vendor app'i) zaten clipboard'a yazıyor
- PowerShell native, ek dependency yok
- Duplicate filter basit

## Ana bilgisayar tarafında

```typescript
// apps/desktop/src/main/api/caller-id.ts
import { Router } from 'express';
import { z } from 'zod';
import { matchCustomer } from '../../domain/customer';
import { broadcastToClients } from '../realtime';

const IncomingCallSchema = z.object({
  phoneNumber: z.string().regex(/^\+?\d{10,15}$|^0\d{10}$/),
  deviceId: z.string(),
  receivedAt: z.string().datetime(),
});

export const callerIdRouter = Router();

callerIdRouter.post('/incoming', async (req, res) => {
  const result = IncomingCallSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const { phoneNumber, receivedAt } = result.data;
  const normalized = normalizePhoneNumber(phoneNumber); // +90 prefix

  // Müşteri eşleştirme
  const customer = await matchCustomer(normalized);

  // Event log (KVKK aware — opt-in varsa)
  await logCallEvent({
    phoneNumber: normalized,
    customerId: customer?.id ?? null,
    receivedAt,
  });

  // Realtime broadcast: kasiyer UI + garson mobilleri
  broadcastToClients('caller-id:incoming', {
    phoneNumber: normalized,
    customer: customer ?? null,
    receivedAt,
  });

  res.json({ ok: true });
});
```

## KVKK uyumu

Caller ID verisi **kişisel veri**. Kurallar:

- [ ] Açık rıza alınmalı (müşteri kayıt ekranında onay kutusu)
- [ ] Retention period tanımlı: 6 ay (opt-in varsa 2 yıl)
- [ ] Rıza olmayan çağrılar: telefon numarası ekranda gösterilir ama DB'ye kalıcı yazılmaz
- [ ] "Beni unut" talebi → ilgili tüm kayıtlar silinir (veya anonymize edilir)
- [ ] Log'lar: son 4 hane dışındaki kısım hash veya mask

```typescript
function maskPhoneForLog(phone: string): string {
  // +905551234567 → +90 555 *** ** 67
  return phone.replace(/(\+\d{2}\s?\d{3})\s?\d{3}\s?\d{2}\s?(\d{2})/, '$1 *** ** $2');
}
```

## Başlatma

Windows servisi olarak veya startup script ile:

```powershell
# Task Scheduler'a ekle (admin olmadan çalışabilir)
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -File C:\RestoranPOS\caller-id-bridge.ps1"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "RestoranPOS Caller ID Bridge" `
  -Action $action -Trigger $trigger -RunLevel Limited
```

## Garson mobil entegrasyonu

Caller ID çağrısı geldiğinde WebSocket üzerinden garson mobiline de push edilir (isteğe bağlı: müdür aktif ederse):

```typescript
// Mobilde
socket.on('caller-id:incoming', (data) => {
  showCallerPopup({
    phone: data.phoneNumber,
    customerName: data.customer?.fullName ?? 'Bilinmeyen arayan',
    lastOrders: data.customer?.recentOrders ?? [],
    deliveryAddress: data.customer?.defaultAddress,
  });
});
```

## Gelecek: C# SDK

v2'de resmi C# SDK yazılacak:
- Yerel yazılım — Windows service
- Clipboard yerine doğrudan cihaz seri portundan okuma (daha stable)
- Authentication ile ana bilgisayara bağlanma (token-based)
- Multiple simultaneous calls (hat başına caller ID)

Şimdilik PowerShell bridge yeterli + kanıtlanmış.

## Test senaryoları

- [ ] Bilinen müşteri çağrısı → popup doğru bilgi ile
- [ ] Yeni çağrı → "Bilinmeyen arayan" + hızlı kayıt formu
- [ ] Aynı numara 3 saniye içinde ikinci kez → tek kayıt (dedupe)
- [ ] Endpoint 500 döndürdü → PowerShell failed.log'a yazdı
- [ ] Endpoint unreachable → retry 3x sonra dead letter
- [ ] KVKK: rıza yok → gösterir, DB'ye yazmaz
- [ ] "Beni unut" → tüm geçmiş silinir

## Desteklenen cihazlar

Test edilen ve çalışan Caller ID cihazları:
- CIDSHOW TEST yazılımı destekleyen her model (çoğu Çin üretimi)
- Seri port tabanlı klasik caller ID modem'ler

Test edilmemiş model → önce QA ortamında dene, sonra prod.
