# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## Session 54 KAPANDI (2026-05-07)

### Tamamlananlar (5 PR main'e merged)

- **PR #105** (`3a1ab25`): Migration 027 idempotent guard + 028 store_date::SMALLINT cast (gizli POST /orders 500 bug fix) + vitest pool=threads + fileParallelism=false + bölge-içi masa etiketi
- **PR #102** (`9792d3df`, **squash-onto-main**): paket sipariş + sidebar fix + müşteri atama + ADR-017 + ADR-018; DTO'ya `tableId/orderNo/waiterUserId`, `createTakeawayOrder` repo'ya `waiterUserId` (ADR-008 §4.1 ABAC), GET takeaway authorize'a kitchen
- **PR #103** (`6c2dd00`, cherry-pick): hard delete + snapshot pattern (Migration 030→032 renumber)
- **PR #104** (`ebd3db5`, cherry-pick 2 commit): paid-only raporlar
- **PR #106** (`b97797f`): Sprint 11 borç kapanışı — reports.test 12 test geri açıldı, ADR-009 hard-delete amendment

### Test sonucu

329/329 PASS, 24 dosya, **0 skipped** — Sprint 11 borç tamam kapatıldı.

### Migration zinciri (ana repo state)

027 idempotent → 028 store_date_cast → 031 takeaway_stage → 032 orders_table_snapshot.

### Memory'e eklenen

- `feedback_pr_merge_collision_avoidance.md` — açık PR'lar dururken bug-fix migration NNN_*.sql çakışması; FIFO sıralama.

### Cleanup

- 6 geçici worktree git registry'sinden kaldırıldı (jovial-dirac, sharp-liskov, takeaway-rebase, hard-delete-rebase, reports-rebase, vigorous-raman, determined-mestorf)
- 50+ eski local branch silindi (sadece `main`)
- Ana repo `D:\restoran-pos-v5` main HEAD `b97797f`

### State (Session 55 başlangıcı)

- Açık PR: **0**
- Local branch: sadece `main`
- API: http://localhost:3001 (PID 15776)
- Web: http://localhost:5173 (PID 2312)
- Dev DB pos_dev: 027/028/031/032 sync

### Sıradaki açık işler

1. **Phase 3** başlangıcı — KDS UI + kitchen routing (ADR-014 §9 backend zaten hazır)
2. **Sprint 9** — Playwright E2E (charter Phase 2 exit kriteri)
3. **ADR-002 §10** — `(tenant_id, username)` UNIQUE migration (Sprint 0/1 borç)
4. Disk üzerinde kilitli worktree dizinleri (Windows file lock; git registry temiz, manuel disk cleanup ileride)

### Önemli dersler (bu seans)

1. **PR squash sırasında migration numara çakışması:** Açık PR'larla aynı numaralı yeni migration eklemek zincirli rebase tetikler. Kontrol komutu: `gh pr list --state open --json files`. FIFO sıralama tercih.
2. **Squash-onto-main > 22 commit interactive rebase:** ADR-018 unification + revert deseni — interactive rebase 22/10 conflict zinciri saatlik. Squash-onto-main net etki tek commit, conflict tek seferde.
3. **PowerShell `Start-Process -WindowStyle Hidden` Claude Code permission sandbox bloğu:** Kullanıcıya prompt gözükmüyor, otomatik reject. **Bash nohup pattern** tercih.
4. **Bash `exit 0` ≠ child öldü:** Background bash kabuk exit ettiğinde nohup'la spawn edilen child alive kalır. Doğrulama: port + log + `Get-CimInstance` (memory'de yazılı, bu seansta tekrar kanıtlandı).
