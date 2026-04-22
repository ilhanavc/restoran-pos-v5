# Architectural Decision Records (ADR)

> Bu dosya projenin mimari karar geçmişini tutar. Her karar immutable'dır — yanlış olduğu anlaşılırsa üzerine yazılmaz, yeni bir ADR ile "superseded" olarak işaretlenir.

## Format

Her ADR:
- **Numara**: Sıralı, 3 hane (ADR-001)
- **Başlık**: Kararın özeti
- **Durum**: `Proposed` | `Accepted` | `Superseded by ADR-XXX` | `Deprecated`
- **Tarih**: YYYY-MM-DD
- **Bağlam**: Neden bir karar gerekiyor
- **Karar**: Ne karar verildi
- **Alternatifler**: Değerlendirilen ve reddedilen seçenekler
- **Sonuçlar**: Pozitif ve negatif sonuçlar

Yeni ADR eklemek için: `/new-adr` slash command'ını kullan. `architect` sub-agent otomatik olarak bağlamı toplar ve dosyayı günceller.

---

## Şablon — her yeni ADR için kopyala

```markdown
## ADR-XXX: <kararın başlığı>

- **Durum**: Proposed
- **Tarih**: YYYY-MM-DD

### Bağlam
<neden bir karar gerekiyor>

### Karar
<ne karar verildi>

### Alternatifler
- **A**: <alternatif 1>
  - Artıları: ...
  - Eksileri: ...
  - Neden reddedildi: ...
- **B**: <alternatif 2>
  - ...

### Sonuçlar
- (+) <pozitif sonuç>
- (+) <pozitif sonuç>
- (−) <negatif sonuç / ödünleşim>

### Referanslar
- ADR-XXX (ilgili karar, varsa)
- Issue: #N (varsa)
- PR: #N (varsa)
```

---

## Aktif kararlar

> Henüz ADR yok. İlk ADR "ADR-001: Monorepo yapısı ve paket isimlendirme" olacak — `GETTING-STARTED.md` → adım 5.

<!-- ADR'lar buraya eklenir, kronolojik sırada -->
