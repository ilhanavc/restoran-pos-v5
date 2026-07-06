#Requires -RunAsAdministrator
<#
.SYNOPSIS
  ADR-032 — Aynı restoran PC'sinde İKİNCİ bir Print Agent servisi kaydeder
  (mutfak / kasa yazıcı ayrımı için).

.DESCRIPTION
  MSI birincil servisi (`RestoranPosPrintAgent`, config
  `%PROGRAMDATA%\restoran-pos\print-agent.json`) kurar. İki yazıcı = 2 agent
  instance (1:1 agent↔yazıcı) olduğundan, ikinci yazıcı için bu script AYNI
  `print-agent.exe`'yi kullanan ayrı bir nssm servisi kaydeder — farklı config
  dosyası (`PRINT_AGENT_CONFIG_PATH`) + farklı device fingerprint
  (`PRINT_AGENT_DEVICE_FINGERPRINT`) + ayrı log ile. İki agent aynı tenant'a
  ayrı `agents` satırlarıyla register olur; claim'de `?kind=` (config'teki
  `jobKinds`) ile ayrışırlar (ADR-032).

  Cloud env (`PRINT_AGENT_API_URL` / `PRINT_AGENT_API_KEY`): SİSTEM düzeyinde
  set edildiyse LocalSystem servisi otomatik miras alır. Emin olmak için
  `-ApiUrl` / `-ApiKey` ile servise özel de gömülebilir.

  ÖN KOŞUL: Önce MSI kurulmuş olmalı (print-agent.exe + nssm.exe install
  dizininde). Yönetici (Administrator) PowerShell gerekir.

.PARAMETER ServiceName
  İkinci servisin adı. Varsayılan: RestoranPosPrintAgentBill

.PARAMETER ConfigPath
  İkinci agent'ın config dosyası yolu.
  Varsayılan: %PROGRAMDATA%\restoran-pos\print-agent-bill.json

.PARAMETER JobKinds
  Config taslağı yazılırsa `jobKinds` alanı. Varsayılan: bill
  (mutfak için: -JobKinds kitchen). Config dosyası zaten varsa dokunulmaz.

.PARAMETER DeviceFingerprint
  Cihaz parmak izi (tenant içinde UNIQUE olmalı). Varsayılan: <PC-adı>-bill

.PARAMETER ApiUrl
  (Opsiyonel) PRINT_AGENT_API_URL — verilirse servise özel set edilir.

.PARAMETER ApiKey
  (Opsiyonel) PRINT_AGENT_API_KEY — verilirse servise özel set edilir.

.PARAMETER InstallDir
  print-agent.exe + nssm.exe konumu.
  Varsayılan: %PROGRAMFILES%\Restoran POS\Print Agent

.PARAMETER Uninstall
  İkinci servisi durdurup kaldırır (config + log KORUNUR).

.EXAMPLE
  # Kasa (USB) agent'ını ekle — bill işlerini basar:
  .\install-second-agent.ps1

.EXAMPLE
  # API bilgilerini servise özel gömerek:
  .\install-second-agent.ps1 -ApiUrl "https://restoranpos.org/api" -ApiKey "pk_xxx_yyy"

.EXAMPLE
  # İkinci agent mutfak olsun (birincil kasa ise):
  .\install-second-agent.ps1 -JobKinds kitchen -ServiceName RestoranPosPrintAgentKitchen -DeviceFingerprint "$env:COMPUTERNAME-kitchen"

.EXAMPLE
  # Kaldır:
  .\install-second-agent.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$ServiceName = 'RestoranPosPrintAgentBill',
  [string]$ConfigPath = "$env:PROGRAMDATA\restoran-pos\print-agent-bill.json",
  [ValidateSet('kitchen', 'bill')]
  [string]$JobKinds = 'bill',
  [string]$DeviceFingerprint = "${env:COMPUTERNAME}-bill",
  [string]$ApiUrl,
  [string]$ApiKey,
  [string]$InstallDir = "$env:PROGRAMFILES\Restoran POS\Print Agent",
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$nssm = Join-Path $InstallDir 'nssm.exe'
$exe = Join-Path $InstallDir 'print-agent.exe'

if (-not (Test-Path $nssm)) {
  throw "[second-agent] nssm.exe bulunamadi: $nssm — once MSI'i kurun (RestoranPosPrintAgent)."
}

# --- Kaldırma yolu ---
if ($Uninstall) {
  if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Host "[second-agent] $ServiceName zaten kayitli degil — yapilacak sey yok."
    return
  }
  Write-Host "[second-agent] $ServiceName durduruluyor + kaldiriliyor..."
  & $nssm stop $ServiceName confirm 2>$null | Out-Null
  & $nssm remove $ServiceName confirm
  Write-Host "[second-agent] $ServiceName kaldirildi. (config + log KORUNDU: $ConfigPath)"
  return
}

# --- Kurulum yolu ---
if (-not (Test-Path $exe)) {
  throw "[second-agent] print-agent.exe bulunamadi: $exe — once MSI'i kurun."
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Warning "[second-agent] $ServiceName zaten kayitli. Once '-Uninstall' calistirin veya farkli '-ServiceName' verin."
  return
}

# Config + log dizinleri
$dataDir = Split-Path -Parent $ConfigPath
$logDir = Join-Path $env:PROGRAMDATA 'restoran-pos\logs'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# Config dosyasi yoksa taslak yaz (USB placeholder + jobKinds). Kullanici
# printer alanlarini (vendorId/productId veya TCP host) doldurmali.
if (-not (Test-Path $ConfigPath)) {
  $template = @"
{
  "printer": { "type": "usb", "vendorId": 0, "productId": 0, "timeoutMs": 10000 },
  "jobKinds": ["$JobKinds"]
}
"@
  Set-Content -Path $ConfigPath -Value $template -Encoding UTF8
  Write-Warning "[second-agent] Config taslagi yazildi: $ConfigPath"
  Write-Warning "[second-agent] -> printer alanlarini (USB vendorId/productId VEYA TCP host/port) DOLDURUN, sonra: Restart-Service $ServiceName"
}

$logStdout = Join-Path $logDir "$ServiceName-stdout.log"
$logStderr = Join-Path $logDir "$ServiceName-stderr.log"

Write-Host "[second-agent] $ServiceName kaydediliyor (exe=$exe)..."
& $nssm install $ServiceName $exe
& $nssm set $ServiceName DisplayName "Restoran POS Print Agent (2. yazici: $JobKinds)"
& $nssm set $ServiceName Description "ADR-032 ikincil yazici agent'i — config jobKinds ile filtrelenmis is turlerini basar."
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName ObjectName LocalSystem
& $nssm set $ServiceName AppStdout $logStdout
& $nssm set $ServiceName AppStderr $logStderr

# Per-servis env: config path + device fingerprint (+ opsiyonel API bilgileri).
# nssm AppEnvironmentExtra sistem env'e EKLER (API_URL/KEY sistem duzeyindeyse
# ayrica gerek yok); her KEY=VALUE ayri arg.
$envPairs = @(
  "PRINT_AGENT_CONFIG_PATH=$ConfigPath",
  "PRINT_AGENT_DEVICE_FINGERPRINT=$DeviceFingerprint"
)
if ($ApiUrl) { $envPairs += "PRINT_AGENT_API_URL=$ApiUrl" }
if ($ApiKey) { $envPairs += "PRINT_AGENT_API_KEY=$ApiKey" }
& $nssm set $ServiceName AppEnvironmentExtra $envPairs

& $nssm start $ServiceName

Write-Host ''
Write-Host "[second-agent] $ServiceName baslatildi."
Write-Host "  Config     : $ConfigPath   (printer + jobKinds:[""$JobKinds""] dogru mu?)"
Write-Host "  Fingerprint: $DeviceFingerprint"
Write-Host "  Log        : $logStdout"
Write-Host ''
Write-Host "Dogrulama: '$logStdout' icinde 'register OK: agentId=...' satirini bekleyin."
if (-not $ApiKey) {
  Write-Host "NOT: -ApiKey verilmedi -> PRINT_AGENT_API_URL/KEY SISTEM env'inde set olmali (LocalSystem miras alir)."
}
