# Architect Brief — Ürün-Bazlı Masa Değiştirme (tek kalem taşıma)

> **currentDate: 2026-07-26** (Pazar). Tüm ADR tarih/karar damgaları bu tarihe göre.
> **Postür: CANLI ÜRETİM.** Restoran 24 Tem'den beri v5'te tek sistem; her
> davranış değişikliği gerçek sipariş akan işletmeye iner.

## Görev

S105 backlog **madde 10** için ADR yaz: *"Yanlış masaya girilen ÜRÜNÜ doğru
masaya aktar"* — yani **tek bir kalemi** (veya kalemin bir kısmını) başka bir
masanın adisyonuna taşıma.

Ürün sahibi onayı: **"ekleyelim, ancak içindeki durumların hepsini tek tek bana
sorarsın"** → Bu yüzden ADR'ı **açık uçlu kararlarla** yaz: her tasarım
çatalını `[SORULACAK]` etiketiyle işaretle, seçenekleri ve senin önerini yaz.
Ürün sahibi tek tek cevaplayacak, sonra ADR Accepted olacak.

**Sen YALNIZ ADR yazarsın — kod yazmazsın.**

## Mevcut durum (doğrulanmış)

- **ADR-028** "Masayı Değiştir": siparişin TAMAMINI başka (BOŞ) masaya taşır
  (`PATCH /orders/:id/table`).
- **ADR-029** "Adisyon Aktar": siparişin TAMAMINI başka (DOLU) masaya aktarıp
  BİRLEŞTİRİR (`POST /orders/:sourceOrderId/merge`).
- **Tek-kalem taşıma YOK.** ADR-029'da Faz B'nin en karmaşık işiydi ve
  kapsam-dışı bırakıldı.
- Kalem düzenleme yolu: `PATCH /orders/:orderId/items/:itemId`
  (ADR-013 Amd3 = adet/porsiyon/fiyat/not/sil/ikram; Amd4 = staged commit).
- Bugünkü çare: kalemi sil (mutfağa **iptal fişi** basar) + doğru masaya
  yeniden gir (mutfağa **yeni fiş** basar) → aşçı iki kâğıt görür, ürün zaten
  pişmiş olabilir.

## Okunacak referanslar

- `.claude/memory/decisions.md` → **ADR-028** (masa değiştir; Karar A/H, race
  koruması `TABLE_ALREADY_OCCUPIED`) · **ADR-029** (adisyon aktar/merge; Faz B
  kapsam notu, `ORDER_HAS_PAYMENTS` guard'ı) · **ADR-013 §1/§2/§3, Amd3, Amd4**
  (kalem düzenleme + staged commit) · **ADR-014 Amd3** (S105 — para bütünlüğü:
  fazla tahsilat her yolda reddedilir; kalem düzenlemesi toplamı ödenenin
  altına düşüremez → `ORDER_TOTAL_BELOW_PAID`) · **ADR-033** (ödeme void) ·
  **ADR-004 Amd5/Amd6** (mutfak fişi + iptal fişi) · **ADR-032** (istasyon
  bazlı fiş yönlendirme: fırın/ızgara) · **ADR-024** (audit zorunluluğu).
- Kod: `apps/api/src/routes/orders.ts` (move/merge/items handler'ları),
  `packages/db/src/repositories/orders.ts` (`moveOrderTable`, `mergeOrder…`,
  `updateItemTx`, recalc), `apps/api/src/print/enqueue-*.ts`,
  `apps/web/src/features/tables/components/MoveTableModal.tsx` +
  `MergeTableModal.tsx` (mevcut hedef-seçici UX paterni).

## ADR'da MUTLAKA ele alınacak çatallar — her biri `[SORULACAK]`

Aşağıdaki her madde için: **seçenekler + senin önerin + gerekçe** yaz. Ürün
sahibi tek tek karar verecek.

1. **Kapsam:** yalnız dine_in mi, paket sipariş de dahil mi? Kaynak/hedef
   kombinasyonları (dolu→dolu, dolu→boş).
2. **Miktar:** kalemin TAMAMI mı taşınır, yoksa adet bölünebilir mi
   ("3 çayın 1'ini taşı")? Bölünürse satır bölme mantığı ne olur?
3. **Hedef masa boşsa:** yeni adisyon otomatik açılır mı? (Masa boşken tek
   kalem taşımak = yeni sipariş yaratmak demek.)
4. **Mutfak fişi:** taşıma mutfağa yansıtılmalı mı? Üç seçenek: (a) hiç fiş
   yok — ürün zaten pişiyor, yalnız hesap sahibi değişiyor; (b) kaynak masaya
   iptal + hedefe yeni fiş; (c) yalnız bilgi fişi ("Masa 5 → Masa 7"). ADR-004
   Amd5/Amd6 ve ADR-032 istasyon yönlendirmesiyle tutarlı olmalı.
5. **Ödeme durumu:** kalem ödenmişse (kalem-bazlı ödeme, `payment_items`)
   taşınabilir mi? ADR-014 Amd3 (S105) *ödenmiş kalemde ikram/silmeyi*
   engelliyor — taşıma da aynı kurala mı tabi? Kaynak adisyonda kısmi ödeme
   varsa ne olur (toplam düşer → `ORDER_TOTAL_BELOW_PAID` tetiklenir mi)?
6. **Kalem durumu:** `new` / `sent` / `preparing` / `ready` — hangi durumdaki
   kalem taşınabilir? Mutfağa gitmiş kalem taşınabilir mi?
7. **İkram/iptal kalemler:** taşınabilir mi (tutar 0 taşırlar)?
8. **Kaynak adisyon boşalırsa:** son kalem taşınınca sipariş otomatik iptal mi
   olur (ADR-014 Amd1 auto-cancel), yoksa boş açık mı kalır?
9. **Yetki:** kim taşıyabilir — admin/cashier/waiter? (ADR-008 §7e ABAC;
   ADR-027 Amd2 "koruma rolde değil para durumunda" ilkesi.)
10. **Snapshot'lar:** kalem taşınınca `created_by_name`, `created_at`,
    fiyat/porsiyon/özellik snapshot'ları korunur mu? Yeni masanın adisyon
    numarası/`store_date` ile çakışma olur mu (cross-day taşıma)?
11. **Audit:** hangi olay(lar) yazılır (`order_item.moved`?), payload'da ne
    olur? ADR-024 kuralları (ALLOWED_KEYS + event tipi + handler üçlüsü —
    S104 dersi: biri eksikse payload sessizce boşalır).
12. **Concurrency:** taşıma sırasında hedef masa kapanırsa/dolarsa? İki
    terminal aynı kalemi aynı anda taşırsa? Kilit sırası ne olmalı
    (ADR-028'in `TABLE_ALREADY_OCCUPIED` paterni).
13. **UI/UX:** taşıma nereden başlar — kalem detay modalinden mi (ADR-013 Amd3
    ekranı), yoksa adisyon panelinden mi? Hedef seçici mevcut `MoveTableModal`
    paternini mi kullanır? Web + mobil ikisi de mi (ADR-013 Amd4'te olduğu
    gibi birebir paritede mi)?
14. **Faz'lama:** MVP'de ne olur, ne v5.1'e kalır? (Ürün sahibi "ekleyelim"
    dedi ama kapsam kilidi gereği en küçük değerli dilim önerilmeli.)

## Kısıtlar (CLAUDE.md)

- **Kapsam kilidi:** bu YENİ bir kavram (v3'te var mıydı bilinmiyor — ADR'da
  "v3 referansı doğrulanmadı" diye işaretle). En küçük değerli dilimi öner.
- Para: integer kuruş; float yasak. TS strict, `any` yok.
- i18n: kullanıcıya görünen tüm metin `t()` key.
- Migration gerekiyorsa `db-migration-guard` gate'i şart; şema değişikliği
  varsa ADR'da AÇIKÇA belirt (`order_items.order_id` UPDATE mi, yoksa
  sil+yeniden-yarat mı — ikisinin audit/fiş sonuçları farklı).

## Teslim formatı

1. `.claude/memory/decisions.md`'e **yeni ADR** (numara: mevcut en büyük ADR
   numarasının bir fazlası — dosyayı tarayıp doğrula) — Durum: **Proposed**.
2. Bana kısa özet: her `[SORULACAK]` çatalı **tek cümlelik soru + seçenekler +
   senin önerin** olarak listele (ürün sahibine aynen soracağım).
3. Şema/migration gerekip gerekmediğini net söyle.
