import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGracefulShutdown } from './shutdown.js';

/**
 * ADR-050 K3 — exercised against a real http.Server: an in-flight request must finish,
 * new connections must be refused, pools closed last, exit(0), and a second signal ignored.
 */
let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

function startServer(handlerDelayMs: number): Promise<number> {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('done');
    }, handlerDelayMs);
  });
  return new Promise((resolve) => server?.listen(0, '127.0.0.1', () => resolve((server?.address() as AddressInfo).port)));
}

function get(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', agent: false }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function wire(drainMs: number) {
  const calls: string[] = [];
  const s = server as Server;
  const shutdown = createGracefulShutdown({
    stopAccepting: () => new Promise<void>((resolve) => s.close(() => resolve())),
    closeIdle: () => s.closeIdleConnections(),
    forceClose: () => {
      calls.push('force');
      s.closeAllConnections();
    },
    tasks: [{ stop: () => calls.push('task.stop') }],
    pools: [{ end: async () => void calls.push('pool.end') }],
    log: () => undefined,
    exit: (code) => calls.push(`exit:${code}`),
    drainMs,
  });
  return { shutdown, calls };
}

describe('createGracefulShutdown (ADR-050 K3)', () => {
  it('lets an in-flight request finish, refuses new ones, closes pools, exits 0', async () => {
    const port = await startServer(300);
    const { shutdown, calls } = wire(5_000);

    const inflight = get(port);
    await new Promise((r) => setTimeout(r, 50)); // request is now being handled
    const done = shutdown('SIGINT');

    await expect(get(port)).rejects.toThrow(); // listener closed → ECONNREFUSED
    await expect(inflight).resolves.toEqual({ status: 200, body: 'done' });
    await done;

    expect(calls).toEqual(['task.stop', 'pool.end', 'exit:0']);
  });

  it('force-closes what is left after the drain timeout (e.g. a 25 s long-poll)', async () => {
    const port = await startServer(10_000);
    const { shutdown, calls } = wire(200);

    const longPoll = get(port).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await shutdown('SIGTERM');

    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(calls).toEqual(['task.stop', 'force', 'pool.end', 'exit:0']);
    expect(await longPoll).toBeInstanceOf(Error); // socket reset → client reconnects
  });

  it('is idempotent: a second signal during shutdown does nothing', async () => {
    await startServer(10);
    const { shutdown, calls } = wire(1_000);
    await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM')]);
    expect(calls.filter((c) => c.startsWith('exit'))).toEqual(['exit:0']);
    expect(calls.filter((c) => c === 'pool.end')).toHaveLength(1);
  });
});
