# Türkçe Restoran Terminolojisi

Bu sözlük projede kullanılacak Türkçe terimlerin tek kaynağıdır. Kod tarafında English variable adları kullanılsa da i18n key'ler ve kullanıcıya görünen metinler bu sözlüğe uymak zorundadır.

## Temel terimler

| Türkçe | İngilizce (kod tarafı) | Açıklama |
|---|---|---|
| Adisyon | Check / Bill | Masaya getirilen hesap özeti |
| Sipariş | Order | Müşterinin verdiği ürün talebi |
| Masa | Table | Fiziksel oturma yeri |
| Pax | Guest count | Masadaki kişi sayısı |
| Bölge / Salon | Zone | Masaların gruplandığı alan (teras, bahçe, salon 1) |
| Menü | Menu | Ürünlerin organize listesi |
| Kategori | Category | Ana menü bölümlemesi (içecekler, ana yemekler) |
| Ürün | Product | Satılabilir menü öğesi |
| Modifier / Özellik | Modifier | Ürünün özelleştirme seçeneği (az pişmiş, soslu) |
| Varyant | Variant | Ürünün farklı biçimi (küçük/orta/büyük) |
| Reçete | Recipe | Ürünün içinde geçen hammadde listesi |
| Stok | Inventory | Hammadde ve mamul envanteri |
| Fire | Waste | Satışa gitmeyen kayıp stok |
| Sayım | Stock count | Fiziksel envanter sayımı |
| Ciro | Revenue | Toplam satış hasılatı |
| Kasa | Cashier / Till | Ödeme alan kişi veya fiziksel yer |
| Gün sonu | Day close | Gün kapanış işlemi |
| X raporu | X report | Gün içi özet (zero-out yok) |
| Z raporu | Z report | Gün sonu kesin rapor (zero-out yapılır) |

## Personel rolleri

| Türkçe | İngilizce (kod) | Yetki |
|---|---|---|
| Patron / İşletme sahibi | Owner | Tüm işletmelere erişim, kullanıcı yönetimi, raporlama |
| Müdür / Şube müdürü | Manager | Tek şubeye tam erişim, personel yönetimi |
| Kasiyer | Cashier | Ödeme alma, gün sonu kapatma |
| Garson | Waiter | Sipariş alma, masa yönetimi |
| Komi | Busboy / Runner | Yardımcı, sipariş taşıma |
| Şef / Aşçı | Chef / Cook | Mutfak ekran (KDS) erişimi |
| Barmen | Bartender | Bar ekran erişimi |

## Ödeme terimleri

| Türkçe | İngilizce (kod) | Açıklama |
|---|---|---|
| Ödeme | Payment | Hesabın karşılanması |
| Nakit | Cash | Fiziksel para |
| Kart | Card | Kredi/banka kartı |
| Multinet / Sodexo / Ticket | Meal voucher | Yemek kartları |
| Açık hesap | Open tab | Ödenmemiş sipariş |
| Veresiye | On account / Credit | Sonraya ertelenen ödeme |
| İkram | Comp / On the house | Ücretsiz verilen ürün |
| İskonto / İndirim | Discount | Tutardan düşüm |
| Servis bedeli | Service charge | Otomatik eklenen servis ücreti |
| Bahşiş | Tip | Gönüllü personel ödülü |
| Yuvarlama | Rounding | Ödemede küçük para yuvarlaması |
| KDV | VAT | Katma değer vergisi |
| Fatura | Invoice | Resmi ödeme belgesi |
| Fiş | Receipt | Yazarkasa çıktısı |

## Vergi ve yasal

| Türkçe | Kısaltma | Açıklama |
|---|---|---|
| Elektronik Fatura | e-Fatura | Mükellef-mükellef arası elektronik belge |
| Elektronik Arşiv | e-Arşiv | Son tüketiciye verilen elektronik belge |
| Yazarkasa | — | GİB mali mührü olan fiş yazıcı |
| Mali mühür | — | Elektronik imzalama sertifikası |
| Vergi dairesi | — | Mükellefin bağlı olduğu idare |
| Ba formu / Bs formu | — | Aylık mal-hizmet beyanname ekleri |

## Sipariş durumları

| Türkçe | İngilizce (kod) | Açıklama |
|---|---|---|
| Taslak | Draft | Henüz gönderilmemiş |
| Gönderildi | Placed / Sent | Mutfağa iletilmiş |
| Hazırlanıyor | Preparing | Mutfakta üzerinde çalışılıyor |
| Hazır | Ready | Servise hazır |
| Teslim edildi | Served | Masaya götürüldü |
| İptal | Cancelled | İptal edilmiş |
| İade | Refunded | Para iadesi yapılmış |

## Masa durumları

| Türkçe | İngilizce (kod) |
|---|---|
| Boş | Empty / Available |
| Dolu | Occupied |
| Rezerve | Reserved |
| Hesap istendi | Check requested |
| Temizleniyor | Cleaning |
| Kapalı | Closed |

## Paket servis

| Türkçe | İngilizce (kod) | Açıklama |
|---|---|---|
| Paket servis | Delivery / Takeout | Müşteriye gönderilen sipariş |
| Gel al | Pickup | Müşterinin mağazadan aldığı |
| Kurye | Courier / Driver | Teslimatçı |
| Teslimat bölgesi | Delivery zone | Kurye gidebileceği alan |
| Minimum tutar | Minimum order | Paket servis için alt limit |

## Sık kullanılan UI metinleri

Bu liste i18n key'leri için rehber:

| Key | Türkçe | İngilizce karşılık (fallback) |
|---|---|---|
| `common.save` | Kaydet | Save |
| `common.cancel` | İptal | Cancel |
| `common.delete` | Sil | Delete |
| `common.edit` | Düzenle | Edit |
| `common.confirm` | Onayla | Confirm |
| `common.back` | Geri | Back |
| `common.close` | Kapat | Close |
| `common.search` | Ara | Search |
| `common.loading` | Yükleniyor... | Loading... |
| `common.error` | Bir hata oluştu | An error occurred |
| `common.retry` | Tekrar dene | Retry |
| `order.new` | Yeni sipariş | New order |
| `order.sendToKitchen` | Mutfağa gönder | Send to kitchen |
| `order.print` | Adisyonu yazdır | Print check |
| `order.pay` | Ödeme al | Collect payment |
| `order.split` | Hesabı böl | Split check |
| `order.transfer` | Masa taşı | Transfer table |
| `order.merge` | Masaları birleştir | Merge tables |
| `table.open` | Masayı aç | Open table |
| `table.close` | Masayı kapat | Close table |
| `table.reserve` | Rezervasyon | Reserve |

## Yasak ifadeler

UI'da asla görünmeyecek:
- ❌ "Error 500"
- ❌ "Failed" (yalnız başına)
- ❌ "Null"
- ❌ "undefined"
- ❌ "Timeout"
- ❌ "Exception"
- ❌ Cesaret kırıcı negatif dil

Kullanılacak alternatifler:
- ✅ "Bir hata oluştu, tekrar deniyoruz..."
- ✅ "Bu işlem tamamlanamadı"
- ✅ "Bağlantı sağlanamadı, yerel modda devam ediyorsunuz"
