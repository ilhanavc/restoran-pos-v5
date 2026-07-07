# Go-Live — Kağıt Fallback Prosedürü + Personel Eğitim Taslağı

> Session 85 (2026-07-07). A7 kalemi. Cutover ön-koşulu (go-live güvenlik ağı).
> **Bölüm 1'i yazdır + kasaya/mutfağa as.** Bölüm 2 = go-live öncesi eğitim rehberi.
> [KÖŞELİ] alanları işletme doldurur.

---

## BÖLÜM 1 — KAĞIT FALLBACK (1 sayfa — YAZDIR + AS)

**Ne zaman:** POS açılmıyor · internet yok · sunucuya erişilmiyor · yazıcı basmıyor.

### 🟢 ALTIN KURAL: Sipariş almayı DURDURMA. Kağıda yaz → sistem gelince gir.

### 1) Sipariş (kağıt adisyon)
- Her masa / paket için kağıt adisyona yaz: **masa no** (veya "PAKET" + telefon + adres), **ürünler + adet**, **saat**.
- Mutfağa kağıt adisyonun kopyasını ver (veya sözlü söyle + kağıdı göster).
- Adisyonu masada / askıda tut.

### 2) Ödeme (kağıt)
- Toplamı **elle hesapla** (menü fiyat listesi elinizin altında olsun — [FİYAT LİSTESİNİ YAZDIR]).
- **Nakit:** üstünü ver → adisyona `ÖDENDİ · NAKİT · ₺___` yaz.
- **Kart:** [POS cihazı ayrıysa onunla çek] → adisyona `ÖDENDİ · KART · ₺___ · slip ___` yaz.
- Ödenen adisyonu **"ÖDENDİ" kutusuna** ayır.

### 3) Sistem gelince (mutabakat — reconciliation)
1. Kağıt adisyonları **sırayla** sisteme gir (önce sipariş, sonra ödeme).
2. Girdiğin adisyonu **işaretle/ayır** → çift-giriş olmasın.
3. **Nakit kasa sayımı** ile sistem toplamını karşılaştır; fark varsa müdüre bildir.

### ☎️ Kimi ararım
- **Müdür:** [TEL]
- **Teknik / geliştirici:** [TEL / KANAL]
- **Adisyo hâlâ açıksa** (cutover sonrası 2-4 hafta): >30 dk sipariş alınamıyor / veri şüphesi → **Adisyo'ya geri dön** (rollback — ADR-031 K10; abonelik açık).

---

## BÖLÜM 2 — PERSONEL EĞİTİM TASLAĞI (go-live öncesi)

> Cutover'dan 1-2 gün önce. Her personel kendi rolünü + kağıt fallback'i öğrenir.

### Herkes (≈30 dk)
- **Giriş:** kendi **e-posta + şifre** ile (username değil — e-posta). Rolünü öğren (kasiyer / garson / mutfak).
- **Ekran turu:** masalar, sipariş alma, kategoriler.
- **Kağıt fallback (Bölüm 1):** nerede asılı, ne zaman devreye girer — herkes bilir.

### Garson — mobil (≈20 dk)
- Uygulamaya giriş → **masa seç → ürün ekle → Kaydet** (Kaydet otomatik mutfağa gönderir; ayrı "gönder" yok).
- Paket: **müşteri ata** + adres.
- İnternet/uygulama takılırsa → kağıt fallback.

### Kasiyer — web (≈30 dk)
- Sipariş alma + düzenleme (comp/void yetkisi kasiyerde).
- **Kategori sırası:** Menü Tanımları → "Kategorileri Sırala" (S85 — sık kullanılanı öne al).
- **Ödeme ekranı:** *Öde* / *Öde ve Kapat* / **Öde ve Yazdır** (fiş bas) / *Masayı Kapat*.
  - Fiş yalnız **"Öde ve Yazdır"** veya elle **"Adisyon Yazdır"** ile basar (Masayı Kapat otomatik basmaz — S85 kararı).
- **Kara liste:** müşteri detay → sorunlu müşteriyi işaretle (yeni siparişe atanamaz).
- Gün sonu / raporlar (özet bakış).

### Mutfak — KDS (≈10 dk)
- **KDS ekranı:** gelen siparişler; hazırlanınca **hazır** işaretle.
- **Mutfak fişi otomatik basar** (Türkçe) — gelmezse müdüre haber.

### Cutover günü notları (personele)
- **Sipariş no 1'den başlar** (yeni sistem — normal).
- **Kasa fiş yazıcısı o gün** devreye girer (codepage teyidi geliştirici tarafından).
- İlk gün **müdür + geliştirici hazır**. Sorun olursa panik yok → kağıt fallback + haber ver.
- **Yedek güvende:** her gece otomatik şifreli yedek alınıyor (A3) — veri kaybı riski minimal.

---

*Taslak — Session 85. İşletme [KÖŞELİ] alanları + fiyat listesi ekini tamamlar; cutover öncesi provası yapılır.*
