---
description: Mevcut sprint/feature'ın Definition of Done checklist'ini çalıştırır. Geçemediği noktaları raporlar. Her kutucuk tamamlanana kadar "bitti" demeye izin vermez.
---

# /phase-done — Definition of Done kontrolü

Bu komut mevcut görevin/feature'ın kapanmaya hazır olup olmadığını sistematik kontrol eder.

## Akış

1. `.claude/plans/active-plan.md` dosyasını oku — aktif görev nedir?
2. Görev tipini belirle (`type:feature`, `type:fix`, `type:refactor`, `type:chore`, `type:docs`)
3. `docs/engineering/definition-of-done.md`'den ilgili checklist'i yükle
4. Otomatik kontrol edilebilenleri çalıştır:
   - `pnpm lint` temiz mi?
   - `pnpm typecheck` temiz mi?
   - `pnpm test` yeşil mi?
   - Coverage hedefi tutturuldu mu?
   - CHANGELOG.md güncellenmiş mi?
   - Migration varsa down test edildi mi?
5. Manuel kontrol gerekenleri listele
6. Gerekli sub-agent review'larını hatırlat:
   - UI değişikliği → `hci-reviewer` + `turkish-ux-reviewer`
   - Security dokunuşu → `security-reviewer`
   - DB migration → `db-migration-guard`
   - Print Agent / yazıcı → `architect` + test planı
   - Auth / PII / ödeme → `security-reviewer`
7. Tüm kutucuklar ✅ değilse, hangileri eksik raporla
8. Hepsi ✅ ise:
   - "Bitti" onayını ver
   - Commit mesaj template'i öner (Conventional Commits)
   - PR description template'i üret
   - `.claude/plans/active-plan.md`'de görev ✅ işaretle

## Çıktı formatı

```markdown
## Definition of Done — <görev adı>

### Otomatik kontroller
- [x] Lint temiz
- [x] Typecheck temiz
- [ ] Tests yeşil — FAIL: 2 test başarısız
  - `packages/domain/src/order.test.ts:45` — "should calculate VAT correctly"
- [x] Coverage ≥ %80 (domain)
- [ ] CHANGELOG.md güncellenmiş — EKSİK

### Manuel kontroller
- [ ] İlgili ADR var mı? Kontrol et: `.claude/memory/decisions.md` → ADR-XXX
- [ ] Sub-agent review'ları alındı mı?
  - [ ] hci-reviewer (UI değişikliği var, gerekli)
  - [ ] turkish-ux-reviewer (UI string'ler var)
  - [x] security-reviewer (auth değişikliği yok)
- [ ] Manuel test planı uygulandı mı?

### Durum
❌ **BİTMEDİ** — 3 kutucuk eksik.

### Yapılacaklar sırası
1. Başarısız testleri düzelt (test dosyasını aç, issue'ya bak)
2. CHANGELOG.md'ye entry ekle: `- feat(order): add VAT calculation [#123]`
3. hci-reviewer sub-agent'ını çağır: "@hci-reviewer review apps/desktop/src/order-screen.tsx"
4. turkish-ux-reviewer sub-agent'ını çağır

Tamamlandığında tekrar `/phase-done` çalıştır.
```

## Kullanım

```
/phase-done
```

Parametresiz. Aktif plan'a bakar.

## Özel durumlar

- Eğer aktif görev yoksa (`active-plan.md` boş veya tüm görevler ✅): "Bir sonraki sprint'e geçmeye hazırız" mesajı ver, faz ilerletme seçeneği sun
- Eğer CI henüz çalışmamış: "CI sonuçları bekleniyor, tekrar dene"
- Eğer branch `main` ise: uyarı ver ("Feature branch'te mi çalışmalısın?")
