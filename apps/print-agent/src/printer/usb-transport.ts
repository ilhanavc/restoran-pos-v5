import { Buffer } from 'node:buffer';
import {
  findByIds,
  usb,
  type Device,
  type Endpoint,
  type Interface,
  type OutEndpoint,
} from 'usb';
import type { UsbPrinterConfig } from './config.js';

/** libusb bulk transfer type constant (2). Module namespace export. */
const LIBUSB_TRANSFER_TYPE_BULK = usb.LIBUSB_TRANSFER_TYPE_BULK;

/**
 * ESC/POS byte stream'i USB bulk-out endpoint üzerinden printer'a yollar.
 *
 * ADR-004 §5 + §Phase 3 PR-5b kararları:
 *   - Library: `usb` (formerly `node-usb`) ^2.13.0, libusb tabanlı, BSD-2,
 *     N-API prebuilt Windows x64 binary (kullanıcı PC'sinde MSVC gerek yok).
 *   - Device ID: `vendorId + productId` zorunlu, opsiyonel `serialNumber`
 *     çoklu cihaz disambiguator.
 *   - Endpoint discovery: otomatik — Interface 0 üzerindeki ilk
 *     `direction === 'out' && transferType === BULK` endpoint kullanılır
 *     (ESC/POS USB printer pattern %99 cihazda deterministik).
 *
 * Davranış:
 *   - `findByIds(vendorId, productId)` ile cihaz bulunur (`undefined` →
 *     `LIBUSB_ERROR_NOT_FOUND` türü hata).
 *   - `serialNumber` config'te varsa string descriptor okunup eşleştirilir;
 *     eşleşmezse hata.
 *   - `device.open()` + `interface(0).claim()` + bulk-out endpoint discovery
 *     + `endpoint.transfer(buffer, callback)` Promise wrap.
 *   - Timeout: `config.timeoutMs` (default 10sn) tek bütçe; aşılırsa
 *     `LIBUSB_ERROR_TIMEOUT` türü hata.
 *   - Cleanup: success/fail her yolda `iface.release()` + `device.close()`
 *     (dangling handle önlenir).
 *
 * Hata türleri (caller retry kararı verir — Agent main loop log'lar ve
 * `failed` raporlar):
 *   - `LIBUSB_ERROR_NOT_FOUND` → cihaz fişten çıkmış / yanlış vid+pid
 *   - `LIBUSB_ERROR_ACCESS` → driver çakışması (Zadig ile WinUSB'e çevir)
 *   - `LIBUSB_ERROR_TIMEOUT` → cihaz cevap vermiyor
 *   - `LIBUSB_ERROR_PIPE` → endpoint hatalı state, cihaz reset gerek
 *   - Endpoint not found → cihaz ESC/POS uyumlu değil
 *   - Schema dışı durumlarda da `Error` fırlatılır (caller log'lar).
 *
 * Race condition önlemi: tek `settled` flag ile timeout/transfer-callback
 * event'lerinin çok seferli resolve/reject etmesi engellenir. Promise
 * her durumda tam bir kez settle olur, cleanup tek kez koşar.
 */
export async function sendToUsbPrinter(
  bytes: Uint8Array,
  config: UsbPrinterConfig,
): Promise<void> {
  const device = findByIds(config.vendorId, config.productId);
  if (device === undefined) {
    throw new Error(
      `[print-agent] USB cihaz bulunamadı (vendorId=0x${toHex4(
        config.vendorId,
      )}, productId=0x${toHex4(config.productId)}) — LIBUSB_ERROR_NOT_FOUND`,
    );
  }

  // device.open() libusb seviyesinde handle açar; iface.claim() sonrası
  // her transfer aynı handle üzerinden gider.
  try {
    device.open();
  } catch (err) {
    throw new Error(
      `[print-agent] USB device.open() başarısız: ${describeError(
        err,
      )} (driver çakışması olabilir — Zadig ile WinUSB sürücüsü kurulmalı)`,
    );
  }

  // serialNumber config'te varsa string descriptor karşılaştırılır.
  // `getStringDescriptor` async — Promise wrap.
  if (config.serialNumber !== undefined && config.serialNumber !== '') {
    let actualSerial: string;
    try {
      actualSerial = await readSerialNumber(device);
    } catch (err) {
      safeClose(device);
      throw new Error(
        `[print-agent] USB serialNumber okunamadı: ${describeError(err)}`,
      );
    }
    if (actualSerial !== config.serialNumber) {
      safeClose(device);
      throw new Error(
        `[print-agent] USB serialNumber eşleşmedi (config=${config.serialNumber}, device=${actualSerial})`,
      );
    }
  }

  let iface: Interface;
  try {
    iface = device.interface(0);
    iface.claim();
  } catch (err) {
    safeClose(device);
    throw new Error(
      `[print-agent] USB interface(0).claim() başarısız: ${describeError(
        err,
      )} (LIBUSB_ERROR_ACCESS — başka bir process cihazı kullanıyor olabilir)`,
    );
  }

  const outEndpoint = findBulkOutEndpoint(iface);
  if (outEndpoint === null) {
    await safeReleaseAndClose(iface, device);
    throw new Error(
      '[print-agent] USB bulk-out endpoint bulunamadı — cihaz ESC/POS uyumlu olmayabilir',
    );
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settle(
        new Error(
          `[print-agent] USB yazma zaman aşımı (${config.timeoutMs.toString()}ms) — LIBUSB_ERROR_TIMEOUT`,
        ),
      );
    }, config.timeoutMs);

    const settle = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Cleanup async; result Promise'i bekletmeden hemen resolve/reject
      // ama dangling handle olmasın diye await ediliyor.
      void safeReleaseAndClose(iface, device).then(() => {
        if (err !== undefined) reject(err);
        else resolve();
      });
    };

    try {
      outEndpoint.transfer(Buffer.from(bytes), (err) => {
        if (err !== undefined && err !== null) {
          settle(
            new Error(
              `[print-agent] USB transfer hatası: ${describeError(err)}`,
            ),
          );
          return;
        }
        settle();
      });
    } catch (err) {
      settle(
        new Error(
          `[print-agent] USB transfer çağrısı patladı: ${describeError(err)}`,
        ),
      );
    }
  });
}

/** 16-bit unsigned → 4-hane hex (örn. `0416`). */
function toHex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

/** `usb` paketinden gelen hata objesini güvenli stringe çevir. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err === null || err === undefined) return '<bilinmiyor>';
  return String(err);
}

/**
 * Interface üzerindeki ilk bulk-out endpoint'i bulur. ESC/POS USB
 * yazıcıları %99 oranında Interface 0'da tek bulk-out endpoint kullanır
 * (Epson, Star, Bixolon, Citizen, generic Çin yazıcılar). Exotic cihaz
 * çıkarsa amendment ile config override eklenebilir (YAGNI şu an).
 */
function findBulkOutEndpoint(iface: Interface): OutEndpoint | null {
  const found = iface.endpoints.find(
    (ep: Endpoint) =>
      ep.direction === 'out' && ep.transferType === LIBUSB_TRANSFER_TYPE_BULK,
  );
  return (found as OutEndpoint | undefined) ?? null;
}

/**
 * USB string descriptor üzerinden serial number oku. `iSerialNumber`
 * descriptor index 0 ise (üretici set etmemiş) boş string döner — caller
 * config eşleşmesini fail eder. `getStringDescriptor` async, Promise wrap.
 */
async function readSerialNumber(device: Device): Promise<string> {
  const idx = device.deviceDescriptor.iSerialNumber;
  if (idx === 0) return '';
  return new Promise<string>((resolve, reject) => {
    device.getStringDescriptor(idx, (err, value) => {
      if (err !== undefined && err !== null) {
        reject(err instanceof Error ? err : new Error(describeError(err)));
        return;
      }
      resolve(typeof value === 'string' ? value : '');
    });
  });
}

/** Interface release + device close; her hata yutulur (best-effort cleanup). */
async function safeReleaseAndClose(
  iface: Interface,
  device: Device,
): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      iface.release(true, () => {
        safeClose(device);
        resolve();
      });
    } catch {
      safeClose(device);
      resolve();
    }
  });
}

/** device.close() — hata yutulur (zaten kapalıysa çift kapanma no-op). */
function safeClose(device: Device): void {
  try {
    device.close();
  } catch {
    // Best-effort cleanup; double close veya zaten kapalı handle no-op.
  }
}
