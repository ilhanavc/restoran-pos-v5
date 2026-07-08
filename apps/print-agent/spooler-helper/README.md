# spooler-helper — `spooler-raw.exe`

ADR-004 Amendment 4 — Windows Spooler **RAW pass-through** yardımcısı.

## Ne işe yarar

Print Agent (Node/pkg `.exe`) bu küçük native yardımcıyı `child_process` ile
spawn eder:

- **stdin** → ham fiş byte'ları (CP857/ESC-POS; agent üretir, yardımcı yalnız taşır)
- **argv[0]** → Windows print queue adı (ör. `KASA-2026`)

Yardımcı içeride Win32 winspool zincirini yürütür:
`OpenPrinter → StartDocPrinter(RAW) → StartPagePrinter → WritePrinter → EndPagePrinter → EndDocPrinter → ClosePrinter`.

Böylece kasa yazıcısına **Windows sürücüsü değiştirilmeden** (Zadig'siz) basılır
— aynı kuyruğa basan başka POS (Adisyo) bozulmaz. Bkz. `spooler-transport.ts`.

## Neden ayrı native exe (npm modülü değil)

Agent `@yao-pkg/pkg` ile tek `.exe`'ye derleniyor ve `usb` addon'unu zaten
gömüyor. 2. bir native Node addon eklemek pkg native-addon riskini ikiye
katlardı. Ayrı, runtime-bağımsız native exe Node tarafında **sıfır yeni addon**
getirir (ADR-004 Amd4 §2).

## Build (dev makinesi — CI'da DEĞİL)

NativeAOT native linker gerektirir: **Visual C++ Build Tools** (MSVC `link.exe`).
.NET 8 SDK + `win-x64`.

```powershell
./build.ps1
```

Çıktı `spooler-raw.exe` prebuilt olarak `../installer/vendor/spooler-raw.exe`'e
kopyalanır ve repo'ya **commit** edilir (nssm.exe emsali — offline + deterministik
CI). MSI, yardımcıyı agent exe'nin yanına (sibling) kurar; agent onu
`PRINT_AGENT_SPOOLER_HELPER_PATH` env → yoksa exe-komşusu default ile bulur.

## Exit kodları

| Kod | Anlam | Agent eşlemesi |
|-----|-------|----------------|
| 0 | başarı | resolve |
| 1 | kullanım (printerName yok) | `SPOOLER_ERROR_USAGE` |
| 2 | OpenPrinter fail (yanlış kuyruk) | `SPOOLER_ERROR_PRINTER_NOT_FOUND` |
| 3 | erişim reddedildi (Win32 5) | `SPOOLER_ERROR_ACCESS_DENIED` |
| 4 | yazma başarısız | `SPOOLER_ERROR_WRITE` |
