# Architect Brief — ADR-013 Amendment 4: Kayıtlı kalem düzenlemesinde iki-aşamalı kaydet

> **currentDate: 2026-07-26** (Pazar). Tüm ADR tarih/karar damgaları bu tarihe göre.
> **Postür: CANLI ÜRETİM.** Restoran 24 Tem'den beri v5'te tek sistem. Her davranış
> değişikliği gerçek sipariş akan işletmeye iner → küçük/cerrahi/geri-alınabilir.

## Görev
ADR-013'e **Amendment 4** yaz: adisyondaki **KAYITLI** (mutfağa gitmiş) bir kalemin
düzenlenmesi şu an **anında** sunucuya uygulanıyor; bunu **iki-aşamalı**ya çevir —
modal/sheet Kaydet = **stage**, ana adisyon Kaydet = **commit**. Web + mobil birebir aynı.
Bu, S105 backlog madde **7 (web) + 11 (mobil)** birleşimidir (ürün sahibi onayı: tek ADR).

Sen YALNIZ ADR yazarsın — kod yazmazsın. Çıktı: `.claude/memory/decisions.md`'e
ADR-013 Amd4 bölümü (numaralı K-kararları), + kısa özet.

## Doğrulanmış problem (S105 canlı + ağ trafiği kanıtı)

**Kritik reframe:** "Yeni ürün ekleme mutfağa gidiyor" tarifi YANLIŞ çıktı. Canlı
yürüyüşte kanıtlandı — kart tıklama + ilave modalı (`OrderProductDetailModal`) Kaydet'i
**sıfır sunucu çağrısı** yapıyor (sadece yerel sepet); mutfağa gitme yalnız ana mor
Kaydet ile (`POST /orders`). **Yeni-ürün ekleme akışı ZATEN doğru — DOKUNULMAZ.**

**Gerçek sorun = KAYITLI kalem düzenlemesi anında uygulanıyor:**

### Web
- `apps/web/src/features/orders/OrderScreenPage.tsx:423` `handleDetailSave` →
  `updateItem.mutateAsync(...)` → **anında `PATCH /orders/:id/items/:itemId`**.
- Kayıtlı kaleme tıklama: `onPersistedEdit={setDetailTarget}` (:724) → `ItemDetailModal` (:873).
- İkram: `handleDetailComp` (:449) anlık PATCH. Silme: `VoidItemConfirmDialog` → anlık.
- `useUpdateOrderItem` = `apps/web/src/features/orders/api.ts:252` (PATCH).
- Pending (yeni) akış DOĞRU: `handleModalConfirm` (:391) → `cart.addItemDetailed/editItem`
  (yerel, `useOrderCart.ts`); commit tek nokta `handleSave` (:507) → `POST`.
- Ağ kanıtı: kayıtlı kalemde Adet 2 → `PATCH .../items/... 200` ANINDA (ana Kaydet yok).

### Mobil
- `apps/mobile/src/screens/OrderScreen.tsx:265` `patchSavedItem` → `updateOrderItem` →
  **anında `PATCH`**. Sheet: `SavedItemSheet` (~:564), `onSave={(patch)=>patchSavedItem(patch)}`.
  Silme `onVoid` → Alert → `patchSavedItem({status:'cancelled'})`. İkram `onToggleComp` anlık.
- `updateOrderItem` = `apps/mobile/src/api/client.ts:246` (PATCH).
- `SavedItemSheet.tsx:89` lokal state → tek `patch` → `onSave`.
- Pending akış DOĞRU: `cart.ts` (`useCart`), ana Kaydet `handleSave` (:193) →
  `createOrder`/`addOrderItems`. Kayıtlı düzenleme bu butondan GEÇMİYOR (bağımsız PATCH).

## Ürün sahibi KARARLARI (KİLİTLİ — ADR bunları veri kabul etsin)
1. **Staged olan: TÜM değişiklikler** — adet · porsiyon (variant) · birim fiyat · not ·
   **ikram** · **silme (void)**. İlke (ürün sahibi, kesin): **hiçbir değişiklik ana adisyon
   Kaydet'e basılmadan aktifleşmez.** Modal/sheet Kaydet = stage; ana Kaydet = commit.
2. **SİLME (void) de STAGED** — [USER kararı S105: önceki "silme anlık" kararını GEÇERSİZ
   kıldı]. Kullanıcı silmeyi işaretler (staged, satır "silinecek" gösterilir), ana Kaydet'te
   `PATCH status=cancelled` uygulanır **ve mutfağa iptal fişi O AN basılır** (ADR-004 Amd6 /
   ADR-013 Amd3 K6). **Kabul edilen risk:** iptal sinyali ana Kaydet'e kadar gecikir
   (kullanıcı Kaydet'e hemen basacağı için pratikte kısa; ürün sahibi tutarlılık için kabul).
   Void ONAY akışı (VoidItemConfirmDialog / Alert): stage anında mı işaretlensin yoksa
   commit anında tek onay mı → architect netleştirsin (öneri: stage anında işaretle+onay,
   commit'te sessiz uygula; ya da işaretle→ana Kaydet'te toplu onay).
3. **Commit tetikleyici:** ana adisyon **Kaydet** butonu, bekleyen yeni ürün **VEYA**
   herhangi bir staged düzenleme/silme varken görünür (şu an yalnız pending yeni ürün varken).
4. **Adisyon kapatılırsa (X / geri):** staged düzenleme/silmeler — pending sepet gibi — **atılır**.
5. **Web + mobil davranışı BİREBİR aynı.**

## ADR'ın çözmesi gereken tasarım kararları (senin K-kararların)
- **K: Staged veri modeli.** Kayıtlı kalemlere katman: `itemId → pendingPatch` haritası.
  Görüntüde saved kalem + staged patch birleşik gösterilir. (Zustand değil, mevcut
  hook-local state paterni — web `useOrderCart`, mobil `useCart` ile hizalı.)
- **K: Commit semantiği.** Ana Kaydet basınca sıra: (a) staged düzenlemeler + silmeler
  her biri ayrı `PATCH` ile uygulanır (silme = `status=cancelled` → mutfağa iptal fişi
  o an basılır); (b) pending yeni ürünler `POST`/`addItems` ile eklenir. Kısmi başarısızlık
  davranışı (bir PATCH patlarsa kalanlar? toast? geri-al? hangi işlemler geçti bilgisi).
- **K: Porsiyon fiyat projeksiyonu.** Porsiyon değişince fiyat SUNUCUDA yeniden kurulur
  (Amd3: eski delta düş + yeni delta ekle). Staged gösterimde satır toplamı yerel
  hesaplanmalı → `packages/shared-domain` saf fonksiyonu kullan (kopya mantık YASAK).
- **K: Ödeme etkileşimi.** Staged (commit edilmemiş) düzenleme varken Ödeme/Hızlı Öde
  ne olur? Öneri: uncommitted durumda Ödeme yerine Kaydet gösterilir (yeni-ürün paterni
  ile aynı) → önce commit, sonra öde. ADR netleştirsin.
- **K: Reprint/audit.** Amd3 K6 (adet/fiyat/not fiş BASMAZ) + K5 (audit ZORUNLU) korunur;
  audit commit anındaki PATCH'te tetiklenir (staging audit'i ETKİLEMEZ, sadece geciktirir).
- **K: Dirty gösterim.** Kayıtlı kalemde bekleyen değişiklik olduğu görsel olarak
  belli olmalı (hci-reviewer detaylandırır; ADR ilkeyi koysun — kullanıcı "Kaydet'e
  basmam gerek" olduğunu anlasın).

## Kısıtlar (CLAUDE.md)
- Kapsam kilidi: bu bir **davranış revizyonu** (yeni-ürün paterniyle tutarlılık), yeni
  kavram değil → MVP içi. Kapsam büyütme yok (yalnız kayıtlı-kalem düzenleme staging'i).
- i18n: kullanıcıya görünen tüm yeni metin `t()` key ile (dirty rozet/uyarı vb.).
- Para: integer kuruş; float yasak. TS strict, `any` yok.
- v3'ten kod kopyalama yok. Cerrahi değişiklik.

## Okunacak referanslar
- `.claude/memory/decisions.md` → **ADR-013** (§1 iki-aşamalı model, §10-11 modal, **Amd2**
  parti modeli/rowId, **Amd3** kalem detay K1-K7) · **ADR-014** (ödeme kapıları, Amd1 K3) ·
  **ADR-004 Amd6** (iptal fişi) · **ADR-032 Amd3** (kasa paket fişi, itemIds).
- Kod: yukarıdaki file:line'lar.

## Teslim formatı
1. `.claude/memory/decisions.md`'e **ADR-013 Amendment 4** bölümü: bağlam + numaralı
   K-kararları (K1..Kn) + "Kabul edilen risk" + "Sonuç".
2. Bana kısa özet: her K-kararı tek cümle + implementasyona geçmeden önce ürün sahibine
   sorulması gereken KALAN karar varsa işaretle (varsa; kilitli kararlar tekrar sorulmaz).
