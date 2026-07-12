/**
 * Blok 10 (apps/mobile) — KASITLI KIRMIZI bulgu testleri.
 *
 * Derin denetim serisi kuralı: HIGH/BLOCKER bulguları kilitler; fix'ler
 * (Blok 13) yapılana kadar KIRMIZI kalır. Assertion'lar DÜZELTİLMİŞ durumu
 * tarif eder — yeşile dönmesi = bulgu kapandı.
 *
 * Koşum (DB/cihaz/Expo gerektirmez, saf statik kaynak analizi):
 *   node --test apps/mobile/audit/
 *
 * Rapor: docs/audit/10-mobile.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..', '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

// ── M10-A-01 (BLOCKER): sipariş yolu idempotency ────────────────────────────
test('M10-A-01a: apps/api POST /orders idempotency ertelemesi kapanmalı', () => {
  const src = read('apps/api/src/routes/orders.ts');
  assert.ok(
    !src.includes('Idempotency key YOK'),
    'orders.ts:872 hâlâ "Idempotency key YOK (v5.1 forward-ref)" — retry duplikasyonuna açık (payments ADR-014 §4 şablonu mevcut)',
  );
});

test('M10-A-01b: mobil createOrder/addOrderItems idempotency key göndermeli', () => {
  const src = read('apps/mobile/src/api/client.ts');
  assert.ok(
    /[Ii]dempotency/.test(src),
    'client.ts sipariş çağrılarında idempotency izi yok — "Tekrar Dene" aynı cart\'ı korumasız yeniden gönderir (OrderScreen.tsx:180-188)',
  );
});

// ── M10-A-02 (HIGH): RN online/focus entegrasyonu ────────────────────────────
test('M10-A-02: TanStack Query RN online/focus yönetimine bağlanmalı (netinfo)', () => {
  const pkg = read('apps/mobile/package.json');
  const app = read('apps/mobile/App.tsx');
  const qc = read('apps/mobile/src/api/queryClient.ts');
  assert.ok(
    pkg.includes('@react-native-community/netinfo') ||
      /onlineManager|focusManager/.test(app + qc),
    'netinfo/onlineManager/focusManager hiç yok — RN\'de offline durumu ayırt edilemiyor, bağlantı rozeti kurulamaz',
  );
});

// ── M10-A-03 (HIGH): reconnect resync ────────────────────────────────────────
test('M10-A-03: socket connect/reconnect anında sorgular invalidate edilmeli', () => {
  const app = read('apps/mobile/App.tsx');
  const sock = read('apps/mobile/src/realtime/socket.ts');
  assert.ok(
    /on\(['"](connect|reconnect)['"]/.test(app + sock),
    'connect/reconnect dinleyicisi yok — WiFi kesintisinde kaçan event\'ler telafi edilmiyor, ekran sessizce bayat kalıyor',
  );
});

// ── M10-PRINT-01 (MEDIUM): Adisyon Yazdır çift-tetik kilidi ─────────────────
test('M10-PRINT-01: Adisyon Yazdır akışı pending-kilidi taşımalı', () => {
  const controller = read('apps/mobile/src/features/payments/TableActionsController.tsx');
  const sheet = read('apps/mobile/src/features/orders/components/TableActionSheet.tsx');
  assert.ok(
    /isPending|disabled/.test(controller) || /disabled/.test(sheet),
    'printBill dalında isPending/disabled kilidi yok — hızlı çift dokunma 2 fiziksel fiş kuyruğa alabilir',
  );
});

// ── M10-HCI-05 (MEDIUM): varsayılan 3-sütun tipografisi ─────────────────────
test('M10-HCI-05: ProductCard varsayılan (dar) modda 14pt altı metin olmamalı', () => {
  const src = read('apps/mobile/src/features/orders/components/ProductCard.tsx');
  const below14 = [...src.matchAll(/fontSize:\s*(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n < 14);
  assert.deepEqual(
    below14,
    [],
    `checklist 14pt minimumu altında fontSize'lar: ${below14.join(', ')} (varsayılan 3-sütunda roomy hiç tetiklenmiyor — settings.ts DEFAULT_PRODUCT_COLUMNS=3)`,
  );
});

// ── M10-TR-CONS (MEDIUM): web↔mobil terim paritesi (örnek: masa durumu) ─────
test('M10-TR-CONS: masa durumu etiketi web ile aynı olmalı (cleaning)', () => {
  const mobile = JSON.parse(read('apps/mobile/src/i18n/locales/tr.json'));
  const web = JSON.parse(read('apps/web/src/i18n/locales/tr.json'));
  const mobileCleaning = mobile?.tables?.status?.cleaning;
  const webCleaning = web?.tables?.status?.cleaning ?? web?.tables?.statusLabel?.cleaning;
  assert.equal(
    mobileCleaning,
    webCleaning,
    `kasiyer "${webCleaning}" görürken garson "${mobileCleaning}" görüyor — aynı kavram iki terim`,
  );
});

// ── M10-QUAL-01 (LOW): bayat JSDoc — ADR-026 Amd E ile çelişki ──────────────
test('M10-QUAL-01: OrderScreen JSDoc kaldırılmış dirty-exit onayını vaat etmemeli', () => {
  const src = read('apps/mobile/src/screens/OrderScreen.tsx');
  assert.ok(
    !src.includes('prompts a confirm'),
    'JSDoc "Leaving with a dirty cart prompts a confirm (K4)" diyor — ADR-026 Amendment E (2026-06-29) bu dialogu KALDIRDI; yorum bayat',
  );
});
