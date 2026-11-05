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
- **Gerekçe:** 52pt eşiği **parmak-öncelikli mobil** (garson terminali) için tanımlıdır. Web = dükkan-PC'de **fare-öncelikli** kasa/kiosk (ADR-031 K1 tek-istasyon dükkan-PC + Chrome kiosk); imleç isabeti parmaktan hassas, 44px WCAG 2.5.5 (AAA) hedef-boyutunun üstünde ve masaüstü yoğunluğuna uygun. Mobil (`apps/mobile`) 52pt tabanını korur (CategoryGrid `minHeight`: iOS 64px, **Android 52px** — tabanın tam üstünde; "64px" tek değer olarak yazılıydı, 2026-11-04'te düzeltildi).
- **Kaynak:** ADR-026 Amendment 4 K8 (2026-07-18, S99) + hci-reviewer gate raporu (PR #394).
- **Gözden geçirme koşulu:** Kasa dokunmatik-ekranlı bir donanıma taşınırsa (parmak-öncelikli), web dokunma hedefleri 52pt'e yükseltilir.

## 6. Android kategori ızgarası — döşeme etiketi sistem yazı-boyutu ayarıyla BÜYÜMEZ

- **Kural:** pos-checklist §Okunabilirlik (satır 113) "Minimum font 14pt" + erişilebilirlik beklentisi: kullanıcı sistem yazı boyutunu büyütürse metin büyür.
- **Sapma:** `CategoryGrid` Android dalında döşeme etiketinin **ekrandaki** boyu `fontScale`'den **bağımsızdır** — çarpansız tabana eşit kalır (412dp'de 14px). Kullanıcı "daha büyük yazı" seçse de kategori etiketi büyümez. Ekrandaki **diğer** metinler normal şekilde büyümeye devam eder; sapma yalnız bu bileşendedir.
- **Gerekçe:** RN varsayılanı `allowFontScaling={true}`, yani ayar hesaplanan fontu çarpar. Döşeme genişliği sabit olduğu için çarpan serbest bırakılırsa 9 harfli kategori adı döşemeye sığmaz ve **kelime ortasından kırılır** — S105'in asıl canlı bug'ı buydu ve bu modülün bütün varlık sebebi onu yapısal olarak imkânsız kılmak. Kırılmış kelime, küçük kalmış kelimeden daha kötü okunur. Döşemeyi büyütmenin tek yolu tek sütuna inmek, ki o da §5'te reddedilen dikey-alan bedelini daha da ağırlaştırır.
- ℹ️ **§5'in rakamları GEÇERLİ kalır.** Ekrandaki boy çarpansız tabana eşit olduğu için "412dp ve üstünde 14-15px, 360-392dp'de 12-13px" ifadesi her çarpanda doğrudur.
- 🔴 **Garanti 2.0 çarpanında biter.** Android sistem ayarının üst sınırı 2.0 ve garanti orada **tam kenarda** tutuyor: 360dp'de çarpansız taban 12px, 12/2.0 = 6 = `MIN_FONT`. 2.2'de taban kilitlenir, ekrandaki boy 13.2'ye **çıkar** ve kelime yine taşar. Bazı OEM'ler 2.0 üstünü sunabiliyor. Bu sınır `categoryGridLayout.test.ts`'te ayrı bir testle çivili.
- **Kaynak:** issue #771 (hci-reviewer gate bulgusu, 2026-11-04) + gate raporu (2026-11-05, `fix/category-grid-font-scale`); `categoryGridLayout.ts` + `categoryGridLayout.test.ts`.
- **Gözden geçirme koşulu:** Sahaya **1.3x üzeri** yazı boyutu ayarıyla çalışan bir garson girerse, ya da 2.0 üstü çarpan sunan bir cihaz kullanılırsa — tek sütuna düşme / ızgarayı seçilince daraltma (#770) seçenekleriyle birlikte yeniden ele alınır.

## 5. Android kategori ızgarası — 412dp altı telefonlarda font 14pt'in altında

- **Kural:** pos-checklist §Okunabilirlik (satır 113) "Minimum font 14pt, kritik metinler 16pt+".
- **Sapma:** `CategoryGrid` Android dalında font pencere genişliğinden hesaplanır. 412dp ve üstünde **14-15px** (uyumlu), ama **360-392dp** aralığında **12-13px** kalır.
- **Gerekçe:** Font, en uzun tek kelimenin ("SALATALAR"/"İÇECEKLER"/"ÇEŞİTLERİ", 9 harf) döşemeye **tek satırda** sığmasından türetilir — kelime ortasından kırılma S105'in asıl canlı bug'ıydı ve kurgu onu yapısal olarak imkânsız kılmak için var. Tek kaldıraç sütun sayısıdır: 4 sütun 6px, 3 sütun 9px veriyordu; 2 sütuna inilerek eşik sahadaki cihazda karşılandı. 360-392dp'de 14pt'ye çıkarmanın başka kaldıracı **yok** — 1 sütun, 14 kategoride ızgarayı ekranı kaplayan bir listeye çevirir ve dikey alan bedeli zaten bu değişikliğin en pahalı tarafı. Sahadaki tek Android cihaz 412dp+ (hci-reviewer gate raporu, 2026-11-04: "360-392dp'de 14pt tutturmanın yolu da yok").
- **Kaynak:** S148 (2026-11-04), `MIN_COLUMNS` 4→2 + `TARGET_TILE_WIDTH` türetilmiş eşik; `categoryGridLayout.ts` + `categoryGridLayout.test.ts`.
- **Gözden geçirme koşulu:** Sahaya **412dp'den dar** bir Android cihaz girerse eşik yeniden ele alınır (ızgara yüksekliğini sınırlayıp kaydırmak, kategori adlarını kısaltmak veya seçilince daraltmak seçenekleriyle birlikte).

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
