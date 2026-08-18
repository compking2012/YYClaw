/**
 * Cron validity-window manager (app-side enforcement).
 *
 * The bundled OpenClaw Gateway has no start/end validity window for cron jobs.
 * We store each job's window locally (`cron-window-store.ts`) and this manager
 * periodically reconciles the Gateway's `enabled` flag with the window: a job is
 * enabled only when the user intended it enabled AND the current local date is
 * inside the window. Because the Gateway process shares the app's lifecycle,
 * reconciling while the app runs is sufficient in practice (bounded by the tick
 * interval and local-date granularity).
 *
 * Mirrors the periodic-repair pattern in `main/ipc-handlers.ts`.
 */
import type { GatewayManager } from '../gateway/manager';
import {
  effectiveEnabled,
  getAllWindows,
  localDateString,
  pruneWindows,
} from './cron-window-store';

const TICK_INTERVAL_MS = 60 * 1000; // re-check window boundaries every minute
const ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // throttle noisy errors to hourly

interface GatewayCronJobLite {
  id: string;
  enabled: boolean;
}

let started = false;

export function startCronWindowManager(gatewayManager: GatewayManager): () => void {
  if (started) return () => undefined;
  started = true;

  let lastErrorLogAt = 0;

  const tick = async (): Promise<void> => {
    try {
      if (gatewayManager.getStatus().state !== 'running') return;

      const windows = getAllWindows();
      const windowedIds = Object.keys(windows);
      if (windowedIds.length === 0) return;

      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
      const jobs = (Array.isArray(result)
        ? result
        : (result as { jobs?: GatewayCronJobLite[] })?.jobs ?? []) as GatewayCronJobLite[];
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const today = localDateString();

      for (const jobId of windowedIds) {
        const job = jobById.get(jobId);
        if (!job) continue;
        const shouldBeEnabled = effectiveEnabled(windows[jobId], today);
        if (job.enabled !== shouldBeEnabled) {
          await gatewayManager.rpc('cron.update', { id: jobId, patch: { enabled: shouldBeEnabled } });
        }
      }

      // Cleanup: drop windows for jobs the Gateway no longer knows about.
      pruneWindows(jobs.map((job) => job.id));
    } catch (error) {
      const now = Date.now();
      if (now - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLogAt = now;
        console.debug('Cron window reconcile error:', error);
      }
    }
  };

  // Reconcile immediately on start, then on the interval.
  void tick();
  const timer = setInterval(() => void tick(), TICK_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    started = false;
  };
}
