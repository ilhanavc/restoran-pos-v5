# ADR-004 Amendment 4 — spooler-raw.exe NativeAOT build + vendor.
#
# Dev makinesinde koşulur (NativeAOT native linker = MSVC/Visual C++ Build
# Tools gerekir); CI'da DEĞİL. Çıktı `spooler-raw.exe` prebuilt olarak
# installer/vendor/'a kopyalanır (nssm.exe emsali — offline + deterministik
# CI, feedback_vendor_in_repo_binary). Vendored exe repo'ya commit edilir.
#
# Kullanim:  pwsh ./build.ps1   (veya PowerShell 5.1)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csproj    = Join-Path $scriptDir 'SpoolerRaw.csproj'
$outDir    = Join-Path $scriptDir 'publish'
$vendorDir = Join-Path (Split-Path -Parent $scriptDir) 'installer/vendor'
$exeName   = 'spooler-raw.exe'

Write-Host "[spooler-helper] NativeAOT publish (win-x64, Release)..."
dotnet publish $csproj -c Release -r win-x64 -o $outDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish basarisiz (exit $LASTEXITCODE)" }

$builtExe = Join-Path $outDir $exeName
if (-not (Test-Path $builtExe)) { throw "Beklenen cikti yok: $builtExe" }

$destExe = Join-Path $vendorDir $exeName
Copy-Item $builtExe $destExe -Force
$sizeKB = [math]::Round((Get-Item $destExe).Length / 1KB)
Write-Host "[spooler-helper] vendored -> $destExe ($sizeKB KB)"
