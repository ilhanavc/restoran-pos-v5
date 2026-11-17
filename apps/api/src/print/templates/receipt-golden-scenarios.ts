/**
 * ADR-045 K3.3 — altın çizim kaydının sabit senaryoları (test yardımcısı,
 * üretim kodu DEĞİL).
 *
 * Bu dosya fiş şablonları değişmeden ÖNCE commit edildi; aynı girdiler
 * şablonlar değiştikten sonra da çizilir ve kayıt birebir aynı kalmalıdır.
 * Senaryolar bilerek "dolu" seçildi: porsiyon, seçenek, kalem notu, sipariş
 * notu, bölge, çok ödemeli döküm, müşterisiz paket — bir şablon değişikliğinin
 * dokunabileceği her dal en az bir senaryoda çalışır.
 */

import type { BillReceiptParams } from './bill-receipt.js';
import type { PackingReceiptParams } from './packing-receipt.js';

export const BILL_SCENARIOS: Readonly<Record<string, BillReceiptParams>> = {
  'bill-dine-in-split-payment': {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    order_type: 'dine_in',
    server_name: 'İlhan',
    table_label: 'Masa 5',
    area_label: 'Bahçe',
    items: [
      {
        name: 'Kıymalı Pide',
        qty: 2,
        variantName: 'Bir buçuk',
        lineTotalCents: 54000,
        note: 'az pişmiş',
        modifiers: ['Acılı', 'Bol soğan'],
      },
      {
        name: 'Ayran',
        qty: 3,
        variantName: null,
        lineTotalCents: 9000,
        note: null,
        modifiers: [],
      },
    ],
    totalCents: 63000,
    payments: [
      { type: 'cash', amountCents: 30000 },
      { type: 'card', amountCents: 20000 },
    ],
    paidTotalCents: 50000,
    remainingCents: 13000,
    created_at_local: '17.11.2026  20:35',
    order_note: 'Doğum günü masası',
  },
  'bill-takeaway-single-payment': {
    tenant_header: 'Pide Salonu',
    order_no: 7,
    order_type: 'takeaway',
    server_name: null,
    table_label: null,
    area_label: null,
    items: [
      {
        name: 'Lahmacun',
        qty: 4,
        variantName: null,
        lineTotalCents: 32000,
        note: null,
        modifiers: [],
      },
    ],
    totalCents: 32000,
    payments: [{ type: 'cash', amountCents: 32000 }],
    paidTotalCents: 32000,
    remainingCents: 0,
    created_at_local: '17.11.2026  12:05',
    order_note: null,
  },
};

export const PACKING_SCENARIOS: Readonly<Record<string, PackingReceiptParams>> = {
  'packing-delivery-full-customer': {
    tenant_header: 'Pide Salonu',
    order_type: 'delivery',
    order_no: 15,
    server_name: 'Kasa',
    created_at_local: '17.11.2026  19:10',
    items: [
      {
        name: 'Karışık Pide',
        qty: 1,
        variantName: 'Tam',
        lineTotalCents: 28000,
        modifiers: ['Kaşarlı'],
        note: 'dilimlensin',
      },
      {
        name: 'Kola',
        qty: 2,
        variantName: null,
        lineTotalCents: 8000,
        modifiers: [],
        note: null,
      },
    ],
    customer_name: 'Ayşe Yılmaz',
    customer_phone: '0532 000 00 00',
    delivery_address: 'Cumhuriyet Mah. Atatürk Cad. No: 12 Daire: 4',
    delivery_note: 'Zile basmayın',
    planned_payment_type: 'card',
    total_cents: 36000,
    order_note: 'Çatal bıçak istemiyor',
  },
  'packing-takeaway-no-customer': {
    tenant_header: 'Pide Salonu',
    order_type: 'takeaway',
    order_no: 16,
    server_name: null,
    created_at_local: '17.11.2026  19:20',
    items: [
      {
        name: 'Ayran',
        qty: 1,
        variantName: null,
        lineTotalCents: 3000,
        modifiers: [],
        note: null,
      },
    ],
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    delivery_note: null,
    planned_payment_type: null,
    total_cents: 3000,
    order_note: null,
  },
};
