/**
 * ADR-045 K3.3 — kasa ve paket fişinin ALTIN ÇİZİM KAYDI.
 *
 * Neden bayt değil, çizim kaydı: fiş raster çiziliyor (`@napi-rs/canvas`,
 * DejaVu). Bayt çıktısının Windows (geliştirme makinesi) ile Linux (CI)
 * arasında aynı olduğu kanıtlanmadı; bayt fixture'ı bir platformda yeşil,
 * diğerinde kırmızı olabilirdi. Çizici saf ve deterministiktir (`build()`
 * saat/rastgelelik içermez, font depoda sabit) → aynı çizim çağrıları aynı
 * resmi üretir. Bu yüzden kaydedilen şey, şablonun `ReceiptCanvas`'a yaptığı
 * çağrıların sırası + metni + punto/kalınlık/girinti argümanlarıdır. Kayıt
 * eşitse fiş, aynı platformda bayt bayt aynıdır — ve kayıt platformdan
 * bağımsızdır.
 *
 * Tek istisna: `itemRow`'un 5. argümanı (`qtyColPx`) yazı tipiyle ÖLÇÜLEN bir
 * piksel değeridir ve platforma göre değişebilir. Bu yüzden ölçümü üreten
 * `qtyColumnWidth` çağrısının kendisi (metinler + punto/kalınlık) kaydedilir ve
 * `itemRow`'a geçen değer YALNIZ o çağrının döndürdüğü değerse
 * `'<qtyColumnWidth>'` ile maskelenir; şablon ölçüm yerine sabit bir sayı
 * geçirirse sayı olduğu gibi kayda girer ve test bunu görür (qa-engineer,
 * 2026-11-17).
 *
 * Dürüst sınır: kayıt ÇİZİM ÇAĞRILARINI kapsar. Çizimden sonraki piksel hattı
 * (`build()`, `encodeRaster`, `wrapPrintJob`) ve `icon`'un çizim fonksiyonunun
 * gövdesi kayıtta yoktur; o katman yapısal zarf testleriyle
 * (`bill-receipt.test.ts`, `packing-receipt.test.ts`) korunur ve ADR-045 PR-1'de
 * değişmedi. Sınıfa yeni bir çizim yöntemi eklenirse kaydın onu atlamaması
 * için `ReceiptCanvas` yöntem kümesi aşağıda kilitlidir.
 *
 * İddia POZİTİFTİR (ADR-045 K3.3, [[feedback_negative_guarantee_stays_green]]):
 * kayıt fixture ile BİREBİR EŞİT. "Hata almadık" güvence sayılmaz.
 *
 * Fixture'ları yeniden üretmek (YALNIZ bilinçli bir şablon değişikliğinde):
 *   UPDATE_RECEIPT_GOLDEN=1 pnpm --filter @restoran-pos/api exec vitest run src/print/templates/receipt-golden.test.ts
 * Bu commit fixture'ları şablonlar DEĞİŞMEDEN ÖNCE üretti; ADR-045 PR-1'in
 * geri kalanı bu kayda dokunmadan geçmek zorunda.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptCanvas } from '../raster/canvas-render.js';
import { renderBillReceipt } from './bill-receipt.js';
import { renderPackingReceipt } from './packing-receipt.js';
import { BILL_SCENARIOS, PACKING_SCENARIOS } from './receipt-golden-scenarios.js';

const FIXTURE_DIR = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const UPDATE = process.env['UPDATE_RECEIPT_GOLDEN'] === '1';

/** Kaydedilen çizim yöntemleri — `ReceiptCanvas`'ın çizen public API'si. */
const DRAW_METHODS = [
  'centered',
  'left',
  'leftRight',
  'itemRow',
  'rule',
  'icon',
  'gap',
] as const;

/** Kaydedilen ama çizmeyen (ölçen) yöntem — `itemRow`'un ölçülen girdisinin kaynağı. */
const MEASURE_METHODS = ['qtyColumnWidth'] as const;

/**
 * `ReceiptCanvas.prototype`'un TAM yöntem kümesi. Buraya eklenmemiş yeni bir
 * yöntem bu testi kırmızıya çevirir: ya kayda alınır (çiziyorsa) ya da
 * bilinçle "çizmez" listesine yazılır.
 */
const NON_RECORDED_METHODS = ['constructor', 'build', 'widthOf', 'wrap'] as const;

type DrawCall = { method: string; args: unknown[] };

/** `render()` süresince `ReceiptCanvas`'a yapılan çizim + ölçüm çağrılarını toplar. */
function recordDrawCalls(render: () => Uint8Array): DrawCall[] {
  const calls: DrawCall[] = [];
  let lastQtyColumnWidth: number | undefined;

  const normalizeArgs = (method: string, args: unknown[]): unknown[] =>
    args.map((a, i) => {
      if (typeof a === 'function') return '<fn>';
      if (method === 'itemRow' && i === 4 && a === lastQtyColumnWidth) {
        return '<qtyColumnWidth>';
      }
      return a;
    });

  for (const method of [...DRAW_METHODS, ...MEASURE_METHODS]) {
    const original = ReceiptCanvas.prototype[method] as (...a: unknown[]) => unknown;
    vi.spyOn(ReceiptCanvas.prototype, method).mockImplementation(function (
      this: ReceiptCanvas,
      ...args: unknown[]
    ) {
      calls.push({ method, args: normalizeArgs(method, args) });
      const result = original.apply(this, args);
      if (method === 'qtyColumnWidth') lastQtyColumnWidth = result as number;
      return result;
    } as never);
  }
  const bytes = render();
  // Çizim gerçekten yapıldı mı — boş kayıt sessizce "eşit" çıkmasın.
  expect(bytes.length).toBeGreaterThan(0);
  return calls;
}

function checkGolden(name: string, calls: DrawCall[]): void {
  const file = `${FIXTURE_DIR}${name}.json`;
  if (UPDATE) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(calls, null, 2)}\n`, 'utf8');
  }
  expect(existsSync(file), `fixture yok: ${file}`).toBe(true);
  const golden = JSON.parse(readFileSync(file, 'utf8')) as DrawCall[];
  expect(calls.length).toBeGreaterThan(5);
  expect(calls).toEqual(golden);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ADR-045 K3.3 — altın çizim kaydı (bugünkü fiş birebir korunur)', () => {
  it('ReceiptCanvas yöntem kümesi kilitli (kaydın atlayabileceği yeni çizim yöntemi yok)', () => {
    expect(Object.getOwnPropertyNames(ReceiptCanvas.prototype).sort()).toEqual(
      [...DRAW_METHODS, ...MEASURE_METHODS, ...NON_RECORDED_METHODS].sort(),
    );
  });

  for (const [name, params] of Object.entries(BILL_SCENARIOS)) {
    it(`kasa fişi: ${name}`, () => {
      checkGolden(name, recordDrawCalls(() => renderBillReceipt(params)));
    });
  }
  for (const [name, params] of Object.entries(PACKING_SCENARIOS)) {
    it(`paket fişi: ${name}`, () => {
      checkGolden(name, recordDrawCalls(() => renderPackingReceipt(params)));
    });
  }
});
