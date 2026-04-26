---
name: scope-guard
description: Bir özellik talebini v5.0 MVP listesine ve v3 referans kapsamına karşı doğrula. Çıktı - `MVP-icinde` / `v5.1-backlog` / `ADR-gerekli`. Tetikle - "scope check", "kapsamda mı", "MVP'de mi", yeni feature talebi geldiğinde.
---

# Scope Guard

CLAUDE.md "Ürün sınırı (kapsam kilidi)" bölümünün otomatik uygulayıcısı.

## İki soru

Her talebe sırayla şu iki soru sorulur:

1. **v3'te var mıydı?** Kontrol: `D:\dev\restoran-pos-v3\` (READ-ONLY). Davranışsal eşleşme arar — birebir UI değil.
2. **v5.0 MVP listesinde mi?** Kontrol: `docs/project-charter.md` MVP bölümü.

## Karar matrisi

| v3'te var | MVP'de var | Sonuç |
|-----------|------------|-------|
| Evet      | Evet       | ✅ İlerle - normal akış (architect → implementer → qa → reviewers) |
| Evet      | Hayır      | ⚠️ v5.1 backlog. `docs/backlog/v5.1.md` altına ekle. ADR'a gerek yok. |
| Hayır     | Evet       | ✅ İlerle - ama yeni özellik olduğu için ADR zorunlu. |
| Hayır     | Hayır      | ⛔ DUR. Kullanıcıya sor - "Bu v3'te yoktu ve MVP'de de yok. Gerçekten v5.0'a giriyor mu? Giriyorsa ADR ile gerekçelendir." |

## Çıktı formatı

```
Talep: <özet>
v3 referansı: [bulundu | bulunamadı] @ <yol varsa>
MVP listesi: [var | yok]
Karar: [MVP-icinde | v5.1-backlog | ADR-gerekli | RED]
Aksiyon: <somut bir sonraki adım>
```

## Bayrak: hardcoded kapsam ihlalleri

Aşağıdakiler herhangi bir koşulda v5.0'a girmez (CLAUDE.md "Hedef değil"):
- 5+ şubeli zincir desteği
- Multi-region / multi-currency
- e-Fatura / yazarkasa entegrasyonu
- Yemek platformu (Yemeksepeti/Getir/Trendyol)
- QR menü
- Sadakat / combo / reçete

Bunlar talep edildiğinde **hemen RED**, ADR bile değil.

## Yapma

- Talebi yorumlamaya çalışma — direkt çıktı ver, kullanıcı karar verir.
- v3 kodundan satır kopyalama (CLAUDE.md "v3'ten taşıma kuralı").
