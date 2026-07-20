/**
 * Yeni bir mutfak yazıcısı için GERÇEK render'lı test fişi üretir
 * (ADR-032 Amendment 1 K15 — yeni istasyonun raster fişi basabildiğinin kanıtı).
 *
 * NEDEN VAR: `test-raster-tcp.ps1` donanım yeteneğini kanıtlar (GS v 0, 576 px,
 * bit sırası) ama RENDER'ı kanıtlamaz — Türkçe glyph'ler, ₺, font, satır
 * kaydırma, hizalama o yazıcıda hiç denenmemiş olur. Bu script projenin
 * gerçek `renderKitchenReceipt` çıktısını üretip, doğrudan TCP 9100'e gönderen
 * kendi kendine yeten bir PowerShell dosyası yazar (dükkan PC'sine tek dosya
 * taşınır; RustDesk paste bozduğu için komut yapıştırmak yerine dosya çalıştırılır).
 *
 * Fiş İÇERİĞİ kasıtlı olarak "TEST" damgalıdır: mutfak personeli gerçek sipariş
 * sanıp ürün hazırlamasın.
 *
 * Kullanım (apps/api içinden):
 *   pnpm exec tsx scripts/ops/render-station-test-receipt.ts \
 *     --host 192.168.1.87 --station IZGARA --out D:/izgara-test-fisi.ps1
 */

import { writeFileSync } from 'node:fs';
import { renderKitchenReceipt, type KitchenReceiptItem } from '../../src/print/templates/kitchen-receipt.js';

function readArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] !== undefined) return process.argv[idx + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`Eksik parametre: --${name}`);
}

const host = readArg('host');
const port = Number(readArg('port', '9100'));
const station = readArg('station');
const outPath = readArg('out');

// Türkçe glyph kapsamı (İ ş ı ğ ç ö ü Ş Ğ Ç Ö Ü) + ₺ bilinçli olarak zorlanır:
// raster render bunları font'tan çizer, CP857 kısıtı yoktur (ADR-004 Amd9).
const items: KitchenReceiptItem[] = [
  {
    name: 'TEST — ADANA ŞİŞ',
    qty: 2,
    variantName: 'Bir buçuk',
    lineTotalCents: 48000,
    modifiers: ['ACILI', 'SOĞANSIZ'],
    note: 'HAZIRLAMAYIN — SİSTEM TESTİ',
  },
  {
    name: 'TEST — İÇLİ KÖFTE',
    qty: 1,
    variantName: null,
    lineTotalCents: 12000,
    modifiers: [],
    note: 'ÇÖĞÜŞıİ glyph kontrolü',
  },
  {
    name: 'TEST — TAVUK DÜRÜM',
    qty: 3,
    variantName: null,
    lineTotalCents: 27000,
    modifiers: ['TURŞUSUZ'],
    note: null,
  },
];

const bytes = renderKitchenReceipt({
  order_type: 'dine_in',
  tenant_header: `TEST FİŞİ — ${station}`,
  order_no: 999,
  table_label: 'TEST',
  area_label: null,
  server_name: 'SİSTEM',
  created_at_local: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  items,
  customer_name: null,
  customer_phone: null,
  delivery_address: null,
  delivery_note: null,
  planned_payment_type: null,
  total_cents: 87000,
});

const base64 = Buffer.from(bytes).toString('base64');

// Üretilen .ps1 SAF ASCII olmalı (PowerShell 5.1 Türkçe mojibake riski).
// Fişin kendisi base64 içinde taşındığı için Türkçe içerik etkilenmez.
const ps1 = `# ${station} istasyonu icin GERCEK render'li test fisi (ADR-032 Amd1 K15).
# Bu dosya otomatik uretildi: apps/api/scripts/ops/render-station-test-receipt.ts
# Hedef: ${host}:${port}  |  Fis boyutu: ${bytes.length} bayt
#
# UYARI: Bu script GERCEK KAGIT BASAR. Fis ${station} istasyonundan cikar.
# Fisin uzerinde "TEST" ve "HAZIRLAMAYIN" yazar; yine de personeli onceden uyarin.
#
# Calistirma:  .\\${outPath.split(/[\\/]/).pop()}

$ErrorActionPreference = 'Stop'
$PrinterHost = '${host}'
$Port = ${port}

Write-Host ''
Write-Host '=== ${station} - gercek render test fisi ==='
Write-Host ('    Hedef: ' + $PrinterHost + ':' + $Port)
Write-Host '    Bu islem KAGIT BASAR.'
Write-Host ''

$payload = [Convert]::FromBase64String('${base64}')
Write-Host ("  Fis boyutu: " + $payload.Length + " bayt")

$client = New-Object System.Net.Sockets.TcpClient
try {
  $handle = $client.BeginConnect($PrinterHost, $Port, $null, $null)
  if (-not $handle.AsyncWaitHandle.WaitOne(5000, $false)) { throw 'Baglanti zaman asimi (5 sn)' }
  $client.EndConnect($handle)
  $stream = $client.GetStream()
  $stream.WriteTimeout = 15000
  $stream.Write($payload, 0, $payload.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds 2000
  Write-Host '  OK - fis gonderildi'
} catch {
  Write-Host ''
  Write-Host ("HATA: " + $_.Exception.Message)
  Write-Host 'NE YAPILMALI: yazici acik mi, kagit var mi, IP dogru mu?'
  if ($client) { $client.Close() }
  exit 2
} finally {
  if ($client) { $client.Close() }
}

Write-Host ''
Write-Host 'KAGIDA BAKIN - kontrol listesi:'
Write-Host '  [1] Turkce harfler dogru mu?  I s i g c o u ve buyukleri bozuk cikmis mi'
Write-Host '  [2] Yazi yumusak/net mi (blok font degil)'
Write-Host '  [3] Urun adlari ve adetler hizali mi, satir kaymasi var mi'
Write-Host '  [4] Fis sag kenardan tasmis mi'
Write-Host '  [5] Kagit kendiliginden kesildi mi'
Write-Host ''
Write-Host 'Hepsi tamamsa ${station} v5 fis boru hattina hazir demektir.'
`;

writeFileSync(outPath, ps1, { encoding: 'ascii' });

console.log(`Fis render edildi: ${bytes.length} bayt`);
console.log(`PowerShell dosyasi yazildi: ${outPath}`);
console.log(`Hedef yazici: ${host}:${port} (${station})`);
