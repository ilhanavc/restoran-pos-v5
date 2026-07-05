# v3 Müşteri Veri Modeli & Excel Export — v5 Taşıma Referansı

> v3 (`D:\dev\restoran-pos-v3`) READ-ONLY referans. Bu doküman v3'ün müşteri veri
> yapısını ve Excel export davranışını, v5 müşteri import'u (`apps/api/scripts/import-v3-customers.ts`,
> ADR-016 §11.5) açısından özetler. Session 82'de DB introspection + export kodu + kullanıcının
> sağladığı gerçek export dosyası ile doğrulandı. Kaynak etiketleri: **Kodda tespit** (şema/kod),
> **Kullanıcı dosyası** (sağlanan xlsx), **Doğrulanmamış**.

## 1. v3 müşteri veri modeli (SQLite)

**Kodda tespit** (DB introspection, `D:\dev\restoran-pos-v3\server\data\pos.db` — geliştirici makinesindeki **dev kopya**, 4 müşteri):

- **`customers`**: `id, business_id, full_name, first_name, last_name, note, is_blacklisted, blacklist_note, total_orders, last_order_at, created_at, updated_at`
  - Hem `full_name` hem `first_name`/`last_name` mevcut (ikisi de dolu olabilir; export duruma göre birini kullanır — §2).
  - **`customers` tablosunda telefon/adres kolonu YOK** — ayrı tablolarda.
- **`customer_phones`** (1-to-many): `id, customer_id, phone, is_primary, normalized_phone, created_at`
  - **Bir müşterinin BİRDEN ÇOK telefonu olabilir.** `is_primary` bayrağı birincili işaretler.
- **`customer_addresses`** (1-to-many): `id, customer_id, title, address, address_note, is_default, province, district, neighborhood, created_at`
  - **Bir müşterinin BİRDEN ÇOK adresi olabilir.** `is_default` varsayılanı işaretler.

**Doğrulanmamış → Netleşti:** `server/data/pos.db` yalnız 4 müşteri içerir = dev kopya, gerçek defter DEĞİL. Gerçek aktif defter kullanıcının restoran PC'sinden export ettiği dosyadır (**1475 müşteri**, §3).

## 2. v3'te İKİ farklı export mekanizması

**Kodda tespit** — `D:\dev\restoran-pos-v3\server\routes\customers.js:447-501` (`GET /api/customers/export`):
- Başlıklar: `Müşteri Adı`, `Müşteri Soyadı`, `Müşteri Telefonu`, `Müşteri Telefonu 2`, `Adres Başlığı`, `Adres`, `Adres Tarifi`, `İl`, `İlçe`, `Mahalle`, `Toplam Sipariş Sayısı`.
- İsim: `first_name`/`last_name` **ayrık** iki kolon (null ise `full_name` bölünür).
- Telefon: birincil + (varsa) bir ikincil = 2 kolon; **3+ telefon sessizce düşer**.
- Adres: yalnız `is_default`/ilk adres; diğer adresler düşer.
- `No` kolonu YOK. → **Bu format v5 import'un beklediği başlıklarla UYUŞMAZ** (dönüşüm gerektirir).

**Kullanıcı dosyası** — kullanıcının sağladığı gerçek export (`Müşteriler_1783237091142.xlsx`) FARKLI bir mekanizmadan (finansal müşteri raporu) gelir:
- Başlıklar: `No`, `Ad Soyad`, `Telefon`, `Mahalle`, `Adres`, `Bakiye`, `Toplam Tutar`, `İndirim Tutarı`, `Toplam Sipariş Sayısı`.
- İsim: **tek `Ad Soyad`**; telefon: **tek `Telefon`** (2. numara YOK); `No` var; ek finansal kolonlar var.
- → **v5 import'un beklediği 6 başlıkla BİREBİR eşleşir** (`No/Ad Soyad/Telefon/Mahalle/Adres/Toplam Sipariş Sayısı`; `V5_MISSING_REQUIRED: []`). Bakiye/Toplam Tutar/İndirim Tutarı okunur ama YAZILMAZ (ADR §11.2 — bakiye v5.1 kapsam-dışı).

**Sonuç:** Kullanıcının kullandığı export v5 import'a hazır; ajanın bulduğu `/export` route'u AYRI bir yol (2. telefon içerir ama uyumsuz format).

## 3. Gerçek dosya + v5 import forecast (Session 82, dry-run)

**Kullanıcı dosyası** (`Müşteriler_1783237091142.xlsx`, sheet `data`, 1475 veri satırı) — PII basılmadan agregat:

| Metrik | Değer | Import davranışı |
|---|---|---|
| Toplam satır | 1475 | |
| Geçerli müşteri | **1469** | 6 satır ad<2 → `customersSkippedInvalidName` |
| Mükerrer `No` (legacy_v3_no) | 6 | Gerçek DB'de `UNIQUE(tenant_id, legacy_v3_no)` + ON CONFLICT → 2.si skip → net **~1463** |
| Telefon dolu | 1094 (%74) | 375 boş → `phonesSkippedEmpty` |
| Mükerrer normalize telefon | ~87 | `UNIQUE(tenant_id, normalized_phone)` → 2.si skip; müşteri telefonsuz girer |
| Adres dolu | 126 | çoğu müşteri adressiz (telefon-siparişi) |
| Mahalle dolu | 30 | |

**Dry-run çıktısı** (gerçek dosya, `--dry-run`, DB gerekmez): `Toplam satır 1475 · Eklenen müşteri 1469 · Atlanan geçersiz isim 6 · Eklenen telefon 1094 · Atlanan telefon boş 375 · Eklenen adres 126`. Dry executor conflict görmediği için mükerrer-No/telefon atlamaları raporda 0 çıkar; gerçek DB'de yukarıdaki net değerler geçerlidir.

## 4. Taşıma için çıkarımlar

- **Import teknik olarak hazır** — kullanıcı dosyası v5 import ile birebir uyar, dry-run temiz koştu (çökme yok).
- **2. telefon kaybı:** aktif dosyada tek telefon var (v3'ün 2. numaraları export anında düşmüş). Operasyonel olarak 2. numara gerekiyorsa: `/export` route'u (`Müşteri Telefonu 2` içerir) kullanılıp import'a bir format-dönüşüm/başlık-map eklenmeli — **ayrı iş kalemi**, MVP-dışı kabul (pilot).
- **Paylaşılan telefonlar (87):** aile/aynı hane; import'ta ilk müşteriye bağlanır, diğerleri telefonsuz. Bug değil, veri gerçeği.
- **Kara liste:** export'ta kolon yok (ADR-016 Amd 1 ile tutarlı) → import HER ZAMAN `is_blacklisted=false`; canlıda elle işaretlenir.
- **Prod import hâlâ KVKK go/no-go'ya bağlı:** teknik hazırlık ≠ izin. `docs/compliance/kvkk-data-inventory.md` §11'deki hukuki maddeler (#2 m.9 aktarım, #3 aydınlatma, #4 yedek) kapanmadan prod'a KOŞULMAZ.
