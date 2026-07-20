<#
.SYNOPSIS
  ESC/POS raster (GS v 0) uyumluluk testi - ag yazicisina DOGRUDAN TCP 9100 uzerinden.

.DESCRIPTION
  ADR-032 Amendment 1 (mutfak istasyon yonlendirmesi) K15 on-kosulu.

  NEDEN VAR: v5 fis render'i ADR-004 Amd9 ile raster'a tasindi ve donanim varsayimlarini
  SABIT kodluyor: 576 piksel genislik (80 mm, 72 byte/satir), 128 satirlik bantlar,
  GS v 0 raster komutu. Kod tabaninda METIN MODUNA DUSME SECENEGI YOKTUR - tek render
  yolu vardir. Dolayisiyla v5'e yeni eklenecek her yazici, kuruluma girmeden ONCE
  bu uc seyi kaldirabildigini kanitlamalidir.

  Bu script projenin render katmanini KULLANMAZ; sabit bir test deseni uretir.
  Amac fisin icerigini degil, DONANIM YETENEGINI kanitlamaktir:
    - TCP 9100 ham bayt kabul ediyor mu
    - GS v 0 raster komutunu isliyor mu
    - 576 piksel tam genisligi basiyor mu (kenardan kenara duz cizgi)
    - bit sirasi dogru mu (dikey seritler duzgun cikmali)
    - kagit kesici calisiyor mu

  Yazdirilan desen (yukaridan asagi):
    kalin siyah cizgi / bosluk / dikey seritler / bosluk / kalin siyah cizgi

.PARAMETER PrinterHost
  Yazicinin IP adresi. Ornek: 192.168.1.87 (IZGARA2025)

.PARAMETER Port
  ESC/POS ham yazdirma portu. Varsayilan 9100.

.PARAMETER DryRun
  Baglantiyi test eder, BAYT GONDERMEZ, kagit harcamaz.

.EXAMPLE
  .\test-raster-tcp.ps1 -PrinterHost 192.168.1.87 -DryRun
  .\test-raster-tcp.ps1 -PrinterHost 192.168.1.87

.NOTES
  UYARI: DryRun disinda bu script GERCEK KAGIT BASAR. Restoran calisiyorsa
  fis ilgili istasyondan cikar ve personel gorur. Yogun saatte calistirmayin.

  Dosya saf ASCII'dir (PowerShell 5.1 Turkce mojibake riski - bilerek sapkasiz).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterHost,

  [int]$Port = 9100,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$BYTES_PER_ROW = 72        # 576 piksel / 8
$BAND_ROWS     = 8         # her desen bandinin satir sayisi

function Write-TestStep {
  param([string]$Text)
  Write-Host "  $Text"
}

Write-Host ''
Write-Host '=== ESC/POS raster (GS v 0) uyumluluk testi ==='
Write-Host "    Hedef : $PrinterHost`:$Port"
if ($DryRun) {
  Write-Host '    Mod   : DRY-RUN (bayt gonderilmez, kagit harcanmaz)'
} else {
  Write-Host '    Mod   : GERCEK BASKI (kagit cikacak)'
}
Write-Host ''

# --- ADIM 1: TCP erisilebilirlik -------------------------------------------
Write-Host 'ADIM 1 - TCP baglanti'
$client = New-Object System.Net.Sockets.TcpClient
try {
  $connect = $client.BeginConnect($PrinterHost, $Port, $null, $null)
  if (-not $connect.AsyncWaitHandle.WaitOne(5000, $false)) {
    throw "Baglanti zaman asimi (5 sn). Yazici acik mi, IP dogru mu?"
  }
  $client.EndConnect($connect)
  Write-TestStep "OK - $PrinterHost`:$Port baglantiyi kabul etti"
} catch {
  Write-Host ''
  Write-Host "HATA - baglanti kurulamadi: $($_.Exception.Message)"
  Write-Host ''
  Write-Host 'NE YAPILMALI:'
  Write-Host '  - Yazici acik ve agda mi: ping ile dogrulayin'
  Write-Host '  - IP dogru mu: Get-Printer | ft Name,PortName'
  Write-Host '  - Baska bir program yaziciyi tek-baglanti modunda tutuyor olabilir'
  if ($client) { $client.Close() }
  exit 2
}

if ($DryRun) {
  $client.Close()
  Write-Host ''
  Write-Host 'SONUC: DRY-RUN BASARILI - yazici TCP baglantisini kabul ediyor.'
  Write-Host '       Raster yetenegi HENUZ KANITLANMADI (bayt gonderilmedi).'
  Write-Host '       Gercek testi calistirmak icin -DryRun parametresini kaldirin.'
  exit 0
}

# --- ADIM 2: Test deseni uret ----------------------------------------------
Write-Host 'ADIM 2 - raster desen uretimi'

# Bant deseni: 0xFF = kenardan kenara siyah, 0x00 = bos, 0xAA = dikey seritler
$bandPattern = @(0xFF, 0x00, 0xAA, 0xAA, 0x00, 0xFF)
$totalRows   = $bandPattern.Count * $BAND_ROWS

$payload = New-Object 'System.Collections.Generic.List[byte]'

# ESC @ - yaziciyi sifirla
$payload.AddRange([byte[]](0x1B, 0x40))

# GS v 0 m xL xH yL yH : m=0 (normal), x=byte/satir, y=satir sayisi
$payload.AddRange([byte[]](
  0x1D, 0x76, 0x30, 0x00,
  [byte]($BYTES_PER_ROW -band 0xFF), [byte](($BYTES_PER_ROW -shr 8) -band 0xFF),
  [byte]($totalRows -band 0xFF), [byte](($totalRows -shr 8) -band 0xFF)
))

foreach ($bandByte in $bandPattern) {
  for ($row = 0; $row -lt $BAND_ROWS; $row++) {
    for ($col = 0; $col -lt $BYTES_PER_ROW; $col++) {
      $payload.Add([byte]$bandByte)
    }
  }
}

# Kagit besle + tam kesme
$payload.AddRange([byte[]](0x0A, 0x0A, 0x0A, 0x0A))
$payload.AddRange([byte[]](0x1D, 0x56, 0x00))

$bytes = $payload.ToArray()
Write-TestStep "OK - $($bytes.Length) bayt uretildi ($totalRows satir x $BYTES_PER_ROW bayt)"

# --- ADIM 3: Gonder ---------------------------------------------------------
Write-Host 'ADIM 3 - gonderim'
try {
  $stream = $client.GetStream()
  $stream.WriteTimeout = 10000
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds 1500
  Write-TestStep "OK - $($bytes.Length) bayt gonderildi"
} catch {
  Write-Host ''
  Write-Host "HATA - gonderim basarisiz: $($_.Exception.Message)"
  Write-Host 'NE YAPILMALI: yazicida kagit var mi, kapak kapali mi, hata lambasi yaniyor mu?'
  $client.Close()
  exit 3
} finally {
  if ($client) { $client.Close() }
}

# --- ADIM 4: Gozle dogrulama (yanlis-pozitif kapatma) ----------------------
Write-Host ''
Write-Host 'ADIM 4 - gozle dogrulama'
Write-Host '  Baytlarin gonderilmis olmasi kagidin ciktigini KANITLAMAZ.'
Write-Host '  Yaziciya bakin ve asagidakileri tek tek kontrol edin:'
Write-Host ''
Write-Host '   [1] Kagit cikti mi?'
Write-Host '   [2] Ust ve alt siyah cizgiler kagidin SOL kenarindan SAG kenarina'
Write-Host '       kadar kesintisiz uzaniyor mu? (576 piksel genislik testi)'
Write-Host '   [3] Ortadaki bolge duzgun dikey seritler mi, yoksa karmakarisik mi?'
Write-Host '       (bit sirasi testi - karisiksa raster uyumsuz demektir)'
Write-Host '   [4] Kagit otomatik kesildi mi?'
Write-Host ''
$answer = Read-Host 'Dordu de tamam mi? (EVET / HAYIR)'

Write-Host ''
if ($answer -eq 'EVET') {
  Write-Host '=== SONUC: GECTI ==='
  Write-Host "$PrinterHost GS v 0 raster'i 576 piksel genisliginde basiyor."
  Write-Host 'Bu yazici v5 fis boru hattina eklenebilir (ADR-032 Amd1 K15 kosulu saglandi).'
  exit 0
} else {
  Write-Host '=== SONUC: KALDI ==='
  Write-Host 'Bu yazici v5 raster fislerini bugunku haliyle basamaz.'
  Write-Host ''
  Write-Host 'NE YAPILMALI:'
  Write-Host '  - Kagit hic cikmadiysa  : yazici ham TCP baskiyi kabul etmiyor olabilir'
  Write-Host '  - Cizgiler kisa kaldiysa: yazici 58 mm olabilir (v5 render 80 mm sabit)'
  Write-Host '  - Desen karisiksa       : GS v 0 destegi yok / farkli raster komutu gerekiyor'
  Write-Host ''
  Write-Host 'Bu durumda ADR-032 Amd1 K15 geregi istasyon bolunmesi cutover ONCESI'
  Write-Host 'ETKINLESTIRILMEZ; sistem tek mutfak hattiyla devam eder.'
  exit 1
}
