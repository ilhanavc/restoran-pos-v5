# Session 105 — Kickoff / Backlog (ürün sahibi canlı kullanım eksikleri, 2026-07-26)

> **Bağlam:** Restoran 3 gündür v5'te CANLI (go-live 24 Tem). Aşağıdakiler ürün
> sahibinin gerçek kullanımda bulduğu eksik/bug listesi. **Kod yazılmadı** —
> S104 sonunda kayda geçirildi, S105'te fix'lere başlanacak.
> **Postür: canlı üretim** — küçük/cerrahi/kanıtlı, yoğun-saat dışı deploy,
> hızlı geri-alma. Her fix ayrı PR + test + kâğıt/cihaz smoke.
> **Kapsam kilidi:** çoğu v3/Adisyo paritesi bug'ı → MVP içi. Yeni kavram
> (logo, ürün-bazlı taşıma) → ADR gerekebilir, aşağıda işaretli.

## Öncelik sırası (öneri — ürün sahibi teyit etsin)

**P0 (para/operasyon):** 4, 11, 7 · **P1 (UX bug):** 9, 8, 6, 5 · **P2 (özellik):** 2, 3, 10, 1

---

## 📊 S106 KAPANIŞ DURUMU (2026-07-29)

| # | İş | Durum |
|---|---|---|
| 7 | Web iki-aşamalı kaydet | ✅ prod'da · ürün sahibi doğruladı |
| 11 | Mobil iki-aşamalı kaydet | ✅ OTA'da · ürün sahibi doğruladı |
| 12 | Paket birim fiyat | ✅ bug yoktu (önbellek) — kapandı |
| 9 | Paket Kişi butonu + geri-text | ✅ prod'da (3 kök neden) |
| 8 | Masa listesi sıralaması | ✅ prod'da |
| 6 | Caller popup tekrar arama | ✅ prod'da · **[USER] canlı doğrulandı (S106)** |
| 5 | Split ödeme denetimi | 🟡 **"Ayrı Ayrı Öde" tarafı BİTTİ** (22 senaryo matrisi, 2 UI bug bulunup düzeltildi, #506 prod'da) · **"Ödeme" (DetailedPaymentModal) tarafı — SONRAKİ OTURUMA** |
| 3 | Anasayfa "Masalarda Tahsil Edilecek" | ✅ prod'da · ürün sahibi doğruladı |
| 2 | Mobil gün cirosu (yönetici) | ✅ OTA'da · ürün sahibi doğruladı |
| 4 | Kasa fişi gecikmesi | ✅ **teşhis: sunucu TEMİZ** (292 fiş, ort. 1sn, >60sn = 0) → kalan tek yer dükkan-PC spooler/yazıcı · **[USER] tamamlandı** |
| 10 | Kalem taşıma | ✅ **UÇTAN UCA CANLI** (S106) — ADR-035 backend+web+mobil, ürün sahibi ikisini de doğruladı |
| 1 | Logo | ✅ **web prod'da canlı** (favicon+sidebar+login) · mobil `app.json` kodda hazır, **OTA ile inmez — ayrı EAS build bekliyor** |
| 14 | Mobil alt navigasyon | ✅ **UÇTAN UCA CANLI** (S106) — ADR-026 Amd5, 4 sekme, ürün sahibi doğruladı |
| 13 | Anthropic repo taraması | ⏸️ hâlâ en sona bırakıldı, başlanmadı |

### S106'da yeni doğan iş — sonraki oturum kickoff'u

**Split ödeme denetimi, madde 2/2 — "Ödeme" (DetailedPaymentModal, tek-seferlik normal ödeme) tarafı.**
"Ayrı Ayrı Öde" tarafı S106'da bitti (bkz. yukarı satır 5) — aynı yöntemle (kombinasyon matrisi çıkar → local dev'de gerçek tarayıcı + DB doğrulamasıyla test et → bulguyu düzelt) `DetailedPaymentModal.tsx` + normal `POST /payments` akışı denetlenecek. Beklenen kombinasyon boyutları: tam ödeme/kısmi ödeme, Öde·Öde ve Kapat·Öde ve Yazdır·Öde Yazdır ve Kapat aksiyonları, Hızlı Öde ile etkileşim, nakit-üstü hesabı, kart ödemede cash alanının davranışı, ikram edilmiş/iptal edilmiş kalem varken ödeme, void sonrası yeniden ödeme. Local dev bootstrap: `admin@local.test` / `admin1234` (`docs/engineering/local-dev.md:70`).
| 13 | Anthropic repoları | ⏸️ en sona (tüm maddeler bitince) |

---

### 1. [FEATURE] Logo ekle
- Fişlere ve/veya login/header'a restoran logosu. **v5.1'e kapsam-dışıydı** (ADR-027 Amd1 E: "logo v5.1"). Fiş logosu = raster'a bitmap gömme (`ReceiptCanvas`); ekran logosu ayrı.
- **ADR gerekebilir** (kapsam açıkça v5.1'e ertelenmişti). Ürün sahibiyle: nereye (fiş mi ekran mı ikisi mi)?

### 2. [FEATURE] Mobilde toplam kazanç göster
- Garson mobil uygulamasına gün-toplam ciro/kazanç. Backend rapor endpoint'i var mı bak (`apps/api` reports). **Yetki sorusu:** garson tüm ciroyu görmeli mi? (ürün sahibi kararı). Muhtemelen ADR/karar gerekir.

### 3. [FEATURE] Web'e AÇIK SİPARİŞ TUTARI göster
- Web'de o an açık (ödenmemiş) tüm adisyonların toplam tutarı.
- **📍 KONUM [USER, S105]: ANASAYFA (dashboard) — mevcut "TOPLAM SİPARİŞ" göstergesinin YERİNE.** (S105 keşif workflow'u masalar ekranı başlığını önermişti; ürün sahibi anasayfayı seçti — o KPI kartı değişecek.)
- **Tutar tanımı (keşif kararı): KALAN (tahsil edilecek), brüt DEĞİL** — kısmi ödeme `total_cents`'i düşürmez; brüt gösterilirse "çekmecedeki nakit + ekrandaki açık tutar" çift sayılır. Salon: `total − paid` (ikisi de `tables` projeksiyonunda hazır, `voided_at IS NULL` filtreli). Paket: açıkken kalan = brüt (delivered geçişi aynı tx'te tam ödeme yazıyor — ADR'ye yazılacak varsayım).
- **🔴 ÖN KOŞUL (keşif bulgusu):** kısmi ödeme socket emit ETMİYOR (`apps/api/src/routes/payments.ts:183` — emit yalnız `orderClosed` iken). Başka terminalde alınan kısmi ödeme sonrası gösterge bayat kalır → önce emit fix, sonra UI (aksi halde HCI "sessiz hata" ihlali). Bu bugün de var olan sessiz arıza (masa kartındaki tutar da bayat).
- Veri için EK ENDPOINT/İSTEK GEREKMEZ; matematik `packages/shared-domain`'e saf fonksiyon olarak (mobil paritesi için).

### 4. [BUG-P0] Mobil hızlı öde → masa kapanış fişi ÇOK GEÇ çıkıyor
- "Mobilden hızlı öde yapıp masa kapatınca UZUN BİR SÜRE SONRA kasadan masanın kapanmasıyla ilgili fiş çıkıyor."
- **NOT:** S104'te tam bunu araştırdım (order 30 / Masa 20) → sunucu tarafı 1sn'de basıyordu (`attempts=0`). Şüphe **Windows spooler kuyruğu** dükkan-PC'de birikiyor. Kâğıttaki TARİH gecikmenin gününü söyler. Ölçüm: dükkan-PC spooler + print-agent poll aralığı + `print_jobs.updated_at - created_at` canlı izle. `docs/context-anchor.md` S104 spooler notu.
- **İlk adım:** print-agent'ın poll aralığı + KASA yazıcısının spooler durumu; gecikme sunucuda mı agent'ta mı Windows'ta mı ayrıştır.

### 5. [BUG-P1] Ayrı ayrı öde — tüm kombinasyonlarda mantık hatası ara
- `apps/web/src/features/payment/components/SplitPaymentModal.tsx`. Kalem-bölüştür + kısmi ödeme + kalan + farklı ödeme türleri kombinasyonlarını dene; tutar/kalan/kapatma mantığını denetle. ADR-014 §10 split-state. Adversarial: her kombinasyon + edge (tek kalem, ikram, iptal karışık).

### 6. [BUG-P1] Caller popup üst üste aynı arayanı göstermiyor
- Arama GEÇMİŞİ (liste) doğru; POPUP üst üste aynı numarada ikinciyi göstermiyor.
- **Konum:** `apps/web/src/features/caller-id/IncomingCallProvider.tsx` (`isSuppressed`/`markSuppressed` per-callLogId; `setCurrentCall`). Adaylar: (a) API 5sn dedup (`findRecentDuplicate`) ikinci gerçek çağrıyı "duplicate" sayıyor → emit yok; (b) popup açıkken ikinci `setCurrentCall` sessiz değişiyor/görünmüyor; (c) suppression. **S104 dersi:** emit oldu mu prod logundan bak (`caller_id.incoming.emitted`). [[feedback_realtime_reconnect_replay]] telafisiyle (#475) etkileşimini de kontrol et.

### 7. ✅ TAMAM (PR #480, prod `3be0223`, ürün sahibi canlıda doğruladı) — İKİ-AŞAMALI KAYDET (WEB) — REFRAME (S105 canlı doğrulama)
- **⚠️ ORİJİNAL TARİF YANLIŞ ÇIKTI (order-30 gibi):** Canlı yürüyüş + ağ trafiği kanıtı (S105): web'de **yeni ürün + ilave ekleme ZATEN tam iki-aşamalı** — kart tıklama + `OrderProductDetailModal` Kaydet'i **sadece sepete** yazıyor (sıfır sunucu çağrısı), mutfağa gitme yalnız ana mor Kaydet ile (`POST /orders`). Modal başlığı da diyor: "Kaydet ile uygulanır". Bu akışa DOKUNULMAZ.
- **GERÇEK SORUN (11 ile aynı):** adisyondaki **KAYITLI** kaleme tıklayınca açılan `ItemDetailModal` → adet/porsiyon/fiyat/not Kaydet'i **anında `PATCH /orders/:id/items/:itemId`** atıyor, ana Kaydet'i beklemiyor. Kanıt: `PATCH .../items/... 200` anında.
- **Konum:** web `ItemDetailModal` + `OrderScreenPage.tsx:423` `handleDetailSave` → `updateItem.mutateAsync` (anlık). Silme/ikram de anlık. **Beklenen:** düzenleme staged tutulsun, ana Kaydet ile commit. **Madde 11'in web ikizi — TEK ADR ile birlikte.** [USER onayı S105: 7 ⇄ 11 birleşti.]

### 8. [BUG-P1] Masa taşıma listesi KARIŞIK sıralı
- `apps/web/src/features/tables/components/MoveTableModal.tsx` — hedef masa listesi sıra ile değil. `display_no`/`code` numeric sort ekle (string sort "Masa 10 < Masa 2" tuzağı). MergeTableModal'da da kontrol et.

### 9. [BUG-P1] Paket sipariş ekranı KİŞİ butonu + geri-text sorunu
- Popup'tan paket sipariş ekranına girip sipariş alırken:
  - (a) "Kişi" butonuna basınca müşteri modalı BOŞ açılıyor → arayan müşteriyle DOLU açılmalı (customerId/phone zaten URL'de: `callToTakeawayRoute`).
  - (b) Kişi butonu ile geri butonu arasındaki **müşteri ismi text'i de geri işlevi görüyor** → yalnız geri butonu geri dönmeli, isim text tıklanabilir olmamalı (veya müşteri detayına gitmeli).
- **Konum:** `CustomerPickerModal.tsx` + paket sipariş ekranı header (`OrderScreenPage` takeaway header). `callToTakeawayRoute` ile ön-dolu geçiyor mu kontrol.

### 10. [FEATURE] Ürün-bazlı masa değiştirme (yanlış masaya girilen ürünü doğru masaya aktar)
- Bir kalemi başka masaya taşı. **ADR-029 adisyonun TAMAMINI aktarıyor; tek-kalem taşıma YOK** (Faz B'nin en karmaşık işiydi, kapsam-dışıydı). **ADR gerekir.** v3'te var mıydı? Ürün sahibi ile kapsam.

### 11. [BUG-P0] Mobilde kalem detay değişikliği İKİ-AŞAMALI KAYDET olmalı
- "Mobilde adisyondaki ürüne tıklayıp değişiklik yapınca o ekrandaki Kaydet HEMEN uyguluyor. Oysa değişiklik ana adisyon listesindeki Kaydet'e basınca etki etmeli."
- **Konum:** `apps/mobile/src/screens/OrderScreen.tsx:577` (`onSave={(patch) => void patchSavedItem(patch)}` → HEMEN PATCH). Beklenen: değişikliği pending/staged tut, ana adisyon Kaydet ile uygula. **Madde 7'nin mobil ikizi.** ⚠️ Karmaşık: `patchSavedItem` sunucu PATCH; staged model kurmak gerekiyor (adet/porsiyon/fiyat/not için bekleyen-değişiklik). Silme (void) ayrı düşün.

### 12. ✅ KAPANDI (S105) — Paket siparişte BİRİM FİYAT değiştirme
- **Sonuç:** kod tarafında bug YOK. Lokalde paket siparişte kayıtlı kalemin fiyatı ₺380→₺500 değişti (PATCH 200, DB `unit=50000`). Prod bundle'ında da alan mevcuttu ("Birim fiyatı"/"Satır toplamı"/"Ürünü Sil" string'leri `index-C1Bn3Ca-.js`'te vardı). `3be0223` deploy'undan sonra ürün sahibi canlıda doğruladı: **çalışıyor**. Muhtemel sebep: tarayıcıda eski bundle önbellekte kalmıştı.
- **Ders:** "canlıda o seçenek yok" bildiriminde önce **yayındaki bundle'ı dışarıdan indirip string ara** (`curl` + `grep`) — sunucuya dokunmadan, kod-var-mı sorusunu kesin cevaplar.

<details><summary>Orijinal kayıt</summary>
- [USER, S105 oturum-içi] "paket siparişte birim fiyat değiştirme" — madde 11'e ek olarak bildirildi.
- **Kapsam bağı:** ADR-013 Amd4 (kayıtlı kalem düzenlemesi, K12: dine_in **+ takeaway**) ile aynı yol; web `ItemDetailModal` takeaway-edit modunda da açılır. Doğrulanacak: paket siparişte kayıtlı kalemin birim fiyatı düzenlenebiliyor mu, kaydediliyor mu, fişe/tutara yansıyor mu.
- **Konum adayları:** `OrderScreenPage` takeaway-edit dalı (`isTakeawayEdit`, `takeawayEditOrderId`) · backend takeaway PATCH yolu (dine_in ile ortak mı, S104 #444'teki gibi ayrık kopya mı?) · `unitPriceCents` snapshot yazımı.
- **Uyarı (S104 #444 dersi):** paket akışı geçmişte dine_in'in ortak resolver'ını kullanmayıp kendi eksik kopyasını çalıştırıyordu → porsiyon/özellik sessizce düşüyordu. Aynı asimetri fiyat yolunda da olabilir.
</details>

### 14. [FEATURE] Mobilde ALT NAVİGASYON (bottom tab bar)
- [USER, S105 kapanış] *"mobile alt navigasyon eklememiz gerekiyor"*.
- **Durum:** kayıt alındı, tasarım/karar YOK. Bir sonraki oturumda ürün sahibiyle netleştirilecek.
- **Netleşmesi gerekenler:** hangi sekmeler (Masalar · Paket? · Çağrılar? · Raporlar/Ciro? · Ayarlar), rol-bazlı görünürlük (garson vs yönetici — S105 madde 2 paterni), mevcut header aksiyonlarının (Ayarlar/Yenile ikonları) sekmelere taşınıp taşınmayacağı.
- **Konum:** `apps/mobile/src/navigation/` (şu an native-stack; tab navigator eklenmesi gerekir) + `RootStackParamList`. Expo/RN `@react-navigation/bottom-tabs` bağımlılığı gerekebilir → **native modül değilse OTA ile iner, değilse yeni build**. Bunu ADR-031 Amd2 (OTA kapsamı) açısından doğrula.
- **ADR gerekebilir:** ADR-026 (mobil kabuk/K2 ekran yapısı) revizyonu — navigasyon iskeleti değişiyor.

### 13. [ARAŞTIRMA] Anthropic resmi repolarından projeye uygulanabilecekler
- [USER, S105 oturum-içi] Anthropic'in yayınladığı **resmi repoları** tara, bu projeye (Claude Code ile geliştirilen canlı POS) uygulanabilecekleri çıkar.
- **Kapsam adayları:** `anthropics/claude-code` (hook'lar, subagent/skill/plugin desenleri, settings şeması) · `anthropics/skills` + `anthropic-cookbook` · `anthropics/claude-agent-sdk` · MCP resmi sunucuları (`modelcontextprotocol/servers` — postgres/filesystem/git) · prompt-engineering rehberleri · değerlendirme (eval) örüntüleri.
- **Bu projeye özgü süzgeç:** neyi gerçekten kullanırız? Mevcut kurulum zaten zengin (10+ sub-agent, skill'ler, context-mode plugin, SessionStart/UserPromptSubmit hook'ları, postgres MCP). Aranan: **eksik olan** ve operasyonel değer üreten şeyler — ör. deploy/migration öncesi otomatik gate hook'u, canlı-üretim koruma hook'u (prod DB'ye yazma engeli), fiş/ödeme regresyonu için eval seti, PR-öncesi otomatik i18n/HCI gate zinciri.
- **Çıktı:** kısa rapor + öncelikli 3-5 somut öneri (her biri: ne, neden bu projede işe yarar, kurulum maliyeti). ADR gerekmez (araç/süreç işi, ürün kapsamı dışı).
- **Not:** araştırma sub-agent ile yapılmalı (ana context korunur — CLAUDE.md core directive 5).

---

## Ortak tema (mimari)
Madde **7 + 11** aynı ilke: **"modal/detay Kaydet = stage, ana Kaydet = commit."** İkisini birlikte tasarla (web+mobil tutarlı). Bu ADR-013 Amd3 kalem-detay akışının davranış revizyonu → **muhtemelen ADR notu** (K6 gibi ürün sahibi kararı).

## Kapsam kilidi özeti
- **ADR gerekli:** 1 (logo v5.1), 2 (garson ciro yetkisi), 10 (kalem-taşıma yeni kavram), 7+11 (iki-aşamalı kaydet davranış revizyonu).
- **Düz bug (MVP içi):** 4, 5, 6, 8, 9.
- **Düz feature (düşük risk):** 3.
