/**
 * Onay bildirimlerinin ekranda kalma süresi (ms).
 *
 * Sonner varsayılanı 4000 ms. Sipariş akışındaki "işlem oldu" bildirimleri
 * (sipariş kaydedildi / güncellendi, kalem işlendi, not kaydedildi, müşteri
 * atandı) yoğun servis sırasında arka arkaya çıkıyor ve ekranı meşgul ediyor —
 * ürün sahibi bunları önce tamamen kaldırmak istedi, sonra "kalsın ama çok kısa
 * görünsün" dedi (S130). Kısa süre bilgi kaybı olmadan gürültüyü düşürür.
 *
 * ⚠️ YALNIZ saf onay bildirimleri için. Şunlara UYGULANMAZ:
 *   • hata bildirimleri (`toast.error`) — kullanıcı okumak ZORUNDA,
 *   • yıkıcı işlem onayları: "Sipariş iptal edildi",
 *   • yazıcı `toast.promise` akışı — basım durumu belirsizliği önemli,
 *   • durum bilgisi taşıyan bildirimler: "Son kalem iptal edildi, adisyon
 *     kapatıldı" · "Bu sipariş zaten güncellenmiş" (409 yarışı) · "Önce siparişi
 *     kaydet". Bunlar bir şeyin OLDUĞUNU değil, ekranın/akışın DEĞİŞTİĞİNİ
 *     söyler; kısaltmak yanlış olur.
 *   • **bir SONRAKİ adımı söyleyenler** (HCI kapısı bulgusu, S130):
 *     "Değişiklik adisyona işlendi, **Kaydet ile uygulanacak**" ve "Ürün
 *     silinecek olarak işaretlendi, **Kaydet ile uygulanacak**". Bunlar ilk
 *     bakışta onay gibi görünür ama kullanıcıya değişikliğin HENÜZ kalıcı
 *     olmadığını söylüyor. Uzun cümle (6-7 kelime) + kısa süre birleşince
 *     "Kaydet lazım mıydı, oldu mu?" belirsizliği doğuruyor (Nielsen #1).
 *
 * Değer: 1600 ms. 1200 denendi, HCI kapısı sınırda buldu — sonner'ın giriş/çıkış
 * animasyonu (~150-250 ms) düşünce efektif okuma penceresi ~900 ms'ye iniyor ve
 * "bir şey çıkıp kayboldu" algısına yaklaşıyor. Kısa metinler için yaygın pratik
 * alt sınır ~1500 ms. Tek sabit — ayarlamak isteyen buradan değiştirir.
 */
export const CONFIRM_TOAST_MS = 1600;
