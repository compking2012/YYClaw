/**
 * Load OpenClaw on-disk session `.jsonl` for office workflow settle.
 *
 * Gateway `chat.history` is windowed (legacy 80 / settle 200). Long tool chains can
 * drop the dispatch user turn, which blocks `requireFreshUserTurn` and history
 * reconcile. The local transcript is complete and is the authoritative fallback
 * for the dispatch user — but a lagging on-disk tail must still be merged with a
 * fresher Gateway window that already holds the final workflow JSON.
 */
import { promises as fsP } from 'node:fs';
import { join } from 'node:path';
import type { GatewayManager } from '../../gateway/manager';
import { resolveOpenClawStateDir } from '../../utils/paths';
import { resolveSessionTranscriptPath } from '../../utils/session-files';
import { parseTranscriptMessages } from '../../utils/session-summary';
import { isRealUserMessage } from '../../../src/lib/office-session-final-mirror';
import { fetchChatHistory, type FetchChatHistoryScheduleOptions } from './gateway-rpc';

/** Prefer a generous window when falling back to Gateway `chat.history`. */
export const OFFICE_WORKFLOW_SETTLE_CHAT_HISTORY_LIMIT = 200;

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type OfficeSessionHistoryMessage = Record<string, unknown>;

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1] || '';
  return SAFE_SESSION_SEGMENT.test(agentId) ? agentId : null;
}

/** Same rules as `normalizeOfficeTimestampMs` in run-completion (kept local to avoid import cycles). */
export function normalizeTranscriptTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === 'string') {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum > 1e12 ? asNum : asNum * 1000;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function messageTimestampMs(message: OfficeSessionHistoryMessage): number {
  return normalizeTranscriptTimestampMs(
    message.timestamp ?? message.createdAt ?? message.ts,
  );
}

/**
 * Fresh-user probe aligned with `hasTriggeringUserTurnAfter`:
 * inspect the **latest** real user only — do not keep scanning older users.
 */
export function transcriptHasDispatchUserTurn(
  messages: OfficeSessionHistoryMessage[],
  startedAtMs: number,
): boolean {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    const ts = messageTimestampMs(msg);
    if (ts === 0) return true; // undated latest user — same as turn-gate undated_match
    return ts >= startedAtMs;
  }
  return false;
}

function isToolResultRole(role: unknown): boolean {
  return role === 'toolResult' || role === 'tool' || role === 'tool_result';
}

/** Tail still looks mid-tool (local flush lag common right after run.ended). */
export function transcriptTailLooksInFlight(messages: OfficeSessionHistoryMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (isToolResultRole(last.role)) return true;
  if (last.role !== 'assistant') return false;
  const content = last.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const hasToolUse = content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const type = (block as { type?: string }).type;
    return type === 'toolUse' || type === 'tool_use' || type === 'toolCall';
  });
  const hasText = content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const row = block as { type?: string; text?: unknown };
    return row.type === 'text' && typeof row.text === 'string' && row.text.trim().length > 0;
  });
  return hasToolUse && !hasText;
}

/** Minimal workflow-JSON shape check (mirrors settle `isWorkflowJsonOutput`, no import cycle). */
export function transcriptHasWorkflowJsonAfter(
  messages: OfficeSessionHistoryMessage[],
  startedAtMs: number,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    const ts = messageTimestampMs(msg);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    const text = extractAssistantText(msg);
    if (!text) continue;
    if (looksLikeWorkflowJsonOutput(text)) return true;
  }
  return false;
}

function extractAssistantText(message: OfficeSessionHistoryMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const row = block as { type?: string; text?: unknown };
    if (row.type === 'text' && typeof row.text === 'string') parts.push(row.text);
  }
  return parts.join('').trim();
}

function looksLikeWorkflowJsonOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const body = (() => {
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    if (fence?.[1]) return fence[1].trim();
    return trimmed;
  })();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return false;
  const slice = body.slice(start, end + 1);
  return (
    /"role"\s*:/u.test(slice)
    && /"step"\s*:/u.test(slice)
    && /"inputValidation"\s*:/u.test(slice)
    && /"execution"\s*:/u.test(slice)
    && /"outputValidation"\s*:/u.test(slice)
    && /"deliverable"\s*:/u.test(slice)
    && /"rollback"\s*:/u.test(slice)
  );
}

/**
 * Keep local prefix (dispatch user + early tools) and append Gateway tail so a
 * truncated `chat.history` window can still settle after the user was pushed out.
 *
 * When the dispatch user is undated (or otherwise dropped by the time-aligned
 * prefix filter), re-attach the latest local user that still opens the turn so
 * `requireFreshUserTurn` can succeed on the merged history.
 */
export function mergeLocalPrefixWithGatewayTail(
  localMessages: OfficeSessionHistoryMessage[],
  gatewayMessages: OfficeSessionHistoryMessage[],
  startedAtMs?: number,
): OfficeSessionHistoryMessage[] {
  const local = Array.isArray(localMessages) ? localMessages : [];
  const gateway = Array.isArray(gatewayMessages) ? gatewayMessages : [];
  if (local.length === 0) return gateway;
  if (gateway.length === 0) return local;

  let gatewayFirstTs = 0;
  for (const msg of gateway) {
    const ts = messageTimestampMs(msg);
    if (ts > 0) {
      gatewayFirstTs = ts;
      break;
    }
  }
  if (gatewayFirstTs <= 0) {
    // Cannot align on time — keep local (has user) and do not invent duplicates.
    return local;
  }

  const prefix = local.filter((msg) => {
    const ts = messageTimestampMs(msg);
    // Drop undated local rows from the time-aligned prefix: they cannot be
    // ordered vs Gateway. Fresh undated users are re-attached below when needed.
    return ts > 0 && ts < gatewayFirstTs;
  });
  const merged = prefix.length > 0 ? [...prefix, ...gateway] : [...gateway];

  if (startedAtMs == null || transcriptHasDispatchUserTurn(merged, startedAtMs)) {
    return merged;
  }

  // Prefix filter may have dropped an undated (or borderline) dispatch user.
  for (let i = local.length - 1; i >= 0; i--) {
    const msg = local[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    const ts = messageTimestampMs(msg);
    if (ts === 0 || ts >= startedAtMs) {
      if (!merged.includes(msg)) return [msg, ...merged];
      return merged;
    }
    return merged;
  }
  return merged;
}

function normalizeTranscriptMessage(message: {
  role?: string;
  content?: unknown;
  timestamp?: number | string;
  createdAt?: number | string;
  ts?: number | string;
  stopReason?: unknown;
  toolCallId?: unknown;
  tool_call_id?: unknown;
  toolName?: unknown;
}): OfficeSessionHistoryMessage {
  const toolCallId = message.toolCallId ?? message.tool_call_id;
  const timestampMs = normalizeTranscriptTimestampMs(
    message.timestamp ?? message.createdAt ?? message.ts,
  );
  return {
    role: message.role,
    content: message.content,
    ...(timestampMs > 0 ? { timestamp: timestampMs } : {}),
    stopReason: message.stopReason,
    toolCallId,
    tool_call_id: toolCallId,
    toolName: message.toolName,
  };
}

async function tryReadSessionsJson(
  agentsRoot: string,
  agentId: string,
): Promise<{ sessionsDir: string; sessionsJson: Record<string, unknown> } | null> {
  if (!SAFE_SESSION_SEGMENT.test(agentId)) return null;
  const sessionsDir = join(agentsRoot, agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  try {
    const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
    const sessionsJson = JSON.parse(raw) as unknown;
    if (!sessionsJson || typeof sessionsJson !== 'object' || Array.isArray(sessionsJson)) {
      return null;
    }
    return { sessionsDir, sessionsJson: sessionsJson as Record<string, unknown> };
  } catch {
    return null;
  }
}

function sessionsJsonHasKey(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
): boolean {
  if (!sessionsJson || typeof sessionsJson !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(sessionsJson, sessionKey)) return true;
  if (Array.isArray(sessionsJson.sessions)) {
    return sessionsJson.sessions.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const row = entry as Record<string, unknown>;
      return row.key === sessionKey || row.sessionKey === sessionKey;
    });
  }
  return false;
}

/**
 * Resolve `sessionKey` → absolute `.jsonl` path via `sessions.json`
 * (preferred agent dir, then scan all agents — same as sessions-api delete path).
 */
export async function resolveOfficeSessionTranscriptPath(
  sessionKey: string,
): Promise<string | null> {
  const preferredAgentId = parseAgentIdFromSessionKey(sessionKey);
  if (!preferredAgentId) return null;

  const agentsRoot = join(resolveOpenClawStateDir(), 'agents');

  const tryResolve = async (agentId: string): Promise<string | null> => {
    const store = await tryReadSessionsJson(agentsRoot, agentId);
    if (!store) return null;
    if (!sessionsJsonHasKey(store.sessionsJson, sessionKey)) return null;
    const sessionsJson = Array.isArray(store.sessionsJson.sessions)
      ? {
          ...store.sessionsJson,
          sessions: store.sessionsJson.sessions.filter(
            (entry) => Boolean(entry) && typeof entry === 'object',
          ),
        }
      : store.sessionsJson;
    let resolved: ReturnType<typeof resolveSessionTranscriptPath>;
    try {
      resolved = resolveSessionTranscriptPath(sessionsJson, store.sessionsDir, sessionKey);
    } catch {
      return null;
    }
    if (!resolved.ok) return null;
    try {
      await fsP.access(resolved.resolvedSrcPath);
      return resolved.resolvedSrcPath;
    } catch {
      return null;
    }
  };

  const preferred = await tryResolve(preferredAgentId);
  if (preferred) return preferred;

  let agentDirs: string[];
  try {
    agentDirs = await fsP.readdir(agentsRoot);
  } catch {
    return null;
  }
  for (const agentId of agentDirs) {
    if (agentId === preferredAgentId) continue;
    const found = await tryResolve(agentId);
    if (found) return found;
  }
  return null;
}

/** Read the full on-disk transcript for `sessionKey` (all `type:message` rows). */
const transcriptPathCache = new Map<string, string | null>();
const transcriptContentCache = new Map<string, {
  mtimeMs: number;
  size: number;
  messages: OfficeSessionHistoryMessage[];
}>();

/** Test-only: clear path/content caches between cases. */
export function clearOfficeSessionTranscriptCachesForTests(): void {
  transcriptPathCache.clear();
  transcriptContentCache.clear();
}

export async function loadOfficeSessionTranscriptMessages(
  sessionKey: string,
): Promise<OfficeSessionHistoryMessage[] | null> {
  let transcriptPath: string | null;
  if (transcriptPathCache.has(sessionKey)) {
    transcriptPath = transcriptPathCache.get(sessionKey) ?? null;
  } else {
    transcriptPath = await resolveOfficeSessionTranscriptPath(sessionKey);
    transcriptPathCache.set(sessionKey, transcriptPath);
  }
  if (!transcriptPath) return null;
  try {
    const stat = await fsP.stat(transcriptPath);
    const cached = transcriptContentCache.get(transcriptPath);
    if (
      cached
      && cached.mtimeMs === stat.mtimeMs
      && cached.size === stat.size
    ) {
      return cached.messages;
    }
    const raw = await fsP.readFile(transcriptPath, 'utf8');
    const messages = parseTranscriptMessages(raw).map((message) => normalizeTranscriptMessage(message));
    transcriptContentCache.set(transcriptPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      messages,
    });
    return messages;
  } catch {
    transcriptPathCache.delete(sessionKey);
    if (transcriptPath) transcriptContentCache.delete(transcriptPath);
    return null;
  }
}

export type WorkflowSettleHistorySource = 'local' | 'gateway' | 'merged';

/**
 * Choose settle history:
 * 1. Gateway already has dispatch user + conclusive JSON → prefer live window
 * 2. Local complete (user + JSON, not mid-tool) → local (covers Gateway truncation)
 * 3. Local has user but Gateway has fresher final JSON (local tail in-flight) → merge
 * 4. Both have user → prefer the side with conclusive JSON
 * 5. Else whichever still has the dispatch user
 * 6. Else non-empty Gateway, then local
 */
export function selectWorkflowSettleHistory(
  localMessages: OfficeSessionHistoryMessage[],
  gatewayMessages: OfficeSessionHistoryMessage[],
  startedAtMs?: number,
): { messages: OfficeSessionHistoryMessage[]; source: WorkflowSettleHistorySource } {
  const local = Array.isArray(localMessages) ? localMessages : [];
  const gateway = Array.isArray(gatewayMessages) ? gatewayMessages : [];

  if (startedAtMs != null) {
    const localHasUser = transcriptHasDispatchUserTurn(local, startedAtMs);
    const gatewayHasUser = transcriptHasDispatchUserTurn(gateway, startedAtMs);
    const localInFlight = transcriptTailLooksInFlight(local);
    const gatewayInFlight = transcriptTailLooksInFlight(gateway);
    const localHasJson = transcriptHasWorkflowJsonAfter(local, startedAtMs);
    const gatewayHasJson = transcriptHasWorkflowJsonAfter(gateway, startedAtMs);

    // Live Gateway window is complete — prefer it (also keeps UTs that mock chat.history
    // from being overridden by a coincidental on-disk transcript for the same sessionKey).
    if (gatewayHasUser && gatewayHasJson && !gatewayInFlight) {
      return { messages: gateway, source: 'gateway' };
    }

    if (localHasUser && localHasJson && !localInFlight) {
      return { messages: local, source: 'local' };
    }

    // Local kept the dispatch user; Gateway window has the final JSON but lost the user.
    if (localHasUser && !gatewayHasUser && gatewayHasJson && (localInFlight || !localHasJson)) {
      return {
        messages: mergeLocalPrefixWithGatewayTail(local, gateway, startedAtMs),
        source: 'merged',
      };
    }

    // Both have the user — prefer the side that already has a conclusive JSON tail.
    if (localHasUser && gatewayHasUser) {
      if (gatewayHasJson && (localInFlight || !localHasJson)) {
        return { messages: gateway, source: 'gateway' };
      }
      if (localHasJson) {
        return { messages: local, source: 'local' };
      }
      return { messages: gateway, source: 'gateway' };
    }

    if (gatewayHasUser) {
      return { messages: gateway, source: 'gateway' };
    }

    if (localHasUser) {
      // Truncated Gateway; wait for local flush on subsequent polls.
      return { messages: local, source: 'local' };
    }
  }

  if (gateway.length > 0) {
    return { messages: gateway, source: 'gateway' };
  }
  if (local.length > 0) {
    return { messages: local, source: 'local' };
  }
  return { messages: [], source: 'gateway' };
}

/**
 * History for workflow settle / structured-reply acceptance.
 *
 * - If Gateway still has the dispatch user → use Gateway immediately (no disk I/O).
 *   Truncation is the only reason to open the on-disk transcript; narration-only /
 *   format-retry / terminal-error paths must not block on filesystem reads.
 * - If Gateway lost the dispatch user → load local `.jsonl` and merge/select.
 */
export async function fetchWorkflowSettleChatHistory(
  gateway: GatewayManager,
  sessionKey: string,
  options?: FetchChatHistoryScheduleOptions & { startedAtMs?: number },
): Promise<{ messages: OfficeSessionHistoryMessage[]; source: WorkflowSettleHistorySource }> {
  const startedAtMs = options?.startedAtMs;
  const scheduleOpts: FetchChatHistoryScheduleOptions | undefined =
    options?.urgent === undefined ? undefined : { urgent: options.urgent };

  let gatewayMessages: OfficeSessionHistoryMessage[];
  try {
    const history = await fetchChatHistory(
      gateway,
      sessionKey,
      OFFICE_WORKFLOW_SETTLE_CHAT_HISTORY_LIMIT,
      scheduleOpts,
    );
    gatewayMessages = Array.isArray(history?.messages)
      ? history.messages as OfficeSessionHistoryMessage[]
      : [];
  } catch {
    gatewayMessages = [];
  }

  // Gateway retained the dispatch user (or startedAt unknown): trust the live window.
  if (
    startedAtMs == null
    || transcriptHasDispatchUserTurn(gatewayMessages, startedAtMs)
  ) {
    return { messages: gatewayMessages, source: 'gateway' };
  }

  // Gateway window truncated past the dispatch user — need the on-disk transcript.
  const local = (await loadOfficeSessionTranscriptMessages(sessionKey)) ?? [];
  return selectWorkflowSettleHistory(local, gatewayMessages, startedAtMs);
}
