# Sprint 3a Retrospektif — ABAC Unblock + CI Gating

**Tarih:** 2026-04-27
**Süre:** 2 oturum (Session 31-34)
**Toplam:** 5 görev / 9 PR / 296 test gerçek execution

## Kapsam

Plan başlangıcı: 3 görev (Görev 14 migration 005 + Görev 15 POST hotfix + Görev 16 ABAC enable). Drift keşifleriyle 2 ek görev eklendi (15.5 CI gating, 15.6 fixture cleanup). Sınır kuralı (≤3) ile scope-patlama kontrol altında tutuldu.

## Önemli keşifler

1. **Sahte yeşil CI drift (kritik).** PR #18'in "16 integration test yeşil" iddiası gerçekte CI'de `describe.skipIf(DB_URL undefined)` ile **skip durumuydu**. ADR-008, ADR-002 §10, Görev 14 hepsi bu sahte güvenliğe dayandı. Görev 15'te errorHandler debug log ile keşfedildi (testler 500 dönüyor → tenant_settings missing trigger hatası). PR #27 (Görev 15.5) CI gating + PR #28 (Görev 15.6) fixture cleanup ile kapatıldı. Sonuç: 296 test gerçek execution kanıtlandı (PR #29 run 24994139680).

2. **Architect uydurma cross-ref örüntüsü (sistemik).** 3 vaka: ADR-002 §6.5 yokken referans verildi, audit_logs şema kolon adları (`action`/`resource_type`/`ip_address`) hayali, ADR-001 multi-tenant ADR yokken referans verildi. Mitigasyon: context-anchor §5 'Yaygın tuzaklar'a madde eklendi, sonraki architect çağrılarında prompt'a "uydurma yasağı + emin değilsen 'doğrulanmamış' işaretle" notu zorunlu hale geldi. Görev 18 ADR-X (Session 34) bu disiplinle yazıldı: cross-ref doğrulama listesi explicit, uydurma 0.

3. **node-pg-migrate v7 + ESM + `CONCURRENTLY` tuzağı.** Görev 14 sırasında §14.1.B `CREATE INDEX CONCURRENTLY` zorunluluğu enforce edilemediği keşfedildi: SQL migration paterni node-pg-migrate v7'de transaction-default, CONCURRENTLY desteklemiyor; TS migration için ts-node + ESM + tsconfig migrations include + migrate script flag karmaşası. Çözüm: ADR-003 §14.1.B.3 amendment "Phase-conditional enforcement" — kural Phase 4 prod cutover'a koşullandırıldı, Phase 0-3 dev ortamı CONCURRENTLY'siz kabul.

4. **Turbo env passing tuzağı.** Görev 15.5 ilk CI run'unda integration testler hâlâ skip oldu — turbo task sandbox env'i parent shell env'inden izole eder (cache reproducibility). `tasks.test.env: ["DATABASE_URL", "TZ"]` cerrahî tercih (globalEnv değil) ile çözüldü. ADR-001 §6.1.4.1 amendment ile belgelendi.

## Sınır kuralı (≤3) ilk tetikleme

İlk gerçek CI execution'da packages/db'de 4 fail çıktı (sınır aşımı). Kullanıcı kuralın amacına sadık kaldı: "(B) skip+paralel reddediliyor, kuralı kurduğumuz oturumda kuralı bozmak demek." Görev 15.6 ayrı PR olarak açıldı, scope patlama önlendi. Sonradan keşfedilen 3 hook fail (`pool ended twice`) sınır içinde kalan ek keşif olarak Görev 15.6'ya dahil edildi.

## Ders çıkarımları

- **CI yeşil ≠ test yeşil.** Skip durumu sahte güvence yaratır. Integration testlerin gerçek execution kanıtı log'da (PASS satırları + test sayısı) zorunlu.
- **Architect cross-ref'ler doğrulama gerektirir.** Sub-agent çıktısı dosyaya yazılmadan önce her cross-ref için `decisions.md` + migration dosyaları + zod schemalarda varlık kontrolü. Paranoyak disiplin.
- **Sınır kuralı yorgunluk anında kıymetli.** Drift birikiminde "şimdi düzeltirim" tuzağı vardır; ≤3 sınırı hayır demeyi disiplinli yapar.
- **Plan-kod drift'i sessiz büyür.** `permissions.ts` 3+ plan'da referanslandı ama dosya hiç yaratılmadı. Plan revizyonu öncesi mevcut kod tabanı doğrulanır.
- **Takvim gerçekçilik.** Bu oturumda "Faz 2 bu oturumda bitirilecek" hedefi koyuldu, ardından 12-16 saatlik iş'in tek oturuma sığmadığı fark edildi. Hedef koymak ≠ hedefin gerçekleşebilirliği. Yorgun zihinle implementasyon sıkıştırma = sahte yeşil drift'in tekrarı (yorgunlukta gözden kaçan tuzaklar). Pratik kural: sprint planı yapılırken charter referansı + tahmini saat hesabı zorunlu, oturum kapasitesi (4-6 saat odaklanmış iş) hedef sınırını belirler. Sprint 3b implementasyonunda bu disiplin korunur.

## Sayılar

- 5 görev (planlı 3 + drift keşfi 2)
- 9 PR (#22, #23, #24, #25, #26, #27, #28, #29, #30)
- 296 test gerçek execution (apps/api 56 + packages/db 11 + shared 229)
- Skip 0
- 4 yeni ADR/amendment: ADR-008 amendment (FK semantiği), ADR-002 §10 (User Lifecycle), ADR-001 §6.1 (Integration Test Infrastructure), ADR-003 §14.1.B.3 (Phase-conditional enforcement)
- 3 yeni context-anchor borç maddesi (kalıcı kayıt): CI integration test gating (resolved), Codegen Windows shell, permissions.ts plan-kod drift (Sprint 3b plan revizyonu PR #31 ile resolved)
