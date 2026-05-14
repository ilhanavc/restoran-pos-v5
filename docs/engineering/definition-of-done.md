# Definition of Done (DoD)

Bu projenin kalbi budur. Hiçbir görev, aşağıdaki tüm kutucuklar işaretlenmeden "tamam" sayılmaz. "Yarım olsa da olur" yok.

Görev türüne göre hangi checklist'in uygulanacağı değişir. Hangi tip olduğunu PR'da etiketle (`type:feature`, `type:fix`, `type:refactor`, `type:chore`, `type:docs`).

## Her tip için ortak DoD

- [ ] Kod TypeScript strict mode'da derleniyor, `any` yok
- [ ] Lint + Prettier temiz (CI geçti)
- [ ] Conventional Commit formatında commit'ler
- [ ] PR açıklaması: ne, neden, nasıl test edildi
- [ ] Hiçbir `TODO:` veya `FIXME:` yorumu yok (varsa ayrı issue açılmış ve linkli)
- [ ] Sentry'ye gönderilmesi gereken hataların tamamı yakalanıp raporlanıyor
- [ ] Kullanıcıya görünen her string `t('key')` üzerinden, `tr.json`'da karşılığı var

## `type:feature` için ek DoD

- [ ] Önce ADR yazıldı (`.claude/memory/decisions.md`) veya mevcut bir ADR'ye atıf yapıldı
- [ ] Aktif plan (`.claude/plans/active-plan.md`) güncellendi
- [ ] Unit test coverage ≥ 80% (domain layer için)
- [ ] E2E test (Playwright veya Detox) ilgili kullanıcı akışını kapsıyor
- [ ] Happy path + en az 2 edge case test edildi
- [ ] HCI checklist'i (docs/hci/pos-checklist.md) geçildi (`hci-reviewer` onayı)
- [ ] `turkish-ux-reviewer` onayı (metinler doğal Türkçe)
- [ ] Performance bütçesi: p95 etkileşim < 200ms (ölçüldü, kanıt PR'da)
- [ ] Accessibility: klavye ile erişilebilir, kontrast WCAG AA (screenshot kanıt)
- [ ] Documentation: ilgili `docs/` altında bir dosya güncellendi veya eklendi
- [ ] CHANGELOG.md'de `## [Unreleased]` altında bir madde eklendi

## `type:fix` için ek DoD

- [ ] Hatayı yeniden üreten bir test yazıldı ve başarısız oldu
- [ ] Fix sonrası test geçti
- [ ] Regresyon önleme: aynı kök nedene sahip başka olası hatalar arandı
- [ ] Root cause PR açıklamasında belgelendi

## `type:refactor` için ek DoD

- [ ] Davranışın değişmediğini kanıtlayan test suite olduğu gibi geçiyor
- [ ] Tüm etkilenen modüllerin coverage'ı korundu veya arttı
- [ ] Migration path (varsa) ADR olarak belgelendi

## `type:chore` için ek DoD

- [ ] CI hâlâ yeşil
- [ ] Diğer geliştiricilerin workflow'unu bozmuyor (lock file değişimi açıklandı)

## `type:docs` için ek DoD

- [ ] Linter (markdownlint) geçti
- [ ] Dahili linkler kırık değil
- [ ] Hem Türkçe terim hem İngilizce karşılığı (gerekiyorsa) verildi

## Print Agent (`apps/print-agent/`, ADR-004) dokunursa

**Kod / domain:**
- [ ] Local'de temiz clone → `pnpm install` → `pnpm turbo run build --filter='@restoran-pos/print-agent...'` çalıştı (workspace deps)
- [ ] `pnpm --filter @restoran-pos/print-agent test` 10+ unit test PASS
- [ ] Türkçe karakter (CP857) encoding doğrulandı (`packages/shared-domain/src/printer/encode-cp857.ts` üzerinden — ASCII fallback YASAK)
- [ ] TCP 9100 transport doğrulandı (USB transport PR-5b'ye kadar ertelendi)

**MSI installer / Windows servisi dokunursa (`apps/print-agent/installer/`):**
- [ ] Lokal MSI build: `cd apps/print-agent/installer && wix build print-agent.wxs -arch x64 -out dist/print-agent-<v>.msi` (WiX v4 dotnet tool; CWD = installer/, path resolve gerek)
- [ ] Lokal MSI E2E: admin PowerShell → `msiexec /i ... /qb /l*v ...` → Service `RestoranPosPrintAgent` (Status: Running veya config eksikse Paused beklenen)
- [ ] Uninstall: `msiexec /x ... /qb` → service kalktı + install dir silindi + **config dosyası KORUNDU** (`%PROGRAMDATA%\restoran-pos\print-agent.json`, re-install dostu)
- [ ] CI workflow `print-agent-msi.yml` SUCCESS (`workflow_dispatch` veya `print-agent-v*` tag push; windows-latest runner; artifact upload edilmiş)
- [ ] `apps/print-agent/installer/vendor/nssm.exe` (vendored, ~368KB win64) repo'da, `.gitignore`'da `!vendor/nssm.exe` negation aktif
- [ ] `@yao-pkg/pkg` target `node22-win-x64` (vercel/pkg deprecated — fork zorunlu)
- [ ] Türkçe README (`installer/README.md`) kurulum / yapılandırma / kaldırma / sorun giderme bölümleri güncel

## DB şema dokunursa

- [ ] `db-migration-guard` sub-agent onayı
- [ ] Up migration yazıldı
- [ ] Down migration yazıldı ve test edildi
- [ ] Mevcut seed data ile geri-ileri migration döngüsü test edildi
- [ ] `tenant_id` konvansiyonu korundu (her transactional tabloda)

## Güvenlik / auth dokunursa

- [ ] `security-reviewer` sub-agent onayı
- [ ] KVKK etki değerlendirmesi (PII dokunuluyorsa)
- [ ] Secret'lar env'den geliyor, hardcoded değil
- [ ] Rate limiting + input validation eklendi

## Self-check: "Bu görev gerçekten bitti mi?"

Merge'den önce sor:
1. 6 ay sonra bu kodu okuyan biri niyeti anlayabilir mi?
2. Bu feature, charter'daki başarı kriterlerine katkı sağlıyor mu?
3. Bu değişiklik, non-goals listesine aykırı mı?
4. Bir restoran sahibi, bu feature için para ödemeye razı olur mu?
5. Yoğun saatte, personel bu ekranda stres yaşar mı?

Hepsine "evet, hazır" diyemiyorsan → merge etme.
