# Başlarken

Bu doküman, v5 bootstrap paketini çalışan bir Claude Code ortamına dönüştürmek için sırayla izlenecek adımları içerir.

> Her adım, bir öncekini tamamlamadan uygulanmaz. Definition of Done felsefemizin ilk testidir.

## 0. Ön gereksinimler

- [ ] Node.js 22 LTS kurulu (`node --version` → `v22.x.x`)
- [ ] pnpm 9+ kurulu (`pnpm --version` → `9.x` veya üzeri)
- [ ] Git kurulu ve global user/email ayarlı
- [ ] Claude Code kurulu (`claude --version` çalışmalı)
- [ ] GitHub hesabın var
- [ ] Hetzner Cloud hesabın var (opsiyonel, cloud deploy'a geçince lazım)

## 1. GitHub repo oluştur

1. GitHub'da yeni repo: `restoran-pos-v5` (Private)
2. **HİÇBİR ŞEY seçme** (README, .gitignore, license hiçbiri)
3. Henüz push etme

## 2. Klasörü repo'ya dönüştür

```bash
cd D:/                        # veya tercih ettiğin yere
# ZIP'i indirdiğini varsayıyoruz
# ZIP içeriği bu klasörde
cd restoran-pos-v5
git init
git add .
git commit -m "chore: phase 0 bootstrap — project constitution, subagents, skills"
git branch -M main
git remote add origin git@github.com:<KULLANICI_ADIN>/restoran-pos-v5.git
git push -u origin main
```

## 3. Dokümanları oku (atlanmaz)

Sırayla:
1. `README.md`
2. `CLAUDE.md` — proje anayasası
3. `docs/project-charter.md` — vizyon, kapsam, başarı kriterleri
4. `.claude/plans/active-plan.md` — ilk sprint planı
5. `.claude/memory/decisions.md` — boş, ama formatı gör

## 4. Claude Code'da aç

```bash
cd D:/restoran-pos-v5
claude
```

İlk oturumda Claude Code `CLAUDE.md`'yi otomatik okur. İlk prompt olarak şunu dene:

> "CLAUDE.md'yi okudun mu? Anayasayı özetle ve aktif plandaki (`.claude/plans/active-plan.md`) ilk görevi bana göster."

## 5. İlk ADR'yi yaz

Kod yazmadan önce ilk mimari karar: **"Monorepo yapısı ve paket isimlendirme"**.

```
/new-adr
```

`new-adr` slash command'ı `architect` sub-agent'ını çağırır, interaktif olarak ADR'yi yazdırır. Bu ADR `.claude/memory/decisions.md`'e ADR-001 olarak eklenir.

## 6. Monorepo iskeletini kur

ADR-001 kabul edildikten sonra `implementer` sub-agent'ıyla:

```
apps/api, apps/web, apps/mobile, apps/print-agent klasörlerini
ve packages/shared-types, packages/shared-domain, packages/shared-ui paketlerini
pnpm workspaces + Turborepo ile kur. ADR-001'deki yapıyı takip et.
```

## 7. İlk "hello" endpoint + web sayfası

Sprint 0 kapanışı:
- `apps/api` → `GET /health` endpoint, PostgreSQL bağlantısı doğrular
- `apps/web` → ana sayfa, `/health`'a fetch yapar, "Cloud bağlı" gösterir

## 8. Definition of Done

`/phase-done` slash command'ını çalıştır. Geçemediğin her kutucuk için geri dön.

---

## Phase 0 çıktı kriteri (exit)

- [ ] Monorepo kuruldu, `pnpm install` temiz
- [ ] ADR-001 (monorepo yapısı) kabul edildi
- [ ] ADR-002 (auth stratejisi) kabul edildi
- [ ] ADR-003 (DB şema ilkeleri) kabul edildi
- [ ] `apps/api` temel iskelet çalışıyor (health endpoint)
- [ ] `apps/web` temel iskelet çalışıyor
- [ ] CI pipeline (GitHub Actions) lint + typecheck + test yeşil
- [ ] README + CLAUDE.md güncel
- [ ] İlk feature için sprint 1 planı yazıldı

Buradan sonra Phase 1 (Core Domain) başlar.
