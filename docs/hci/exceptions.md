# HCI Checklist İstisnaları

> `docs/hci/pos-checklist.md` kurallarından **bilinçli** sapmaların kaydı. Her giriş: hangi kural, neden sapıldı, kaynak ADR/PR, gözden geçirme koşulu. `hci-reviewer` bu dosyayı istisna-kaynağı olarak okur; burada kayıtlı bir sapma yeni PR'larda blocker sayılmaz (kapsamı değişmedikçe).

## 1. Masalar header bağlantı-noktası — "yalnız ikon" istisnası (bağlıyken)

> ⛔ **SUPERSEDED (2026-07-27, ADR-026 Amd5 K4 / PR #493):** kalıcı nokta kaldırıldı — bağlantı durumu artık yalnız sorunlu durumda (`ConnectionBanner`) metinli bant olarak gösterilir; istisnanın konusu kalmadı. Kayıt tarihçe için korunur.

- **Kural:** pos-checklist "İkon + metin kombinasyonu — yalnız ikon yasak" (yeni garson ikonu tanımayabilir).
- **Sapma:** Bağlantı-durumu göstergesi **bağlıyken yalnız yeşil nokta** gösterir (metinsiz); bağlanıyor/kopukken noktanın yanına metin etiketi ("Bağlanıyor…" / "Sunucu bağlantısı yok") eklenir.
- **Gerekçe:** Rush-hour minimalizm kuralıyla çatışma bilinçli çözüldü — normal durumda kalıcı "Bağlı" etiketi görsel gürültü üretir ve kart içeriği zaten canlıdır; garsonun **aksiyon alması gereken** anormal durumlar iki kanal (renk + metin) taşır. Erişilebilirlik: nokta her durumda `accessibilityLabel` taşır; `disconnected` geçişi ekran-okuyucuya ayrıca duyurulur (`AccessibilityInfo.announceForAccessibility`).
- **Kaynak:** ADR-026 Amendment 2 K1 (2026-07-17, S98) + hci-reviewer gate raporu (PR #388).
- **Gözden geçirme koşulu:** Pilot geri bildiriminde garsonlar yeşil noktanın anlamını sormaya başlarsa, ilk açılışta 1-2 sn geçici "Bağlı" etiketi (sonra nokta-only) değerlendirilir.

## 2. Web (kasa) dokunma hedefi — 44px `h-11` konvansiyonu

- **Kural:** pos-checklist "Dokunma hedefi ≥ 52pt" (rush-hour parmak-öncelikli isabet).
- **Sapma:** `apps/web` buton/sekme konvansiyonu **44px** (`h-11`) — CategoryTabs dahil, codebase geneli yerleşik (DiningAreasPage, TablesListPage, UsersPage vb.).
- **Gerekçe:** 52pt eşiği **parmak-öncelikli mobil** (garson terminali) için tanımlıdır. Web = dükkan-PC'de **fare-öncelikli** kasa/kiosk (ADR-031 K1 tek-istasyon dükkan-PC + Chrome kiosk); imleç isabeti parmaktan hassas, 44px WCAG 2.5.5 (AAA) hedef-boyutunun üstünde ve masaüstü yoğunluğuna uygun. Mobil (`apps/mobile`) 52pt tabanını korur (CategoryGrid tile 64px).
- **Kaynak:** ADR-026 Amendment 4 K8 (2026-07-18, S99) + hci-reviewer gate raporu (PR #394).
- **Gözden geçirme koşulu:** Kasa dokunmatik-ekranlı bir donanıma taşınırsa (parmak-öncelikli), web dokunma hedefleri 52pt'e yükseltilir.

## 4. Kalem taşıma — geri alma (undo) yok

- **Kural:** pos-checklist §3 "geri alınamaz her aksiyonun undo'su olmalı".
- **Sapma:** Ürün-bazlı adisyon taşıma (ADR-035) **anlık** ve **undo'suz**dur; onay penceresi tek koruma katmanıdır.
- **Gerekçe:** Ters yönde taşıma pratikte undo işlevi görür (aynı kalem hedeften kaynağa geri taşınabilir) — ayrı bir undo mekanizması ikinci bir para-kritik yol açardı. Onay penceresi kalem adı + adet + kaynak + hedefi yazar, ayrıca "fiş basılmaz" ve "boş masada yeni adisyon açılır" notlarını önden verir. Her taşıma `order_item.moved` audit'i bırakır (S11), yani iz kaybolmaz.
- **Kaynak:** ADR-035 S14 (2026-07-26, ürün sahibi; "undo v5.1") + hci-reviewer gate raporu (PR-2, 2026-07-27).
- **Gözden geçirme koşulu:** Canlı kullanımda yanlış-masaya-taşıma vakası görülürse v5.1'deki undo öne çekilir.

## 3. Sekme çubuğu — "Satış" sekmesinin profil yüklenene dek gecikmeli belirmesi

- **Kural:** pos-checklist "geç yüklenen içerik dokunma hedeflerini kaydırmamalı" (yanlış-tıklama deseni).
- **Sapma:** admin/kasiyer oturumunda açılışta profil `getMe()` ile tazelenene kadar sekme sayısı 3'tür; profil gelince "Satış" belirir (3→4) ve sekme genişlikleri o anda değişir.
- **Gerekçe:** Rol-reaktif sekme listesi, S105 #489'daki "donmuş rol snapshot'ı" hatasının panzehiridir (ADR-026 Amd5 K1) — sekmeler zustand selector'a bağlı kalmak ZORUNDA. Pencere tek ağ round-trip'i (saniye-altı); `Order` sekme dışında olduğundan yanlış dokunuşun maliyeti düşük ve anında geri alınabilir. Alternatif (profil gelene dek sekme çizmemek) açılışta boş kabuk gösterir — daha kötü.
- **Kaynak:** ADR-026 Amendment 5 K1 (2026-07-26) + hci-reviewer gate raporu (PR #493 re-review, 2026-07-27).
- **Gözden geçirme koşulu:** Pilotta yanlış-sekme dokunuşu şikâyeti gelirse, kalıcılaştırılmış profil (S105 #489) açılışta senkron okunarak pencere sıfırlanır (ağ tazelemesi arkada kalır).

## 4. Katalog kartı — gövde-tap "porsiyon miras alır" ama `+`/`−` stepper "default Tam" ekler

- **Kural:** pos-checklist "sistem durumu görünürlüğü / tutarlı davranış" (aynı kartta iki ekleme yolu farklı sonuç verirse yanlış-sipariş riski).
- **Sapma:** ADR-013 Amendment 6 sonrası ürün kartının **gövdesine dokunma** (`handleAddProduct`), masadaki eşleşen satırın porsiyon+özelliğini **miras alır** (ör. 1,5). Aynı kartın üstündeki **`+`/`−` adet stepper'ı** (`incrementProduct`, `isQuickAddItem`) ise miras almaz — **default varyantı (Tam)** hedefler/ekler. Yani gövde-tap 1,5, `+` tuşu Tam üretebilir; `pendingQtyByProductId` badge'i varyant ayrımı yapmadan toplar.
- **Gerekçe:** **ÜRÜN SAHİBİ AÇIK KARARI (2026-08-16, S113):** "artı tuşu normal porsiyon eklemeli; yalnız karta dokunma miras alsın." Karar AskUserQuestion ile iki kez netleştirildi (kullanıcı ilk soruyu "anlamadım" dedi, somut senaryoyla tekrar soruldu). Mimari olarak da ADR-013 Amendment 2 K2 ("modalden/özelleştirmeden gelen non-default satırlar kart şeridinden değiştirilmez") ile tutarlı — miras satır bir "özelleştirilmiş" satır sayılır, stepper onu hedeflemez. `+`/`−` yolu ADR-013 Amendment 6 K5'te bilinçli KAPSAM DIŞI bırakıldı.
- **Kaynak:** ADR-013 Amendment 6 K5 (2026-08-16) + ürün sahibi AskUserQuestion kararı + hci-reviewer gate raporu (PR — katalog-tap-inherit, 2026-08-16, HIGH bulgu → owner sapmayı bilinçli seçti).
- **Gözden geçirme koşulu:** Pilotta kasiyer `+` tuşuyla yanlışlıkla Tam eklediğini bildirirse (yanlış mutfak fişi/hesap), iki seçenek: (a) `incrementProduct`'ı da miras-bileşime çekmek (gövde-tap ↔ `+` tam tutarlılık), veya (b) badge'i varyant-kırılımlı gösterip sapmayı görünür kılmak.
