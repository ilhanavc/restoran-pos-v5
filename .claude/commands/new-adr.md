---
description: Yeni bir Architectural Decision Record (ADR) başlat. Architect sub-agent'ı çağırır ve şablonla birlikte yeni karar dokümanlaması sürecini yönetir.
---

# /new-adr — Yeni ADR oluştur

Bu komut çalıştırıldığında:

1. `.claude/memory/decisions.md` dosyasını oku
2. Son ADR numarasını bul, bir sonrakini ayır (ADR-XXX)
3. Bağlam için kullanıcıdan şu bilgileri topla:
   - Kararın başlığı (kısa, imperative mood: "X için Y kullan")
   - Neden karar gerekiyor? (bağlam)
   - En az 2 alternatif
   - Tercih edilen seçenek + gerekçe
4. `architect` sub-agent'ını çağır, tam ADR'yi yazdır
5. Sonuç `decisions.md` sonuna eklenir
6. CHANGELOG.md'ye notu ekle
7. PR oluşturma önerisi: `feat(arch): ADR-XXX <başlık>`

## Şablon

```markdown
## ADR-XXX: <başlık>

- **Durum**: Proposed
- **Tarih**: YYYY-MM-DD

### Bağlam
<neden karar gerekiyor, hangi problemi çözüyor>

### Karar
<ne karar verildi, özet>

### Alternatifler
- **A**: <alternatif 1>
  - Artıları: ...
  - Eksileri: ...
  - Neden reddedildi: ...
- **B**: <alternatif 2>
  - ...

### Sonuçlar
- (+) <pozitif>
- (+) <pozitif>
- (−) <trade-off>
- (−) <trade-off>

### Referanslar
- ADR-XXX: ilgili karar
- Issue: #N
- PR: #N
```

## Kullanım örneği

```
/new-adr "Cloud'da Redis cache layer eklemek için"
```

Sonrasında architect sub-agent interaktif olarak bağlamı toplar ve ADR'yi yazar.
