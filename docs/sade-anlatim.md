# Sistem — sade anlatım (teknik terim kullanmadan)

> **Kime:** ürün sahibine. Ürün sahibi 2026-11-14'te istedi: *"bana bu projede her şeyi anlayabileceğim şekilde açıkla."*
>
> **Bu dosyada SAYI YOK.** Sayılar (kaç sipariş, hangi sürüm, ne bekliyor) bilerek yazılmadı, çünkü bayatlıyorlar. Güncel durum tek yerde: **`docs/context-anchor.md` §2**. Burada yalnız **değişmeyen şeyler** var: sistem nelerden oluşuyor, hangi kelime ne demek, işler nasıl yürüyor.

---

## 1. Sistem altı parçadan oluşuyor

**① Almanya'daki bilgisayar (sunucu).**
Sistemin beyni. Bütün siparişler, masalar, fiyatlar, müşteriler burada. Kiralık, aylık ödeniyor. Fatura ödenmezse bu bilgisayara **dışarıdan erişim kapanır** ve restoran çalışmaz — sunucu çalışmaya devam eder ama kimse ulaşamaz. Bu daha önce iki kez yaşandı.

**② Web uygulaması.**
Kasiyerin ve müdürün tarayıcıdan açtığı ekran: masalar, ödeme alma, raporlar, ayarlar.

**③ Telefon uygulaması.**
Garsonun elindeki. Hem App Store'da hem Google Play'de yayında.

**④ Dükkandaki yazıcı programı.** *(En çok karıştırılan parça.)*
Almanya'daki bilgisayar, dükkandaki fiş yazıcısına doğrudan yazdıramaz — arada internet var, yazıcının internet adresi yok. Çözüm: dükkandaki bilgisayarda küçük bir program duruyor ve sürekli sunucuya *"bana basılacak iş var mı?"* diye soruyor. İş varsa alıp yazıcıya gönderiyor. Üç tane çalışıyor: **mutfak, fırın, kasa.**

**⑤ Telefon numarası okuyucu.**
Gelen aramada numarayı okuyup müşteriyi ekranda gösteren köprü.

**⑥ Veritabanı.**
Her şeyin yazıldığı dosya dolabı.

---

## 2. Sık geçen kelimeler — sade karşılıkları

| Terim | Anlamı |
|---|---|
| **Deploy** | Yeni kodu Almanya'daki bilgisayara taşımak. ⚠️ **Bu yapılmadıkça restoranda hiçbir şey değişmez** — kodu yazmak tek başına yetmez |
| **OTA** | Aynı şey, telefon uygulaması için: mağazadan geçmeden güncelleme göndermek |
| **Migration** | Dosya dolabının şeklini değiştirmek (yeni çekmece eklemek gibi). Riskli, çünkü içinde canlı veri var. **Geri alma düğmesi yok** — ters giderse yedekten dönülür, o yüzden her seferinde önce yedek alınır |
| **PR → CI → merge** | İş önce **öneri** olarak durur (PR), sonra robotlar kontrol eder (CI), sonra kabul edilir (merge). *"CI yeşil"* = robotlar sorun bulmadı |
| **ADR** | Yazılı karar belgesi. Yapısal bir şey yapılmadan önce *"ne karar verdik, neden"* yazılır. Sebebi: altı ay sonra kimse *"burası neden böyle"* diye sormasın |
| **Tenant / işletme** | Sistemi paylaşan bir işletme. Aynı sunucuda birden fazla işletme, birbirinin verisini **hiç görmeden** durabilir |
| **RLS** | Veritabanının kendisi, bir işletmenin verisini başkasına göstermeyi **reddeder** — kodda hata olsa bile. Büyük bir işti, bitti |
| **Fail-closed** | Emin olmayınca tahmin etmek yerine **reddetmek**. Güvenlik için doğru; yan etkisi şu: hata olunca sistem bağırmaz, **sessizce durur** |
| **Fail-open** | Tersi: emin olmayınca **basit hâliyle devam etmek**. Yazıcıda doğru olan bu — reddetmek mutfağın sipariş görmemesi demek |
| **Dalga (A/B/C/D)** | Büyük bir değişikliğin parçalara bölünmüş adımları. Hepsi bir günde yapılmaz, çünkü ters giderse neyin bozduğu anlaşılmaz |

---

## 3. Bir iş nasıl yürüyor

1. **Karar** — yapısal bir şeyse önce ADR yazılır, ürün sahibi açık soruları cevaplar.
2. **Kod** — yazılır, testleri yazılır.
3. **Kapılar** — güvenlik, veritabanı, ekran tasarımı, Türkçe metin için ayrı kontroller çalışır.
4. **Öneri + robot kontrolü** — PR açılır, CI koşar.
5. **Kabul** — merge edilir. ⚠️ **Buraya kadar restoranda hiçbir şey değişmedi.**
6. **Deploy** — kod sunucuya taşınır. **Değişiklik ancak şimdi gerçek oldu.**
7. **Kanıt** — "başarılı" yazısına değil, ölçüme bakılır: yazıcılar akıyor mu, hata kaydı temiz mi.

---

## 4. Neden bazı işler "restoran kapalıyken" yapılıyor

İki sebep:

- **Sunucu yeniden başlarken birkaç saniye kesinti olur.** Açık adisyon varken bu, kasiyerin elinde hata görmesi demek.
- **Yazıcı yolundaki hatalar sessizdir.** Yanlış giden bir değişiklik ekrana hata basmaz; sadece fiş çıkmaz. Mutfak siparişi görmez ve kimse sebebini anlamaz.

Bu yüzden yazıcıya ve girişe dokunan işler dükkan kapalıyken iner.

---

## 5. Yedek nasıl çalışıyor

Her saat, veritabanının şifreli bir kopyası alınıp hem sunucuda hem **başka bir yerde** (off-site) saklanıyor. Yedek alınmazsa ayrıca **alarm** çalıyor — yani sessizce yedeksiz kalınmıyor. Veritabanının şeklini değiştiren her işten **önce** elle bir yedek daha alınır.

---

## 6. Güncel durum nerede yazıyor

| Ne öğrenmek istiyorsun | Nereye bak |
|---|---|
| Şu an ne bitti, ne bekliyor | `docs/context-anchor.md` **§2** (tek giriş kapısı) |
| Yol haritası / sıralama | `docs/roadmap-v51-coklu-sube.md` → kod adı **PUSULA** |
| Hangi karar neden alındı | `.claude/memory/decisions.md` (ADR'ler) |
| Deploy nasıl yapılır | `docs/ops/deploy.md` |
| Satın-alma denetiminin bulguları | `docs/audit/dd-scope-triage.md` |

---

## 7. Projenin tekrarlayan tek hatası

**Kod bayatlamaz, onu çevreleyen yazılı plan bayatlar.**

Bu projede en pahalı hatalar *"kod yanlıştı"* değil, *"bir kez doğru olmuş bir dokümana dayanarak emin bir cümle kurmak"* oldu. Üç kez aynı dosya bayat çıktı. Bu yüzden kural şu: **bir durum sorusu geldiğinde dosya cevap değil, kontrol listesidir** — her madde koda ve canlı sisteme karşı yeniden ölçülür.
