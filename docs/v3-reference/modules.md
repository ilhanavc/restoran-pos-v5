# v3 Reference — Modüller

> Phase 0 Görev 2.1. Kaynak: İlhan'ın doğrudan gözlemi + Claude Code röportajı.
> Amaç: v5 tasarımında referans — davranış/kural taşınır, kod kopyalanmaz.
> Format: Her modül A/B/C/D sorularıyla röportaj yöntemiyle doldurulmuştur.

---

## Modül Sırası (operasyonel bağımlılığa göre)

1. Ayarlar ← bu dosyada
2. Auth / Login ← bu dosyada
3. Menü
4. Masa Yönetimi + Salon Bölgeleri
5. Müşteri (CRM temel)
6. Caller ID
7. Sipariş (dine-in + paket)
8. Mutfak Ekranı
9. StoreBridge / Yazıcı
10. Ödeme
11. Raporlar
12. Rezervasyon
13. Stok
14. Audit Log
15. Yedek

---

## 1. Ayarlar

> İşletme bilgileri, kullanıcı yönetimi (CRUD), yazıcı tanımları, ekran ayarları.
> Not: Auth/Login akışı ayrı modül (2). StoreBridge, Caller ID, Audit Log, Yedek, Sürüm Notları, Mobil Cihazlar v3 Ayarlar menüsünde görünse de kendi modüllerinde ele alınır.

### A. Amaç ve Akış

Restoranın temel yapılandırma ekranlarını barındırır. Sadece **Admin** rolü girer.

v3'te "Ayarlar" menüsü altındaki gerçek ayar ekranları:

1. **Kurulum Kontrolü** — 8 adımlık operasyonel hazırlık checklist'i. Şunların durumunu gösterir: işletme bilgileri, yönetici kullanıcı, salon+masa, menü, kasa yazıcısı, mutfak yazıcısı, yerel yedekleme, StoreBridge servisi. Her adım "Hazır" veya "Uyarı" rozetli. Son tamamlanma tarihi kaydediliyor. Yeni kurulumda rehberlik için işe yarar; kurulum tamamlanmış sistemde değeri düşük.

2. **İşletme Bilgileri** — Basit form. Alanlar: işletme adı, adres, telefon, vergi numarası (vergi dairesi alanı YOK), fiş başlığı, fiş altı yazısı. Logo yükleme YOK. "Kaydet" ve "Varsayılanlara dön" butonları var.

3. **Kullanıcı Yönetimi (CRUD)** — Kullanıcı ekleme, rol atama (admin/kasiyer/garson/mutfak). Şifre sıfırlama UI mevcut ama çalışmıyor. Login akışı/JWT/token ayrı modülde (Auth / Login).

4. **Yazıcı Ayarları** — 3 yazıcı tanımlı: Bar (İçecek, "legacy" tag'li, 192.168.1.101:9100), Kasa (müşteri fişi, 192.168.1.102:9100), Mutfak (192.168.1.100:9100). Her yazıcı için: ad, rol, aktif/pasif, varsayılan müşteri yazıcısı, bağlı cihaz, kategori atamaları, otomatik yazdırma tercihleri (masa/paket/değişiklikte). Yazıcı detayında 4 sekme: Genel, Tercihler, Önizleme ve Test, Gelişmiş.

5. **Ekran Ayarları** — Tema, düzen, dil tercihleri (detay görülmedi).

### B. Bağımlılıklar

| Ayar | Beslendiği modül(ler) |
|---|---|
| İşletme Bilgileri | Yazıcı (fiş başlığı/altı), Raporlar (rapor header) |
| Kullanıcı Yönetimi | Auth/Login (login akışı), Audit Log (kim yaptı), Raporlar (kasiyer tahsilatı) |
| Yazıcı Ayarları | (v3) StoreBridge → (v5) Print Agent, Sipariş "mutfağa gönder", Ödeme (kasa fişi) |
| Kurulum Kontrolü | Tüm modüllerin hazırlık durumunu okur (read-only aggregator) |
| Ekran Ayarları | Yalnızca frontend UI |

### C. v3 Durumu

**Çalışanlar:**
- İşletme Bilgileri formu kaydediliyor
- Kullanıcı ekleme + rol atama (CRUD kısmı) çalışıyor
- Kurulum Kontrolü checklist'i durumları doğru gösteriyor

**Sorunlular / Kritik:**
- **Şifre sıfırlama çalışmıyor** — login akışı Auth/Login modülünde ele alınacak
- **Yazıcı durumu çelişkili:** Dev versiyonunda StoreBridge aktif değil (3 yazıcı "Eksik kurulum", 0 kategori atanmış, Kurulum Kontrolü "taranmamış"). Üretim versiyonunda (farklı/eski versiyon) yazıcılar basıyor. Bu "sürüm güncellemede yazıcı bozulması" sorununun canlı kanıtı — printer-notes.md ve pain-points.md iki versiyonu da karşılaştırmalı belgeleyecek.
- **Bar yazıcısındaki "legacy" tag:** Sürüm geçişinden kalma quirk; hangi sorunu çözüp hangisini ürettiği pain-points.md'e gidecek
- **Logo yükleme yok:** İşletme kimliği fişte tam yansımıyor

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- İşletme Bilgileri formu (+ logo yükleme eklenir)
- Kullanıcı Yönetimi CRUD (+ çalışan şifre reset)
- Ekran Ayarları — dil seçimi (MVP'de sadece Türkçe)

**v5.0 MVP — v3'ten farklı / sadeleştirilmiş:**
- Yazıcı Ayarları — Basit UI prensibi (Karar 2) ile yeniden tasarlanır: basit mod varsayılan (`Mutfak: ✓ Çalışıyor [Test Et]`) + gelişmiş mod gizli (IP, port, kategori routing, otomatik yazdırma tercihleri) + zero-config LAN keşif ilk kurulumda
- Kurulum Kontrolü — basit checklist; v3'teki 8 adımlı elaborate wizard değil

**v5.1:**
- Sürüm Notları ekranı (charter'da v5.1)
- Mobil Cihaz Eşleştirme ekranı (charter'da v5.1)

**v5.2+ / non-goal:** Yok

---

## 2. Auth / Login

> Login ekranı, oturum yönetimi, rol bazlı erişim kontrolü, şifre reset.
> Not: Kullanıcı CRUD (ekle/sil/rol ata) Ayarlar modülünde (1). Auth; token, session, login akışı, şifre reset mekanizmasını kapsar.
> v5 notu: "Login ekranı ve işleyişi baştan kurulmalı" — v3 kodu referans değil.

### A. Amaç ve Akış

Login ekranı: email + şifre alanları, "Şifremi unuttum" linki (görünür ama çalışmıyor), "Giriş Yap" butonu. Demo hızlı giriş: 4 buton (Yönetici / Kasiyer / Garson / Mutfak) — şifresiz, tıkla direk rol geçişi.

Roller (v3 kodu incelendi, bundle `index-zntpOZb5.js:520536` — Kodda tespit):
- **Yönetici / Admin** — tüm ekranlar + ayarlar + raporlar
- **Kasiyer (cashier)** — `/home`, `/tables`, `/customers`, `/reservations`, `/stock`, `/reports`; ayarlara erişim yok
- **Garson (waiter)** — **sadece `/tables`** (Masalar); `/home` bile yok. Sidebar alt barında "garson çağırma" butonu görünür (admin/cashier/waiter için)
- **Mutfak (kitchen)** — **sadece `/kitchen`** (Mutfak ekranı)
- **Ek:** "Tanımlamalar" alt menüsü (`/settings/menu`, `/settings/dining-areas`, `/settings/features`) yalnızca admin
- **Doğrulanmamış:** Backend middleware rol koruması (frontend filter `tD.filter(g => s(...g.roles))` kesin; kaynak `.ts`'de `requireRole` var mı ayrı teyit gerekir)
- **Doğrulanmamış:** Mutfak ekranı içi alt aksiyonlar (sipariş durumu güncelleme, yazdırma) kitchen için tam kapsam

Akış: email+şifre → Giriş Yap → rolüne göre menü açılır. Demo butonlarıyla: şifresiz, sadece rol seçimi. Logout: sol menüde "Çıkış" butonu var, davranışı test edilmedi.

**Şifre sıfırlama akışı (Kodda tespit, `index-zntpOZb5.js:531025`):** Form submit çalışıyor → `$e.forgotPassword(email)` → `POST /auth/forgot-password` (email + opsiyonel `business_id`) → başarı mesajı "Talebiniz alındı. Geçici şifre tanımlandığında bu ekrandan giriş yapabilirsiniz." Model: **admin-manuel-reset** (email link değil). Hata durumunda inline mesaj. **Doğrulanmamış:** backend endpoint gerçekten ne yapıyor (mail/DB flag/log). Kullanıcının "çalışmıyor" beyanı muhtemelen bu backend tarafı veya admin'in geçici şifre atama UI'ının bulunmaması/bozukluğuyla ilgili.

### B. Bağımlılıklar

| Auth verisi | Beslendiği modül |
|---|---|
| Rol | Sol menü görünürlüğü, her ekranda yetki kontrolü |
| Session / user_id | Audit Log ("kim yaptı" kaydı) |
| Token / oturum | API isteklerinde auth header (v3'te Electron+lokal DB — HTTP token kullanımı belirsiz, teyit lazım) |
| Kullanıcı Yönetimi (Ayarlar) | Auth sisteme kullanıcı ekler/siler, şifre belirler |

### C. v3 Durumu

**Çalışanlar:**
- Email + şifre ile login (en azından admin için doğrulandı)
- Demo hızlı giriş 4 rol için çalışıyor
- Rol bazlı menü gösterimi çalışıyor (admin tüm menüyü görüyor)

**Sorunlular / Kritik:**
- **Şifre sıfırlama çalışmıyor** — kullanıcının açık beyanı; tıklanınca ne olduğu bile doğrulanmadı
- **"Login ekranı ve işleyişi baştan kurulmalı"** — kullanıcı netti; v3 Auth kodu referans bile olmayabilir, yalnızca rol isimleri ve demo akışı taşınır
- **Oturum süresi / timeout belirsiz** — test edilmedi
- **JWT / token muhtemelen yok** — v3 Electron+lokal; session state büyük ihtimalle UI'da; v5 için fark etmez (sıfırdan)
- **Çoklu cihaz belirsiz** — v3 tek PC varsayımı; v5'te web + mobil paralel kritik fark
- **Logout davranışı belirsiz** — buton var ama test edilmedi
- **v3 araştırması sonrası teyit edilenler (bkz. A bölümü):** Garson sadece `/tables`, Mutfak sadece `/kitchen`, şifre reset formu `POST /auth/forgot-password` çağırıyor ve admin-manuel-reset modeli kullanılıyor
- **Mimari sinyal (Ek gözlem):** Rol yetki matrisi v3'te tek merkezi yerde (`tD` nav array) tanımlı — temiz. v5'te bu merkezi yaklaşım korunmalı.
- **Hâlâ doğrulanmamış:** logout davranışı, oturum timeout, backend route guard, şifre reset backend gerçekten ne yapıyor

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Email + şifre login
- Demo hızlı giriş (4 rol; prod'da env flag ile kapatılır)
- 4 rol: admin, kasiyer, garson, mutfak
- Rol bazlı menü / ekran gösterimi

**v5.0 MVP — v3'ten farklı / yeniden tasarlanmış:**
- **Şifre sıfırlama çalışır halde** — v3'te zaten admin-manuel-reset modeli kodlanmış (önerdiğimiz hibrit yaklaşımla uyumlu); v5'te aynı model + admin UI'ı düzgün çalışır halde (ADR-002)
- JWT access token + refresh token (rotation ile) — v3'te yoktu
- Logout + token invalidation (server-side refresh token blacklist)
- Oturum timeout politikası net: access token ve refresh token süreleri ADR-002'de karar verilecek (tahmin: 8 saat / 30 gün — henüz kesinleşmedi)
- Çoklu cihaz desteği: aynı kullanıcı web + mobilden aynı anda giriş yapabilir
- Şifre politikası ADR-002'de tanımlanır

**v5.1:**
- MFA / 2FA (altyapı MVP'de hazır, UI v5.1)
- "Bu cihazı hatırla" (uzun ömürlü refresh token)
- Kullanıcı profil ekranı (avatar, ad güncelleme)
- Şifre geçmişi (son 3 tekrar kullanılamaz)

**v5.2+ / non-goal:**
- SSO / Google / Apple login
- LDAP / Active Directory
- Biometric login

---

## 3. Menü

> Kategori + ürün + porsiyon + özellik grubu yönetimi. Sadece **Admin** erişir.

### A. Amaç ve Akış

Menü editörü sol-sağ panel düzeninde: sol panelde kategori listesi (+ "Ekle" butonu), sağda seçili kategorinin ürün kartları. Ürün kartı: ad, kategori etiketi, fiyat. Sağ üstte "Yeni ürün ekle". Kategori bazlı filtreleme ve ürün araması mevcut.

**Ürün formu alanları:** ad (zorunlu), kategori (dropdown), açıklama (opsiyonel), barkod (opsiyonel), yazıcı hedefi (Mutfak/Bar/Kasa dropdown), porsiyon bilgileri (ad + fiyat KDV dahil + varsayılan radio; birden fazla porsiyon eklenebilir — Tam/Yarım/Buçuk), ürün görseli (5MB, JPG/PNG/WEBP), özellik grupları (dropdown ile atama).

**Porsiyon:** ürün boyutu/miktarı varyasyonu (Tam 320₺ / Yarım 180₺). Biri varsayılan, sipariş ekranında bu fiyat görünür.

**Özellik grubu:** ayrı bir "Özellikler" ekranında tanımlanır (Ayarlar/Tanımlamalar altı). Grup alanları: ad, seçim tipi (Tekli/Çoklu), zorunlu mu, aktif mi, özellikler (ad + ekstra tutar + varsayılan). Örnek: "YUMURTA" grubu → Tekli seçim → [YUMURTALI +0₺ (varsayılan), YUMURTASIZ +10₺]. Ürün formundan ürüne atanır. Çoklu seçim doğru çalışıyor (adisyon ekranında "YUMURTALI, YUMURTASIZ" aynı anda listelenebiliyor).

**Menü değişiklikleri** anında sipariş ekranına yansır. Ancak **eski siparişlerin fiyatı snapshot'landığı için** değişiklikten önce açılan siparişler etkilenmez.

**Sıralama:** Ürünler up/down arrow butonlarıyla sıralanır (drag-drop değil). Kaydedince sipariş ekranı güncellenir.

**Kod altyapısı (Kodda tespit):**
- `attributes.js:135-138` — DB'de hem `category_attribute_groups` hem `product_attribute_groups` tablosu var. UI şu an sadece ürüne atamayı gösteriyor; kategoriye atama altyapı olarak hazır.
- `printRouting.js:50-57` — Yazıcı yönlendirme öncelik: (1) `printer_routing` tablosu kategori bazlı birincil, (2) ürün/kategori `printer_target` alanı fallback override.
- `products.js:432-476` — Hibrit silme: sipariş geçmişi varsa soft-delete (`is_deleted=1, is_active=0`), yoksa hard-delete + görsel dosyası temizliği.
- `reports.js:61,65` — Satış raporu `GROUP BY oi.product_name` (snapshot ada göre gruplar, canlı menü adına değil).

### B. Bağımlılıklar

| Menü verisi | Beslendiği modül | Not |
|---|---|---|
| Ürün adı, porsiyon fiyatı, özellik seçimleri | **Sipariş** — adisyon paneli | Fiyat sipariş anında snapshot'lanır; sonraki menü değişikliği eski siparişi etkilemez |
| Ürün adı | **Mutfak ekranı** | Özellik seçimleri (YUMURTASIZ vb.) **iletilmiyor** — v3 eksiği |
| Ürün adı + porsiyon + özellik | **Yazıcı / Print Agent** | Kullanıcı fişte basıldığından emin değil, Modül 9'da teyit edilecek |
| `product_name` snapshot + miktar | **Raporlar** | `GROUP BY oi.product_name` — snapshot ada göre gruplanır (`reports.js:61,65`) |
| Kategori → yazıcı | **Print Agent** | `printer_routing` tablosu birincil; ürün `printer_target` fallback override (`printRouting.js:50-57`) |
| Ürün kaydı | **Stok** | Bağlantı yok — stok modülü menüden bağımsız (products tablosunda stok kolonu yok) |

### C. v3 Durumu

**Çalışanlar:**
- Kategori ve ürün CRUD sorunsuz
- Porsiyon (Tam/Yarım, farklı fiyat) çalışıyor
- Özellik grubu tanımlama + ürüne atama çalışıyor
- Özellik grubu **çoklu seçim** adisyonda doğru (ekran teyidi: "YUMURTALI, YUMURTASIZ" aynı anda)
- Menü fiyat değişikliği sipariş ekranında anında görünür
- Ürün silme hibrit modeli kodda sağlıklı (`products.js:432-476`)

**Sorunlular / Kritik:**
- **Mutfak ekranında özellik seçimi görünmüyor** (Kullanıcı gözlemi): YUMURTASIZ sipariş edilse bile mutfak kartında yalnız ürün adı. Mutfakçı sadece fişten öğrenebilir.
- **Görsel yükleme bozuk** (Kullanıcı gözlemi): Form yükleme yapıyor ama liste/detay kartında düzgün görünmüyor. Ürün detayında broken thumbnail ekranda görüldü.
- **"Yazıcı hedefi" alanı çelişki** (Kodda tespit): Ürün formunda var ama `printer_routing` tablosu (kategori bazlı) birincil. UI'da iki mekanizmanın varlığı kafa karıştırıyor; kullanıcı ne işe yaradığını bilmiyor.
- **Barkod alanı kullanılmamış** (Kullanıcı gözlemi): Form alanı var ama hiç test edilmemiş, iş değeri belirsiz.
- **UX zayıf** (Kullanıcı gözlemi): Menü ana ekranı ve ürün detay ekranı kullanıcı dostu değil.

**Doğrulanmamış:**
- Fişte özellik seçimi (YUMURTASIZ) basılıyor mu — B'de "evet" C'de "bilmiyorum" çelişkisi → Modül 9'da teyit
- Barkod alanının işlevsel bağlantısı
- `is_deleted=1` soft-delete ürünün menü listesinden runtime'da gerçekten gizlendiği

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Kategori CRUD (ekleme/düzenleme/silme/sıralama)
- Ürün CRUD (ad, kategori, açıklama, görsel, porsiyon)
- Porsiyon yönetimi (birden fazla porsiyon, farklı fiyat, varsayılan seçim)
- Özellik grubu tanımlama (tekli/çoklu seçim, zorunlu/opsiyonel, ekstra tutar)
- Özellik grubu ürüne atama
- Kategori → yazıcı yönlendirme (routing)
- Menü değişikliği anında yansıma + eski sipariş fiyat snapshot'ı
- Ürün silme hibrit (soft/hard)

**v5.0 MVP — v3'ten farklı / sadeleştirilmiş / düzeltilmiş:**
- **Özellik grubu kategoriye atanabilir** (kullanıcı isteği): DB altyapısı zaten var (`category_attribute_groups`), UI'ya çıkarılır. Kategoriye atanan grup kategori ürünlerine otomatik uygulanır. Ürün bazlı ek atama korunur.
- **Mutfak ekranında özellik görünür** (v3 eksiği): "KAŞARLI PİDE (YUMURTASIZ)" formatı.
- **Görsel yükleme düzgün çalışır** (v3 bozukluğu): yükleme + liste kartı + detay gösterimi test kapsamında.
- **"Yazıcı hedefi" alanı ürün formundan kaldırılır** (kafa karışıklığını gider): Tek mekanizma = kategori bazlı routing.
- **Menü ana ekranı + ürün detay UX yenilenir** (Basit UI prensibi — Karar 2): Basit mod varsayılan, gelişmiş mod gizli.
- **Barkod alanı MVP'den çıkarılır**: Hiç kullanılmamış → v5.1.

**v5.1:**
- Barkod okuyucu entegrasyonu + ürün barkod alanı
- Ürün bazlı yazıcı override UI (kategoriden farklı yazıcıya gönderme)
- Menü ↔ Stok entegrasyonu (stok modülü zaten v5.1)
- Ürün görseli otomatik boyutlandırma + WebP dönüşümü

**v5.2+ / non-goal:**
- Combo menü / reçete yönetimi (charter non-goal)
- Yemeksepeti / Getir / Trendyol Yemek menü senkronu (charter non-goal)

---

## 4. Masa Yönetimi + Salon Bölgeleri

> Masalar ekranı (kasiyer/garson ana giriş), salon bölgeleri (Admin), masa açma/taşıma, paket servis yan akış, Caller ID entegrasyonu.

### A. Amaç ve Akış

**Masalar ana ekran:** Üst bar — "Masalar [X] Boş [Y] Dolu" sayacı, ortada **Paket** butonu, sağ üstte Caller ID telefon ikonu + yenile. Bölge sekmeleri (örn: "İç Salon (3/25)" + "BAHÇE (2/12)") dolu/toplam sayıyı gösterir. 3 kolonlu masa kartı grid, aşağı kaydırılarak hepsi görülür. Sağ yan panel: "Paket siparişler" (açık paket varsa listelenir).

**Masa kartı görseli:**
- **Boş:** beyaz kart + sağ üstte yeşil nokta
- **Dolu:** turuncu çerçeve + garson adı + tutar (₺720,00) + süre (16 dk 55 sn — sipariş oluşturulduğu an başlar) + turuncu nokta + sağ üstte 3-nokta context menu

**Salon Bölgeleri ekranı (Ayarlar altı — Admin):** "Her bölge için hedef masa sayısını girin. Boş masalar güvenle kapatılır; dolu masa veya açık adisyon varken sayı düşürülemez." Her masa sistemde benzersiz ID saklar; farklı bölgelerde aynı görünen "Masa 1" sırası kullanılabilir (bölge adıyla birlikte gösterilir). "+ Yeni bölge" butonu, düzenle/sil.

**Masa açma:** Boş masaya tıklama → **direkt sipariş ekranı**. Kapasite / garson seçimi / müşteri sayısı gibi ara form yok.

**Masa taşıma:** Kart 3-nokta menüden "Masayı Taşı" → "Hedef masayı seçin" modu → boş masa seç. Dolu hedef gösterilirse "Hedef masa boş olmalı" toast ile engellenir. Taşıma sonrası garson/tutar/süre hedefe aktarılır.

**Masa birleştirme:** **Yok** (v3'te desteklenmiyor).

**Paket servis:** Ayrı mekanizma (Kodda tespit: `orders.js:53`). `order_type = 'dine_in' | 'takeaway'`. Paket masaya bağlanmaz; üstteki "Paket" butonu takeaway listesini açar. Takeaway ek alanları: `takeaway_out_at`, `takeaway_delivered_at`, `takeaway_planned_payment_type`.

**Caller ID:** Telefon çalınca **GELEN ARAMA popup** otomatik açılır (görsel teyit): telefon no, müşteri adı, "Kayıtlı müşteri" etiketi, **Siparişi Aç** butonu — tek tıkla paket sipariş ekranı açılır. Sağ üst telefon ikonu son 7 günlük arama geçmişini listeler.

**Dolu masa detayı (sipariş ekranı):** Üstte masa adı + bölge + müşteri ikonu + yazıcı ikonu (fiş bas). Sağ adisyon panelinde her sipariş kalemi: garson + saat rozeti ("İLHAN AVCİ - 16:12"), porsiyon, özellik, fiyat × adet. Sağ üstte **Taşı**, altta **Ödeme** + **Hızlı Öde**.

**Hızlı Öde akışı:** 4 seçenek — **Öde** (masa açık kalır), **Öde & Kapat** (ödemeyi al ve masayı boşalt), **Öde & Yazdır** (fiş gönder, masa açık), **Öde + Yazdır + Kapat**. Nakit / Kredi Kartı seçimi.

**Detaylı Ödeme:** Sipariş kalemleri ekranda, "Ayrı ayrı öde" ile kalemler kişilere paylaştırılabilir. "Kaydet" ile kısmi ödeme kaydedilir (masa açık kalır).

**Kod altyapısı (Kodda tespit):**
- `orders.js:54-55` — `table_id` ve `customer_id` optional/nullable
- `admin.js:2239,2243` — hedef masa sayısı düşürünce boş masalar `is_active=0` soft-delete
- `reports.js:99,193,259` — raporlar `LEFT JOIN tables` yapar ama gruplama masaya göre değil (ürün adı bazlı)

### B. Bağımlılıklar

| Masa verisi | Beslendiği modül | Not |
|---|---|---|
| `table_id` → `orders.table_id` | **Sipariş** | v3 varsayımı: tek masa = tek aktif açık sipariş (aynı anda 2 adisyon **Doğrulanmamış**) |
| `user_id` (masayı ilk açan) | **Auth / Garson** | Kartta görünen garson = aktif siparişi ilk oluşturan. **Masa garsona atanmaz** (Kullanıcı teyit) |
| Masa → ödeme akışı | **Ödeme** | 4 seçenek (Öde / Öde & Kapat / Öde & Yazdır / Öde+Yazdır+Kapat). Ödeme masayı otomatik kapatmaz; kullanıcı seçer |
| `order_type='takeaway'` | **Paket servis** | Paket masaya bağlanmaz. Sağ panel ve üst "Paket" butonu ayrı liste |
| `dining_area_id` + `target_table_count` | **Salon Bölgeleri (Ayarlar)** | Düşürmede boş masalar soft-delete; dolu/açık adisyon varken engellenir |
| `table_id` + masa adı snapshot | **Mutfak ekranı** | Mutfak kartında masa adı ("Masa M1"); taşımada güncellenir (Kullanıcı teyit) |
| `table_id` + `order_id` | **Raporlar** | `LEFT JOIN tables` var ama masa bazlı gruplama yok |
| `customer_id` | **Müşteri (CRM)** | Masa detayındaki insan ikonu müşteri eşleştirme. Paket kritik, dine-in opsiyonel |
| Telefon numarası → müşteri | **Caller ID** | Gelen arama popup → Siparişi Aç → paket sipariş. Son 7 gün arama geçmişi |

### C. v3 Durumu

**Çalışanlar:**
- Masalar ekranı Boş/Dolu sayaç, garson, tutar, süre canlı güncelleme
- Çoklu bölge (İç Salon + BAHÇE) sekme geçişi
- Masa taşıma (boş hedefe) — garson/tutar/süre doğru aktarım
- 4 ödeme seçeneği + Ayrı ayrı öde akışı
- Caller ID popup (görsel teyit) + Siparişi Aç aksiyonu
- 3-nokta context menu (Öde / Hızlı Öde / Masayı Taşı / Yazdır / İptal)
- "Sipariş kaydedildi" toast bildirimi
- Dolu masa/açık adisyon varken masa ve bölge silme engellenir (Kullanıcı teyit)

**Sorunlular / Kritik:**
- **Garson atama yok** (Kullanıcı teyit): Masa garsona kilitli değil; kartta görünen garson = siparişi ilk oluşturan. **Mimari sinyal:** v5 mobil garson uygulaması için yetersiz — "hangi garson hangi masadan sorumlu" takibi eksik.
- **Masa birleştirme yok** (Kullanıcı teyit): Kalabalık grup 2 masaya ayrı adisyon açmak zorunda.
- **Yazdırma fonksiyonunda genel sıkıntı** (Kullanıcı gözlemi): "Yazdır" ve "Öde & Yazdır" aksiyonlarında genel sorun. Detay Modül 9 kapsamında.
- **Genel akış iyi** (Kullanıcı gözlemi).

**Doğrulanmamış:**
- Aynı masada paralel (2+) açık sipariş mümkün mü — muhtemelen tek adisyon varsayımı, test yok.

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Masa ve salon bölgeleri CRUD (Admin)
- Hedef masa sayısı yönetimi (soft-delete mekaniği, dolu engelleme)
- Çoklu bölge + sekme navigasyonu
- Masalar ana ekran: 3 kolonlu grid, canlı sayaç, dolu kartta garson+tutar+süre
- Boş masaya tıklama → direkt sipariş ekranı (ara form yok)
- Masa taşıma (boş hedefe; dolu engellenir)
- Context menu: Öde / Hızlı Öde / Masayı Taşı / Yazdır / İptal
- 4 ödeme seçeneği + Detaylı Ödeme "Ayrı ayrı öde"
- Caller ID gelen arama popup + Siparişi Aç + son 7 gün geçmişi
- Paket servis ayrı akış (takeaway, masaya bağlı değil)
- Müşteri eşleştirme (`orders.customer_id` optional)

**v5.0 MVP — v3'ten farklı / yeni / düzeltilmiş:**
- **Garson atama modeli** (v3 eksiği): Masa garson sorumluluğu netleşir. Masaya tıklayan garson = sorumlu (değiştirilebilir); Admin elle atama/serbest yapar. Mobil garson uygulaması için kritik.
- **Masa birleştirme** (v3'te yoktu → MVP'ye alındı): 2+ masa tek adisyon. Sonradan ayrılabilir. 25 masalı pide/lokanta gerçekliği gerektiriyor.
- **Aynı masada paralel sipariş kuralı net**: Tek masa = tek aktif sipariş (tek adisyon); ek sipariş aynı adisyona kalem olarak eklenir. ADR ile yazılı kural.
- **Paket servis Caller ID akışı vurgulanır**: Panel ve tek tıklık akış MVP'de iyileştirilir.
- **Yazdırma sorunları çözülür** (detay Modül 9).

**v5.1:**
- **Masa görsel yerleşim planı** (drag-drop salon editörü)
- **Masa kapasitesi alanı** (rezervasyonla birlikte anlamlı)
- **Masa başı ciro raporu** (v3'te altyapı var, gruplama yok)
- **Oturma süresi metriği** (rush-hour analizi)

**v5.2+ / non-goal:**
- Çoklu şube salon yönetimi (charter v5.2+)
- Online masa rezervasyonu (charter non-goal)

---

## 5. Müşteri (CRM temeli)

> Müşteri kartı (ad, çoklu telefon, çoklu adres), arama, Caller ID ile eşleştirme, paket siparişle entegrasyon. Ayrı "Müşteriler" ekranı sol menüden (admin + kasiyer).

### A. Amaç ve Akış

**Müşteri listesi ekranı (Kullanıcı teyit):** Sol menüde "Müşteriler" sekmesi, aranabilir liste. Arama **telefon** ve **ad/ünvan** alanlarında; adres aramadan hariç. "+ Yeni müşteri" butonu.

**Müşteri kartı alanları (Kodda tespit, `customers.js:527-563`, `migrations/run.js:168`):**
- `full_name` + `first_name` + `last_name` (ayrık alanlar)
- `note` (serbest metin alan — v3 DB'de mevcut, UI önceliği düşük)
- `total_orders` denormalized sayaç
- `business_id` (multi-tenant skopu)

**Çoklu telefon (Kodda tespit, `customer_phones` tablosu + `customers.js:653,776`):**
- `phone`, `normalized_phone`, `is_primary` — biri birincil, diğerleri ek
- Normalize fonksiyonu (`utils/phoneNormalize.js`) Caller ID eşleşmesi için kritik

**Çoklu adres (Kodda tespit, `customer_addresses` tablosu + `customers.js:668,710,763`):**
- `title` (ev/iş/diğer etiketi), `address` (serbest metin), `address_note`
- `province`, `district`, `neighborhood` (ayrık coğrafi alanlar)
- `is_default` — biri varsayılan teslimat adresi

**Giriş noktaları (Kodda tespit + Kullanıcı teyit):**
- Müşteriler ekranı "+ Yeni müşteri" (`POST /customers`)
- Caller ID popup'tan (tanınmayan numara → kaydet + sipariş aç; kullanıcı bu akışı teyit etti)
- Excel import (`POST /customers/import/preview` + `/commit`, `customers.js:191,237`)

**Excel import akışı (Kodda tespit, `customers.js:62-150`):**
- Kolon varyantları kabul ediyor: "Ad Soyad / Müşteri / name", "Telefon / Tel / phone", "Telefon 2 / phone_2", vs.
- Preview: satır normalize, mükerrer tespit (`normalized_phone` + `full_name` birleşimi ile mevcut kayıt bul)
- Commit: yeni ekle VEYA mevcut güncelle; telefon ve adresleri alt tablolara yaz; is_primary / is_default bayrağı yoksa ilk eklenen otomatik işaretlenir

**Caller ID entegrasyonu (Modül 4'te teyit):** Gelen çağrıda `normalized_phone` ile müşteri eşleşir → popup'ta müşteri adı görünür → "Siparişi Aç" → paket sipariş ekranında müşteri önceden eşlenmiş.

**Dine-in eşleştirme (Kullanıcı teyit):** Teknik olarak mümkün (`orders.customer_id` optional) ancak pratikte **nadiren / neredeyse hiç** kullanılıyor. Paket ana kullanım senaryosu.

**Sipariş snapshot (Kodda tespit, `orders.js:374`):** `customer_name_snapshot` alanı sipariş anında müşteri adını dondurur. Müşteri adı sonradan değişse bile eski sipariş/fiş/rapor etkilenmez (Sinyal #6 ile tutarlı).

### B. Bağımlılıklar

| Müşteri verisi | Beslendiği modül | Not |
|---|---|---|
| `customer_id` | **Sipariş (paket)** | `orders.customer_id` optional; paket siparişte tipik olarak dolu, dine-in nadir |
| `customer_name_snapshot` | **Sipariş + Raporlar + Fiş** | Sipariş anında donar; müşteri adı değişse bile eski sipariş korunur |
| `normalized_phone` | **Caller ID (Modül 6)** | Gelen çağrı → normalize → eşleşme arama |
| `customer_addresses.is_default` | **Paket teslimat + Fiş (Modül 9)** | Paket fişinde varsayılan adres basılır |
| `customer_phones.is_primary` | **Caller ID + Müşteri kartı** | Birden fazla telefon, biri birincil |
| `total_orders` | **Müşteri detay + raporlar** | Denormalized sayaç; sipariş kapanışında güncellenir (Doğrulanmamış) |
| `customer_id` | **Rezervasyon (v5.1)** | Rezervasyon müşteriye bağlanır — v5.1 modülü |

### C. v3 Durumu

**Çalışanlar:**
- Ayrı "Müşteriler" sayfası; telefon + ad araması
- Çoklu telefon (is_primary) CRUD
- Çoklu adres (is_default + coğrafi alanlar) CRUD
- Excel import/export (kullanıcı teyit: aktif kullanılıyor)
- Caller ID → müşteri eşleşmesi (Modül 4'te teyitli)
- `customer_name_snapshot` sipariş anında doluyor (`orders.js:374`)

**Sorunlular / Kritik:**
- **Mükerrer kayıt engeli yok** (Kullanıcı teyit): Aynı telefonla 2 müşteri açılabiliyor. `normalized_phone` alanı var ama unique constraint yok. Caller ID eşleşmesinde belirsizlik yaratır.
- **Sipariş geçmişi görüntüleme yok** (Kullanıcı teyit + "çok önemli, v5'te olsun"): Müşteri detayında sadece kart bilgisi; geçmiş sipariş listesi yok.
- **UX zayıf** (Kullanıcı gözlemi): Kart ekleme/düzenleme formları zahmetli.

**Doğrulanmamış:**
- Müşteri silme davranışı — kullanıcı "silme özelliği yok, gerek de yok" diyor; kodda endpoint'in varlığı ayrıca teyit edilecek (Phase 1).
- `total_orders` sayacı güncelleme anı (sipariş açılışı mı, kapanışı mı).
- Excel export formatı ve include edilen alanlar.

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Ayrı "Müşteriler" ekranı (liste + detay)
- Telefon + ad arama
- Müşteri kartı: ad, çoklu telefon (is_primary), çoklu adres (is_default + il/ilçe/mahalle)
- Caller ID entegrasyonu (Modül 6)
- `customer_name_snapshot` pattern (Sinyal #6)
- Paket sipariş müşteri eşleştirme; dine-in opsiyonel (nadir)

**v5.0 MVP — v3'ten farklı / düzeltilmiş / yeni:**
- **Telefon unique constraint** (v3 eksiği): `normalized_phone` üzerinde unique index (`tenant_id` skopunda). Mükerrer kayıt engellenir.
- **Müşteri detayında sipariş geçmişi görüntüleme** (v3 eksiği — kullanıcı kritik istek): Son N sipariş listesi (tarih, tutar, durum, kalemler). **⚠ KAPSAM TERFİ:** Charter v5.1'de → MVP'ye terfi. Yeni ADR gerekli.
- **Excel import + export MVP'de** (kullanıcı kararı): **⚠ KAPSAM TERFİ:** Charter v5.1'de → MVP'ye terfi. Yeni ADR gerekli. Gerekçe: pilot geçişte mevcut müşteri tabanının taşınması + günlük ihtiyaç.
- **Müşteri silme yok** (kullanıcı kararı): Silme endpoint/UI yok. KVKK talebi için **anonimize** akışı: `full_name='Anonim'`, telefon + adres kayıtları silinir, `customer_id` ve siparişler korunur, `customer_name_snapshot` (geçmiş sipariş) güncellenmez — rapor bütünlüğü korunur.
- **UX yenilenir** (Basit UI prensibi, Karar 2): Liste + kart formu sadeleşir; adres girişi akışı Basit/Gelişmiş katmanla.

**v5.1:**
- Müşteri notu / tercih alanı UI'ya çıkarılır (v3 DB'de `note` alanı zaten var; MVP'de gizli)
- Detaylı müşteri kartı (doğum günü, e-posta, etiket/grup — VIP/toptan/personel)
- Sipariş geçmişi gelişmiş filtre/arama (MVP'de düz son-N liste yeterli)
- Rezervasyon modülü (müşteriye bağlı)

**v5.2+ / non-goal:**
- Sadakat programı / puan (charter non-goal)
- SMS/Email kampanya (charter non-goal)
- Müşteri segmentasyonu / CRM analitiği
- Borç / veresiye takibi (kullanıcı kararı: kapsam dışı)
- Otomatik hatırlatma SMS (rezervasyon v5.1'de opsiyonel)

---

## 6. Caller ID

> Gelen çağrı → müşteri eşleştirme → paket sipariş açma. Donanım katmanı (USB modem/ATA) + bridge servisi + cloud backend + realtime popup.
> Not: UI akışı (popup görsel, Siparişi Aç, son 7 gün geçmişi) Modül 4'te teyit edildi. Bu modül teknik/backend mimarisini kapsar.

### A. Amaç ve Akış

**Tam akış (Kodda tespit, `bridge.js:365-391`, `callerIdService.js`, `callerid.js`):**

```
USB modem/ATA (COM port)
  → StoreBridge (v3) / Print Agent (v5)
    → POST /api/bridge/caller-id/incoming   [bridgeAuth, JWT yok]
      → processIncomingCall()
        → normalizePhoneDigits(rawPhone)
        → dedupe kontrolü (30 sn pencere, aynı numara tekrar gelirse atla)
        → findCustomerPhoneRow() → müşteri eşleşmesi
        → call_logs INSERT (phone, normalized_phone, customer_id,
                            customer_name_snapshot, address_snapshot, source_type)
        → Socket.IO emit 'caller-id' → frontend popup anında açılır
```

**Donanım (Kullanıcı teyit):** USB modem veya ATA cihazı, Windows COM port üzerinden çalışıyor. Fiziksel telefon hattı.

**Bridge auth (Kodda tespit, `middleware/bridgeAuth.js`):** JWT değil, token tabanlı (`BRIDGE_TOKEN` env). Bridge servisi bu tokenla gelir; normal kullanıcı JWT akışından ayrı.

**Dedupe (Kodda tespit, `callerIdService.js:72`):** `CALLER_ID_DEDUPE_SECONDS` penceresi — aynı numara aynı `source_type` ile kısa sürede tekrar gelirse `call_logs`'a **yazılmaz**, popup açılmaz. v5 değeri: **30 saniye** (kullanıcı kararı).

**Müşteri eşleşmesi (Kodda tespit, `callerIdService.js:11-27`):** `customer_phones.normalized_phone` üzerinden eşleşme. Eşleşme varsa `customer_name_snapshot` + `address_snapshot` (varsayılan adres) anında `call_logs`'a yazılır. Müşteri bilgisi sonradan değişse bile call_log'daki snapshot korunur.

**Popup (v3: polling; v5: Socket.IO, Kullanıcı kararı):**
- v3: Frontend `GET /recent` endpoint'ini yoklar (yorum `callerid.js:65`: "global popup polling"); 2-3 sn gecikme.
- v5: `processIncomingCall` sonrası `emitToRoom(businessId, 'caller-id', payload)` → popup sıfır gecikmeyle açılır. Socket.IO zaten mutfak ekranı için kurulu — aynı connection paylaşılır.

**call_logs alanları (Kodda tespit, `callerIdService.js:103-114`):**
- `phone`, `normalized_phone`, `customer_id` (nullable), `customer_name_snapshot`, `address_snapshot`, `source_type` ('http' / 'simulate' / 'cid812' / 'hardware'), `status`

**Simülasyon endpoint (Kodda tespit, `callerid.js:43`):** `POST /simulate` — test için gerçek donanım olmadan çağrı simüle eder. `sourceType='simulate'` olarak call_logs'a düşer.

**call_logs saklama:** 30 gün (kullanıcı kararı); 30 günden eski kayıtlar otomatik temizlenir (cron).

**Legacy tablo (Kodda tespit, `callerIdService.js:122-129`):** `incoming_calls` tablosu hâlâ yazılıyor (eski uyumluluk). v3'te yorum: "gerektiğinde kaldırılabilir." v5'te **kaldırılır** — yalnızca `call_logs`.

### B. Bağımlılıklar

| Caller ID verisi | Beslendiği modül | Not |
|---|---|---|
| `normalized_phone` eşleşmesi | **Müşteri (Modül 5)** | `customer_phones.normalized_phone` üzerinden; unique constraint v5'te zorunlu (Sinyal #14) |
| `customer_id` + `customer_name_snapshot` | **Müşteri kartı + Sipariş** | Popup'ta müşteri adı; Siparişi Aç → paket sipariş ekranında eşlenmiş gelir |
| `address_snapshot` | **Paket sipariş + Fiş** | Call anındaki varsayılan adres donduruluyor |
| `BRIDGE_TOKEN` | **Print Agent (v5)** | Bridge auth token; ayrı env var, normal JWT değil |
| Socket.IO `business:{id}` room | **Mutfak ekranı + Web** | Aynı Socket.IO connection; `emitToRoom()` |
| Popup UI + "Siparişi Aç" | **Masa Yönetimi (Modül 4)** | Akış orada teyit edildi |

### C. v3 Durumu

**Çalışanlar (Kodda tespit + Kullanıcı teyit, Modül 4):**
- StoreBridge → `POST /api/bridge/caller-id/incoming` → `processIncomingCall()` → call_logs akışı
- Müşteri eşleşmesi `normalized_phone` üzerinden çalışıyor
- `customer_name_snapshot` + `address_snapshot` call anında donduruluyor
- Dedupe mekanizması (aynı numara kısa sürede tekrar → tek popup)
- Simülasyon endpoint (`/simulate`) geliştirici testi için
- Popup görsel + "Siparişi Aç" + son 7 gün geçmişi (Modül 4 teyit)

**Sorunlular / Kritik:**
- **Popup gecikme** (Kodda tespit): Frontend polling `GET /recent` — 2-3 sn gecikme. v5'te Socket.IO ile düzeltildi.
- **Legacy `incoming_calls` tablosu** (Kodda tespit): İki tabloya paralel yazma, dead weight. v5'te kaldırılıyor.

**Doğrulanmamış:**
- COM port okuma mekanizması (v3 `bridgeProcess.cjs`'de Caller ID kodu bulunamadı — muhtemelen ayrı bir script veya donanım yazılımı doğrudan HTTP POST yapıyor).
- `CALLER_ID_DEDUPE_SECONDS` sabitinin v3'teki tam değeri (kaç saniye olduğu kod analizinde bulunmadı; v5'te 30 saniye olarak sabitlendi).

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- `POST /api/bridge/caller-id/incoming` endpoint (bridgeAuth)
- `GET /api/callerid/history` + `/recent` (geçmiş + fallback polling)
- `PATCH /api/callerid/logs/:id/status` (log durumu güncelleme)
- `POST /api/callerid/simulate` (geliştirici/test simülasyonu)
- `processIncomingCall()`: normalize → dedupe → eşleştir → call_logs INSERT → emit
- `customer_name_snapshot` + `address_snapshot` call anında dondurulur
- 30 günlük call_logs retention (günlük cron temizliği)
- 30 sn dedupe penceresi

**v5.0 MVP — v3'ten farklı / iyileştirilmiş:**
- **Socket.IO emit** (v3 polling → v5 anlık): `processIncomingCall()` sonrası `emitToRoom(businessId, 'caller-id', payload)`; frontend popup sıfır gecikme.
- **Print Agent içine entegre** (kullanıcı kararı): Ayrı Caller ID Bridge servisi yok. Print Agent (restoran PC'sinde Windows servisi) hem yazıcı job'larını hem COM port/HTTP forward'ı yönetir. Tek kurulum, tek servis.
- **Legacy `incoming_calls` tablosu kaldırılır**: Yalnızca `call_logs`. ADR-003 DB şema ilkelerine eklenecek.
- **Sinyal #14 ile uyum**: `customer_phones.normalized_phone` unique constraint; eşleşme belirsizliği ortadan kalkar.

**v5.1:**
- **KVKK call_log anonimize**: "Verilerimi sil" talebinde `call_logs.phone` ve `normalized_phone` maskelenir/silinir; `customer_name_snapshot` → 'Anonim'. (Modül 5 anonimize akışıyla paralel, v5.1'de birlikte ele alınır.)

**v5.2+ / non-goal:**
- VoIP / SIP entegrasyonu (farklı donanım; v5.0 COM port + USB modem hedefli)
- Çok hatlı santral yönetimi
- Çağrı kaydı / ses kayıt

---

## 7. Sipariş (dine-in + paket)

> Sipariş oluşturma, kalem yönetimi, durum akışı, mutfağa iletim, ikram/iptal, paket servis özel akışları. Kasiyer, garson ve mutfak modüllerinin merkez koordinatörü.

### A. Amaç ve Akış

**Sipariş yaşam döngüsü (Kodda tespit, `orderStatus.js`):**

```
Sipariş:   new → saved → in_kitchen → preparing → ready → served → closed
                                                          └→ cancelled
Kalem:     new → sent → preparing → ready → served
                      └→ cancelled | comped (her aşamadan)
```

**"Kaydet" = mutfağa gönder (Kullanıcı teyit):** Garson/kasiyer kalemleri ekler → "Kaydet" tuşuna basar → sipariş `in_kitchen`'a geçer + print job kuyruğa girer. Kaydetmeden sipariş DB'ye yazılmaz. `saved` ara durumu: v3'te kullanım belirsiz — `in_kitchen`'a geçmeden önce draft olarak kaydedilebilir.

**API endpoint'leri (Kodda tespit, `orders.js`):**

| Endpoint | Açıklama |
|---|---|
| `POST /api/orders` | Sipariş oluştur |
| `POST /api/orders/:id/items` | Açık siparişe kalem ekle |
| `PATCH /api/orders/:id/status` | Sipariş durumu güncelle |
| `PATCH /api/orders/:id/items/:itemId` | Kalem güncelle (durum, adet, not, ikram) |
| `PATCH /api/orders/:id/customer` | Siparişe müşteri ata |
| `GET /api/orders/active` | Aktif siparişler (admin + mutfak) |
| `GET /api/orders/takeaway/open` | Açık paket siparişler |
| `PATCH /api/orders/:id/takeaway/delivery` | Paketi teslim edildi işaretle |
| `POST /api/orders/:id/takeaway/print-label` | Paket etiketi bas |
| `POST /api/orders/:id/print-receipt` | Fiş bas |
| `GET /api/orders/print-health` | Print job sağlık durumu |
| `POST /api/orders/print-jobs/:id/retry` | Başarısız print job yeniden dene |

**Socket.IO event'leri (Kodda tespit, `orders.js` + `socket.js`):**

| Event | Tetikleyen aksiyon |
|---|---|
| `order:created` | Yeni sipariş oluştu |
| `order:items_added` | Açık siparişe kalem eklendi |
| `order:updated` | Sipariş durumu değişti |
| `order:item_updated` | Kalem durumu/ikram değişti |

**Sonradan kalem ekleme (Kodda tespit, `orderService.js:498`):** `addItemsToOrder()` — kapalı/iptal değilse her durumda kalem eklenebilir. `order:items_added` emit → mutfak yeni kalemleri görür. Kitchen adjustment print job için ayrıca kontrol gerekli.

**İkram / comped (Kodda tespit, `orderService.js:307,748`):** Kalem bazlı. `is_comped=1` + `comp_reason` alanı. Toplam hesabında `is_comped` kalemler atlanır — fiş/raporda görünür ama tutara katılmaz. Sipariş bazlı ikram doğrulanmamış.

**Kalem/sipariş iptali (Kodda tespit, `orderService.js:578-620`):**
- İptal nedeni zorunlu değil (kullanıcı teyit); audit log yazılır
- Tüm kalemler iptal edilirse sipariş otomatik `cancelled` → masa `boş`'a döner
- Kalem iptali/miktar azaltmada mutfağa "kitchen adjustment" job gider

**Para hesabı (Kodda tespit, `orderService.js:308-321`):**
- `subtotal = Σ(unit_price × quantity − item.discount_amount)` — comped kalemler hariç
- `grand_total = subtotal − order.discount_amount`
- ⚠️ v3'te `grand_total` (float) + `grand_total_cents` (int) ikisi birden — v5'te **yalnız cents** (charter kuralı: float yasak)

**order_no (Kodda tespit, `helpers.js:30-37`):** Her gün `store_date` bazında sıfırlanır. `MAX(order_no) + 1` — kullanıcı isteğiyle uyumlu.

**Paket servis özel alanlar (Kodda tespit, `createOrderSchema`):** `delivery_note` (teslimat notu), `courier_note` (kurye notu) — kullanımda mı bilinmiyor (Doğrulanmamış).

**İskonto (Kodda tespit):** `orders.discount_amount` + `order_items.discount_amount` DB'de mevcut. Ancak `orders.js` route'larında iskonto endpoint'i yok → ödeme akışında mı uygulanıyor belirsiz (Doğrulanmamış).

### B. Bağımlılıklar

| Sipariş verisi | Beslendiği modül | Not |
|---|---|---|
| `product_id` + `portion_id` + fiyat snapshot | **Menü (Modül 3)** | `resolveOrderItemPrice()` — sipariş anında fiyat dondurulur |
| `table_id` | **Masa (Modül 4)** | Masa dolu/boş durumu siparişe bağlı |
| `customer_id` + `customer_name_snapshot` | **Müşteri (Modül 5)** | Paket: zorunlu eğilim; dine-in: opsiyonel |
| `order:created/updated/item_updated` emit | **Mutfak (Modül 8)** | Realtime KDS güncellemeleri |
| `in_kitchen` status + print_jobs | **Print Agent (Modül 9)** | Mutfağa gönder = print job kuyruğu |
| `status='closed'`, `paid_total` | **Ödeme (Modül 10)** | Ödeme siparişi kapatır |
| `grand_total_cents`, `store_date`, `order_no` | **Raporlar (Modül 11)** | Z/X raporu, günlük ciro |
| `order_type='takeaway'` | **Caller ID (Modül 6)** | Caller ID → paket sipariş açar |

### C. v3 Durumu

**Çalışanlar (Kodda tespit + Kullanıcı teyit):**
- Sipariş oluşturma + kalem ekleme akışı (Kaydet = mutfağa gönder)
- Tüm durum geçişleri (new→in_kitchen→…→closed/cancelled)
- Kalem bazlı ikram (`is_comped` + `comp_reason`)
- Kalem iptali → kitchen adjustment job
- Tüm kalemler iptal → sipariş otomatik cancelled → masa boşalır
- Sonradan kalem ekleme (`addItemsToOrder`)
- Paket servis özel akışları (open, delivery, print-label)
- order_no günlük sıfırlama (`store_date` bazında)
- Print job health check + retry mekanizması
- Socket.IO emit (4 event tipi)

**Sorunlular / Kritik:**
- **Float para birimi** (Kodda tespit): `grand_total` float + `grand_total_cents` int çift saklama. v5'te düzeltilecek — yalnız cents.
- **İskonto akışı belirsiz** (Kodda tespit): DB'de alan var ama route yok; ödeme modülünde mi entegre, ayrı endpoint mi belirsiz.

**Doğrulanmamış:**
- `delivery_note` / `courier_note` pratikte kullanılıyor mu
- `saved` ara durumunun gerçek kullanımı
- Sipariş bazlı ikram var mı (kalem bazlı kesin, tüm sipariş ikramı belirsiz)
- İskonto endpoint / UI konumu (Ödeme modülünde netleşecek)
- Sonradan eklenen kalemlerin kitchen print davranışı (emit var, job teyit belirsiz)

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Tüm sipariş durum akışı (status enum'lar v3 ile aynı)
- Kaydet = mutfağa gönder (in_kitchen geçişi)
- Kalem ekleme/güncelleme/iptal
- Kalem bazlı ikram (`is_comped` + `comp_reason`)
- Tüm kalemler iptal → otomatik order cancelled → masa boşalır
- Kitchen adjustment job (kalem iptal/azaltma)
- Paket özel akışlar (open, delivery, print-label)
- order_no günlük sıfırlama
- Socket.IO 4 event
- Print job health + retry

**v5.0 MVP — v3'ten farklı / düzeltilmiş / yeni:**
- **Yalnız cents** (charter kuralı): `grand_total_cents` tek para alanı; `grand_total` float kaldırılır. Tüm hesaplar integer minor unit (kuruş).
- **Masa birleştirme desteği** (Sinyal #10): Tek sipariş → `order_tables` junction tablosu (birden fazla `table_id`). `createOrder` + `addTable` + `removeTable` operasyonları. ADR-XXX ile şekillenecek.
- **Garson ataması** (Sinyal #9): `orders.assigned_waiter_id` — mobil garson uygulaması için. Sipariş açan = ilk atanan; değiştirilebilir.
- **Tek masa = tek aktif sipariş** invariantı açık (Sinyal #11): DB'de partial unique index.

**v5.1:**
- **İskonto UI** (v3'te belirsiz): Kasiyer limitli, üstü admin onayı (charter: "limit altı kasiyerde, limit üstü admin onayı"). Phase 1 başında ADR.
- `delivery_note` / `courier_note` UI'ya çıkarılması (MVP'de DB alanı hazır, UI v5.1)

**v5.2+ / non-goal:**
- Sipariş şablonu / favori kalem listesi
- Masa bazlı menü kısıtlaması (farklı fiyat/menü)
