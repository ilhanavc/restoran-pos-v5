# Türkçe Glossary — Hızlı Referans

Tam sözlük: `docs/domain/glossary.md`. Bu dosya Claude Code'un hızlı erişimi içindir.

## Asla değiştirilmeyecek çeviriler

| Türkçe | Kod tarafı | Kullanıcıya |
|---|---|---|
| Adisyon | `check` | **Adisyon** (asla "hesap özeti", "bill", "fatura değil") |
| Sipariş | `order` | **Sipariş** |
| Masa | `table` | **Masa** |
| Pax | `guestCount` | **Kişi sayısı** veya **Pax** |
| Yazarkasa | `fiscalPrinter` | **Yazarkasa** |
| e-Fatura | `eInvoice` | **e-Fatura** (tireli) |
| e-Arşiv | `eArchive` | **e-Arşiv** (tireli) |
| Kasa | `cashRegister` | **Kasa** |
| Gün sonu | `dayClose` | **Gün sonu** |
| Z raporu | `zReport` | **Z raporu** |
| Fire | `waste` | **Fire** |

## Personel rolleri

Kod: `OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `BUSBOY`, `CHEF`, `BARTENDER`

UI: Patron, Müdür, Kasiyer, Garson, Komi, Şef, Barmen

## Yasak ifadeler (UI)

`Error`, `Failed`, `Null`, `Undefined`, `Timeout`, `Exception` — kullanıcıya asla gösterilmez. Hepsi sıcak Türkçe karşılıklarına çevrilir.

## i18n key konvansiyonu

- Namespace: `<module>.<action>` → `order.sendToKitchen`
- Param: ICU MessageFormat → `order.total: "Toplam: {amount, number, currency}"`
- Pluralization: ICU plural → `table.count: "{count, plural, one {# masa} other {# masa}}"`

Dosya: `packages/i18n/locales/tr.json` (tek kaynak v1)
