# Test Stratejisi

## Piramit

```
       ╱ E2E ╲          ← %10  (Playwright web, Detox mobile)
      ╱───────╲
     ╱ Integ.  ╲        ← %30  (vitest + test DB, API kontrat)
    ╱───────────╲
   ╱    Unit     ╲      ← %60  (vitest, domain logic, pure fn)
  ╱───────────────╲
```

Orantılar rehber, katı kural değil. Ama **domain layer %80+ unit coverage zorunlu.**

## Araçlar

| Katman | Tool | Not |
|---|---|---|
| Unit | Vitest | Hızlı, ESM-native, Jest uyumlu API |
| Integration (API) | Vitest + Supertest + test PostgreSQL | Test container veya docker-compose |
| E2E (web) | Playwright | Chrome + Firefox + WebKit |
| E2E (mobile) | Detox | iOS simulator + Android emulator |
| Visual regression | Playwright `toHaveScreenshot` | Kritik ekranlar |
| Load/stress | k6 | Cloud API endpoint'leri |

## Ne test edilir?

### Unit test'i yaz
- Domain entity'ler (Order, Money, Table)
- Policy'ler (DiscountPolicy, TaxPolicy)
- Value object'ler (Money.add, TableNumber.parse)
- Pure helper'lar (formatTRY, parsePhoneNumber)

### Unit test yazma
- React component'leri (Storybook + visual test yeter)
- Trivial getter/setter
- Framework'ün kendisi (Express route handler shell'i)

### Integration test'i yaz
- API endpoint'i + gerçek DB
- Repository implementasyonları
- Print Agent → yazıcı akışı (mock yazıcı ile)
- WebSocket event emission/broadcast

### E2E test'i yaz
- Sipariş oluşturma → mutfağa gönderme → ödeme → adisyon baskı (happy path)
- Paket servis Caller ID akışı
- Garson mobil → sipariş → cloud → mutfak ekranı (multi-device)
- Auth akışları (login, token refresh, logout)

## Coverage hedefi

- `packages/shared-domain/`: %85 minimum (CI hard gate)
- `apps/api/`: %70 minimum
- `apps/web/`: %60 (çok UI, coverage less meaningful)
- `apps/mobile/`: %60
- `apps/print-agent/`: %75 (kritik — yazıcıyla etkileşim)

## Test yazma stili

- **AAA**: Arrange, Act, Assert
- **Describe-it** hiyerarşisi: `describe('Order', () => describe('when placed', () => it('emits OrderPlaced event', ...)))`
- **Her test bağımsız**: Önceki test'in state'ine güvenme
- **Fixture builder pattern**: `const order = buildOrder({ status: 'placed' })` — test data üretimini merkezileştir
- **Fake/stub/mock ayrımı**: Mümkünse fake tercih (in-memory impl), mock son çare

## Red-green-refactor (TDD)

Domain layer için **TDD zorunlu**:
1. Test yaz, başarısız olduğunu gör (RED)
2. En az kodu yaz, geçir (GREEN)
3. Tekrar et et, testler hâlâ geçsin (REFACTOR)

UI / glue code için TDD zorunlu değil ama sonradan test eklemek mecburi.

## CI testleri

Her PR'da:
- Lint
- Typecheck
- Unit tests (paralel)
- Integration tests (PostgreSQL service container ile)
- Build tüm paketler

Main'e merge öncesi:
- E2E smoke test suite

Nightly (schedule'lı):
- Full E2E suite
- Visual regression
- Security scan (npm audit, trivy)

## Flaky test politikası

- Flaky test quarantine'lenir (3 tekrar kırılırsa)
- 48 saat içinde ya düzeltilir ya silinir
- Quarantine'li test ile main'e merge yasak

## Test data

- **Seed data**: Realistik Türk restoran menüsü (lokanta, kafe, pizzacı varyantları)
- **PII**: Test data'da asla gerçek PII yok (fake isim/telefon)
- **Production data**: Dev'e asla kopyalanmaz

## Performance test'i

Her sprint sonunda:
- Cloud API: p50/p95/p99 latency ölçümü ana endpoint'ler için
- Web app: cold load → sipariş ekranı interaktif süresi
- Mobile app: ilk sipariş girişi click → mutfağa iletim süresi
- Print Agent: print job queue'dan yazıcıya ulaşma süresi
