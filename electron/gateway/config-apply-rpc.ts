/**
 * OpenClaw control-plane config.apply requires an optimistic-concurrency baseHash
 * from a prior config.get (see requireConfigBaseHash in OpenClaw gateway).
 */
import { resolveConfigSnapshotHash } from '../utils/openclaw-cli';

export type ConfigGetSnapshot = {
  hash?: string;
  raw?: string | null;
};

export function buildConfigApplyParams(
  config: unknown,
  snapshot: ConfigGetSnapshot | null | undefined,
): { raw: string; baseHash: string } {
  const baseHash = resolveConfigSnapshotHash(snapshot);
  if (!baseHash) {
    throw new Error('config base hash unavailable; re-run config.get and retry');
  }
  return {
    raw: typeof config === 'string' ? config : JSON.stringify(config),
    baseHash,
  };
}

/**
 * Read on-disk openclaw.json, fetch gateway baseHash via config.get, then config.apply.
 * Retries once when another writer races the snapshot (`config changed since last load`).
 * config.get is not a control-plane write and does not consume the 3/60s apply budget.
 */
export async function applyOpenClawConfigViaGatewayRpc(opts: {
  rpc: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  readConfig: () => Promise<unknown>;
  maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const config = await opts.readConfig();
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = (await opts.rpc('config.get', {}, 15_000)) as ConfigGetSnapshot;
    const params = buildConfigApplyParams(config, snapshot);
    try {
      await opts.rpc('config.apply', params, 30_000);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (attempt < maxAttempts - 1 && /config changed since last load/i.test(message)) {
        continue;
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'config.apply failed'));
}
