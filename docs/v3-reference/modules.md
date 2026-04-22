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

Roller (admin dışı tahmin — v3 kodu incelenince doğrulanacak):
- **Yönetici / Admin** — tüm ekranlar + ayarlar + raporlar
- **Kasiyer** — muhtemelen masa, sipariş, ödeme, paket servis (test edilmedi)
- **Garson** — bilinmiyor (muhtemelen masa + sipariş)
- **Mutfak** — bilinmiyor (muhtemelen sadece mutfak ekranı)

Akış: email+şifre → Giriş Yap → rolüne göre menü açılır. Demo butonlarıyla: şifresiz, sadece rol seçimi. Logout: sol menüde "Çıkış" butonu var, davranışı test edilmedi. Şifre sıfırlama: "Şifremi unuttum" linki görünür — tıklanınca ne olduğu (modal/sessiz/hata) doğrulanmadı, çalışmadığı kesin.

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
- Bilinmeyenler (Garson/Mutfak yetkileri, logout, timeout) v3 kodu incelenince doğrulanacak

### D. v5 Kapsam Tasnifi

**v5.0 MVP — v3'tekiyle aynı kapsam:**
- Email + şifre login
- Demo hızlı giriş (4 rol; prod'da env flag ile kapatılır)
- 4 rol: admin, kasiyer, garson, mutfak
- Rol bazlı menü / ekran gösterimi

**v5.0 MVP — v3'ten farklı / yeniden tasarlanmış:**
- **Şifre sıfırlama çalışır halde** — v3'te yok sayılır, v5'te baştan tasarlanır (akış tercihi ADR-002'de; öneri aşağıda)
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
