---
name: adr-closer
description: Bir ADR'ı `Proposed`'dan `Accepted`'a taşı, `decisions.md` aktif kararlar listesine cross-link ekle, ilgili `docs/v3-reference/` ve `docs/engineering/` notlarına geri-link bırak. Tetikle - "ADR-XXX kapat", "ADR'ı accepted yap", "kararı kapat".
disable-model-invocation: true
---

# ADR Closer

Bu skill bir ADR'ı resmi olarak kapatır.

## Akış

1. **ADR numarasını al.** Kullanıcı vermediyse `ls .claude/memory/decisions.md` üstünden `Proposed` durumda olanları listele, hangisini kapatacağını sor.
2. **Definition of Done kontrolü** — `docs/engineering/definition-of-done.md` checklist'inde ADR'a bağlı maddeler tamam mı? Eksikse skill `phase-done` skill'ini öner ve dur.
3. **Durum güncelle.** İlgili ADR bloğunda:
   - `**Durum**: Proposed` → `**Durum**: Accepted`
   - `**Tarih**: YYYY-MM-DD` → kapanış tarihini ekle (`**Kapanış**: YYYY-MM-DD`)
4. **Aktif kararlar bölümüne** kısa cross-link satırı ekle:
   ```
   - [ADR-XXX: <başlık>](#adr-xxx-...) — <bir cümle özet>
   ```
5. **Cross-link**: ADR'ın etkilediği dosyalara (kod değil, doküman) geri-link bırak. Örnek - ADR yazıcıyla ilgiliyse `docs/v3-reference/printer-domain.md` üstüne "Bu modül ADR-XXX (Accepted) kararı altında" satırı ekle.
6. **Final check**: `.claude/memory/decisions.md` doğru parse oluyor mu (markdown başlık seviyeleri bozulmadı mı).

## Çıktı formatı

```
ADR-XXX kapatıldı.
- decisions.md: Proposed → Accepted
- Cross-link: docs/...
- Etkilenen aktif görevler: <varsa active-plan.md referansı>
```

## Yapma

- Yeni ADR yazma — bunun için `/new-adr` var.
- Kod dosyalarına dokunma — bu skill sadece doküman.
- Superseded etiketi koyma — onun için ayrı ADR açılır.
