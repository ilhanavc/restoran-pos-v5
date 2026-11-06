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

## Yazıcı / ajan terimleri (ADR-044 K4, 2026-11-06)

| Kavram | UI'da | UI'da ASLA |
|---|---|---|
| Restoran PC'sinde koşan print-agent servisi | **yazıcı** | "agent", "ajan", "servis", "print-agent", "binary" |
| Ajanın bildirdiği binary sürümü | **yazıcı sürümü** | "yazılım" (yazıcının firmware'iyle karışır), "versiyon" |
| Sürüm henüz bildirilmemiş | **henüz bilinmiyor** | "bildirilmedi" (eksiklik/hata gibi okunur; durum GEÇİCİ) |
| Sürüm beklenenden eski | **Güncelleme bekliyor** | "güncel değil", "eski", "hatalı" (uyarı ACİL DEĞİL — yazıcı çalışmaya devam eder) |

Kaynak: `turkish-ux-reviewer` kapısı (2026-11-06, ADR-044 PR-1). Ton kuralı: bu uyarılar **durum** bildirir, sorun ilan etmez.

## i18n key konvansiyonu

- Namespace: `<module>.<action>` → `order.sendToKitchen`
- Param: ICU MessageFormat → `order.total: "Toplam: {amount, number, currency}"`
- Pluralization: ICU plural → `table.count: "{count, plural, one {# masa} other {# masa}}"`

Dosyalar: **`apps/web/src/i18n/locales/tr.json`** (web) · **`apps/mobile/src/i18n/locales/tr.json`** (mobil).
⚠️ Bu satır 2026-11-06'ya kadar *`packages/i18n/locales/tr.json`* diyordu — **öyle bir paket yok** (`packages/` altında `db`, `shared-domain`, `shared-types` var). Yol koddan doğrulanıp düzeltildi.
