# Mağaza Vitrin Metinleri — Taslak (Restoran POS Garson)

> **Dayanak:** ADR-031 Amendment 4 K6 (`.claude/memory/decisions.md`).
> **Amaç:** [USER]'ın App Store Connect ve Google Play Console formlarına **kopyala-yapıştır** yapacağı Türkçe metinler.
> **Durum:** Taslak — konsola girilmeden önce ürün sahibi okur/onaylar.
> **Uyarı:** Metinler uygulamanın gerçek işlevini anlatır; pazarlama abartısı bilinçli olarak kullanılmamıştır (yanlış beyan = inceleme sorusu).

---

## 1. Uygulama adı

```
Restoran POS Garson
```

- `app.json` içindeki `expo.name` ile birebir aynıdır (ADR-031 Amd4 K6: ad korunur).
- App Store adı sınırı 30 karakter · Play "App name" sınırı 30 karakter → 19 karakter, uygun.

**Alt başlık (App Store "Subtitle", 30 karakter sınırı):**

```
Masa ve adisyon yönetimi
```

---

## 2. Kısa açıklama (Google Play "Short description", 80 karakter sınırı)

```
Restoran personeli için masa, adisyon ve sipariş yönetimi uygulaması.
```

(68 karakter.)

---

## 3. Tam açıklama (Google Play "Full description" / App Store "Description")

```
Restoran POS Garson, restoran personelinin salondaki işini telefondan yürütmesi için
tasarlanmış bir servis uygulamasıdır. Garson masaya gider, siparişi orada alır ve mutfağa
anında gönderir; kasaya gidip not düşmek ya da fiş beklemek gerekmez.

Uygulamayla yapabilecekleriniz:

• Masaların anlık durumunu görme: boş, dolu ve adisyonu açık masalar tek ekranda görünür.
• Masaya adisyon açma ve mevcut adisyona ürün ekleme.
• Menüden kategori ve ürün seçerek sipariş alma; porsiyon, ürün özelliği ve sipariş notu
  girme.
• Alınan siparişi mutfağa ve ilgili hazırlık istasyonuna gönderme.
• Adisyondaki kalemleri, adetleri ve toplam tutarı görüntüleme; gerektiğinde kalem
  düzeltme ve iptal.
• Paket servis siparişlerini görme ve takip etme.
• Sipariş durumu değiştiğinde anlık bildirim alma.

Uygulama, işletmenin kendi sunucusuyla çalışır ve kullanım için işletme tarafından
oluşturulmuş bir personel hesabı gerektirir. Genel kullanıma açık bir sipariş veya rezervasyon
hizmeti değildir; müşteriler için değil, restoran çalışanları için üretilmiştir.

Veriler yalnızca işletmenin kendi sunucusunda tutulur, üçüncü taraflarla paylaşılmaz.
Uygulamada reklam ve izleme (tracking) bulunmaz.

Gizlilik politikası: https://restoranpos.org/privacy
```

---

## 4. Anahtar kelimeler (App Store "Keywords", 100 karakter sınırı, virgülle ayrılır)

```
restoran,adisyon,garson,sipariş,masa,pos,kafe,lokanta,servis,mutfak,paket servis
```

(80 karakter.) Not: App Store'da uygulama adında geçen kelimeleri tekrar etmek gereksizdir;
Play'de ayrı bir anahtar kelime alanı yoktur, kelimeler tam açıklamada doğal olarak geçer.

---

## 5. Kategori

| Mağaza | Seçim |
|---|---|
| App Store | **Business (İş)** — birincil. İkincil (istenirse): Productivity (Verimlilik). |
| Google Play | **Business (İş)** — uygulama türü: Apps (Uygulamalar), oyun değil. |

**Gerekçe (ADR-031 Amd4 K6):** "Yiyecek ve İçecek" kategorisi tüketiciye hizmet veren
uygulamalar içindir. Bu uygulama personele hizmet eder; yanlış kategori inceleme ekibinden
"bu uygulama tüketici için mi?" sorusunu ve gereksiz red riskini doğurur.

---

## 6. Diğer vitrin alanları

| Alan | Değer |
|---|---|
| Gizlilik politikası URL'i | `https://restoranpos.org/privacy` |
| Destek e-postası | **[USER] belirleyecek** (ADR-031 Amd4 K5) — aynı adres gizlilik sayfasında da görünür |
| Destek URL'i (App Store, istenirse) | `https://restoranpos.org/privacy` (iletişim bölümü içerir) |
| Pazarlama URL'i | Boş bırakılabilir (zorunlu değil) |
| Fiyat | Ücretsiz · uygulama içi satın alma YOK |
| İçerik derecelendirmesi | Herkes / 3+ (şiddet, kullanıcı içeriği, sosyal etkileşim yok) |
| Yaş sınırı | Yok |
| Ülke/bölge | Türkiye (yeterli) — dünya geneli seçilirse de metinler Türkçedir |

---

## 7. İnceleme notu (App Store Connect "Notes" / Play "App access" açıklaması)

**Güncel metin (2026-10-19, ADR-043 demo tenant'ına göre):**

```
Bu uygulama tek bir restoranın (Dilan Pide, Türkiye) kendi personeli tarafından kullanılan
dahili bir operasyon aracıdır. Halka açık bir tüketici hizmeti sunmaz. Kullanım için işletme
tarafından oluşturulan bir personel hesabı zorunludur; bu nedenle inceleme için bir demo
hesap sağlanmıştır.

Demo hesap, gerçek restoranın verisine değil, yalnızca inceleme amacıyla oluşturulmuş AYRI
bir demo işletmeye bağlıdır. İçinde gerçek müşteri bilgisi veya gerçek sipariş yoktur;
2 bölge, 10 masa ve 15 örnek ürün bulunur. Bu nedenle açık sipariş listesi başlangıçta
boştur — bu beklenen durumdur.

Demo hesapla masa listesi görülebilir, adisyon açılabilir, sipariş oluşturulabilir ve ödeme
alınabilir. Yapılan hiçbir işlem gerçek işletmeyi etkilemez.

Uygulama reklam içermez, üçüncü taraflarla veri paylaşmaz ve uygulama içi satın alma sunmaz.
```

**Metinde ROL adı GEÇMEZ — bilinçli.** Eski metin *"düşük yetkili bir 'garson' rolünde"* diyordu;
ADR-043 ile kimlik demo tenant'ın **admin** hesabına geçince bu cümle **yanlış beyana** dönüştü
(2026-10-19'da fark edildi). Rol adı yazılırsa hesap her değiştiğinde metin bayatlar. Ayrıca
Apple'a "incelemeciye yönetici hesabı verdik" demek gereksiz soru davet eder. Rol yerine
**demo işletmenin izole olduğu** anlatılır — bu her kimlikte doğru kalır.

**Boş liste uyarısı da bilinçli:** demo tenant'ta 0 sipariş var; incelemeci boş ekranı
"uygulama çalışmıyor" sanabilir (Guideline 4.2 riski). İlk turda benzer bir bilgi talebi
gelmişti (`project_app_store_live`).

Demo hesap kimlik bilgisi **yalnızca mağaza konsollarına** girilir; repoya/ADR'ye yazılmaz
(ADR-031 Amd4 K8).

> ⏳ **Uygulama durumu:** bu metin **henüz App Store Connect'e yapıştırılmadı** (2026-10-19;
> Chrome eklentisi bağlantısı koptuğu için Claude giremedi). Konsolda hâlâ eski "garson"lu
> metin duruyor. ASC → App Review Information → **Edit** → Notes → yapıştır → **Save**.
> Play tarafındaki "Oturum açma bilgileri" alanında ayrı bir açıklama metni yok, yalnız kimlik
> var; orası 2026-10-19'da güncellendi.

---

## 8. Ekran görüntüsü planı (içerik rehberi — çekim [USER]/ayrı iş kalemi)

| # | Ekran | Gösterilecek |
|---|---|---|
| 1 | Masalar | Salon görünümü, dolu/boş masa renkleri |
| 2 | Sipariş alma | Kategori + ürün seçimi |
| 3 | Adisyon | Kalemler, adet, toplam tutar |

Kurallar: gerçek cihaz/emülatörden alınır (mockup render değil); iOS için 6.7" ve 6.5",
Android için telefon boyutu; her mağaza için en az 3 adet. **Gerçek müşteri adı/telefonu
GÖRÜNMEZ** — demo veri kullanılır veya maskelenir (ADR-024 PII disiplini).
