# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## Session 55 — Sprint 9 (2026-05-08)

### Tamamlananlar

- **ADR-019 Accepted** — E2E Smoke Suite Stratejisi (Chromium-only, worker 1, kysely direct seed, storageState, preview proxy reuse §3.1)
- **ADR-019 §1 amendment 2** — S2/S4/S5 scope-aligned (S2 bölge sync, S4 hard-delete, S5 timezone) + **Sprint 9 / 9b ayrımı** (bu sayı amendment)
- **PR #108** (`feat/sprint-9-playwright-e2e`) — Görev 37 altyapı + S1 senaryosu
  - Playwright config (Chromium-only)
  - apps/web/e2e/: global-setup, fixtures (seed + auth.setup), helpers, S1 spec, README
  - .github/workflows/e2e.yml (postgres:17 service reuse)
  - eslint.config.js e2e/** override
  - vite.config.ts preview proxy
- **CI evolusyon** (4 fix zinciri, her biri bir önceki katmanı açtı):
  - `b0e7a7a` Build workspace packages (shared-types/domain/db) — fresh CI checkout dist eksik
  - `083e080` globalSetup string path (require.resolve ESM uyumsuz)
  - `5d21346` vite.config preview.proxy (server.proxy dev-only, vite preview proxy etmiyor)
  - `bbbe945` S5 spec ADR §1 saf scope (defensive testler kaldırıldı)
- **Sprint 9b ertelendi** — S2-S5 spec dosyaları silindi (commit XXXXXXX). qa-engineer locator'ları lokal UI keşfi olmadan yazmıştı; gerçek DOM'da `getByRole(/Yeni|Ekle/)` `#tenant-name` toBeDisabled self-delete locator'lar 30s timeout

### S1 PASS, S2-S5 ertelendi — neden

- **S1 (login UI)** tüm 4 CI koşumunda PASS → Vite SPA fallback + preview proxy + auth flow + storageState altyapısı doğrulandı
- S2-S5 fail nedeni: locator'lar gerçek DOM ile uyuşmuyor (qa-engineer sandbox'tan kör yazmış)
- ADR-019 §1 amendment 2: S2-S5 → Sprint 9b (lokal `pos_e2e` DB + Playwright UI mode + Inspector ile locator çıkarma şart)

### State (Session 55 sonu — Sprint 9 KAPANDI)

- main HEAD: `ec0f3ff` (PR #108 squash merged)
- Açık PR: 0 (chore/session-55-close henüz açılmadı, kapanış PR'ı)
- Sprint 9: ✅ KAPANDI (altyapı + S1 yeşil, CI Playwright Smoke 1m44s + ci 1m4s)
- Sprint 9b: backlog (S2-S5 — qa-engineer lokal UI keşfi sonrası yeni PR)
- ADR-002 §10 username UNIQUE: borç (Plan A — sıradaki)
- Phase 3 KDS: backlog (Plan C — ADR-019 sonrası)
- Worktree disposal: `D:\restoran-pos-v5\.claude\worktrees\determined-bhabha-194e2a` orphan (branch silinemedi worktree çakışması; manuel cleanup ileride)

### Önemli dersler

1. **Subagent UI testi körlemesine yazamaz**: qa-engineer sadece dosya isimlerinden + page tsx özeti ile spec yazınca locator'lar gerçek DOM'la uyuşmuyor. Çözüm: lokal Playwright UI mode + Inspector ile locator inspect, sonra spec yaz.
2. **Vite preview proxy server.proxy ≠ preview.proxy**: Dev mode'da `server.proxy`, preview mode'da `preview.proxy`. İki ayrı config bloğu. E2E için preview kullanılırsa preview.proxy şart.
3. **fresh CI checkout workspace packages dist eksik**: `pnpm install` lockfile'a göre paketleri kurar ama workspace paketlerinin TS build'lerini yapmaz. Web build'den önce shared-types + shared-domain + db build şart.
4. **`require.resolve` ESM mode'da yok**: apps/web `"type": "module"` → playwright.config.ts'de `require.resolve('./...')` ReferenceError. Playwright 1.30+ globalSetup string path destekler.
5. **Lokal e2e DB ayrımı (ADR-019 §3.1)**: `pos_e2e` ayrı DB. `pos_dev` truncate edilirse dev verisi gider; seed.ts üçlü guard (NODE_ENV, CI, DB ismi pattern).

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
