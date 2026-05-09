# v3 KDS Davranış Notu

**Kaynak:** `D:\dev\restoran-pos-v3\client\src\components\kitchen\KitchenScreen.jsx` (READ-ONLY). Kod taşıma yasak; v5 Sprint 12 (ADR-020) için davranış referansı.

## Layout
- Grid `auto-fill, minmax(320px, 1fr)` → 3-4 kolon; sıralama API'den (FIFO `created_at`)
- Boş: ChefHat + "Bekleyen sipariş yok"

## Kart
1. **Header:** order_type ikonu (Paket / Masa N) + `#order_no` + Clock + `timeAgo`
2. **Items:** quantity (accent, büyük), ürün adı, modifier (turuncu), not (kırmızı + alert)
3. **Footer:** "Sipariş Tamam" — tüm kalemler ready olunca enable

## Yaş rengi
- <10 dk: nötr
- 10-20 dk: `--warning` turuncu
- \>20 dk: `--danger` kırmızı
- Yeni (`status='in_kitchen'`): warning + 3× pulse

## Status
- Item-level "Hazır" yeşil → opacity 0.5 + line-through; v3 tek-step (`preparing` yok)

## Realtime
- Socket: `order:created|updated|item_updated|items_added` → full reload
- Disconnect fallback: 30s polling

## Ses
- Web Audio sine 880Hz / 0.4s bip; sadece yeni sipariş eklendiğinde

## v5 farkları (ADR-020)
- K3: `sent → preparing → ready` 3-state (v3: tek)
- K2: kategori `kitchen_print` filter (v3: tüm kalemler)
- K6: eşikler 5/10dk (v3: 10/20)
- v5 dışı (v5.1 backlog): order-level kapatma, ses, multi-station, ürün-tag
