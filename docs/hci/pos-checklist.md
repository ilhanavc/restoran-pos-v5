# HCI Checklist — POS Özel

Her UI değişikliği, bu checklist'ten geçmek zorundadır. `hci-reviewer` sub-agent'ı PR'da bu listeyi uygular.

## Nielsen'in 10 ilkesi (hepsi uygulanır)

### 1. Sistem durumu her zaman görünür

- [ ] Yükleme (loading) göstergesi 200ms üzeri her işlemde var
- [ ] Sync durumu sürekli ekranda: "Cloud ile bağlı" / "Yerel modda" / "Sync gecikmiş: X dk"
- [ ] Yazıcı durumu görünür: bağlı / meşgul / kağıt yok / offline
- [ ] Caller ID aktif mi? Gösterge ışığı
- [ ] Başarılı aksiyon sonrası Toast bildirimi ("Sipariş mutfağa gönderildi")

### 2. Sistem ile gerçek dünya eşleşmesi

- [ ] Jargon Türkçe ve restoran sektörü: "sipariş", "adisyon", "masa", "komi", "servis", "pax"
- [ ] İkon + metin kombinasyonu (yalnız ikon yasak — tanımayan yeni garson için)
- [ ] Renk kodlaması kültürel: kırmızı = hata/iptal, yeşil = tamam, sarı = dikkat
- [ ] Masa haritası gerçek oturma düzenine benzeyebilir (opsiyonel customization)

### 3. Kullanıcı kontrolü ve özgürlük

- [ ] Her destructive aksiyon için undo (en az 5 saniye): sipariş iptali, satır silme
- [ ] Kapanmış hesap 5 dakika içinde geri açılabilir (audit log ile)
- [ ] Yanlış baskı iptal edilebilir (ikinci baskı = ORJİNAL DEĞİL damgalı)
- [ ] Escape tuşu her modal'ı kapatır
- [ ] Navigation ileri-geri tutarlı

### 4. Tutarlılık ve standartlar

- [ ] Aynı aksiyon her ekranda aynı yerde, aynı renkte, aynı ikonla
- [ ] Desktop/mobile/web — üç platformda tutarlı görsel dil
- [ ] Platform konvansiyonlarına saygı: iOS'ta back swipe, Android'de hardware back
- [ ] Tarih formatı: her yerde `dd.mm.yyyy` veya `dd Ocak 2026`
- [ ] Para formatı: `24,75 ₺` (virgülle ondalık, TL sembolü sonda)

### 5. Hata önleme

- [ ] Büyük tutarlı ödemede (> 1000 TL) onay modal'ı
- [ ] "Hesabı sil" butonu destructive renkte, 2 adımlı onay
- [ ] Gerçek zamanlı validasyon: ödeme > hesap tutarı uyarısı
- [ ] Menü ürünü silme: o ürünün açık siparişlerde kullanımını kontrol
- [ ] Boş zorunlu alan submit'i engellenir, inline hata gösterilir

### 6. Tanıma > hatırlama

- [ ] Ürün tile'larında görsel (varsa) + ad + fiyat
- [ ] Son eklenen / en çok satan bölümü her kategori başında
- [ ] Modifier'lar ürün seçilince otomatik açılır (bazını hatırlamaya gerek yok)
- [ ] Klavye kısayolları ekranda gösterilir (power user için)
- [ ] Son 10 işlem hesap geçmişinde erişilebilir

### 7. Esneklik ve verimlilik

- [ ] Klavye kısayolları (sadece desktop): Ctrl+P = bas, F2 = masa seç
- [ ] Ürün arama: ilk 3 harf ile filtre
- [ ] "Favoriler" bölümü — en sık kullanılan 10 ürün shortcut
- [ ] Toplu işlem: birden fazla siparişi aynı anda yazdır/gönder
- [ ] Hem acemi (tıklama akışı) hem uzman (kısayol) senaryosu çalışıyor

### 8. Estetik ve minimalist tasarım

- [ ] Ekranda her piksel bir amaca hizmet ediyor (dekorasyon yok)
- [ ] Renk paletinde en fazla 5 aktif renk
- [ ] Tipografi ölçeği: 3 boyut yeter (başlık / gövde / küçük etiket)
- [ ] Animasyon: sadece state değişikliklerini iletmek için, <300ms, reduced-motion desteği
- [ ] Rush saatinde dikkat dağıtacak hiçbir şey yok: bildirim animasyonları duraklar

### 9. Hata mesajlarını tanı, anlat, kurtar

- [ ] Hata mesajları Türkçe, teknik terim yok: "Sipariş gönderilemedi" değil "Error 500"
- [ ] Her hata mesajı bir aksiyon önerir: "Tekrar dene" / "Teknik desteği ara" / "Offline modda devam et"
- [ ] Kurtarma yolu açık: kaybolan sipariş draft'ı local'den geri getirilebilir
- [ ] Sentry reference ID gösterilir (destek için), ama üstte değil yardım ekranında
- [ ] Sessiz hata yasak — kullanıcı bilmeden veri kaybı olmaz

### 10. Yardım ve dokümantasyon

- [ ] Her ekranda `?` ikonu → kontekstüel yardım
- [ ] İlk 3 gün onboarding turu (atlanabilir)
- [ ] Video tutorial link'leri kritik akışlar için
- [ ] Destek chat/çağrı butonu her ekranda (sağ alt)

## POS-spesifik ek prensipler

### Fitts Kanunu

- [ ] En sık kullanılan butonlar (Ekle, Bas, Öde) ekran kenarına yakın ve büyük
- [ ] "Ekle" butonu ürün tile'ının tamamı tıklanabilir alan (sadece küçük bir buton değil)
- [ ] Tablet kullanımında başparmak reach zone'u dikkate alınır

### Hick Kanunu

- [ ] Menüde tek ekranda 200 ürün yok. Kategori → alt kategori → ürün
- [ ] Maksimum 7 kategori ilk ekranda (Miller's rule)
- [ ] Sık kullanılan ürünler "Favoriler" ile shortcut

### Dokunma hedefi

- [ ] Tüm interaktif elementler minimum 52×52 pt (Apple HIG 44, biz +8)
- [ ] Aralarında minimum 8 pt boşluk (yanlış dokunma önleme)

### Okunabilirlik

- [ ] Minimum font 14pt, kritik metinler 16pt+
- [ ] Kontrast oranı: normal metin ≥ 4.5:1, büyük metin ≥ 3:1 (WCAG AA)
- [ ] Güneş altı mod: sadece siyah/beyaz, yüksek kontrast tema

### Rush-hour test

- [ ] Bu ekran, saatte 200 sipariş akışında stres testinden geçti mi?
- [ ] Yanlış tıklama oranı < %1 (test oturumu ile ölçüldü)
- [ ] Yeni garson 60 dakikada hatasız sipariş girebiliyor mu?

### Erişilebilirlik (WCAG AA minimum)

- [ ] Tüm interactive element klavye ile erişilebilir
- [ ] Odak (focus) göstergesi görünür
- [ ] Screen reader etiketleri (aria-label) doğru
- [ ] Renk tek ayırt edici değil (şekil + renk)
- [ ] Animasyon `prefers-reduced-motion` ile kapatılabilir

### Stres senaryoları

- [ ] Islak parmakla dokunma testi (tablet kullanım gerçeği)
- [ ] Eldivenli dokunma (mutfak personeli)
- [ ] Düşük batarya uyarısı — işlem yapmayı engellemez
- [ ] İnternet yokluğunda görünür uyarı + yerel moda geçiş sorunsuz

## Review akışı

Her UI PR'da:
1. `hci-reviewer` sub-agent bu listeyi uygular
2. Fail olan maddeleri PR'a yorum olarak düşer
3. Geliştirici düzeltir
4. Yeniden review
5. ✅ tüm maddeler geçtiğinde merge hakkı
