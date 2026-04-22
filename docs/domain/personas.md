# Kullanıcı Personaları

> Bu dosya, v5'in kim için yazıldığını netleştirir. v4'teki 5 persona'nın yerini alır. MVP için 4 rol yeterli: admin, kasiyer, garson, mutfak.

**Önemli**: Bu persona'lar v5 MVP için. Zincir yöneticisi, müdür koordinatörü, muhasebeci gibi roller yok — kapsam dışı.

---

## 1. Admin (İlhan — işletme sahibi)

**Tanım**: Restoranın sahibi. Sistemi kurar, ayarlar, raporları izler, personel ve menü yönetir.

**Bağlam**: Çoğunlukla ofisten (bilgisayar) veya evden (tablet) sisteme bağlanır. Gün içinde restoranda da olabilir ama rutin operasyonda aktif değil.

**İhtiyaçları**:
- Menü + kategori yönetimi (ürün ekle, fiyat değiştir, kaldır)
- Personel yönetimi (kullanıcı ekle, rol ver, şifre sıfırla)
- Rapor (günlük ciro, ürün bazlı satış, personel performans, stok)
- Masa planı (masa ekle/sil/yerleştir)
- Yazıcı ayarları (hangi yazıcı neyi basacak — mutfak/bar yönlendirmesi)
- Vardiya açılış/kapanış raporu

**Korkuları**:
- Gün sonu raporu yanlış çıkar → vergi/muhasebe sorunu
- Personel sistemi yanlış kullanır → sipariş kaybı
- Cloud çöker → restoran durur

**Başarı**: Haftada 1-2 kez açıp raporları incelemek yeterli; günlük operasyon personel tarafından kesintisiz yürür.

---

## 2. Kasiyer

**Tanım**: Restoranın kasasında oturan, adisyon keser, ödeme alır, paket siparişleri telefonla kayıt eden kişi. Genelde restoranın en deneyimli personeli.

**Bağlam**: Tek bir sabit cihaz (tarayıcı açık bilgisayar) üzerinde çalışır. 8-10 saat ara vermeden ekran başında. Yoğun saatlerde (öğle + akşam) aynı anda 5-10 masaya ait adisyon açıktır. Restoranda 25 masa var.

**İhtiyaçları**:
- Hızlı masa açma/kapama
- Açık adisyonları görme (masa numarasına göre)
- Parçalı ödeme (bir masada 3 kişi ayrı ayrı ödüyor)
- Paket servis kayıt (telefon gelir — Caller ID ile otomatik müşteri tanıma)
- Masa taşıma / birleştirme
- Gün sonu kapanış raporu (POS)

**Korkuları**:
- Yoğun saatte sistem yavaşlar → kuyruk
- Yanlış masaya sipariş yazar → müşteri şikayeti
- Kartlı ödeme kabul edilmezse müşteri gider

**Başarı**: Adisyon kesme süresi < 30 saniye, parçalı ödeme < 1 dakika, hiç "sistem donuyor" demez.

---

## 3. Garson

**Tanım**: Masa servisi yapan, müşteriden sipariş alan, yemeği getiren kişi. 2-4 kişi olabilir. Gençler, el becerisi var, teknolojiye yatkın.

**Bağlam**: **Mobil cihazla** (kendi telefonu veya restoranın tableti) çalışır. Sürekli hareket halinde. Yoğun saatte koşarak ilerler. Ellerinde tabak/tepsi olabilir, tek elli giriş yapar.

**İhtiyaçları**:
- Hızlı masa seçme (25 masa listeden değil, görsel planından)
- Hızlı ürün ekleme (kategori > ürün, fiyat görünür)
- Not ekleme (az tuzlu, ekstra peynir vs.)
- Siparişi mutfağa gönder (tek tık)
- Adisyon durumunu görme (bu masaya ne gitti, ne kaldı)
- Çağrı geldiğinde müşteriye seslenme (mutfak hazır)

**Korkuları**:
- Mobilde buton küçük, yanlış basarım
- Sipariş "kayboldu" der, mutfak almadı → müşteri bekler
- Hızlı değişen masa planı kafasını karıştırır

**Başarı**: Sipariş girişi (3-4 kalem) < 45 saniye. Yoğunlukta panik yaşamadan, ıslak parmakla bile ekrana basabilir.

---

## 4. Mutfak (aşçı / mutfak sorumlusu)

**Tanım**: Mutfağa giren siparişleri sıraya dizen, hazırlayan, "hazır" işaretleyen kişi. Bar varsa aynı rolün içecek versiyonu da.

**Bağlam**: Ellerde yağ, su, un var. **Dokunmatik ekran** mutfakta sabit duruyor (veya büyük bir tablet duvara asılı). Yazıcı fişi de aynı anda basılı olarak çıkar (yedek). Yoğun saatte 8-12 sipariş aynı anda "hazırlanıyor" durumunda olabilir.

**İhtiyaçları**:
- Açık siparişleri büyük puntolu kartlar halinde görme
- Sipariş geliş sırası net (en eski önde)
- "Hazır" butonu iri, tek tıkla basılabilir
- Kalem bazlı işaretleme (tavuklu geldi, pilav bekliyor)
- Sesli uyarı yeni sipariş geldiğinde
- Notları (özel istek) büyük punto + vurgulu göstermek

**Korkuları**:
- Sipariş görülmedi, müşteri bekletildi
- Dokunmatik ekran yağ/su sebebiyle çalışmaz
- "Hazır" deyip garson görmedi, yemek soğudu

**Başarı**: Hiç sipariş atlanmaz, "hazır" sinyali 2 saniye içinde garsona ulaşır, mutfak rahat çalışır.

---

## Rol matrisi (yetki bazlı)

| Aksiyon | Admin | Kasiyer | Garson | Mutfak |
|---|---|---|---|---|
| Menü düzenleme | ✅ | ❌ | ❌ | ❌ |
| Personel ekleme | ✅ | ❌ | ❌ | ❌ |
| Rapor görme | ✅ | Kendi vardiyası | ❌ | ❌ |
| Masa açma/kapama | ✅ | ✅ | ✅ | ❌ |
| Sipariş girme | ✅ | ✅ | ✅ | ❌ |
| Siparişi mutfağa gönderme | ✅ | ✅ | ✅ | ❌ |
| Sipariş "hazır" işaretleme | ✅ | ❌ | ❌ | ✅ |
| Ödeme alma | ✅ | ✅ | ❌ | ❌ |
| İkram / iskonto | ✅ | ✅ (limit altında) | ❌ | ❌ |
| Masa silme (yanlışlıkla açıldı) | ✅ | ✅ | ❌ | ❌ |
| Günlük kapanış raporu (POS) | ✅ | ✅ (vardiya sonu) | ❌ | ❌ |

İlk ADR'lerden birinde bu matrisin teknik karşılığı kesinleştirilir (ADR-002 Auth stratejisi içinde).

---

**Terminoloji notu:** Türkiye'de yasal **Z raporu** fiziksel yazarkasadan alınır ve POS kapsamı dışındadır (sinyal #32). Bu sistemdeki **"günlük kapanış"** POS'un kendi gün sonu kapanış raporudur (ciro, sipariş sayısı, ödeme kırılımı, anomali özeti). İki kavram karıştırılmamalı.
