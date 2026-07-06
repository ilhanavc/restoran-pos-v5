#Requires -Version 5.1
<#
.SYNOPSIS
  ESC/POS termal yazıcı codepage tarama aracı (ADR-004 §7 / CP857 Türkçe).

.DESCRIPTION
  Yazıcıya (TCP 9100) tek bağlantıda, farklı `ESC t N` codepage değerleriyle
  aynı Türkçe örneği bastırır. Çıkan fişte HANGİ N satırında Türkçe karakterler
  (İ ş ç ğ ı ö ü Ş Ğ Ç Ü Ö) DOĞRU çıkıyorsa, o N bu yazıcının CP857 seçicisidir.

  Kod standart `ESC t 13` (CP857) gönderir; bazı ucuz/klon yazıcılar CP857'yi
  farklı bir indekste tutar ya da yalnız DIP-switch ile ayarlanır. Bu araç doğru
  değeri ampirik bulur. Sonucu `shared-domain/src/printer/esc-pos.ts` CODEPAGE_CP857
  değerine yazarız (13 çalışmıyorsa).

.PARAMETER PrinterIp
  Yazıcının LAN IP'si. Varsayılan: 192.168.1.120

.PARAMETER Port
  ESC/POS raw port. Varsayılan: 9100

.PARAMETER Codepages
  Denenecek ESC t N değerleri. Varsayılan yaygın Türkçe/Latin indeksleri.

.EXAMPLE
  .\codepage-scan.ps1
.EXAMPLE
  .\codepage-scan.ps1 -PrinterIp 192.168.1.120
#>
[CmdletBinding()]
param(
  [string]$PrinterIp = '192.168.1.120',
  [int]$Port = 9100,
  [int[]]$Codepages = (0..50)
)

$ErrorActionPreference = 'Stop'

# CP857 Türkçe örnek byte'ları: İ ş ç ğ ı ö ü Ş Ğ Ç Ü Ö
$sample = [byte[]](0x98, 0x9f, 0x87, 0xa6, 0x8d, 0x94, 0x81, 0x9e, 0xa5, 0x80, 0x9a, 0x99)

$bytes = New-Object System.Collections.Generic.List[byte]
function Add-Ascii([string]$t) {
  foreach ($c in [System.Text.Encoding]::ASCII.GetBytes($t)) { $bytes.Add($c) }
}
function Add-Raw([byte[]]$b) { foreach ($x in $b) { $bytes.Add($x) } }

Add-Raw @(0x1b, 0x40)                       # ESC @ (reset)
Add-Ascii "== CODEPAGE TARAMASI ==`n"
Add-Ascii "Dogru N: satirda I s c g i o u S G C U O`n"
Add-Ascii "yerine gercek Turkce harfler cikan N.`n`n"
foreach ($n in $Codepages) {
  Add-Raw @(0x1b, 0x74, 0x00)               # ESC t 0 (CP437'ye don - desteklenmeyen N onceki sayfayi miras almasin)
  Add-Raw @(0x1b, 0x74, [byte]$n)           # ESC t N (codepage sec)
  Add-Ascii ("N=" + $n.ToString().PadLeft(2) + ": ")
  Add-Raw $sample
  Add-Raw @(0x0a)                           # LF
}
Add-Raw @(0x0a, 0x0a, 0x0a)
Add-Raw @(0x1d, 0x56, 0x42, 0x00)           # GS V B 0 (tam kesme)

$arr = $bytes.ToArray()
Write-Host "[codepage-scan] $PrinterIp`:$Port -> $($arr.Length) byte gonderiliyor..."
$client = New-Object System.Net.Sockets.TcpClient
try {
  $client.Connect($PrinterIp, $Port)
  $stream = $client.GetStream()
  $stream.Write($arr, 0, $arr.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds 800
  $stream.Close()
} catch {
  throw "[codepage-scan] Yaziciya baglanilamadi ($PrinterIp`:$Port): $($_.Exception.Message)"
} finally {
  $client.Close()
}
Write-Host "[codepage-scan] Gonderildi. Cikan fise bak: hangi 'N=...' satirinda Turkce DOGRU?"
Write-Host "[codepage-scan] O N degerini bildir; kodda CODEPAGE_CP857'yi ona gore ayarlariz."
