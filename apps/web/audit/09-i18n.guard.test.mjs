/**
 * Blok 9 W9-I18N-01 — i18n regresyon kilidi (38 hardcoded site / 13 dosya).
 *
 * CLAUDE.md çekirdek direktif 4: "Kullanıcıya görünen tüm metinler Türkçe ve
 * i18n-key üzerinden." Bu test her hedef dosyada hardcoded kullanıcı-metninin
 * KALKTIĞINI + kullanılan i18n key'lerinin tr.json'da MEVCUT olduğunu doğrular.
 *
 * Fix'ten ÖNCE KIRMIZI (string'ler hâlâ hardcoded) → fix sonrası YEŞİL.
 * Koşum (DB/tarayıcı gerektirmez, saf statik kaynak analizi):
 *   node --test apps/web/audit/09-i18n.guard.test.mjs
 *
 * Rapor: docs/audit/09-web.md (PR #338 arşiv)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(webSrc, rel), 'utf8');

/** JSX/JS yorumlarını çıkar — yorumdaki metin kullanıcıya render edilmez, taranmaz. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** patterns: string (includes) | RegExp (.test) — hâlâ mevcut olanları döndürür. */
function assertGone(file, patterns) {
  const src = stripComments(read(file));
  const remaining = patterns.filter((p) =>
    typeof p === 'string' ? src.includes(p) : p.test(src),
  );
  assert.deepEqual(
    remaining.map(String),
    [],
    `${file}: hâlâ hardcoded → ${remaining.map(String).join(' | ')}`,
  );
}

function assertHasKeys(keys) {
  const obj = JSON.parse(read('i18n/locales/tr.json'));
  const missing = keys.filter(
    (k) => k.split('.').reduce((o, seg) => (o == null ? undefined : o[seg]), obj) === undefined,
  );
  assert.deepEqual(missing, [], `tr.json eksik key: ${missing.join(', ')}`);
}

// ── tr.json: yeni + yeniden-bağlanan key'ler mevcut ──────────────────────────
test('W9-I18N-01: kullanılan i18n key\'leri tr.json\'da tanımlı', () => {
  assertHasKeys([
    // yeni payment.split
    'payment.split.payerLabel',
    'payment.split.remainingCount',
    'payment.split.paidAmount',
    'payment.split.fillFull',
    'payment.split.changeLabel',
    // mevcut-ama-çağrılmayan (bedava bağlama)
    'payment.split.addOne',
    'payment.split.removePayer',
    'payment.split.emptyPayer',
    'payment.split.removeOne',
    'payment.split.commitPayer',
    'payment.type.cash',
    'payment.type.card',
    // yeni order.a11y
    'order.a11y.remove',
    'order.a11y.decrement',
    'order.a11y.increment',
    'order.a11y.quantity',
    // yeni common.duration + currency
    'common.duration.zero',
    'common.duration.days',
    'common.duration.hours',
    'common.duration.minutes',
    'common.currencySymbol',
    // yeni sidebar + dashboard
    'sidebar.toggleClose',
    'sidebar.toggleOpen',
    'sidebar.clockLabel',
    'dashboard.hourlyRevenue.axisMax',
    // W9-I18N-02: kayıp key kök nedeni — mevcut key'e yönlendirilir
    'customers.errors.PHONE_ALREADY_EXISTS',
    'customers.errors.createFailed',
  ]);
});

// ── SplitPaymentModal (13 site) ──────────────────────────────────────────────
test('W9-I18N-01: SplitPaymentModal para-yolu metinleri i18n', () => {
  assertGone('features/payment/components/SplitPaymentModal.tsx', [
    'aria-label="Ekle"',
    'aria-label="Kişi sil"',
    'Soldan ürün ekleyin',
    'aria-label="Çıkar"',
    'Bu kişiden ödemeyi al',
    /\/>\s*Nakit/, // <Banknote /> Nakit
    /\/>\s*Kredi Kartı/, // <CreditCard /> Kredi Kartı
    '`Kalan ${available}`',
    'Ödendi ·',
    'Para üstü:',
    /`Kişi \$\{no\}`/, // makePayer label (kaldırıldı — no'dan türetilir)
    /`Kişi \$\{group\.payer_no/, // PaidGroup fallback
    /\{payer\.label\}/, // DraftPayerCard render (Payer.label kalktı)
  ]);
});

// ── orders aria-label'ları → order.a11y.* (12 site / 4 dosya) ────────────────
test('W9-I18N-01: orders aria-label\'ları order.a11y üzerinden', () => {
  for (const f of [
    'features/orders/components/AdisyonPanel.tsx',
    'features/orders/components/OrderProductDetailModal.tsx',
    'features/orders/components/ProductCard.tsx',
    'features/orders/components/TakeawayCartPanel.tsx',
  ]) {
    assertGone(f, [
      'aria-label="Kaldır"',
      'aria-label="Azalt"',
      'aria-label="Artır"',
      '`Adet: ${qty}`',
    ]);
  }
});

// ── CustomerPickerModal (3 site + W9-I18N-02 kayıp key) ──────────────────────
test('W9-I18N-01/02: CustomerPickerModal hata metinleri i18n', () => {
  assertGone('features/orders/components/CustomerPickerModal.tsx', [
    "'Bu telefon zaten kayıtlı'", // phoneExists defaultValue
    "'Müşteri eklenemedi'", // createFailed hardcoded fallback + toast
    'customers.errors.phoneExists', // yanlış key adı — PHONE_ALREADY_EXISTS'e taşındı
  ]);
});

// ── layout: AppShell + Sidebar (2 site) ──────────────────────────────────────
test('W9-I18N-01: layout aria-label\'ları i18n', () => {
  assertGone('components/layout/AppShell.tsx', ["'Menüyü kapat'", "'Menüyü aç'"]);
  assertGone('components/layout/Sidebar.tsx', ['aria-label="Saat"']);
});

// ── TableCard formatElapsed (4 alt-string) ───────────────────────────────────
test('W9-I18N-01: TableCard süre etiketi i18n', () => {
  assertGone('features/tables/components/TableCard.tsx', [
    "'0 dk 0 sn'",
    '`${day} gün ${hour} sa ${min} dk ${sec} sn`',
    '`${totalHour} sa ${min} dk ${sec} sn`',
    '`${totalMin} dk ${sec} sn`',
  ]);
});

// ── admin + dashboard: ₺ sembol + axisMax (4 site) ───────────────────────────
test('W9-I18N-01: ₺ sembol + eksen etiketi i18n', () => {
  assertGone('features/admin/attribute-groups/components/GroupListRow.tsx', ['`₺${']);
  assertGone('features/admin/attribute-groups/components/NewGroupDrawer.tsx', [/>\s*₺\s*</]);
  assertGone('features/admin/menu-products/ProductEditorPage.tsx', [/>\s*₺\s*</]);
  assertGone('features/dashboard/components/HourlyRevenueSkeleton.tsx', ['₺0K']);
});
