# Git Akışı

## Model: Trunk-based development

- `main` her zaman deploy edilebilir durumda
- Feature'lar kısa ömürlü (< 3 gün) feature branch'lerde
- Uzun süren değişiklikler → feature flag + trunk'a sık merge

## Branch adlandırma

- `feat/<kısa-açıklama>` — yeni özellik
- `fix/<kısa-açıklama>` — hata düzeltme
- `refactor/<kısa-açıklama>` — davranış değişmeden iç yapı değişimi
- `chore/<kısa-açıklama>` — build, deps, config
- `docs/<kısa-açıklama>` — sadece doküman

Örnek: `feat/order-split-check`, `fix/printer-utf8-encoding`

## Conventional Commits

Her commit mesajı:
```
<type>(<scope>): <özet>

<isteğe bağlı gövde>

<isteğe bağlı footer>
```

**Type'lar**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `style`

**Scope örnekleri**: `domain/order`, `api/menu`, `desktop/printer`, `mobile/waiter`, `sync`, `db`

**Breaking change**: footer'da `BREAKING CHANGE: <açıklama>`

Örnekler:
```
feat(domain/order): support split check across multiple customers

fix(desktop/printer): handle utf-8 codepage on escpos printers

chore(deps): bump express to 5.0.1
```

## PR süreci

1. **Issue** önce açılır (feature veya bug)
2. **Branch** oluşturulur, değişiklik yapılır
3. **Commit'ler atomik** — her commit kendi başına anlamlı
4. **Push + PR** açılır, PR template doldurulur
5. **CI geçer** (lint, typecheck, test, build)
6. **Self-review**: kendi PR'ına git, her değişikliği tekrar oku
7. **Sub-agent review'ları**: PR tipine göre ilgili sub-agent'lar çağrılır
8. **Merge**: squash-merge (tek commit main'e gider), commit mesajı PR başlığı olur
9. **Branch silinir** (GitHub otomatik)

## PR template

Her PR şu başlıkları içerir:

```markdown
## Ne
<değişikliğin bir cümlelik özeti>

## Neden
<hangi gereksinimi/bug'ı/ADR'yi karşılıyor, linkle>

## Nasıl test edildi
<unit/integration/E2E test listesi + varsa manuel test adımları>

## DoD checklist
- [ ] docs/engineering/definition-of-done.md geçildi
- [ ] İlgili sub-agent review'ları alındı
- [ ] CHANGELOG.md güncellendi

## Ekran görüntüleri / kanıt
<UI değişikliği varsa before/after>
```

## Branch koruma (main)

- Direct push yasak
- Merge öncesi zorunlu:
  - ✅ CI yeşil
  - ✅ En az 1 PR review (sub-agent ile self-review geçerli sayılır)
  - ✅ Branch up-to-date
  - ✅ Conversation'lar çözülmüş

## Semver ve release

- `packages/*` paketlerinde [Changesets](https://github.com/changesets/changesets)
- `apps/*` için tag bazlı: `desktop@1.2.3`, `mobile@1.2.3`, `api@1.2.3`
- Major bump → mutlaka ADR
- Pre-release: `1.2.3-beta.1` (pilot için)

## Rebase vs merge

- Feature branch'ini güncel tutmak için: rebase (`git pull --rebase origin main`)
- Main'e: squash-merge (GitHub UI)
- Force push sadece kendi feature branch'ine

## Commit imzalama

- GPG veya SSH ile commit'ler imzalanır (zorunlu, `commit.gpgsign = true`)

## .gitattributes

- LF line ending (Windows'ta bile)
- Binary file'lar LFS'e (büyük image, video vb. varsa)

## Release notları

Her release için:
- `CHANGELOG.md` — Keep a Changelog formatı
- GitHub Release — tag'a bağlı, CHANGELOG'dan otomatik
- Pilot müşteri için: sade Türkçe "Yenilikler" dokümanı
