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

## 8. Mutfak Ekranı (KDS)

> Mutfaktaki aşçının gelen siparişleri gördüğü dijital ekran. Kağıt fiş yerine (veya yanında) kullanılır, kalemler "hazır" diye işaretlenir. Modül 7'deki Socket.IO event'leri bu modülün ana beslemesidir.

### A. Amaç ve Akış

**v3 gerçeği (Kullanıcı teyit):** Mutfakta bilgisayar/ekran yok, siparişler yalnız kağıt fişten yürüyor. v3 kodunda `KitchenScreen.jsx` mevcut ama operasyonel kullanım sıfır — atıl değil, kullanım senaryosu yok. v5'te kod paritesi korunur (kapsam kilidi: v3'te vardı) ama operasyonel zorunluluk değil; ana mutfak akışı yine Print Agent + Modül 9 (Yazıcı) üzerinden kağıt fiş.

**Rol ve erişim (Kodda tespit, `App.jsx:304`):** `/kitchen` route `admin` + `kitchen` rolüne açık. `kitchen` rolüyle login olan otomatik `/kitchen`'a yönlenir (`App.jsx:103-104`). Kasiyer/garson göremez.

**Birincil amaç (Kullanıcı kararı):** Tek ekran, tüm siparişler kart halinde. İstasyon filtresi yok (v5.1). Pide/lokanta ölçeğinde en sade model.

**Beslediği event'ler (Kodda tespit, Modül 7):**
- `order:created` → yeni kart açılır + bip
- `order:items_added` → mevcut karta kalem eklenir + bip
- `order:updated` → kart durumu güncellenir
- `order:item_updated` → kalem satırı güncellenir (ikram, iptal)

**İşaretleme (Kodda tespit, `KitchenScreen.jsx:83,94,214`):**
- Kalem bazlı "Hazır" butonu → `PATCH /orders/:id/items/:itemId status=ready`
- Tüm kalemler `ready` olunca sipariş otomatik `ready` → `api.updateOrderStatus(orderId, 'ready')`
- Kart **manuel temizleme** — aşçı "tamam" dokunana kadar ekranda kalır (Kullanıcı kararı; v3 davranışı doğrulanacak)

**Sesli uyarı (Kodda tespit, `KitchenScreen.jsx:8-11`):** Web Audio API ile kısa bip. v5'te her yeni sipariş ve kalem eklenmesinde tek bip; iptal için farklı ton (Kullanıcı kararı).

**Bekleme süresi / aging (Kodda tespit, `KitchenScreen.jsx:27-35`):**
- 0-10 dk → nötr renk
- 10+ dk → sarı (warning)
- 20+ dk → kırmızı (danger)
- Eşikler v3'te hardcoded; v5 MVP'de aynı sabit değerler, ayar UI v5.1

**Online kopukluğu (Kullanıcı kararı):** Socket disconnect olduğunda büyük "Bağlantı yok" uyarı ekranı. Print Agent ayrı akış olduğu için mutfakta kağıt fiş yazdırılmaya devam — aşçı fişten yürür. Offline cache/sync yok (v5.2+).

### B. Bağımlılıklar

| Veri / Event | Kaynağı | Not |
|---|---|---|
| `order:created` / `items_added` / `updated` / `item_updated` | **Sipariş (Modül 7)** | Socket.IO ana besleme |
| `PATCH /orders/:id/items/:itemId status=ready` | **Sipariş (Modül 7)** | İşaretleme endpoint'i |
| `order_type` (dine-in / takeaway) + müşteri adı snapshot | **Sipariş (Modül 7)** + **Müşteri (Modül 5)** | Paket kart başlığı |
| `table_id` + salon bölgesi | **Masa (Modül 4)** | Dine-in kart başlığı |
| `order.created_at` (sunucu saati) | **Sipariş (Modül 7)** | Aging hesabı için doğru timestamp |
| `is_comped`, `comp_reason` | **Sipariş (Modül 7)** | İkram rozeti |
| Kitchen adjustment payload (`type: cancel / reduce`) | **Sipariş (Modül 7)** — Sinyal #22 | Kart flash + farklı ses |
| Rol + auth | **Auth (Modül 2)** | admin + kitchen rolü filtresi |

### C. v3 Durumu

**Çalışanlar (Kodda tespit, `KitchenScreen.jsx`):**
- Socket.IO event dinleme (`order:*`)
- Kart listesi + aging renk (10/20 dk)
- Web Audio API bip sesi
- Kalem bazlı "Hazır" işaretleme
- Tüm kalemler ready → sipariş otomatik ready

**Sorunlular / Kritik:**
- **Operasyonel kullanım sıfır** (Kullanıcı teyit): Mutfakta cihaz yok. v3 kodu çalışıyor ama kimse ekrana bakmıyor. v5'te cihaz zorunluluğu yine yok — Print Agent + Modül 9 gerçek çözüm.
- **Aging eşikleri hardcoded** (Kodda tespit): 10/20 dk sabit. v5 MVP'de aynı, ayar UI v5.1.
- **Rol içinde fiyat görünürlüğü doğrulanmadı** (Doğrulanmamış): v3 kartında fiyat gösteriliyor muydu bilinmiyor. v5'te rol prensibi gereği **fiyat gösterilmez**.

**Doğrulanmamış:**
- Kart manuel temizleme v3'te aynı mı, otomatik mi kayboluyor
- Kitchen adjustment job payload'ı KDS ekranında nasıl render ediliyor (backend emit kesin, UI işleme belirsiz)
- Paket vs dine-in görsel ayrımı v3'te var mı

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- `/kitchen` route, admin + kitchen rolüne açık
- Açık sipariş kart listesi (`in_kitchen` → `ready` arası)
- Bekleme süresi aging rengi (10 dk sarı / 20 dk kırmızı) — eşikler sabit
- Web Audio API bip sesi (yeni sipariş + kalem eklenmesi)
- Kalem bazlı "Hazır" butonu → `PATCH /orders/:id/items/:itemId`
- Tüm kalemler ready → sipariş otomatik `ready`
- Kart manuel temizleme (aşçı dokunana kadar kalır)

**v5.0 MVP — v3'ten farklı / düzeltilmiş / yeni:**
- Kart başlığı ayrımı: "Masa N · Salon" (dine-in) vs "PAKET · Müşteri Adı" (takeaway)
- Paket kartında `delivery_note` görünür; `courier_note` kasada kalır (kuryeye yönelik)
- Kitchen adjustment görselleştirme (Sinyal #22):
  - İptal → kalem üstü çizili + kırmızı "İPTAL" rozet + farklı tonda ses
  - Azaltma → `5→3` delta + "AZALTILDI" rozet
- Socket disconnect → büyük "Bağlantı yok" uyarı (v3 online değildi, bu senaryo yoktu)
- Kartta fiyat gösterilmez (rol prensibi — mutfak mali bilgi görmez)
- İkram rozeti (kalem bazlı "İKRAM" etiketi)

**v5.1:**
- Aging eşikleri işletme ayarlarından (pide / döner farklı süreler için)
- İstasyon filtresi (mutfak / ızgara / bar sekme) — Modül 3 yazıcı routing ile paralel
- Kart başında "Tüm kalemleri hazır" kısa yol butonu (tek dokunuş ready)
- Cihaz eşleştirme UI (hangi ekran hangi istasyonu gösterir)
- Geri alma (yanlış işaretlenen kalemi revert etme)

**v5.2+ / non-goal:**
- Offline cache + sync (v5.2+ offline mod paketiyle)
- Farklı ses tonları per event tipi (şimdilik sadece iptal farklı ton, yeni/ekleme tek bip)
- KDS üzerinden "mutfağa not gönder" / aşçıdan kasaya uyarı
- Mutfakta cihaz zorunluluğu (charter kararı: fiş ana araç kalır)

## 9. Yazıcı / Print Agent

> v3'ün en büyük ağrı noktası: 3 yazıcıda Türkçe karakter bozuk, fiş düzeni kırılıyor, sürüm güncellemesi yazıcı akışını bozuyor. v5'te sıfırdan yazılır — v3 kodu kopyalanmaz, yalnız şema + domain notları + byte tablosu referans (ADR-004, Session 1 hafızası).

### A. Amaç ve Akış

**Donanım gerçeği (Kullanıcı teyit):**
- Bugün 1 USB + 2 Ethernet yazıcı; **sayı runtime değişken** — restoran büyüdükçe eklenir/çıkarılır (Sinyal #27)
- Tüm özel Türkçe harfler (ş, ğ, ü, ö, ç, İ) fişte bozuk çıkıyor
- v3 StoreBridge katmanı kırılgan; her güncellemede farklı sorun çıkıyor (susma, hizalama bozulması, routing sıfırlama)

**Mimari karar (ADR-004, Phase 1 başı):** Print Agent = restoran PC'sinde çalışan **ayrı Windows servisi**, web/mobile kodundan **ayrı versiyonlanır**. Cloud update → yazıcı akışını etkilemez. Agent iki sorumluluk taşır: **yazıcı + Caller ID forward** (Sinyal #18).

**İletişim modeli (v5 kararı):** Hibrit — Socket.IO push (anında) + pull fallback (disconnect'te 2 sn polling). `idempotency_key` (v3 şemasında hazır) sayesinde çift basım imkansız.

```
Cloud API
  ├─ Job kuyruğa: INSERT print_jobs (status='pending', idempotency_key)
  ├─ Socket emit to Agent
Agent
  ├─ Socket subscribe OR pull /print-jobs/next
  ├─ Claim: UPDATE SET claimed_by, claimed_until
  ├─ Render: ESC/POS byte stream (preamble + CP857 encoded)
  ├─ Transport: USB spooler OR TCP 9100
  ├─ Ack: PATCH /print-jobs/:id/printed
  └─ Hata: PATCH /print-jobs/:id/failed + auto retry
```

**v3 şema (Kodda tespit, `migrations/run.js:328-365`):**
- `printers(id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active)` — type ∈ {receipt, kitchen, bar}, port default 9100
- `printer_routing(id, business_id, category_id, printer_id)` — UNIQUE(business_id, category_id)
- `print_jobs(id, order_id, printer_id, job_type, payload JSON, status, error_message, idempotency_key, claimed_by, claimed_until, attempt_count, printed_at)`

**Job tipleri (v5 MVP):**
- `receipt` — kasa adisyonu (ödeme sonrası)
- `kitchen` — mutfağa/bara kalemler (sipariş kaydet / kalem ekle)
- `adjustment` — iptal/azaltma (Sinyal #22): ayrı fiş, kırmızı "İPTAL" / "AZALTILDI" başlık, `{ type: cancel|reduce, beforeSnap, afterSnap }` payload
- `label` — paket etiketi (aynı 80mm kasa yazıcısından kısa format; ayrı 40mm sticker yazıcı v5.1)

**CP857 kök neden (Kodda tespit, Kullanıcı doğrulanmamış):**
- v3 `encodePC857` fonksiyonu doğru ve test edilmiş (`encodePC857.test.js` — tüm byte mapping'leri: Ç=0x80, Ğ=0xa6, İ=0x98, Ş=0xe0, ü=0x81, ş=0xe7…)
- **En olası neden:** yazıcıya `ESC t 13` (CP857 code page select) komutu gönderilmiyor → yazıcı default PC437'de kalıyor, doğru byte'lar yanlış glyph'e map oluyor
- v5 çözüm: her baskı öncesi **zorunlu preamble** `ESC @` (init) + `ESC t 13` (CP857 select); UTF-8 → CP857 encoder tek katman; bypass yasak

**Retry ve timeout (Sinyal #26):**
- Arka plan auto retry: 5 sn + 15 sn
- 20 sn içinde `printed` değilse → kasa ekranına toast + ses uyarısı ("Yazıcı X: 1 bekleyen fiş")
- Job UI'da "başarısız" listesine düşer, manuel retry butonu
- v3'te `POST /print-jobs/:id/retry` endpoint'i zaten mevcut, v5'te korunur

**Monitoring (MVP basit):**
- Yeşil: son 60 sn içinde başarılı baskı
- Sarı: 1+ fail var
- Kırmızı: 5+ dk sessiz
- Detaylı ESC/POS status query (kağıt yok / kapak açık) → v5.1 (yazıcı modeli desteği belirsiz)

**Yazıcı CRUD (v5 kararı):** Sadece admin — Ayarlar → Yazıcılar ekranı. İlk kurulumda zero-config keşif wizard: USB spooler listele + LAN ping tarama (basit-first-ui prensibi).

### B. Bağımlılıklar

| Veri / Event | Kaynağı | Not |
|---|---|---|
| `printer_routing` (kategori → printer) | **Menü (Modül 3)** | Sinyal #8 — MVP tek mekanizma (kategori bazlı) |
| Print job tetik (order save, kalem ekle, adjustment) | **Sipariş (Modül 7)** | `in_kitchen` geçişi + `items_added` + kalem iptal |
| `order_type=takeaway` + müşteri adı/adresi | **Müşteri (Modül 5) + Sipariş (Modül 7)** | Paket etiketi |
| Caller ID forward (TCP dump parse) | **Caller ID (Modül 6)** | Sinyal #18 — aynı Agent |
| Fiş başlığı, adres, logo, KDV | **İşletme Ayarları (Modül 1)** | Receipt render |
| Rol kontrolü (yazıcı CRUD = admin) | **Auth (Modül 2)** | Ayarlar → Yazıcılar |
| Realtime push/pull | **Socket.IO altyapısı** | ADR-004 belirleyecek |

### C. v3 Durumu

**Çalışanlar (Kodda tespit):**
- Şema tam (`printers`, `printer_routing`, `print_jobs` + claim/retry/idempotency alanları)
- Kategori bazlı routing `printRouting.js`
- ESC/POS renderer + encodePC857 (`store-bridge/printers/renderers.js`)
- Print job idempotency test (`printJobs.idempotency.test.js`)
- Auto print policy (`printerAutoPrintPolicy.js`)
- `POST /print-jobs/:id/retry` manuel retry

**Sorunlular / Kritik (Kullanıcı teyit):**
- **CP857 Türkçe karakter bozuk** (tüm özel harfler): büyük ihtimalle `ESC t 13` eksik
- **StoreBridge her güncellemede farklı sorun üretiyor** — katman kırılgan, v5'te sıfırdan yazılır
- **Yazıcı çift routing mekanizması** (Sinyal #8): kategori routing + ürün `printer_target` fallback UI'yı karıştırıyor → v5 MVP'de tek mekanizma (kategori)
- **Mutfak adjustment job render formatı belirsiz** (Doğrulanmamış): v3'te emit kesin, basım formatı v5'te yeniden tanımlanır (kırmızı İPTAL/AZALTILDI başlık)

**Doğrulanmamış:**
- v3'te `ESC t 13` komutu render'da gerçekten eksik mi (Phase 1 başında kod analizi ile teyit)
- Fiş preview UI vs gerçek baskı path'leri encoder açısından aynı mı
- `printerAutoPrintPolicy.js` hangi kararları aldığı net değil

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3 kapsamı korunur:**
- `printers`, `printer_routing`, `print_jobs` şema (claim/retry/idempotency_key/attempt_count)
- Kategori bazlı routing — tek mekanizma (Sinyal #8: ürün bazlı override v5.1)
- Job tipleri: `receipt`, `kitchen`, `adjustment`, `label`
- Paket etiketi = aynı 80mm kasa yazıcısından kısa format (v3 `print-label` mantığı)
- Health endpoint + manuel retry endpoint

**v5.0 MVP — v3'ten farklı / düzeltilmiş / yeni:**
- **Print Agent ayrı Windows servisi, ayrı versiyonlanır** (StoreBridge'in aksine web/mobile update'inden izole)
- **Print Agent = Yazıcı + Caller ID forward tek servis** (Sinyal #18)
- **Hibrit iletişim:** Socket push + pull fallback; `idempotency_key` ile çift basım yok
- **CP857 düzeltmesi (Sinyal #28):** her baskı öncesi zorunlu preamble `ESC @ + ESC t 13`; UTF-8 → CP857 encoder tek katman; bypass yasak. v3 byte tablosu domain referansı (kod kopyalama değil)
- **Timeout 20 sn → kasa toast + ses uyarısı** (Sinyal #26); başarısız job listesi + manuel retry
- **Yazıcı CRUD sadece admin** (Ayarlar → Yazıcılar); yazıcı sayısı runtime değişken (Sinyal #27)
- **Monitoring MVP:** son başarılı baskı + fail count (yeşil/sarı/kırmızı)
- **Zero-config keşif wizard** (ilk kurulum): USB spooler listele + LAN ping tarama (basit-first-ui)
- **Kitchen adjustment fişi format:** ayrı fiş, kırmızı "İPTAL"/"AZALTILDI" başlık, before/after snapshot

**v5.1:**
- Ürün bazlı `printer_target` override UI (Sinyal #8)
- ESC/POS status query (`DLE EOT n` — kağıt yok / kapak açık / buffer dolu)
- Fiş template editörü (logo boyutu, header/footer özelleştirme)
- PDF arşivi opsiyonu (son 30 gün, Hetzner Storage Box)
- Ayrı etiket yazıcı (40mm sticker) desteği

**v5.2+ / non-goal:**
- Cloud'dan uzak şubelere yazıcı atama (multi-branch)
- Yazıcı kuyruğu drag-drop öncelik UI
- Fiş e-posta gönderimi (müşteri onayıyla — KVKK)

## 10. Ödeme

> Parçalı ödeme (kalem bazlı allocation), nakit + kart, para üstü hesabı, ödeme sonrası iptal (refund), idempotency. İskonto v5.1'e ertelendi (Sinyal #30, charter güncellemesi + ADR-XXX).

### A. Amaç ve Akış

**Kullanıcı kararları (Modül 10 röportaj özeti):**
- Parçalı ödeme **kalem bazlı** ("herkes kendi yediğini öder") — v3 pattern'i
- Ödeme yöntemleri: **sadece nakit + kart** (sepet, veresiye MVP dışı)
- **İskonto MVP dışı → v5.1** (Sinyal #30, kapsam küçültme ADR-XXX)
- Refund: tam iptal, admin onayı, neden metni zorunlu

**v3 şema (Kodda tespit, `migrations/run.js:255-275, 305-`):**
- `payments(id, business_id, order_id, amount, payment_type, payment_scope, idempotency_key, …)` — `payment_type` ∈ {cash, card, mixed, other}; `payment_scope` ∈ {full_order, split_item}
- `payment_allocations(id, business_id, payment_id, order_id, order_item_id, amount, …)` — kalem bazlı dağıtım
- `refunds(id, business_id, order_id, payment_id, amount, reason, approved_by, idempotency_key, …)`
- UNIQUE index: `idx_payments_idempotency ON payments(business_id, order_id, idempotency_key) WHERE idempotency_key IS NOT NULL`

**Parçalı ödeme UI akışı (v5 kararı):**
1. Kasiyer adisyonda kalemleri checkbox ile seçer
2. "Seçilenleri öde" butonu → yöntem (Nakit / Kart) + tutar girişi
3. Nakit ise `tendered_cents` girilir, sistem para üstü hesaplar
4. Kaydet → `payments` satırı + her seçilen kalem için `payment_allocations` satırı
5. Kalan kalemler aktif kalır, sonraki müşteri için akış tekrar
6. `paid_total_cents >= grand_total_cents` olduğunda sipariş otomatik `closed`, masa boşalır, `receipt` print job kuyruğa

**Karışık ödeme (Sinyal #29):** Nakit + kart aynı grup için → iki ayrı `payments` satırı (her biri tek `payment_type`). `mixed` deprecate.

**Para üstü:** `payments.tendered_cents` − `payments.amount_cents` = para üstü. Z raporunda kasa açığı/artığı hesabı için kritik.

**İptal akışı ayrımı (v5 kararı):**
- **Ödeme öncesi iptal** → `orders.status='cancelled'` (Modül 7 akışı), `refunds` yazmaz, masa boşalır
- **Ödeme sonrası iptal** → yeni `refunds` satırı + admin onay + neden metni + audit log; para fiziksel iadesi kasiyer/admin sorumluluğunda

**Refund MVP:** Tam iptal (siparişin tamamı iade). Kısmi refund (belirli kalemler) → v5.1 (Sinyal #31).

**Idempotency:** Server-side zorunlu. UI "Öde" çift tıklamada aynı `idempotency_key` → ikinci istek UNIQUE ile reddedilir, istemci son kayıtlı yanıtı alır. Refund için aynı kontrat.

### B. Bağımlılıklar

| Veri / Event | Kaynağı | Not |
|---|---|---|
| `orders.grand_total_cents` | **Sipariş (Modül 7)** | Ödenecek tutar |
| `order_items` | **Sipariş (Modül 7)** | Kalem bazlı parçalama |
| `receipt` print job tetik | **Yazıcı (Modül 9)** | Ödeme tamamlanınca |
| Masa boşaltma | **Masa (Modül 4)** | Sipariş closed → masa boş |
| Admin onay + audit log | **Auth (Modül 2) + Audit** | Refund için |
| Z / X raporu | **Raporlar (Modül 11)** | Günlük ödeme kırılımı, kasa açığı/artığı |
| Kasiyer/admin rolü | **Auth (Modül 2)** | Normal ödeme kasiyer; refund admin |

### C. v3 Durumu

**Çalışanlar (Kodda tespit):**
- `payments` + `payment_allocations` + `refunds` şeması tam
- `payment_scope` ∈ {full_order, split_item}
- `idempotency_key` UNIQUE index
- `paymentService.js`, `refundService.js` ayrı service katmanı

**Sorunlular / Kritik:**
- **Float para hesabı** (Sinyal #21): çift saklama. v5'te yalnız cents.
- **`payment_type='mixed'` ambiguous** (Sinyal #29): v5'te deprecate, iki ayrı satır.
- **İskonto route yok** (Modül 7 açık ucu, Sinyal #30): DB'de alan var, uygulama endpoint'i yok → fiilen kullanılmıyor. v5.1'e ertelendi.
- **Refund idempotency UI tarafı doğrulanmadı** (Doğrulanmamış): server UNIQUE var, UI çift tıklama testi yok. v5'te optimistic lock.

**Doğrulanmamış:**
- `payment_type='mixed'` gerçek kullanımı
- Bahşiş alanı v3'te yok (tips tablosu grep'te çıkmadı)
- Refund sonrası `orders.status` davranışı

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3 kapsamı korunur:**
- `payments` + `payment_allocations` + `refunds` şeması
- `payment_scope` ∈ {full_order, split_item}
- `idempotency_key` UNIQUE(business_id, order_id)
- Kalem bazlı parçalı ödeme UI (checkbox → "Seçilenleri öde")
- Para üstü hesabı (`tendered_cents`)
- Ödeme tamamlanınca sipariş closed + masa boş + `receipt` print job
- Refund admin onay + neden zorunlu + audit log

**v5.0 MVP — v3'ten farklı / düzeltilmiş:**
- **Yalnız `*_cents` integer** (Sinyal #21): tüm para integer kuruş
- **`payment_type` ∈ {cash, card}** (Sinyal #29): mixed + other deprecate; karışık = iki satır
- **İskonto MVP dışı → v5.1** (Sinyal #30): ⚠️ kapsam küçültme ADR-XXX + charter güncelleme
- **Ödeme öncesi iptal vs sonrası refund** ayrımı net
- **Refund idempotency server-side zorunlu** + UI optimistic lock
- **Tüm refund admin onayı** (kasiyer limit kuralı iskonto ile birlikte v5.1'e)

**v5.0 MVP — yeni (v3'te yok):**
- Ödeme UI'sında yalnız 2 yöntem butonu (Nakit / Kart)

**v5.1:**
- İskonto (sipariş bazlı, kasiyer limit altı, üstü admin onayı) — ADR ile geri getirilir
- Kısmi refund (Sinyal #31)
- Sepet (Yemeksepeti/Getir/Trendyol manuel) ödeme yöntemi
- Bahşiş (`tip_cents`)
- Hızlı tutar tuşları (100/200/500)
- Açık hesap / veresiye

**v5.2+ / non-goal:**
- POS cihazı entegrasyonu (banka API)
- Fiş e-posta (KVKK onayı)
- Yemek platformu API entegrasyonu
