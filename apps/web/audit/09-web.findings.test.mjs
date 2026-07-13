/**
 * Blok 9 (apps/web) — KASITLI KIRMIZI bulgu testleri.
 *
 * Derin denetim serisi kuralı: bu dosya HIGH/MEDIUM bulguları kilitler ve
 * fix'ler yapılana kadar (Blok 13) KIRMIZI kalır. Assertion'lar DÜZELTİLMİŞ
 * durumu tarif eder — yeşile dönmesi = bulgu kapandı demektir.
 *
 * Koşum (DB/tarayıcı gerektirmez, saf statik kaynak analizi):
 *   node --test apps/web/audit/
 *
 * Rapor: docs/audit/09-web.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(webSrc, rel), 'utf8');

// ── W9-HCI-01: sipariş ekranı "Yazdır" no-op ─────────────────────────────────
test('W9-HCI-01: OrderScreenPage Yazdır butonu no-op olmamalı (gerçek print akışına bağlı)', () => {
  const src = read('features/orders/OrderScreenPage.tsx');
  assert.ok(
    !/handlePrint\s*=\s*\(\)\s*=>\s*undefined/.test(src),
    'handlePrint hâlâ `() => undefined` — buton aktif görünüp hiçbir şey yapmıyor (canlı teyitli)',
  );
});

// ── W9-A-03: hata durumu yanlış boş-durum olarak sunuluyor (4 ekran) ─────────
const IS_ERROR_SCREENS = [
  'features/customers/CustomersPage.tsx',
  'features/tables/TablesListPage.tsx',
  'features/admin/DiningAreasPage.tsx',
  'features/admin/MenuDefinitionsPage.tsx',
];
for (const rel of IS_ERROR_SCREENS) {
  test(`W9-A-03: ${rel} sorgu hatasını ele almalı (isError dalı)`, () => {
    const src = read(rel);
    // Sıkı desen: TanStack Query isError bayrağı (toast.error vb. eşleşmesin).
    assert.ok(
      /\bisError\b|status\s*===\s*'error'/.test(src),
      'ekran isError durumunu hiç okumuyor — hata, boş-durum ("Henüz ... yok") olarak maskeleniyor (canlı teyitli)',
    );
  });
}

// ── W9-I18N-01: SplitPaymentModal hardcoded para-yolu metinleri ──────────────
test('W9-I18N-01: SplitPaymentModal ödeme tipi etiketleri i18n üzerinden gelmeli', () => {
  const src = read('features/payment/components/SplitPaymentModal.tsx');
  // tr.json'da payment.type.cash/card TANIMLI; modal yine de literal kullanıyor.
  const hardcoded = [];
  if (/>\s*Nakit\s*</.test(src) && !src.includes("t('payment.type.cash')")) hardcoded.push('Nakit');
  if (/>\s*Kredi Kartı\s*</.test(src) && !src.includes("t('payment.type.card')")) hardcoded.push('Kredi Kartı');
  if (/Bu kişiden ödemeyi al/.test(src) && !src.includes("t('payment.split.commitPayer')")) hardcoded.push('commitPayer');
  if (/Soldan ürün ekleyin/.test(src) && !src.includes("t('payment.split.emptyPayer')")) hardcoded.push('emptyPayer');
  assert.deepEqual(hardcoded, [], `hardcoded string siteleri: ${hardcoded.join(', ')} (13 sitenin 5'inin key'i zaten tanımlı)`);
});

// ── W9-TR-01: CSV export başlıklarında ASCII yazım hataları ──────────────────
test('W9-TR-01: müşteri dışa-aktarma başlıkları Türkçe karakterli olmalı', () => {
  const tr = read('i18n/locales/tr.json');
  const broken = ['Tum Telefonlar', 'Toplam Siparis', 'Olusturma'].filter((s) => tr.includes(`"${s}"`));
  assert.deepEqual(broken, [], `ASCII'ye düşmüş başlıklar: ${broken.join(' · ')} (doğrusu: Tüm Telefonlar / Toplam Sipariş / Oluşturma)`);
});

// ── W9-A-01: useAssignCustomer yanıt-şekli uyumsuzluğu (dormant S77 mayını) ──
test('W9-A-01: useAssignCustomer PATCH /orders/:id/customer düz DTO tipine cast etmeli', () => {
  const src = read('features/orders/api.ts');
  const fnBody = src.split('useAssignCustomer')[1]?.split('export function')[0] ?? '';
  assert.ok(
    !fnBody.includes('OrderWithItemsResponse'),
    'hook zarflı OrderWithItemsResponse bekliyor; backend düz camelCase DTO döner (canlıda dormant — sonuç okunmuyor)',
  );
});
