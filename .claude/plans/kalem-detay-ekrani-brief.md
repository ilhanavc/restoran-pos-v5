# Kalem Detay Ekranı — gereksinim yakalaması (S104, cutover SONRASI iş)

> **Durum:** ⛔ **KOD YAZILMADI.** Ürün sahibi gereksinimleri verdi (S104, 23 Tem —
> cutover arifesi). Kapsamı ADR gerektiriyor; cutover'a girmeden yapılmaz.
> **Sıra:** ADR → backend → web → mobil.

## Talep

Ürün sahibi: *"webde adisyon listesinde **kaydedilmiş** bir ürüne tıkladığımızda
Adisyo örneğindeki gibi bir ekran olması gerekiyor, sonrasında bu işlevi mobil
için de eklememiz gerekiyor."* Referans: Adisyo POS'un ürün-detay modalı
(masaüstü modal + mobil bottom-sheet ekran görüntüleri, S104 sohbeti).

## İSTENEN (ürün sahibi onayladı)

| # | İşlem | v5'te bugün | Not |
|---|---|---|---|
| 1 | **Adet +/−** | ❌ yok | Kaydedilmiş kalemin adedi değişebilmeli |
| 2 | **Ürün notu düzenleme** | ✅ var (`PATCH item {note}`) | Yalnız ekrana taşınacak |
| 3 | **Porsiyon değiştirme** | ❌ yok | Fiyat yeniden hesaplanmalı |
| 4 | **Ürünü sil** | ✅ var (`status:'cancelled'`) | S104'te garsona da açıldı |
| 5 | **İkram et** | ✅ var (`isComped`) | admin/kasiyer kapısı **duruyor** |
| 6 | 🔴 **Birim fiyatı düzenleme** | ❌ yok | Aşağıya bak — mimari karar |

### ⚠️ Kritik kısıt (ürün sahibi, birebir)

> *"burada yapılan değişikliklerin **yazıcıdan çıkmasına gerek yok**, sistemde
> gözükmesi yeterli"*

Yani bu ekrandaki hiçbir değişiklik mutfak/iptal fişi **tetiklemez**. Bu, mevcut
davranıştan **sapmadır**: kalem iptali bugün istasyona iptal fişi bastırıyor
(ADR-004 Amd6 + ADR-032 Amd1 K14). ADR'de açıkça kararlaştırılmalı — "sil"
buradan yapılınca fiş çıkacak mı çıkmayacak mı?

### 🔴 Birim fiyatı düzenleme — ADR-013 §2'yi deler

Ürün sahibi (birebir): *"birim fiyatı düzenleme adımı önemli ve **sadece o
üründeki seçilen ürünün** biriminin fiyatının değişmesi gerekiyor ve **değişen
fiyat ile adet sayısının çarpılıp** hesapta o şekilde gözükmesi gerekiyor."*

- Kapsam: **yalnız o kalem satırı** — ürün kataloğu fiyatı DEĞİŞMEZ
- `total_cents = yeni_birim × adet` olarak yeniden hesaplanır
- **Çatışma:** ADR-013 §2 "server-side fiyat otoritesi — UI değerleri YOK
  SAYILIR". Bu özellik istemciden fiyat kabul etmeyi gerektirir → **ADR-013
  amendment ZORUNLU**, `security-reviewer` gate şart (parasal + IDOR yüzeyi)
- Tasarım soruları: yetki kimde (garson mu, yalnız admin/kasiyer mi)? tavan/taban
  var mı (ADR-012 Amd1'deki ±1.000 TL emsali)? indirim mi override mı olarak
  raporlanacak? audit payload'ı ne taşıyacak (before/after)?

## İSTENMEYEN (ürün sahibi eledi)

- **2. Marş'a gönder** — v5'te "marş" kavramı yok
- **Ürünü farklı siparişe taşı** — ADR-029 adisyonun TAMAMINI aktarıyor; kalem
  bölümlü aktarım Faz B'nin en karmaşık işiydi, kapsam dışı
- **Sipariş grubu** — sorulmadı/istenmedi

## Teknik ön-inceleme (S104'te bakıldı)

- Mevcut uç: `PATCH /orders/:orderId/items/:itemId` — **yalnız** `note`,
  `status:'cancelled'`, `isComped` kabul ediyor (`OrderItemUpdateSchema`).
  Adet / porsiyon / birim fiyat için **şema + handler genişlemesi** gerekir.
- `updateItemTx` + `orders.total_cents` recalc zinciri var; adet/fiyat değişimi
  aynı recalc'a bağlanmalı (iptal/ikram hariç tutma mantığı korunarak).
- S104'te kaldırılan iki kapı (sahiplik + gönderilmiş-durum) bu ekranın
  ön-koşuluydu — artık garson kaydedilmiş kaleme dokunabiliyor.
- Web'de kalem satırı `AdisyonPanel.tsx`; mobilde `AdisyonSheet.tsx` +
  `LineDetailSheet.tsx` (mobilde **sepet** satırı için zaten bir detay
  sheet'i VAR — kaydedilmiş kalem için yeniden kullanılabilir).

## Kapsam kilidi notu

v5.0 MVP listesinde **yok**; v3'te de yok (Adisyo paritesi). CLAUDE.md core
directive 6 gereği **ADR ile gerekçelendirilmeli**. Cutover'ı bloklamaz.
