import type { GatewayManager } from '../../gateway/manager';
import type { GatewayLifecycleState } from '../../gateway/process-policy';
import { noteConfigWatcherRefresh } from '../../gateway/config-refresh-scheduler';
import { logger } from '../../utils/logger';

/**
 * OpenClaw control-plane writes are capped at 3 / 60s. Skill hot-apply must use
 * at most one immediate attempt so a transient failure cannot exhaust the budget
 * and rate-limit the next user action.
 */
const CONFIG_APPLY_RATE_LIMIT_FALLBACK_MS = 60_000;
const CONFIG_APPLY_RATE_LIMIT_MAX_WAIT_MS = 65_000;

const ACTIVE_GATEWAY_STATES = new Set<GatewayLifecycleState>(['running', 'starting', 'reconnecting']);

function isActiveGatewayState(state: GatewayLifecycleState): boolean {
  return ACTIVE_GATEWAY_STATES.has(state);
}

type SkillHotGateway = Pick<GatewayManager, 'getStatus' | 'applyConfigHotOnly'>;

let deferredHotApplyTimer: ReturnType<typeof setTimeout> | null = null;
let deferredHotApplyGateway: SkillHotGateway | null = null;

/** Parse OpenClaw `config.apply` control-plane rate-limit errors (`3 per 60s`). */
export function parseConfigApplyRateLimit(error: unknown): { retryAfterMs: number } | null {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (!/rate limit exceeded for config\.apply/i.test(msg)) return null;
  const match = /retry after (\d+)\s*s/i.exec(msg);
  const seconds = match ? Number(match[1]) : NaN;
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : CONFIG_APPLY_RATE_LIMIT_FALLBACK_MS;
  return { retryAfterMs };
}

/** Test helper: cancel any deferred config.apply scheduled after a rate limit. */
export function clearDeferredSkillConfigHotApplyForTests(): void {
  if (deferredHotApplyTimer) {
    clearTimeout(deferredHotApplyTimer);
    deferredHotApplyTimer = null;
  }
  deferredHotApplyGateway = null;
}

/**
 * One-shot deferred push after the Gateway rate-limit window. Must not call
 * applySkillConfigHotWithFallback (that would re-arm another deferred wave).
 */
function scheduleDeferredSkillConfigHotApply(
  gatewayManager: SkillHotGateway,
  retryAfterMs: number,
): void {
  const waitMs = Math.min(
    Math.max(retryAfterMs, 1_000),
    CONFIG_APPLY_RATE_LIMIT_MAX_WAIT_MS,
  );
  deferredHotApplyGateway = gatewayManager;
  if (deferredHotApplyTimer) {
    clearTimeout(deferredHotApplyTimer);
  }
  deferredHotApplyTimer = setTimeout(() => {
    deferredHotApplyTimer = null;
    const gateway = deferredHotApplyGateway;
    deferredHotApplyGateway = null;
    if (!gateway || gateway.getStatus().state !== 'running') return;

    void (async () => {
      try {
        const applied = await gateway.applyConfigHotOnly();
        if (applied) return;
        noteConfigWatcherRefresh(
          gateway,
          'Deferred skill config.apply did not apply; awaiting native config watcher',
          { onlyIfRunning: true },
        );
      } catch (error) {
        if (parseConfigApplyRateLimit(error)) {
          // Still limited in the new window — do not reschedule; watcher owns convergence.
          noteConfigWatcherRefresh(
            gateway,
            'Deferred skill config.apply still rate-limited; awaiting native config watcher',
            { onlyIfRunning: true },
          );
          return;
        }
        logger.warn('Deferred skill config hot apply failed', { error });
        noteConfigWatcherRefresh(
          gateway,
          'Deferred skill config.apply failed; awaiting native config watcher',
          { onlyIfRunning: true },
        );
      }
    })();
  }, waitMs);
}

/**
 * Push openclaw.json via config.apply without any restart fallback.
 * Single immediate attempt (preserves OpenClaw's 3/60s budget). On rate limit,
 * fall back to the native config watcher and schedule one deferred one-shot.
 */
export async function applySkillConfigHotWithFallback(
  gatewayManager: SkillHotGateway,
): Promise<boolean> {
  if (gatewayManager.getStatus().state !== 'running') {
    return false;
  }

  try {
    const applied = await gatewayManager.applyConfigHotOnly();
    if (applied) return true;
    logger.warn('Skill config hot apply returned false');
  } catch (error) {
    const rateLimit = parseConfigApplyRateLimit(error);
    if (rateLimit) {
      logger.warn('Skill config hot apply rate-limited; deferring to watcher + delayed one-shot', {
        retryAfterMs: rateLimit.retryAfterMs,
      });
      noteConfigWatcherRefresh(
        gatewayManager,
        'Skill mutation committed; config.apply rate-limited',
        { onlyIfRunning: true },
      );
      scheduleDeferredSkillConfigHotApply(gatewayManager, rateLimit.retryAfterMs);
      return false;
    }
    logger.warn('Skill config hot apply attempt failed', { error });
  }

  noteConfigWatcherRefresh(
    gatewayManager,
    'Skill mutation committed; config.apply hot-only did not converge',
    { onlyIfRunning: true },
  );
  return false;
}

/**
 * Perform a P1 filesystem mutation without interrupting Gateway sessions.
 * Used for skill *install* / overwrite paths. Directory changes are discovered
 * by OpenClaw on new Agent turns / skills watcher; config.apply hot-only updates
 * allowlists/entries only.
 */
export async function withGatewayHotSkillFilesystem<T>(
  gatewayManager: Pick<GatewayManager, 'getStatus' | 'applyConfigHotOnly' | 'rpc'>,
  operation: () => Promise<T> | T,
): Promise<T> {
  const value = await operation();
  if (gatewayManager.getStatus().state !== 'running') {
    return value;
  }

  const configApplied = await applySkillConfigHotWithFallback(gatewayManager);
  if (!configApplied) {
    logger.warn('Skill config hot apply did not converge; disk mutation kept committed');
  }

  // Observability only: proves disk scan path responds. Must not roll back
  // committed files/config and must not be treated as config.apply success.
  try {
    await gatewayManager.rpc('skills.status', {}, 5_000);
  } catch (error) {
    logger.warn('Skill filesystem status observation did not converge immediately', { error });
  }

  return value;
}

/**
 * Pause the OpenClaw Gateway around skill *uninstall* directory removal.
 * Semantics match 2026-07-25 (commit 9a026580): stop → mutate → restart.
 *
 * Gateway watches ~/.openclaw/skills with chokidar; on Windows that keeps handles
 * open and blocks uninstall cleanup. Install paths keep using
 * withGatewayHotSkillFilesystem instead.
 */
export async function withGatewayRestartForSkillFilesystem<T>(
  gatewayManager: Pick<GatewayManager, 'getStatus' | 'stop' | 'restart'>,
  operation: () => Promise<T> | T,
): Promise<T> {
  const stateBefore = gatewayManager.getStatus().state;
  const shouldRestartGateway = isActiveGatewayState(stateBefore);

  if (shouldRestartGateway) {
    logger.info('[skills] Stopping Gateway before skill filesystem mutation');
    await gatewayManager.stop();
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  try {
    return await operation();
  } finally {
    if (shouldRestartGateway) {
      try {
        logger.info('[skills] Restarting Gateway after skill filesystem mutation');
        await gatewayManager.restart();
      } catch (error) {
        logger.warn('Failed to restart Gateway after skill filesystem mutation:', error);
      }
    }
  }
}
