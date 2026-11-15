---
name: scope-guard
description: Bir özellik talebini ADR-046 K4 kapısına karşı doğrula — v3 kapsamı + ADR-046 K3 "satılan ürün" listesi + "hedef değil" listesi + PUSULA sırası. Çıktı - `Kapsamda` / `Kapsamda-ADR-gerekli` / `Ertelenmiş` / `DUR-sor` / `RED`. Tetikle - "scope check", "kapsamda mı", "MVP'de mi", yeni feature talebi geldiğinde.
---

# Scope Guard

CLAUDE.md "Ürün sınırı (kapsam kilidi)" bölümünün otomatik uygulayıcısı. Kural kaynağı: **ADR-046** (`.claude/memory/decisions.md`, 2026-11-15) — K3 (kapalı liste), K4 (kapı), K5 (hedef değil).

> 2026-11-15 öncesi kapı "v3'te var mı? + v5.0 MVP listesinde mi?" idi. "v5.0 MVP listesi" artık **tarihsel** referanstır (MVP 2026-07-24'te canlıya girdi), kapının sorusu değildir.

## Dört soru (sırayla)

1. **v3 kapsamında mı?** Kontrol: `D:\dev\restoran-pos-v3\` (READ-ONLY). Davranışsal eşleşme arar — birebir UI değil.
2. **ADR-046 K3 listesinde mi?** S1 kayıt · S2 e-posta doğrulama · S3 şifre sıfırlama · S4 abonelik/deneme/kilit · S5 tahsilat (kart + havale/EFT) · S6 asgari platform yönetimi · S7 abonelik sonu veri yaşam döngüsü · S8 sözleşme/aydınlatma onayı kaydı · S9 2FA · S10 müşterinin kendi ayar yüzeyleri · S11 satış öncesi sağlamlık işleri (Dalga D, OPS-9 → OPS-2b, OPS-3, OPS-1/MIM-4, VERI-2, OPS-12). **Liste kapalıdır.**
3. **"Hedef değil" listesinde mi?** (aşağıdaki bayrak listesi) → evetse **RED**.
4. **PUSULA'da sırası geldi mi?** Kontrol: `docs/roadmap-v51-coklu-sube.md` "PUSULA sırası".

## Karar matrisi

| v3'te var | K3'te var | Hedef değil | Sonuç |
|-----------|-----------|-------------|-------|
| —         | —         | Evet        | ⛔ **RED.** Yalnız ADR-046'ya amendment ile açılır |
| Evet      | —         | Hayır       | ✅ **Kapsamda.** Yapılmadıysa backlog; yapısal ise tasarım ADR'si |
| Hayır     | Evet      | Hayır       | ✅ **Kapsamda — tasarım ADR'si zorunlu**, PUSULA sırasını bekler |
| Hayır     | Hayır     | Hayır       | ⛔ **DUR, kullanıcıya sor:** "Bu v3'te yoktu ve ADR-046 K3 listesinde de yok. K3'e gerekçeli amendment mı, backlog mu?" |

**"Sırası gelmedi" ≠ "kapsam dışı":** kapsamdaki bir kalem PUSULA'da henüz sırası gelmemişse sonuç `Ertelenmiş`tir, `RED` değil. Sıra atlamak PUSULA'nın bağımlılık gerekçesine karşı yazılı itiraz ister.

## Çıktı formatı

```
Talep: <özet>
v3 referansı: [bulundu | bulunamadı] @ <yol varsa>
ADR-046 K3: [S<n> | yok]
Hedef değil: [evet: <kalem> | hayır]
PUSULA: [Katman <n>, sırası geldi | bekliyor | listede yok]
Karar: [Kapsamda | Kapsamda-ADR-gerekli | Ertelenmiş | DUR-sor | RED]
Aksiyon: <somut bir sonraki adım>
```

## Bayrak: "hedef değil" (ADR-046 K5)

Aşağıdakiler talep edildiğinde **hemen RED** — yalnız ADR-046'ya amendment ile açılır:
- Rakiplerin (Adisyo vb.) özellik listesini kopyalamak / özellik yarışı — "Adisyo'da var" tek başına gerekçe değildir
- Çok şubeli işletme yönetimi (şubeler arası rapor, merkezi menü) — şubesi olan müşteride her şube **ayrı hesap**
- Multi-region
- **Restoranın satışları için** e-Fatura / e-Arşiv veya yazarkasa/ÖKC entegrasyonu
- QR menü
- Sadakat / combo / reçete

⚠️ **RED değil, `DUR-sor` (ADR ister — ADR-046 K3 "bilinçle listede olmayanlar"):** fiyat planı kademeleri / özellik paketleri, kupon/referans programı, uygulama içi destek sohbeti, çoklu dil, Türkiye dışı pazar / **çoklu para birimi**.

⚠️ **Artık RED DEĞİL:**
- **Yemek platformu entegrasyonları** (Yemeksepeti/Getir/Trendyol/Uber Eats) → hedefte, sırası **en sonda** (PUSULA Katman 4 / Faz 6). Faz 6'nın kendi ADR'si olmadan kod `Ertelenmiş`tir.
- **Ürün sahibinin müşterisine abonelik faturası** → kapsam sorusu değil, **kod dışı** (mali müşavir işi, ADR-046 K6).

## Yapma

- Talebi yorumlamaya çalışma — direkt çıktı ver, kullanıcı karar verir.
- K3'e kendiliğinden kalem ekleme: liste kapalıdır, ekleme ADR-046 amendment'ı ister.
- v3 kodundan satır kopyalama (CLAUDE.md "v3'ten taşıma kuralı").
