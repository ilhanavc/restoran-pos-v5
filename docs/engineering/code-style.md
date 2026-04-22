# Kod Standartları

## Genel ilkeler

- **TypeScript strict mode zorunlu**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- **`any` yasak**: `unknown` kullanılabilir, type guard'larla daraltılır
- **Immutability default**: `const` birincil tercih, mutation açıkça yorumlanır
- **Pure function'lar tercih edilir**: Yan etkileri izole et (IO, time, randomness dışarıda)
- **YAGNI + KISS**: Şimdi ihtiyaç yoksa yazma. Okunur kod > clever kod.

## Dil ve adlandırma

- Kod dili: İngilizce
- Kullanıcıya görünen metin: Türkçe, i18n key üzerinden
- Değişken: `camelCase` (`orderTotal`)
- Type / Interface / Class: `PascalCase` (`OrderRepository`)
- Dosya: `kebab-case` (`order-repository.ts`)
- Test dosyaları: `<source>.test.ts` veya `<source>.spec.ts`
- Bool değişkenler "is/has/should" ile başlar: `isOpen`, `hasTax`, `shouldPrint`
- Abbreviation yasak: `usr` yerine `user`, `req` yerine `request`. Yaygınlar hariç (`id`, `url`, `api`, `db`)

## Dosya organizasyonu

Her source file:
1. Import'lar (önce external, sonra internal, sonra type-only)
2. Type tanımları
3. Constant'lar
4. Ana export
5. Helper fonksiyonlar (private)

Paket yapısı (Clean Architecture):
```
packages/domain/src/<context>/
  ├── entities/        ← Aggregate root'lar (Order, Menu, Customer)
  ├── value-objects/   ← Money, TableNumber, PhoneNumber
  ├── events/          ← OrderPlaced, PaymentReceived
  ├── policies/        ← İş kuralları (discount policy, tax policy)
  └── repositories/    ← Interface'ler (impl yok, sadece abstract)
```

## TypeScript tipleri

- **`zod` schema'ları tek kaynak**: Runtime validation + compile-time type
- API sınırlarında (request/response, DB I/O, external services) her zaman zod
- Internal pure business logic'te doğrudan interface kullanmak OK

Örnek:
```typescript
import { z } from 'zod';

export const OrderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceKurus: z.number().int().nonnegative(),
  modifiers: z.array(z.string().uuid()).default([]),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;
```

## Para birimi

**Para her zaman integer kuruş olarak tutulur.** `number` (float/double) asla. Hesaplamalar `bigint` veya özel `Money` value object.

❌ Yasak: `totalPrice = 24.75`  
✅ Doğru: `totalPriceKurus = 2475`

Formatlayıcı: `formatTRY(2475)` → `"24,75 ₺"`

## Zaman

- Tüm iç temsil: UTC ISO string veya epoch millis
- Formatlama: saat dilimi aware, `Intl.DateTimeFormat` ile TR locale
- DB'de: `TIMESTAMPTZ` (PostgreSQL) / `TEXT ISO` (SQLite)

## Error handling

- Domain error'ları `Error` subclass'ı: `DomainError`, `ValidationError`, `NotFoundError`, `ConflictError`
- İnfrastructure error'ları sarılıp domain error'a çevrilir (katman sızıntısı yasak)
- HTTP katmanında tek bir error middleware hepsini uygun status code'a çevirir
- Kullanıcıya asla raw error message gitmez (i18n key'li mesaj + sentry reference id)

## Async

- `async/await` tercih, `.then()` chain'leri yasak (Promise.all hariç)
- Cancelation: `AbortController` + `AbortSignal` destekle
- Long-running'lerde ilerleme bildirimi (progress callback veya event)

## Logging

- `console.log` yasak (ESLint ile engellenir). `pino` kullan.
- Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- Structured log (JSON), mesaj değil anahtar-değer: `logger.info({ orderId, branchId }, 'order.placed')`
- PII logging: **yasak**. Müşteri telefonu, adresi, ad-soyad log'a yazılmaz.

## Yorumlar

- Yorum "ne" yapar değil "neden" yapar anlatır. Kod zaten ne yaptığını söyler.
- TODO: yasak. Issue aç, linki yorumda bırak: `// see #123`
- JSDoc sadece public API'lar için (library kullanıcısı görecekse)

## Import'lar

- Absolute path: `@/domain/order`, `@/ui/Button`
- Relative path sadece aynı klasör içinde: `./helpers`
- Circular dependency: CI ile engellenir (madge)

## Lint config

- ESLint: `@typescript-eslint/recommended-type-checked`, `eslint-plugin-import`, `eslint-plugin-promise`, `eslint-plugin-unicorn`
- Prettier: 100 karakter, 2 space, single quote, trailing comma
- Husky + lint-staged ile commit öncesi otomatik
