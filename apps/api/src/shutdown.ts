/**
 * ADR-050 K3 — graceful shutdown on SIGINT (PM2's default) / SIGTERM.
 *
 * Goal is not a shorter gap but that the gap does not break half-done work: a request that
 * already wrote to the DB gets to send its response instead of being killed mid-way (the
 * client would show an error and the user would press again → duplicate record).
 *
 * Order: stop cron tasks → stop accepting + close sockets (`stopAccepting`, resolves once every
 * connection has ended) → after `drainMs` force-close whatever is left (e.g. 25 s print-agent
 * long-polls; agents reconnect by themselves) → close DB pools → exit. Idempotent: a second
 * signal while shutting down is ignored.
 */
export interface ShutdownDeps {
  /** Stop accepting new connections, close realtime sockets; resolves when all connections ended. */
  stopAccepting: () => Promise<void>;
  /** Close keep-alive connections that are idle right now (called right after stopAccepting starts). */
  closeIdle: () => void;
  /** Destroy every remaining connection (drain timeout reached). */
  forceClose: () => void;
  /** Scheduled cron tasks to stop first (each task runs in its own transaction — ADR-050 K3.4). */
  tasks: ReadonlyArray<{ stop: () => unknown }>;
  /** DB pools closed last. */
  pools: ReadonlyArray<{ end: () => Promise<void> }>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  exit: (code: number) => void;
  drainMs?: number;
}

export function createGracefulShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const drainMs = deps.drainMs ?? 5_000;
  let started = false;

  return async (signal: string) => {
    if (started) return;
    started = true;
    const t0 = Date.now();
    deps.log('[api] Kapanış başladı', { signal, drainMs });

    for (const task of deps.tasks) {
      try {
        task.stop();
      } catch {
        // a cron task that cannot stop must not block the shutdown
      }
    }

    let forced = false;
    const drained = deps.stopAccepting().catch(() => undefined);
    deps.closeIdle();
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        forced = true;
        deps.forceClose();
        resolve();
      }, drainMs).unref();
    });
    await Promise.race([drained, timer]);
    // forceClose ends the remaining sockets; give `drained` a moment to settle afterwards.
    if (forced) await Promise.race([drained, new Promise((r) => setTimeout(r, 1_000).unref())]);

    for (const pool of deps.pools) {
      await pool.end().catch(() => undefined);
    }
    deps.log('[api] Kapanış tamam', { ms: Date.now() - t0, forced });
    deps.exit(0);
  };
}
