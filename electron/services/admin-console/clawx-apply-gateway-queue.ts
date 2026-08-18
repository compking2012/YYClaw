// @ts-nocheck
/**
 * Serialize gateway-bound work with in-flight `clawx_apply_sync` on the device.
 * The OpenClaw gateway multiplexes RPCs on one WebSocket, so apply-sync work is serialized here to
 * avoid minute-scale queueing and false RPC timeouts when a long history fetch is pending.
 */
let applySyncExclusiveTail: Promise<void> = Promise.resolve();

export function runApplySyncExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = applySyncExclusiveTail.then(() => fn());
  applySyncExclusiveTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Wait until no `clawx_apply_sync` handler is running (safe before other gateway RPC). */
export function awaitApplySyncExclusiveIdle(): Promise<void> {
  return applySyncExclusiveTail;
}
