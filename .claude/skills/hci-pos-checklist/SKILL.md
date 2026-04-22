---
name: hci-pos-checklist
description: Use on any UI PR or when designing a new screen. Applies Nielsen's 10 heuristics plus POS-specific principles (Fitts, Hick, rush-hour, touch targets, stress-resistant design). Ensures every screen is usable during peak restaurant hours.
---

# HCI POS Checklist — Uygulama Rehberi

Bu skill `docs/hci/pos-checklist.md`'nin uygulanabilir kısa versiyonudur. Tam referans için o dosyaya bak.

## Review sırası (her UI PR için)

1. Değişen dosyaları oku
2. Simüle et: yoğun saat, yeni garson, ıslak parmak
3. Aşağıdaki hızlı listeyi uygula
4. Her `❌` için PR'a somut öneri yaz
5. Tüm `✅` olunca onay

## Hızlı checklist

### Görünürlük
- [ ] Loading state var (>200ms işlemlerde)
- [ ] Success feedback var (toast/animasyon, <500ms)
- [ ] Error state Türkçe + aksiyon önerili
- [ ] Empty state (liste boş olduğunda anlamlı mesaj)
- [ ] Sync durumu göründüğü her yerde tutarlı

### Dokunma hedefi
- [ ] Buton boyutu ≥ 52×52pt
- [ ] Butonlar arası boşluk ≥ 8pt
- [ ] Tıklanabilir alanın tamamı aktif (sadece text değil, padding dahil)
- [ ] Swipe aksiyonları net (yarım destructive değil)

### Tipografi
- [ ] Minimum font 14pt
- [ ] Kritik metin (fiyat, toplam) 16pt+ bold
- [ ] Kontrast WCAG AA (4.5:1 normal, 3:1 büyük)
- [ ] Sentence case (ALL CAPS yasak)
- [ ] Türkçe karakterler düzgün render

### Navigasyon
- [ ] Geri dönüş yolu belli
- [ ] Modal'dan Esc/X ile çıkış
- [ ] Breadcrumb derin sayfalarda
- [ ] Son açılan ekran hatırlanıyor (pilot için isteğe bağlı)

### Form
- [ ] Her input label'lı
- [ ] Zorunlu alan belli (* veya "(zorunlu)")
- [ ] Gerçek zamanlı validasyon (onBlur)
- [ ] Hata mesajı input'un altında, kırmızı
- [ ] Submit buton loading state'i destructive aksiyonda 2-step

### Destructive aksiyonlar
- [ ] "Sil" butonu kırmızı
- [ ] Onay modal'ı zorunlu
- [ ] Modal başlığı somut: "Siparişi sil?" (generic "Emin misiniz?" değil)
- [ ] Undo 5 saniye (kısa silme işlemleri)

### Responsive / cihaz
- [ ] Tablet portrait + landscape test edildi
- [ ] Safe area (iOS notch) respect ediliyor
- [ ] Klavye açıldığında input görünür kalıyor
- [ ] Küçük ekranda (320px) bozulmuyor

### Accessibility
- [ ] Screen reader label (aria-label / accessibilityLabel)
- [ ] Klavye navigasyon (Tab order mantıklı)
- [ ] Focus göstergesi görünür
- [ ] Renk tek ayırt edici değil (şekil/ikon + renk)
- [ ] `prefers-reduced-motion` respect ediliyor

### POS-spesifik
- [ ] Rush-hour test zihinsel olarak yapıldı
- [ ] Yeni garson 60 sn içinde anlayabilir
- [ ] Mutfak ekranında cam arkasından okunabilir
- [ ] Güneş altında yüksek kontrast mod çalışıyor
- [ ] Eldivenli parmak testi geçti (dokunma hedefi)

### Türkçe UX
- [ ] Tüm metinler glossary'ye uygun (adisyon, sipariş, masa…)
- [ ] Çeviri kokmuyor, doğal Türkçe
- [ ] Hata mesajı + aksiyon önerisi
- [ ] Yasak ifadeler yok (Error, Null, Timeout, Exception)
- [ ] Para formatı: "24,75 ₺"
- [ ] Tarih formatı: "01.02.2026" veya "1 Şubat 2026"

## Özel senaryolar

### Sipariş alma ekranı
- Ürün görseli + ad + fiyat tile
- Kategori filtreleri üstte, max 7 ilk görünür
- Favoriler shortcut bar
- Arama field'ı, ilk 3 harfle filtre
- Quick add (+/- butonları)
- Notlar alanı için opsiyonel (collapsed default)
- Sepet sağda sticky (tablet) veya alt drawer (telefon)

### Ödeme ekranı
- Toplam tutar büyük, ortada
- Ödeme yöntemi seçimi card grid (ikonlu)
- Split check flow adım adım
- Yuvarlama göstergesi
- Bahşiş hızlı seçim (yok/5%/10%/özel)
- Fatura bilgisi (opsiyonel)

### Masa haritası
- Boş/dolu/rezerve renk kodu
- Pax sayısı görünür
- Süre (ne zamandır açık)
- Uzun basma = action menu
- Tek basma = aç (eğer dolu)

### Caller ID popup
- Telefon + müşteri adı büyük
- Son siparişler özet
- "Yeniden aynı sipariş" hızlı buton
- Yeni adres eklemek kolay
- Kapat = basit X

## Red flag'ler — otomatik reject

Aşağıdakilerden birini görürsen PR'ı direkt block et:
- ❌ 32×32pt buton
- ❌ `alert('Error')` tarzı raw hata
- ❌ `TextInput` olmayan label
- ❌ Hardcoded English string UI'da
- ❌ Confirm modal'sız destructive aksiyon
- ❌ Loading state'siz async button
- ❌ Fixed pixel sizes (responsive olmayan)
- ❌ `color: #hex` (tema desteği yok)
- ❌ Platform-specific code'un diğer platforma uymayan fallback'i

## Kabul dili — PR yorumu

```markdown
## HCI Review — PR #XXX

### Durum
✅ Onaylandı / 🟡 İyileştirme gerekli / ❌ Blocker

### Bulgular
**Blocker'lar**: <yoksa "yok">

**İyileştirme önerileri**:
1. Dosya `X.tsx:42` — Y ilkesi ihlali
   - Sorun: ...
   - Öneri: ...

### Kabul edildi
- [ ] Görünürlük
- [ ] Dokunma hedefi
- [ ] Tipografi
- [ ] Accessibility
- [ ] Türkçe UX
- [ ] Rush-hour simülasyonu
```

## Referanslar

- `docs/hci/pos-checklist.md` — tam doküman (blocker detayları)
- `docs/domain/glossary.md` — terminoloji
- Nielsen 10 heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines
- Material Design: https://m3.material.io/
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/
