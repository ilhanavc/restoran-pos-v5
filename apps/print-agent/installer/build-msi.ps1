# Restoran POS Print Agent — MSI build helper.
#
# ADR-004 §Phase 3 PR-6 (decisions.md L4516-L4638):
#   - pkg ile node22-win-x64 binary üret (dist/exe/print-agent.exe)
#   - nssm.exe vendor/ altına indir (yoksa)
#   - WiX v4 ile MSI paketle (installer/dist/print-agent-<version>.msi)
#
# Kullanım:
#   pwsh apps/print-agent/installer/build-msi.ps1
#
# Gereksinim:
#   - Windows + PowerShell 7+ (CI veya lokal admin)
#   - Node 22 + pnpm
#   - WiX v4 (`dotnet tool install --global wix --version 4.0.5`)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Resolve-Path (Join-Path $here '..')
$repoRoot = Resolve-Path (Join-Path $agentRoot '..\..')

# 1. package.json'dan version oku — WiX ProductVersion ile tutarlı olsun
$pkgJson = Get-Content (Join-Path $agentRoot 'package.json') -Raw | ConvertFrom-Json
$version = $pkgJson.version
Write-Host "[build-msi] version=$version"

# 2. nssm.exe vendor klasörüne indir (yoksa) — CC0 lisans, offline kurulum
$vendorDir = Join-Path $here 'vendor'
$nssmExe = Join-Path $vendorDir 'nssm.exe'
if (-not (Test-Path $nssmExe)) {
  Write-Host "[build-msi] nssm.exe yok, indiriliyor..."
  New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
  $nssmZip = Join-Path $env:TEMP 'nssm-2.24.zip'
  Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $nssmZip
  $extractDir = Join-Path $env:TEMP 'nssm-extract'
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $nssmZip -DestinationPath $extractDir -Force
  Copy-Item -Path (Join-Path $extractDir 'nssm-2.24\win64\nssm.exe') -Destination $nssmExe
  Write-Host "[build-msi] nssm.exe OK"
} else {
  Write-Host "[build-msi] nssm.exe mevcut, atlandi"
}

# 3. TypeScript -> JS derle, sonra pkg ile tek exe
Push-Location $repoRoot
try {
  Write-Host "[build-msi] TypeScript derleniyor..."
  pnpm --filter '@restoran-pos/print-agent' build:emit
  if ($LASTEXITCODE -ne 0) { throw "tsc fail" }

  Write-Host "[build-msi] pkg ile exe paketleniyor..."
  pnpm --filter '@restoran-pos/print-agent' build:exe
  if ($LASTEXITCODE -ne 0) { throw "pkg fail" }
} finally {
  Pop-Location
}

$exePath = Join-Path $agentRoot 'dist\exe\print-agent.exe'
if (-not (Test-Path $exePath)) {
  throw "[build-msi] exe uretilemedi: $exePath"
}
Write-Host "[build-msi] exe OK: $exePath"

# 4. WiX v4 ile MSI paketle
$distDir = Join-Path $here 'dist'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
$msiPath = Join-Path $distDir "print-agent-$version.msi"
$wxsPath = Join-Path $here 'print-agent.wxs'

Write-Host "[build-msi] WiX build: $msiPath"
wix build $wxsPath -arch x64 -out $msiPath
if ($LASTEXITCODE -ne 0) { throw "wix build fail" }

Write-Host "[build-msi] MSI hazir: $msiPath"
$msiSize = (Get-Item $msiPath).Length
Write-Host "[build-msi] Boyut: $([math]::Round($msiSize / 1MB, 2)) MB"
