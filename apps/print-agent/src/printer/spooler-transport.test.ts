import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { sendToSpoolerPrinter } from './spooler-transport.js';
import type { SpoolerPrinterConfig } from './config.js';

/**
 * spooler-transport unit testleri — gerçek yardımcı exe / yazıcı YOK.
 * `child_process.spawn` mock'lanır; sahte child (EventEmitter) ile exit code
 * / stderr / timeout / spawn-error senaryoları simüle edilir. Gerçek winspool
 * smoke'u (P/Invoke doğrulaması) Windows'ta gerçek `spooler-raw.exe` +
 * yazıcı ile ayrıca koşulur (native-interop dersi) — mock burada değil.
 *
 * non-win32 platform guard'ı transport'ta erken fırlatır → win32 yolunu test
 * etmek için `process.platform` override edilir. `vi.mock` hoisting sayesinde
 * spooler-transport import edildiğinde `spawn` zaten mock'tur.
 */
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

/**
 * stderr + stdin GERÇEK EventEmitter (write/end mock üstüne eklenir) → stdin
 * 'error' (EPIPE) event'i emit edilip yutulma davranışı test edilebilir.
 * Child'ın kendisi de EventEmitter ('close'/'error' emit).
 */
function makeFakeChild(): EventEmitter & {
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  });
  return Object.assign(new EventEmitter(), {
    stdin,
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

const BASE_CONFIG: SpoolerPrinterConfig = {
  type: 'spooler',
  printerName: 'KASA-2026',
  timeoutMs: 500,
};

describe('sendToSpoolerPrinter', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: ORIGINAL_PLATFORM,
      configurable: true,
    });
    vi.clearAllMocks();
    delete process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'];
  });

  it('non-win32 platformda UNSUPPORTED_PLATFORM fırlatır (spawn edilmez)', async () => {
    setPlatform('linux');
    await expect(
      sendToSpoolerPrinter(new Uint8Array([0x1b]), BASE_CONFIG),
    ).rejects.toThrow(/SPOOLER_ERROR_UNSUPPORTED_PLATFORM/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('exit 0 → resolve; printerName argv + bytes stdin + env helper path', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'C:/fake/spooler-raw.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const bytes = new Uint8Array([0x1b, 0x40, 0x41]);
    const p = sendToSpoolerPrinter(bytes, BASE_CONFIG);

    // Executor senkron: spawn + stdin.write/end anında çağrılır.
    expect(spawnMock).toHaveBeenCalledWith(
      'C:/fake/spooler-raw.exe',
      ['KASA-2026'],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    const written = child.stdin.write.mock.calls[0]?.[0] as Buffer;
    expect(Array.from(written)).toEqual([0x1b, 0x40, 0x41]);
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });

  it('exit 2 → SPOOLER_ERROR_PRINTER_NOT_FOUND (stderr eklenir)', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.stderr.emit('data', Buffer.from("OpenPrinter('KASA-2026') fail, Win32=1801"));
    child.emit('close', 2);
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_PRINTER_NOT_FOUND[\s\S]*1801/);
  });

  it('exit 3 → SPOOLER_ERROR_ACCESS_DENIED', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('close', 3);
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_ACCESS_DENIED/);
  });

  it('exit 4 → SPOOLER_ERROR_WRITE', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('close', 4);
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_WRITE/);
  });

  it("spawn 'error' event → SPOOLER_ERROR_SPAWN", async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'missing.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('error', new Error('spawn ENOENT'));
    await expect(p).rejects.toThrow(/ENOENT[\s\S]*SPOOLER_ERROR_SPAWN/);
  });

  it('timeout → child öldürülür + SPOOLER_ERROR_TIMEOUT', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'slow.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    // Kısa timeout; child hiç 'close' emit etmez → timer ateşler.
    const p = sendToSpoolerPrinter(new Uint8Array([1]), {
      ...BASE_CONFIG,
      timeoutMs: 100,
    });
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_TIMEOUT/);
    expect(child.kill).toHaveBeenCalled();
  });

  it('resolve sonrası geç gelen close çift-settle etmez', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('close', 0);
    await expect(p).resolves.toBeUndefined();
    // İkinci (hatalı) close event'i no-op olmalı — settled guard.
    expect(() => child.emit('close', 4)).not.toThrow();
  });

  it('env override yoksa exe-komşusu (sibling) default spawn edilir', async () => {
    setPlatform('win32');
    delete process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'];
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    // MSI prod yolu: yardımcı agent exe komşusunda; env override YOK.
    const expected = join(dirname(process.execPath), 'spooler-raw.exe');
    expect(spawnMock).toHaveBeenCalledWith(
      expected,
      ['KASA-2026'],
      expect.objectContaining({ windowsHide: true }),
    );
    child.emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });

  it('stdin EPIPE (child erken öldü) yutulur → sonuç close ile belirlenir', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    // Child stdin okumadan öldü → stdin 'error' (EPIPE) throw ETMEMELİ.
    expect(() =>
      child.stdin.emit('error', new Error('write EPIPE')),
    ).not.toThrow();
    child.emit('close', 2);
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_PRINTER_NOT_FOUND/);
  });

  it('exit 1 → SPOOLER_ERROR_USAGE', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('close', 1);
    await expect(p).rejects.toThrow(/SPOOLER_ERROR_USAGE/);
  });

  it('exit code null (sinyalle öldürüldü) → beklenmeyen çıkış', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array([1]), BASE_CONFIG);
    child.emit('close', null);
    await expect(p).rejects.toThrow(/beklenmeyen çıkış/);
  });

  it('boş byte dizisi de stdin.write ile yollanır', async () => {
    setPlatform('win32');
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = 'x.exe';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const p = sendToSpoolerPrinter(new Uint8Array(0), BASE_CONFIG);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    child.emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });
});
