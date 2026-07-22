/**
 * Mobil 3-nokta operasyonel aksiyon kümesi — TEK KAYNAK (ADR-027 Faz A + K6).
 *
 * ADR-026 K6 açık gating: yetkisiz/yok aksiyon HİÇ render edilmez (web'in
 * "hepsini render et + 403" modelinin tersi). Bu modül dolu-masa 3-nokta
 * sheet'inde render edilebilecek aksiyonların tek listesidir; security-reviewer
 * + kapsam-kilidi-reviewer buradan doğrular. Rol bazlı gating YOK — ADR-027
 * K1/K2: bu aksiyonları GARSON DAHİL HERKES yapar (payments.create/print.bill
 * `+waiter`, #217/#218). İptal/comp/müşteri-ata backend'de de garsona kapalı.
 *
 *   RENDER (Faz A + ADR-028 + ADR-029):
 *     quickPay  — Hızlı Öde (POST /payments full + pay_and_print_close, #217;
 *                 ADR-014 Amd2: kasa fişi DAİMA basılır)
 *     printBill — Adisyon Yazdır (POST /orders/:id/print-bill, #218)
 *     moveTable — Masayı Değiştir (PATCH /orders/:id/table, ADR-028; aktif
 *                 dine-in siparişi boş masaya taşı; garson dahil — orders.move)
 *     mergeTable — Adisyon Aktar (POST /orders/:id/merge, ADR-029; aktif dine-in
 *                 adisyonu başka DOLU masaya aktar/birleştir; garson dahil —
 *                 orders.merge; orders.move ile aynı grant)
 *
 *   v5.1 (backend HAZIR ama UI ERTELENDİ — ürün sahibi 2026-07-01
 *   "mobilde hızlı öde yeterli, öde olmasa da olur"):
 *     pay — tam Öde ekranı (tutar girişi + 4 işlem + kısmi/bahşiş)
 *
 *   Faz B kalan (backend YOK → render EDİLMEZ, ADR-030 rezerv):
 *     swapTables (iki dolu masa yer değiştir)
 *
 *   ADR-027 Amendment 2 (2026-07-20) — cancelOrder AÇILDI:
 *     cancelOrder — Siparişi İptal Et (POST /orders/:id/cancel). ADR-027 K2 ve
 *     ADR-008 §7c'deki "garson iptal edemez" kararını geri alır. Koruma ROLDE
 *     DEĞİL PARA DURUMUNDA: aktif ödemesi olan adisyonu ADMIN DAHİL kimse
 *     iptal edemez (sunucu `ORDER_HAS_PAYMENTS` ile reddeder). Sipariş türü
 *     kısıtı yok (paket dahil). Sebep zorunlu (5 ön-tanımlı seçenek).
 *
 *   ASLA (garson kademesinde kapalı — ADR-027 K2 + ADR-008 §7c):
 *     comp (ikram) · assignCustomer
 */
export type TableActionKind =
  | 'quickPay'
  | 'printBill'
  | 'moveTable'
  | 'mergeTable'
  | 'cancelOrder';

/**
 * Render edilen aksiyonlar (sıra = sheet görünüm sırası).
 * `cancelOrder` bilinçli olarak EN SONDA: yıkıcı aksiyon, listenin başında
 * yanlışlıkla dokunulacak yerde durmamalı (sheet'te ayırıcı + kırmızı stil).
 */
const FAZ_A_TABLE_ACTIONS: readonly TableActionKind[] = [
  'quickPay',
  'printBill',
  'moveTable',
  'mergeTable',
  'cancelOrder',
] as const;

/**
 * Bir masa için görünür 3-nokta aksiyonları. Aktif sipariş yoksa (orderId null)
 * ödenecek/bastırılacak bir şey yoktur → aksiyon yok. Aksi hâlde Faz A sabit
 * kümesi (garson dahil tüm roller — ADR-027).
 */
export function visibleTableActions(
  orderId: string | null,
): readonly TableActionKind[] {
  if (orderId === null) {
    return [];
  }
  return FAZ_A_TABLE_ACTIONS;
}
