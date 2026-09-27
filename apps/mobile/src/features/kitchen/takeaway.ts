import type { OpenTakeawayOrder } from '../../api/schemas';

/**
 * Mutfak ekranı "Paket" sekmesinin saf karar mantığı — ADR-039 Amendment 2.
 *
 * Neden ayrı dosya: `apps/mobile`'da RN bileşen testi altyapısı YOK (mobil E2E
 * v5.1'e ertelendi). Mevcut tek test deseni saf fonksiyon testidir
 * (`batches.test.ts`). Bu yüzden "hangi buton etkin", "hangi numara aranır"
 * gibi kararlar bileşenin içine gömülmez; buradan test edilir. Bileşen yalnız
 * bu fonksiyonların çıktısını render eder.
 */

export type TakeawayStage = OpenTakeawayOrder['takeawayStage'];

/** Bir kartta hangi aşama aksiyonunun sunulacağı. */
export type StageAction =
  | { kind: 'markOut' }
  | { kind: 'markDelivered' }
  | { kind: 'none' };

/**
 * Sıralı akış (ADR-017 Amendment 2): `preparing → out_for_delivery → delivered`.
 * Atlamalı geçiş ve geri yön YOK — sunucu da 409 ile reddeder.
 *
 * Tek bir aksiyon döner: iki buton asla aynı anda etkin olamaz (kullanıcı
 * "hangisine basacağım" kararı vermek zorunda kalmaz; ADR-039 Amd2 K6).
 */
export function nextStageAction(stage: TakeawayStage): StageAction {
  if (stage === 'preparing') return { kind: 'markOut' };
  if (stage === 'out_for_delivery') return { kind: 'markDelivered' };
  // `delivered` açık kuyrukta görünmez (liste status=open); defansif dal.
  return { kind: 'none' };
}

/**
 * "Teslim edildi" ONAY GEREKTİRİR, "Teslimata çıktı" gerektirmez.
 *
 * Gerekçe (ADR-039 Amd2 K6): `delivered` geçişi sunucuda **ödeme satırı yazar
 * ve adisyonu kapatır** (`orders.ts` — "delivered = paid + payments insert").
 * Yani para hareketidir ve telefonda yanlış dokunuş riski kasa ekranına göre
 * yüksektir. Üstelik yanlış işaretleme **geri alınamaz** (paket ödemesi void
 * edilemiyor — ADR-039 Amd2 G3), onay adımı tek koruma hattıdır.
 */
export function requiresConfirmation(action: StageAction): boolean {
  return action.kind === 'markDelivered';
}

/**
 * "Ara" butonu için telefon numarası seçimi.
 *
 * `isPrimary` olan numara tercih edilir; yoksa ilk numara. Hiç numara yoksa
 * `null` → buton gösterilmez.
 *
 * ⚠️ `kitchen` rolünde bu fonksiyon hiç çalışmaz: `/customers/*` uçlarının
 * tamamı mutfağa kapalı ve aşama yanıtındaki telefon maskeli (ADR-039 Amd2 G2,
 * KVKK). Mutfakta "Ara" butonu render EDİLMEZ.
 */
export function pickCallablePhone(
  phones: ReadonlyArray<{ rawPhone: string; isPrimary: boolean }>,
): string | null {
  if (phones.length === 0) return null;
  const primary = phones.find((p) => p.isPrimary);
  return (primary ?? phones[0])!.rawPhone;
}

/**
 * `tel:` URI üretimi. Numaradaki boşluk/parantez/tire temizlenir — bazı Android
 * çeviricileri biçimlendirilmiş numarayı olduğu gibi kabul etmiyor. Baştaki `+`
 * KORUNUR (uluslararası numara).
 */
export function telUri(rawPhone: string): string | null {
  const cleaned = rawPhone.replace(/[^\d+]/g, '');
  // '+' tek başına veya boş → çevirici açmak anlamsız.
  if (cleaned.replace(/\+/g, '').length === 0) return null;
  return `tel:${cleaned}`;
}

/**
 * Kuyruk sıralaması: EN ESKİ ÜSTTE.
 *
 * ⚠️ KDS kuyruğunun (`batches.ts`) tersi — orada "en yeni üstte" kuralı var
 * (ADR-026 Amd6 K7: aşçı az önce gireni görmek ister). Paket kuyruğunda soru
 * farklı: "hangi paket en uzun süredir bekliyor / hangisini şimdi yola
 * çıkarmalıyım". En eski üstte o soruyu doğrudan cevaplar.
 */
export function sortTakeawayQueue(
  orders: readonly OpenTakeawayOrder[],
): OpenTakeawayOrder[] {
  return [...orders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/**
 * Bir Mutfak kartına dokunmak sipariş ekranını açabilir mi?
 * ADR-026 Amendment 3 (S131) Karar 4.
 *
 * Mobil `OrderScreen` **masa-kimlikli** (`route.params.tableId`,
 * `useActiveOrderForTable`, önbellek `['orders','by-table',...]`). Paket
 * siparişinde `table_id` NULL olduğu için o ekran onu temsil edemez →
 * **Dilim A'da paket kartına dokunma ETKİSİZDİR** (sessiz no-op; yanlış ekran
 * açmaktan iyidir). Paket düzenleme Dilim B'nin işi: hedef `OrderScreen` değil,
 * `TakeawayOrderScreen`'e eklenecek "mevcut siparişi düzenle" kipi.
 *
 * ⚠️ `tableCodeSnapshot` ile kod-eşleştirme REDDEDİLDİ: masa kodu bölgeler arası
 * tekrarlanabilir (ADR-009 Karar A) ve snapshot masa yeniden adlandırılmışsa
 * bayattır → yanlış masanın siparişi açılırdı.
 */
export function tableIdForCardTap(batch: {
  orderType: 'dine_in' | 'takeaway';
  tableId: string | null;
}): string | null {
  if (batch.orderType !== 'dine_in') return null;
  return batch.tableId;
}
