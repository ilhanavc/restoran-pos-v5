# Inter font (self-hosted)

ADR-011 §6 selects Inter, self-hosted, Latin Extended-A subset (Türkçe `ç ğ ı İ ö ş ü` full support). Google Fonts CDN was rejected (KVKK + offline + restoran PC ağı).

Bu klasöre 4 woff2 dosyası eklenmelidir:

- `Inter-Regular.woff2` (weight 400)
- `Inter-Medium.woff2` (weight 500)
- `Inter-SemiBold.woff2` (weight 600)
- `Inter-Bold.woff2` (weight 700)

Kaynak: <https://github.com/rsms/inter/releases> (latest stable). `Inter Web` paketinden Latin / Latin Extended-A subset alınmalı.

Dosyalar yoksa `globals.css`'teki `@font-face` 404 verir, ancak `font-family` zinciri `Inter, system-ui, ...` olduğu için UI sorunsuz fallback yapar.
