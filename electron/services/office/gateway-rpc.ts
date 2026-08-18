import type { GatewayManager } from '../../gateway/manager';
import { ensureProjectAgentSessionNew, parseProjectIdFromOfficeSessionKey } from './office-session-new';
import {
  scheduleOfficeChatHistory,
  type ChatHistoryMessage,
  type FetchChatHistoryScheduleOptions,
} from './office-session-history-sync';
import {
  assertOfficeSpawnRpcDisabled,
  resolveAgentIdFromOfficeSessionKey,
  withOfficeSpawnToolDeny,
} from './office-spawn-policy';
import {
  registerOfficeInflightLlm,
  unregisterOfficeInflightLlm,
} from './office-inflight-llm-registry';
import { assertOfficeLlmSendAllowed } from './office-llm-send-guard';

export type OfficeAgentMessageOptions = {
  agentId?: string;
  projectId?: string;
  skipProjectSessionNew?: boolean;
  nodeId?: string;
};

export type OfficeSessionsSendParams = {
  sessionKey: string;
  message: string;
  targetSessionKey?: string;
  targetAgentId?: string;
  idempotencyKey?: string;
  projectId?: string;
  skipProjectSessionNew?: boolean;
  nodeId?: string;
};

export type { ChatHistoryMessage, FetchChatHistoryScheduleOptions };

type RpcResult = { runId?: string; status?: string; [key: string]: unknown };

function rememberInflightAfterSend(params: {
  projectId?: string;
  sessionKey: string;
  runId?: string;
  agentId?: string;
  nodeId?: string;
}): void {
  const projectId = params.projectId?.trim();
  const sessionKey = params.sessionKey.trim();
  if (!projectId || !sessionKey) return;
  registerOfficeInflightLlm({
    projectId,
    sessionKey,
    runId: params.runId,
    agentId: params.agentId,
    nodeId: params.nodeId,
  });
}

export function forgetOfficeInflightAfterSettle(
  projectId: string | undefined,
  sessionKey: string | undefined,
): void {
  const id = projectId?.trim();
  const key = sessionKey?.trim();
  if (!id || !key) return;
  unregisterOfficeInflightLlm(id, key);
}

export class OfficeRuntimeToolPolicyUnsupportedError extends Error {
  readonly code = 'OFFICE_RUNTIME_TOOL_POLICY_UNSUPPORTED' as const;

  constructor(message = '当前 Gateway 不支持 Office runtime tool policy，禁止运行 Office 项目') {
    super(message);
    this.name = 'OfficeRuntimeToolPolicyUnsupportedError';
  }
}

/** @deprecated Current embedded Gateway does not expose a runtime tool-policy capability RPC. */
export async function assertOfficeRuntimeToolPolicySupported(gateway: GatewayManager): Promise<void> {
  void gateway;
  return undefined;
}

/** Obsolete fallback variant / additionalProperties rejection — not a model runtime failure. */
export function isGatewayRpcParamShapeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Keep narrow: real AJV failures like sessionKey type errors must surface.
  return /unexpected property/i.test(msg);
}

/**
 * Prefer substantive runtime failures (rate-limit / quota / UNAVAILABLE) over
 * later param-shape INVALID_REQUEST from obsolete fallback variants.
 */
export function preferGatewayRpcError(current: Error | null, next: Error): Error {
  if (!current) return next;
  const currentShape = isGatewayRpcParamShapeError(current);
  const nextShape = isGatewayRpcParamShapeError(next);
  if (currentShape && !nextShape) return next;
  if (!currentShape && nextShape) return current;
  // Both substantive: keep quota/rate-limit over later method/transport noise.
  const currentQuota = isGatewayRpcQuotaOrRateLimitError(current);
  const nextQuota = isGatewayRpcQuotaOrRateLimitError(next);
  if (currentQuota && !nextQuota) return current;
  if (!currentQuota && nextQuota) return next;
  return next;
}

export function isGatewayRpcQuotaOrRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /rate[- ]?limit/i.test(msg)
    || /exceeded your current quota/i.test(msg)
    || /\b429\b/.test(msg)
    || /temporarily rate-limited/i.test(msg);
}

async function tryRpc(
  gateway: GatewayManager,
  methods: string[],
  paramsList: Record<string, unknown>[],
  timeoutMs = 120_000,
): Promise<unknown> {
  let lastError: Error | null = null;
  for (const method of methods) {
    for (const params of paramsList) {
      try {
        return await gateway.rpc(method, params, timeoutMs);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        lastError = preferGatewayRpcError(lastError, err);
      }
    }
  }
  throw lastError ?? new Error('RPC failed');
}

async function callAgentMessageDirect(
  gateway: GatewayManager,
  sessionKey: string,
  message: string,
  idempotencyKey?: string,
  options?: Pick<OfficeAgentMessageOptions, 'agentId' | 'projectId' | 'nodeId'>,
): Promise<RpcResult> {
  const projectId =
    options?.projectId?.trim() || parseProjectIdFromOfficeSessionKey(sessionKey);
  assertOfficeLlmSendAllowed(projectId);
  const agentId = options?.agentId?.trim() || resolveAgentIdFromOfficeSessionKey(sessionKey);
  return withOfficeSpawnToolDeny(agentId, async () => {
    const key = idempotencyKey ?? `office-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effectiveMessage = message;
    // Current Gateway chat.send / agent schemas require `sessionKey` and reject root `key`.
    // Keep deliver true/false as the only compatibility variants.
    const variants = [
      { sessionKey, message: effectiveMessage, idempotencyKey: key, deliver: true },
      { sessionKey, message: effectiveMessage, idempotencyKey: key, deliver: false },
    ];
    const result = await tryRpc(
      gateway,
      ['chat.send', 'agent'],
      variants,
    );
    const rpcResult = (result && typeof result === 'object' ? result : {}) as RpcResult;
    rememberInflightAfterSend({
      projectId,
      sessionKey,
      runId: typeof rpcResult.runId === 'string' ? rpcResult.runId : undefined,
      agentId,
      nodeId: options?.nodeId,
    });
    return rpcResult;
  });
}

export async function callAgentMessage(
  gateway: GatewayManager,
  sessionKey: string,
  message: string,
  idempotencyKey?: string,
  options?: OfficeAgentMessageOptions,
): Promise<RpcResult> {
  const projectId =
    options?.projectId?.trim() || parseProjectIdFromOfficeSessionKey(sessionKey);
  assertOfficeLlmSendAllowed(projectId);
  const agentId = options?.agentId?.trim() || resolveAgentIdFromOfficeSessionKey(sessionKey);
  await ensureProjectAgentSessionNew(
    gateway,
    {
      sessionKey,
      agentId,
      projectId: options?.projectId ?? projectId,
      skipProjectSessionNew: options?.skipProjectSessionNew,
      message,
    },
    (gw, key, text, idem, directOptions) =>
      callAgentMessageDirect(gw, key, text, idem, {
        ...directOptions,
        projectId: options?.projectId ?? projectId,
        nodeId: options?.nodeId,
      }),
  );
  // Re-assert after await: abort may have started during session-new.
  assertOfficeLlmSendAllowed(projectId);
  return callAgentMessageDirect(gateway, sessionKey, message, idempotencyKey, {
    agentId,
    projectId: options?.projectId ?? projectId,
    nodeId: options?.nodeId,
  });
}

/**
 * Deliver a handoff to another office session.
 * Uses `chat.send` on the target session (widely supported). Older gateways may
 * expose `sessions.send` / `sessions_send` for cross-session routing — tried only
 * when no explicit target session is provided.
 */
export async function sessionsSend(
  gateway: GatewayManager,
  params: OfficeSessionsSendParams,
): Promise<RpcResult> {
  const targetKey = params.targetSessionKey?.trim();
  const deliverKey = targetKey || params.sessionKey;
  const projectId =
    params.projectId?.trim()
    || parseProjectIdFromOfficeSessionKey(deliverKey)
    || parseProjectIdFromOfficeSessionKey(params.sessionKey);
  assertOfficeLlmSendAllowed(projectId);
  const key = params.idempotencyKey ?? `office-send-${Date.now()}`;
  const agentId =
    params.targetAgentId?.trim()
    || (targetKey ? resolveAgentIdFromOfficeSessionKey(targetKey) : resolveAgentIdFromOfficeSessionKey(params.sessionKey));

  await ensureProjectAgentSessionNew(
    gateway,
    {
      sessionKey: deliverKey,
      agentId,
      projectId: params.projectId ?? projectId,
      skipProjectSessionNew: params.skipProjectSessionNew,
      message: params.message,
    },
    (gw, key, text, idem, directOptions) =>
      callAgentMessageDirect(gw, key, text, idem, {
        ...directOptions,
        projectId: params.projectId ?? projectId,
      }),
  );

  assertOfficeLlmSendAllowed(projectId);
  return withOfficeSpawnToolDeny(agentId, async () => {
    if (targetKey) {
      return callAgentMessageDirect(gateway, targetKey, params.message, key, {
        agentId,
        projectId: params.projectId ?? projectId,
        nodeId: params.nodeId,
      });
    }

    const base = {
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: key,
    };
    const rawVariants: Record<string, unknown>[] = [];
    if (params.targetAgentId) {
      rawVariants.push({ ...base, agentId: params.targetAgentId });
    }
    rawVariants.push(base);
    const variants = rawVariants;

    try {
      const result = await tryRpc(gateway, ['sessions.send', 'sessions_send'], variants);
      const rpcResult = (result && typeof result === 'object' ? result : {}) as RpcResult;
      rememberInflightAfterSend({
        projectId,
        sessionKey: params.sessionKey,
        runId: typeof rpcResult.runId === 'string' ? rpcResult.runId : undefined,
        agentId,
        nodeId: params.nodeId,
      });
      return rpcResult;
    } catch {
      return callAgentMessageDirect(gateway, params.sessionKey, params.message, key, {
        agentId,
        projectId: params.projectId ?? projectId,
        nodeId: params.nodeId,
      });
    }
  });
}

/**
 * Office session history via sync controller: normal reads align to unified 3s ticks;
 * `urgent` flushes the session immediately (e.g. accept / post-run validation).
 */
export type GatewaySessionListRow = {
  key: string;
  status?: string;
  hasActiveRun?: boolean;
  updatedAt?: number;
};

function parseGatewaySessionListUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const SESSION_LIST_ROW_CACHE_MS = 2_000;
const sessionListRowCache = new Map<string, { atMs: number; row: GatewaySessionListRow | null }>();

/** @internal test helper */
export function clearGatewaySessionListRowCache(): void {
  sessionListRowCache.clear();
}

/** Bust cached row before success-settle verify (baseline / confirm). */
export function invalidateGatewaySessionListRowCache(sessionKey: string): void {
  sessionListRowCache.delete(sessionKey.trim());
}

/** Lookup one session row from Gateway `sessions.list` (Office idle reconcile, mirrors Chat UI). */
export async function fetchGatewaySessionListRow(
  gateway: GatewayManager,
  sessionKey: string,
): Promise<GatewaySessionListRow | null> {
  const trimmedKey = sessionKey.trim();
  if (!trimmedKey) return null;

  const now = Date.now();
  const cached = sessionListRowCache.get(trimmedKey);
  if (cached && now - cached.atMs < SESSION_LIST_ROW_CACHE_MS) {
    return cached.row;
  }

  try {
    const data = await gateway.rpc<{ sessions?: unknown[] }>('sessions.list', {
      includeDerivedTitles: false,
      includeLastMessage: false,
    });
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    for (const raw of sessions) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (key !== trimmedKey) continue;
      const parsed: GatewaySessionListRow = {
        key,
        status: typeof row.status === 'string' ? row.status.trim().toLowerCase() : undefined,
        hasActiveRun: typeof row.hasActiveRun === 'boolean' ? row.hasActiveRun : undefined,
        updatedAt: parseGatewaySessionListUpdatedAtMs(row.updatedAt ?? row.updated_at),
      };
      sessionListRowCache.set(trimmedKey, { atMs: now, row: parsed });
      return parsed;
    }
    sessionListRowCache.set(trimmedKey, { atMs: now, row: null });
    return null;
  } catch {
    return null;
  }
}

export async function fetchChatHistory(
  gateway: GatewayManager,
  sessionKey: string,
  limit = 80,
  options?: FetchChatHistoryScheduleOptions,
): Promise<{ messages: ChatHistoryMessage[] }> {
  const { isOfficeUnifiedPollingActive } = await import('./office-sync-runtime');
  if (options?.urgent === true || isOfficeUnifiedPollingActive()) {
    return scheduleOfficeChatHistory(gateway, sessionKey, limit, options);
  }
  const { fetchOfficeChatHistoryDirect } = await import('./office-session-history-sync');
  return fetchOfficeChatHistoryDirect(gateway, sessionKey, limit);
}

export async function sessionsSpawn(
  gateway: GatewayManager,
  params: {
    sessionKey: string;
    task: string;
    agentId?: string;
    taskName?: string;
  },
): Promise<RpcResult> {
  void gateway;
  void params;
  assertOfficeSpawnRpcDisabled();
}
