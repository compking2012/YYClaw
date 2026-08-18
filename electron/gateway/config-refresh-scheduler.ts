import type { GatewayManager } from './manager';
import { logger } from '../utils/logger';
import { hasChannelRuntimeError, isChannelRuntimeConnected } from '../utils/channel-status';

type GatewayRestartTarget = Pick<GatewayManager, 'getStatus' | 'debouncedRestart'>;
type GatewayRuntimeTarget = Pick<
  GatewayManager,
  'getStatus' | 'rpc' | 'applyConfigViaRpc' | 'debouncedReload'
>;
type GatewayChannelRuntimeTarget = Pick<
  GatewayManager,
  'getStatus' | 'rpc' | 'applyConfigViaRpc' | 'debouncedRestart'
>;

type ChannelStatusRuntimeAccount = {
  accountId?: string;
  connected?: boolean;
  running?: boolean;
  linked?: boolean;
  lastError?: string;
  probe?: { ok?: boolean } | null;
};

type ChannelStatusResponse = {
  channelAccounts?: Record<string, ChannelStatusRuntimeAccount[]>;
};

type GatewayRefreshOptions = {
  delayMs?: number;
  onlyIfRunning?: boolean;
};

export type AgentRuntimeExpectation = {
  agentId: string;
  modelRef: string;
};

type AgentRuntimeListResponse = {
  defaultId?: string;
  agents?: Array<{
    id?: string;
    model?: {
      primary?: string;
    };
  }>;
};

const DEFAULT_RUNTIME_CONVERGENCE_TIMEOUT_MS = 2_000;
const DEFAULT_RUNTIME_ESCALATION_TIMEOUT_MS = 3_000;
const DEFAULT_RUNTIME_CONVERGENCE_INTERVAL_MS = 100;
const pendingRuntimeConvergence = new WeakMap<object, Map<string, Promise<void>>>();

const DEFAULT_CHANNEL_CONVERGENCE_TIMEOUT_MS = 1_500;
const DEFAULT_CHANNEL_ESCALATION_TIMEOUT_MS = 4_000;
const DEFAULT_CHANNEL_CONVERGENCE_INTERVAL_MS = 400;
const pendingChannelConvergence = new WeakMap<object, Map<string, Promise<void>>>();

function shouldSkip(
  gatewayManager: Pick<GatewayManager, 'getStatus'> | undefined,
  options?: GatewayRefreshOptions,
): boolean {
  if (!gatewayManager) return true;
  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return true;
  }
  return false;
}

/** Record that OpenClaw's native config watcher will apply an on-disk change. */
export function noteConfigWatcherRefresh(
  gatewayManager: Pick<GatewayManager, 'getStatus'> | undefined,
  reason: string,
  options?: GatewayRefreshOptions,
): void {
  if (shouldSkip(gatewayManager, options)) return;
  logger.info(`${reason}; awaiting OpenClaw native config watcher`);
}

function runtimeMatches(
  response: AgentRuntimeListResponse,
  expectations: AgentRuntimeExpectation[],
  expectedDefaultAgentId?: string,
): boolean {
  if (expectedDefaultAgentId && response.defaultId !== expectedDefaultAgentId) {
    return false;
  }
  const runtimeModels = new Map(
    (response.agents ?? []).flatMap((agent) => (
      typeof agent.id === 'string' && typeof agent.model?.primary === 'string'
        ? [[agent.id, agent.model.primary] as const]
        : []
    )),
  );
  return expectations.every(
    ({ agentId, modelRef }) => runtimeModels.get(agentId) === modelRef,
  );
}

/**
 * Poll `agents.list` until the live runtime snapshot matches `expectations`, or
 * the deadline passes. Returns true on convergence, false on timeout. Throws
 * only if the Gateway stops mid-wait.
 */
async function pollUntilConverged(
  gatewayManager: GatewayRuntimeTarget,
  expectations: AgentRuntimeExpectation[],
  expectedDefaultAgentId: string | undefined,
  intervalMs: number,
  deadline: number,
): Promise<boolean> {
  let lastError: unknown;
  while (Date.now() <= deadline) {
    if (gatewayManager.getStatus().state !== 'running') {
      throw new Error('Gateway stopped before model configuration reached the live runtime');
    }
    try {
      const response = await gatewayManager.rpc<AgentRuntimeListResponse>(
        'agents.list',
        {},
        Math.min(1_000, Math.max(250, deadline - Date.now())),
      );
      if (runtimeMatches(response, expectations, expectedDefaultAgentId)) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  if (lastError) {
    logger.debug('[gateway-refresh] agents.list poll error before timeout', {
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
  return false;
}

/**
 * Wait until OpenClaw's live runtime snapshot reflects a model config write.
 * `agents.list` reads `context.getRuntimeConfig()`, unlike `config.get`, which
 * only confirms the file on disk. Calls for the same target state are coalesced.
 *
 * Three-phase, self-healing convergence:
 *   1. watcher    — briefly poll while the kernel's native file watcher applies
 *                   the on-disk change (fast path when the watcher fires).
 *   2. escalate   — the watcher is unreliable in the embedded gateway and often
 *                   misses atomic-rename writes, so push the config deterministically
 *                   via `config.apply` and re-poll.
 *   3. fallback   — if the push still didn't converge, schedule a reload (which
 *                   degrades to a restart per policy) and return optimistically:
 *                   the config is already persisted, so the reload will apply it.
 * Only throws if the Gateway stops mid-wait.
 */
export async function awaitAgentRuntimeConvergence(
  gatewayManager: GatewayRuntimeTarget | undefined,
  expectations: AgentRuntimeExpectation[],
  options?: {
    expectedDefaultAgentId?: string;
    timeoutMs?: number;
    escalationTimeoutMs?: number;
    intervalMs?: number;
  },
): Promise<void> {
  if (!gatewayManager || gatewayManager.getStatus().state !== 'running') {
    return;
  }
  if (expectations.length === 0 && !options?.expectedDefaultAgentId) {
    return;
  }

  const normalized = [...expectations].sort((a, b) => a.agentId.localeCompare(b.agentId));
  const key = JSON.stringify({
    expectations: normalized,
    defaultAgentId: options?.expectedDefaultAgentId ?? null,
  });
  let managerPending = pendingRuntimeConvergence.get(gatewayManager as object);
  if (!managerPending) {
    managerPending = new Map();
    pendingRuntimeConvergence.set(gatewayManager as object, managerPending);
  }
  const existing = managerPending.get(key);
  if (existing) {
    await existing;
    return;
  }

  const watcherTimeoutMs = options?.timeoutMs ?? DEFAULT_RUNTIME_CONVERGENCE_TIMEOUT_MS;
  const escalationTimeoutMs = options?.escalationTimeoutMs ?? DEFAULT_RUNTIME_ESCALATION_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_RUNTIME_CONVERGENCE_INTERVAL_MS;
  const expectedDefaultAgentId = options?.expectedDefaultAgentId;
  const pending = (async () => {
    logger.info('[gateway-refresh] mode=watcher result=runtime_wait_started', {
      expectations: normalized,
      expectedDefaultAgentId,
    });

    // Phase 1: give the kernel's native watcher a brief window to apply the write.
    if (await pollUntilConverged(
      gatewayManager, normalized, expectedDefaultAgentId, intervalMs, Date.now() + watcherTimeoutMs,
    )) {
      logger.info('[gateway-refresh] mode=watcher result=runtime_converged', {
        expectations: normalized,
        expectedDefaultAgentId,
      });
      return;
    }

    // Phase 2: watcher missed it (atomic-rename write in embedded gateway) —
    // push deterministically via config.apply and re-poll.
    logger.info('[gateway-refresh] mode=escalate cause=watcher_timeout method=config.apply', {
      expectations: normalized,
      expectedDefaultAgentId,
    });
    await gatewayManager.applyConfigViaRpc();
    if (await pollUntilConverged(
      gatewayManager, normalized, expectedDefaultAgentId, intervalMs, Date.now() + escalationTimeoutMs,
    )) {
      logger.info('[gateway-refresh] mode=escalate result=converged_after_escalation', {
        expectations: normalized,
        expectedDefaultAgentId,
      });
      return;
    }

    // Phase 3: still not converged — schedule a reload (degrades to restart per
    // policy) so the persisted config lands, and return without erroring. We
    // cannot await through a restart here (the WS drops), but the change is
    // saved and guaranteed to apply.
    logger.warn('[gateway-refresh] mode=escalate result=escalate_reload cause=escalation_timeout', {
      expectations: normalized,
      expectedDefaultAgentId,
    });
    gatewayManager.debouncedReload();
  })();

  managerPending.set(key, pending);
  try {
    await pending;
  } finally {
    if (managerPending.get(key) === pending) {
      managerPending.delete(key);
    }
  }
}

function channelAccountConverged(
  response: ChannelStatusResponse,
  storedChannelType: string,
  accountId: string | undefined,
): boolean {
  const accounts = response.channelAccounts?.[storedChannelType] ?? [];
  if (accounts.length === 0) return false;
  const pool = accountId
    ? accounts.filter((account) => (account.accountId ?? 'default') === accountId)
    : accounts;
  if (pool.length === 0) return false;
  return pool.some(
    (account) => isChannelRuntimeConnected(account) && !hasChannelRuntimeError(account),
  );
}

/**
 * Poll `channels.status` until the target channel account reports a healthy,
 * error-free live connection, or the deadline passes. Returns true on
 * convergence, false on timeout. Throws only if the Gateway stops mid-wait.
 */
async function pollUntilChannelConverged(
  gatewayManager: GatewayChannelRuntimeTarget,
  storedChannelType: string,
  accountId: string | undefined,
  intervalMs: number,
  deadline: number,
): Promise<boolean> {
  let lastError: unknown;
  while (Date.now() <= deadline) {
    if (gatewayManager.getStatus().state !== 'running') {
      throw new Error('Gateway stopped before channel configuration reached the live runtime');
    }
    try {
      const response = await gatewayManager.rpc<ChannelStatusResponse>(
        'channels.status',
        {},
        Math.min(2_000, Math.max(500, deadline - Date.now())),
      );
      if (channelAccountConverged(response, storedChannelType, accountId)) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  if (lastError) {
    logger.debug('[gateway-refresh] channels.status poll error before timeout', {
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
  return false;
}

/**
 * Wait until the running Gateway's live channel runtime reflects a saved channel
 * config change. Mirrors `awaitAgentRuntimeConvergence` but for channels, whose
 * "connected" state is read from the `channels.status` RPC. Calls for the same
 * (channel, account) target are coalesced.
 *
 * Three-phase, self-healing convergence:
 *   1. watcher   — briefly poll while OpenClaw's native file watcher applies the
 *                  on-disk change (fast path when the watcher fires or the plugin
 *                  is already loaded — e.g. a WeChat account with a live token).
 *   2. escalate  — the watcher is unreliable and often misses atomic-rename
 *                  writes, so push the config deterministically via `config.apply`
 *                  and re-poll (handles credential updates to an already-loaded
 *                  plugin without a restart).
 *   3. fallback  — still not connected: a newly-configured channel plugin (e.g.
 *                  Feishu's `openclaw-lark`) is only installed/loaded on a full
 *                  Gateway (re)start (`ensureConfiguredPluginsUpgraded` runs at
 *                  prelaunch, and an in-place SIGUSR1 reload does not), so schedule
 *                  a restart and return optimistically — the config is persisted.
 * Only throws if the Gateway stops mid-wait.
 */
export async function awaitChannelRuntimeConvergence(
  gatewayManager: GatewayChannelRuntimeTarget | undefined,
  storedChannelType: string,
  accountId?: string,
  options?: {
    timeoutMs?: number;
    escalationTimeoutMs?: number;
    intervalMs?: number;
  },
): Promise<void> {
  if (!gatewayManager || gatewayManager.getStatus().state !== 'running') {
    return;
  }

  const key = JSON.stringify({ channel: storedChannelType, account: accountId ?? null });
  let managerPending = pendingChannelConvergence.get(gatewayManager as object);
  if (!managerPending) {
    managerPending = new Map();
    pendingChannelConvergence.set(gatewayManager as object, managerPending);
  }
  const existing = managerPending.get(key);
  if (existing) {
    await existing;
    return;
  }

  const watcherTimeoutMs = options?.timeoutMs ?? DEFAULT_CHANNEL_CONVERGENCE_TIMEOUT_MS;
  const escalationTimeoutMs = options?.escalationTimeoutMs ?? DEFAULT_CHANNEL_ESCALATION_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_CHANNEL_CONVERGENCE_INTERVAL_MS;
  const logContext = { channel: storedChannelType, accountId: accountId ?? null };

  const pending = (async () => {
    logger.info('[gateway-refresh] mode=watcher result=channel_wait_started', logContext);

    // Phase 1: give the kernel's native watcher a brief window to apply the write.
    if (await pollUntilChannelConverged(
      gatewayManager, storedChannelType, accountId, intervalMs, Date.now() + watcherTimeoutMs,
    )) {
      logger.info('[gateway-refresh] mode=watcher result=channel_converged', logContext);
      return;
    }

    // Phase 2: watcher missed it — push deterministically via config.apply and re-poll.
    logger.info('[gateway-refresh] mode=escalate cause=watcher_timeout method=config.apply', logContext);
    await gatewayManager.applyConfigViaRpc();
    if (await pollUntilChannelConverged(
      gatewayManager, storedChannelType, accountId, intervalMs, Date.now() + escalationTimeoutMs,
    )) {
      logger.info('[gateway-refresh] mode=escalate result=channel_converged_after_escalation', logContext);
      return;
    }

    // Phase 3: still not connected — a new/updated channel plugin only loads on a
    // full Gateway (re)start, so schedule a restart and return optimistically.
    logger.warn('[gateway-refresh] mode=escalate result=escalate_restart cause=escalation_timeout', logContext);
    gatewayManager.debouncedRestart();
  })();

  managerPending.set(key, pending);
  try {
    await pending;
  } finally {
    if (managerPending.get(key) === pending) {
      managerPending.delete(key);
    }
  }
}

/**
 * Use only for config changes that genuinely require replacing the Gateway
 * process, such as Gateway server settings, plugin infrastructure changes, or
 * conservative destructive agent operations.
 */
export function scheduleGatewayProcessRestart(
  gatewayManager: GatewayRestartTarget | undefined,
  reason: string,
  options?: GatewayRefreshOptions,
): void {
  if (shouldSkip(gatewayManager, options)) return;
  logger.info(`${reason}; scheduling Gateway process restart`);
  gatewayManager!.debouncedRestart(options?.delayMs);
}
