# Plan — "Tahsil Edilecek" göstergesine açık paket siparişlerini ekle (anasayfa + raporlar)

- **Tarih:** 2026-11-26 · **Talep:** ürün sahibi ("teslim edilmemiş paket sipariş tutarları da tahsil edilmemiş masa tutarı gibi hesaplanıp anasayfada ve raporlarda gözükmeli; eksik iş istemiyorum")
- **Durum:** PLAN — ürün sahibi onayı bekliyor. Kod yazılmadı.

## 1. Ürün sahibinin kararları (2026-11-26)

| Soru | Cevap |
|---|---|
| Hangi paketler? | **Henüz ödenmemiş olanlar** — açık paketlerin **kalan** (ödenmemiş) tutarı. Teslimden önce kasada ödenmiş paket girmez (zaten tahsil edildi); "teslim edildi" anında otomatik ödendiği için düşer. Masa göstergesiyle aynı mantık. |
| Anasayfada nasıl? | **"Tahsil Edilecek" yazısı yeterli** → bugünkü "Masalarda Tahsil Edilecek" kartı **"Tahsil Edilecek"** olur, değeri **masa + paket** kalanı. *(Yorum — görünüm onayında teyit edilecek: tek kart, ayrı kart yok.)* |
| Raporlarda nerede? | **Rapor özet kartları** — Raporlar sayfasının üstündeki kartlara aynı "Tahsil Edilecek" eklenir. Z raporu (gün sonu) **değişmez**. |

## 2. Ölçülen bugünkü durum

**Kodda tespit:**
- Anasayfa kartı (`apps/web/src/features/dashboard/DashboardPage.tsx:87-136`) tutarı `GET /tables` masa listesinden hesaplıyor (`openTabTotalCents`, `packages/shared-domain/src/table.ts:171-183`) → **paketler bilerek hariç** (kod yorumu `:84-85`), etiket `dashboard.kpi.openTab` = "Masalarda Tahsil Edilecek" (`tr.json:61`).
- Masa + paketi birlikte sayan uç **zaten var ve testli**: `GET /reports/kpi/open-orders-total` (`apps/api/src/routes/reports/open-orders-total.ts`) → `Σ max(0, total − ödenen)`, iptal edilmiş ödemeler hariç, `status='open'`, tarih penceresi yok (canlı). Bugün yalnız **mobil** Satış ekranı kullanıyor. Bu uç ADR-026 Amd5 K6'da tam bu gerekçeyle açılmıştı ("`GET /tables` paketleri kaçırır").
- Raporlar sayfası (`apps/web/src/features/reports/ReportsPage.tsx`) 4 kart gösteriyor (ciro, sipariş sayısı, ortalama adisyon, iptal); açık tutar **yok**. Sayfada **tarih aralığı filtresi** var.
- Anasayfa masa kartı otomatik yenilenmiyor (yalnız "Yenile" düğmesi); rapor kartları 60 sn'de bir yenileniyor.

**Canlı veri (prod, salt-okur, 2026-11-26 12:53):**
- Açık siparişler: 6 paket (hepsi "hazırlanıyor") = **7.760 TL** · 3 masa = **1.940 TL** → bugünkü kart yalnız 1.940 TL gösteriyor.
- Sipariş durumları pratikte yalnız `open` / `paid` / `cancelled` → uçtaki `status='open'` ile masa listesindeki "bitmemiş" tanımı **aynı sonucu** verir.
- Son 30 günde 19 paket teslimden önce kasada ödenmiş → tanım gereği girmez (doğru).

**v3 (kapsam kapısı):** v3 açık masa ve paketleri **tek tek tutarlarıyla** listeliyordu (masa ekranı paket listesi, raporlarda "Açık Adisyonlar" tablosu), toplam göstermiyordu. → **Kapsamda:** v3'te var olan bilginin özet hâli + v5'teki masa göstergesinin tamamlanması + ürün sahibinin açık talebi. "Hedef değil" listesinde değil. Yeni yapısal karar yok → **ADR-026 Amd5'e kısa not** (web anasayfa da `open-orders-total`'a geçti), yeni ADR gerekmez.

## 3. Tasarım

**Tek doğruluk kaynağı:** anasayfa kartı da, rapor kartı da, mobil Satış ekranı da **aynı uçtan** (`open-orders-total`) beslenir → üç ekran asla farklı rakam göstermez. API **değişmez** (yanıt şekli aynı: `openTotalCents`, `openOrderCount`, `asOf`).

| Yer | Değişiklik |
|---|---|
| **Web — veri** | `useOpenOrdersTotal` kancası (web `dashboard/api/reports.ts`, mevcut 60 sn yenileme + `REPORTS_KEY` → "Yenile" düğmesi bunu da tazeler) |
| **Web — anasayfa** | Kart etiketi **"Tahsil Edilecek"**; değer uçtan; kartta küçük ikinci satır **"N açık sipariş"** (*görünüm onayında karar*); yükleniyor `…` / hata `—` deseni aynen |
| **Web — raporlar** | Özet kartlarına **"Tahsil Edilecek"** kartı; 🔴 bu kart tarih filtresine **bağlı değil** → kartta **"Şu an"** ibaresi (HCI: kullanıcı seçili tarih aralığına ait sanmasın) |
| **i18n** | `dashboard.kpi.openTab` metni "Tahsil Edilecek" olur (anahtar aynı kalır ya da `openOrders`'a taşınır — i18n-key-checker kararı); yeni `reports.kpi.openOrders`, `…openOrdersNow`, `…openOrderCount` (sayı için `count` değil `orderCount` — i18next çoğul tuzağı) |
| **Temizlik** | Anasayfa artık `openTabTotalCents` kullanmazsa ve başka kullanan yoksa: fonksiyon **mobil/başka yerde kullanılıyor mu** bakılır; yalnız bu değişikliğin ürettiği yetim (kullanılmayan import) silinir. `useTables` anasayfada başka iş için kullanılıyorsa kalır |
| **Mobil** | **Değişmez** (zaten bu uçtan masa + paket gösteriyor, "Açık adisyonlar") |

**Görünüm onayı ÖNCE** (proje kuralı: "önce görünümü göster"): anasayfa ve raporlar için iki küçük görsel taslak → ürün sahibi onayı → sonra kod.

## 4. Uygulama adımları (sırayla)

1. **Görünüm taslağı** (anasayfa kartı + rapor kartı, "N açık sipariş" ve "Şu an" ibaresiyle) → ürün sahibi onayı.
2. **ADR-026 Amd5'e not** (web anasayfa kaynağı değişti, kapsam masa + paket).
3. **Web kodu:** kanca + anasayfa kartı + rapor kartı + i18n (TR).
4. **Testler:**
   - API: `reports-open-orders-total.test.ts`'e eksik vakalar — **teslimden önce kasada ödenmiş paket girmez**, **"teslim edildi" yapılan paket düşer**, açık paket + kısmi ödeme kalan doğru, iptal edilmiş paket girmez, **dünden kalan açık sipariş** de sayılır (canlı gösterge, tarih süzgeci yok — #790 dersi).
   - Web: anasayfa kartı (yükleniyor / veri / hata / 0 TL), rapor kartı ("Şu an" ibaresi, tarih filtresi değişince bu kartın değişmediği), "Yenile" düğmesinin bu sorguyu tazelediği.
   - i18n anahtar testi (eksik/fazla anahtar).
5. **İncelemeler (proje kuralı):** `hci-reviewer` + `turkish-ux-reviewer` + `i18n-key-checker` + `kapsam-kilidi-reviewer`; bulgular düzeltilir.
6. **Yerelde gerçek tarayıcıda doğrulama:** yerel API + web → bir masa + iki paket (biri teslimden önce ödenmiş) aç → anasayfa ve raporlar kartında beklenen tutar → paketi "teslim edildi" yap → tutarın düştüğünü gör → ekran görüntüsü.
7. **PR → CI (head SHA) → ürün sahibi onayıyla birleştirme.**
8. **Canlıya:** gece yayınına eklenir (03:00–06:00; migration yok). Kabul: ertesi servis açılışında anasayfa "Tahsil Edilecek" = masa + paket; mobil Satış ekranındaki "Açık adisyonlar" ile **aynı rakam**.

## 5. Bitti sayılma ölçütü (DoD)

- [ ] Görünüm ürün sahibince onaylandı
- [ ] Anasayfa, raporlar ve mobil aynı anda aynı tutarı gösteriyor (yerel tarayıcıda kanıt)
- [ ] Yukarıdaki API + web testleri yazıldı, yerelde ve CI'da yeşil (`Test Files` satırı dahil)
- [ ] Dört inceleme ajanı onayı, bulgular kapandı
- [ ] Tüm metinler i18n anahtarıyla, Türkçe
- [ ] ADR-026 Amd5 notu düşüldü
- [ ] Canlıda kabul ölçütü sağlandı (gece yayınından sonra)

## 6. Kapsam dışı (bilerek) ve ayrı iş

- **Z raporu (gün sonu fişi) değişmez** — ürün sahibi kararı.
- **Mobil değişmez** — zaten doğru.
- 🔴 **Ayrı iş — bulunan gizli hata:** paket "teslim edildi" yapılınca sistem **siparişin TAMAMI kadar** ödeme yazıyor (`packages/db/src/repositories/orders.ts` `updateTakeawayStage`); teslimden önce **kısmi** ödeme alınmışsa müşteri **fazla tahsil edilmiş** görünür. Canlıda hiç yaşanmamış (paketlerde birden fazla ödeme = 0, fazla tahsilat = 0) ama kod buna izin veriyor. Ödeme kodu olduğu için ayrı PR + `security-reviewer`; **bu işten hemen sonra** yapılması önerilir. Bu iş bitmeden de yeni gösterge doğru kalır (kalan tutar uçta `max(0, …)` ile hesaplanıyor).
- Dünden kalmış unutulmuş bir açık sipariş göstergede **görünmeye devam eder** (bugünkü masa kartıyla aynı, bilinçli: "şu an ne kadar para dışarıda"). "N açık sipariş" satırı bunu fark etmeyi kolaylaştırır.
