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

## Print Agent / native modül (node-thermal-printer, node-hid, vb.) dokunursa

- [ ] CI: Windows build geçti (Print Agent hedef platformu Windows)
- [ ] Local'de temiz clone → `pnpm install` → `pnpm --filter print-agent build` çalıştı
- [ ] 3 yazıcı türü de test edildi: USB, Ethernet, test mode
- [ ] Türkçe karakter (CP857) baskısı doğrulandı

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
