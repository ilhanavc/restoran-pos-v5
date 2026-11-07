#Requires -RunAsAdministrator
# UYARI: BU DOSYA UTF-8 BOM ILE KAYDEDILMELIDIR - BOM'u silmeyin.
# Windows PowerShell 5.1, BOM'suz bir .ps1'i sistem ANSI kod sayfasiyla okur
# (bu makinelerde windows-1254) ve dosyadaki tirnak/tire karakterleri yanlis
# yorumlanir: string erken kapanir, script "Unexpected token" ile CALISMADAN
# olur. 2026-07-20'de birebir olculdu (install-second-agent.ps1 ayni uyariyi
# tasir). Bu dosya bilerek ASCII-only yazildi ki BOM kaybolsa bile parse olsun.
<#
.SYNOPSIS
  ADR-044 K5 - Restoran PC'sindeki print-agent servislerini SIRALI ve
  DOGRULAMALI sekilde yeni exe'ye gecirir; hata halinde otomatik geri alir.

.DESCRIPTION
  Bugune kadar guncelleme elle yapiliyordu: servisi durdur, exe'yi kopyala,
  baslat - uc servis icin uc kez tekrarlanan, sirasi ve dogrulamasi operatorun
  hafizasina birakilmis bir yordam. Bu script o yordami koda gomer.

  MSI UPGRADE YASAK (ADR-044 K5 / version.ts): MSI yukseltmesi servisi yeniden
  kaydeder ve nssm AppEnvironmentExtra ile gomulu env'i SILER - yani
  PRINT_AGENT_API_KEY kaybolur ve uc yazici birden susar. Guncelleme yalniz exe
  kopyalamayla yapilir; bu script MSI'a hic dokunmaz.

  UC SERVIS TEK EXE PAYLASIR. install-second-agent.ps1:208
  (nssm install <svc> $exe) ikinci ve ucuncu servisi de AYNI print-agent.exe'ye
  baglar. Windows calisan bir exe'yi kilitler, yani dosya hicbir servis
  kosarken degistirilemez.

  ADR-044 K5'in bir cumlesi bu yuzden YANLISTI ve duzeltildi:
  "sirayla yapildiginda diger iki yazici akmaya devam eder". Paylasilan tek
  binary ile bu mumkun degil - dosyayi degistirmek icin ucunun de durmasi
  gerekir. Siralamanin gercek kazanci downtime DEGIL, FAIL-FAST: yeni binary
  bozuksa bunu ILK servis baslatilirken anlariz ve diger ikisi hic
  baslatilmadan geri alinir. Dukkan bozuk bir surume topluca gecmez.

  Kesinti profili: dosya degisimi saniyeler surer ve kuyruk KALICIDIR
  (print_jobs; 4 ayda yetim is yok) - bu pencerede dusen bir fis kaybolmaz,
  servis donunce basilir.

  Sira (ADR-044 K5): IZGARA -> FIRIN -> KASA. En az hacimliden baslanir; KASA
  adisyon yazicisi oldugu icin en sona birakilir.

  Kabul kaniti: servisin "Running" olmasi YETMEZ. PR-1'den beri ajan surumunu
  sunucuya bildiriyor -> yazici yonetim ekranindaki surum satiri tek gercek
  kanittir. Script bunu hatirlatir; -LogPath verilirse boot log'unda surumu
  ayrica arar.

.PARAMETER NewExe
  Kopyalanacak yeni print-agent.exe'nin yolu (-Rollback yoksa zorunlu).

.PARAMETER InstallDir
  Kurulu exe + nssm.exe konumu.
  Varsayilan: %PROGRAMFILES%\Restoran POS\Print Agent

.PARAMETER Services
  Islenecek servisler, SIRASIYLA. Varsayilan ADR sirasi:
  RestoranPosPrintAgentGrill (IZGARA) -> RestoranPosPrintAgent (FIRIN) ->
  RestoranPosPrintAgentBill (KASA).

.PARAMETER ExpectedVersion
  Beklenen surum (or. 0.0.5). -LogPath ile birlikte boot log'unda aranir.

.PARAMETER LogPath
  Ajanin stdout log dosyasi (nssm AppStdout). Verilirse surum dogrulamasi
  yapilir; verilmezse yalniz servis durumu kontrol edilir.

.PARAMETER DryRun
  Hicbir seye dokunmaz; yalniz on kontrolleri ve plani yazar.

.PARAMETER Rollback
  Yeni exe kopyalamaz: .bak dosyasini geri yukler ve servisleri sirayla
  baslatir. Kopyalama sonrasi bir sorun gorulurse elle cagrilir.

.EXAMPLE
  .\update-agents.ps1 -NewExe C:\Kurulum\print-agent.exe -ExpectedVersion 0.0.5 -DryRun

.EXAMPLE
  .\update-agents.ps1 -NewExe C:\Kurulum\print-agent.exe -ExpectedVersion 0.0.5

.EXAMPLE
  .\update-agents.ps1 -Rollback
#>
[CmdletBinding()]
param(
  [string]$NewExe,
  [string]$InstallDir = "$env:PROGRAMFILES\Restoran POS\Print Agent",
  [string[]]$Services = @(
    'RestoranPosPrintAgentGrill',
    'RestoranPosPrintAgent',
    'RestoranPosPrintAgentBill'
  ),
  [string]$ExpectedVersion,
  [string]$LogPath,
  [int]$StartupTimeoutSec = 30,
  [switch]$DryRun,
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'

# Kurulu exe ~50 MB (pkg ile paketlenmis Node). 10 MB'lik taban, yanlis dosya
# (bir .cmd sarmalayicisi ya da yarim indirilmis exe) kopyalanmasini ucuza
# yakalar: sinirdaki degeri degil, acik ara guvenli olani al.
$MinExeBytes = 10MB

$exePath = Join-Path $InstallDir 'print-agent.exe'
$bakPath = "$exePath.bak"

function Write-Step {
  param([string]$Message)
  Write-Host "[update-agents] $Message"
}

function Get-Sha256 {
  param([string]$Path)
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

function Assert-ServicesExist {
  foreach ($svc in $Services) {
    if ($null -eq (Get-Service -Name $svc -ErrorAction SilentlyContinue)) {
      throw "[update-agents] servis bulunamadi: $svc - kurulum tamamlanmamis olabilir (install-second-agent.ps1)."
    }
  }
}

function Stop-AllServices {
  # Paylasilan exe kilitli oldugu icin UCU DE durmak ZORUNDA (bkz. DESCRIPTION).
  foreach ($svc in $Services) {
    Write-Step "durduruluyor: $svc"
    if (-not $DryRun) { Stop-Service -Name $svc -Force -ErrorAction Stop }
  }
}

function Start-ServiceVerified {
  param([string]$ServiceName)
  Write-Step "baslatiliyor: $ServiceName"
  if ($DryRun) { return $true }

  Start-Service -Name $ServiceName -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-Service -Name $ServiceName).Status -eq 'Running') { break }
    Start-Sleep -Milliseconds 500
  }
  $state = (Get-Service -Name $ServiceName).Status
  if ($state -ne 'Running') {
    Write-Step "HATA: $ServiceName $StartupTimeoutSec sn icinde Running olmadi (durum: $state)"
    return $false
  }

  if ($ExpectedVersion -and $LogPath) {
    if (-not (Test-Path $LogPath)) {
      Write-Step "UYARI: log dosyasi yok ($LogPath) - surum dogrulamasi ATLANDI"
      return $true
    }
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    while ((Get-Date) -lt $deadline) {
      $tail = Get-Content -Path $LogPath -Tail 80 -ErrorAction SilentlyContinue
      if ($tail -and (($tail -join "`n") -match [regex]::Escape($ExpectedVersion))) {
        Write-Step "surum dogrulandi ($ExpectedVersion): $ServiceName"
        return $true
      }
      Start-Sleep -Milliseconds 500
    }
    Write-Step "HATA: $ServiceName boot log'unda $ExpectedVersion gorulmedi"
    return $false
  }
  return $true
}

function Invoke-Rollback {
  Write-Step 'GERI ALMA: .bak geri yukleniyor'
  if (-not (Test-Path $bakPath)) {
    throw "[update-agents] geri alinamaz: $bakPath yok. Kurulum dosyasini elle kopyalayin."
  }
  Stop-AllServices
  if (-not $DryRun) { Copy-Item -Path $bakPath -Destination $exePath -Force }
  $ok = $true
  foreach ($svc in $Services) {
    if (-not (Start-ServiceVerified -ServiceName $svc)) { $ok = $false }
  }
  if ($ok) {
    Write-Step 'GERI ALMA TAMAM - uc servis de eski exe ile calisiyor.'
  }
  else {
    Write-Step 'GERI ALMA SONRASI servis(ler) ayaga kalkmadi - MUDAHALE GEREKIYOR.'
    exit 2
  }
}

# --- On kontroller ----------------------------------------------------------
Write-Step "install dizini: $InstallDir"
if (-not (Test-Path $exePath)) {
  throw "[update-agents] kurulu exe bulunamadi: $exePath - once MSI'i kurun."
}
Assert-ServicesExist

if ($Rollback) {
  Invoke-Rollback
  return
}

if (-not $NewExe) {
  throw '[update-agents] -NewExe zorunlu (ya da -Rollback kullanin).'
}
if (-not (Test-Path $NewExe)) {
  throw "[update-agents] yeni exe bulunamadi: $NewExe"
}

$newItem = Get-Item $NewExe
if ($newItem.Length -lt $MinExeBytes) {
  throw "[update-agents] yeni exe fazla kucuk ($($newItem.Length) byte, taban $MinExeBytes) - yanlis dosya mi?"
}
$newHash = Get-Sha256 -Path $NewExe
$curHash = Get-Sha256 -Path $exePath
if ($newHash -eq $curHash) {
  Write-Step 'yeni exe kurulu olanla AYNI (SHA256 eslesti) - yapilacak is yok.'
  return
}

Write-Step "kurulu SHA256: $curHash"
Write-Step "yeni   SHA256: $newHash"
Write-Step ('sira: ' + ($Services -join ' -> '))
Write-Step 'UYARI: UC SERVIS TEK EXE PAYLASIR -> dosya degisimi icin ucu de duracak (saniyeler). Kuyruk KALICI, dusen fis kaybolmaz.'
if ($DryRun) {
  Write-Step 'DRY-RUN: hicbir sey yapilmadi.'
  return
}

# --- Uygulama ---------------------------------------------------------------
Stop-AllServices

Write-Step "yedek aliniyor: $bakPath"
Copy-Item -Path $exePath -Destination $bakPath -Force

Write-Step 'yeni exe kopyalaniyor'
Copy-Item -Path $NewExe -Destination $exePath -Force
$copiedHash = Get-Sha256 -Path $exePath
if ($copiedHash -ne $newHash) {
  Write-Step "HATA: kopyalama sonrasi SHA256 uyusmuyor (beklenen $newHash, bulunan $copiedHash)"
  Invoke-Rollback
  exit 1
}
Write-Step 'kopyalama dogrulandi (SHA256)'

# Servisler SIRAYLA ve her biri dogrulanarak baslatilir: bozuk bir binary ilk
# serviste yakalanir, diger ikisi hic baslatilmaz.
$started = @()
foreach ($svc in $Services) {
  if (Start-ServiceVerified -ServiceName $svc) {
    $started += $svc
    continue
  }
  Write-Step "FAIL-FAST: $svc ayaga kalkmadi - baslatilanlar: $($started -join ', '); kalanlar BASLATILMADI."
  Invoke-Rollback
  exit 1
}

Write-Step 'TAMAM - uc servis de yeni exe ile calisiyor.'
Write-Step 'KABUL KANITI: yazici yonetim ekranindaki surum satirini kontrol et (ADR-044 K4).'
Write-Step 'Servis durumu Running tek basina KANIT DEGILDIR.'
