<#
.SYNOPSIS
  Installs CallerBridge.exe as a Windows Service (LocalSystem, auto-start).

.DESCRIPTION
  Run from an elevated PowerShell prompt on the restaurant PC.
  Service name: restoran-pos-caller-bridge

.PARAMETER ExePath
  Full path to CallerBridge.exe (publish output, self-contained).

.EXAMPLE
  .\install-service.ps1 -ExePath "C:\restoran-pos\caller-bridge\CallerBridge.exe"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath
)

$ErrorActionPreference = "Stop"
$ServiceName = "restoran-pos-caller-bridge"
$DisplayName = "Restoran POS - Caller ID Bridge"
$Description = "CIDShow C812A -> POST /bridge/caller-id/incoming (ADR-016)"

if (-not (Test-Path $ExePath)) {
    throw "ExePath not found: $ExePath"
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Service already exists, stopping & deleting…"
    Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Creating service $ServiceName…"
sc.exe create $ServiceName binPath= "`"$ExePath`"" start= auto DisplayName= "$DisplayName" | Out-Null
sc.exe description $ServiceName "$Description" | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Write-Host "Starting service…"
Start-Service -Name $ServiceName

Get-Service -Name $ServiceName
Write-Host "Done. Logs: $(Split-Path $ExePath)\logs\"
