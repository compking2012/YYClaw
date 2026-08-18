import { isOfficeSessionKey } from '../../../shared/office-session';
import type { GatewayManager } from '../../gateway/manager';
import { isRealUserMessage } from '../../../src/lib/office-session-final-mirror';
import { fetchOfficeChatHistoryDirect } from './office-session-history-sync';
import {
  clearProjectSessionNewInFlight,
  getProjectAgentNewLedgerEpoch,
  getProjectSessionNewInFlight,
  hasProjectSessionNewSent,
  markProjectSessionNewSent,
  setProjectSessionNewInFlight,
} from './office-session-new-ledger';
import { sleepAbortable } from './run-completion';

export const OFFICE_SESSION_NEW_COMMAND = '/new';
export const OFFICE_SESSION_NEW_RESET_POLL_MS = 500;
export const OFFICE_SESSION_NEW_RESET_DEADLINE_MS = 30_000;

type RawMsg = Record<string, unknown>;

export type EnsureProjectAgentSessionNewParams = {
  sessionKey: string;
  agentId: string;
  projectId?: string;
  skipProjectSessionNew?: boolean;
  message?: string;
  signal?: AbortSignal;
};

export type CallAgentMessageDirect = (
  gateway: GatewayManager,
  sessionKey: string,
  message: string,
  idempotencyKey?: string,
  options?: { agentId?: string },
) => Promise<{ runId?: string; status?: string; [key: string]: unknown }>;

export function parseProjectIdFromOfficeSessionKey(sessionKey: string): string | undefined {
  const key = sessionKey.trim();
  const taskMatch = key.match(/:office:task:([^:]+):/);
  if (taskMatch?.[1]) return taskMatch[1];
  const roomMatch = key.match(/:office:task-room:([^:]+)(?:$|:)/);
  if (roomMatch?.[1]) return roomMatch[1];
  const dmTaskMatch = key.match(/:office:role:[^:]+:dm:task-([^:]+)$/);
  if (dmTaskMatch?.[1]) return dmTaskMatch[1];
  return undefined;
}

export function isOfficeP2PSessionKey(sessionKey: string): boolean {
  return /:office:p2p:/.test(sessionKey.trim());
}

export function normalizeOfficeSessionMessageText(message: string | undefined): string {
  return (message ?? '').replace(/\s+/g, ' ').trim();
}

/** Room mirror / announce lines are not business LLM dispatches. */
export function shouldSkipProjectSessionNewForMessage(message: string | undefined): boolean {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) return false;
  if (trimmed.startsWith('[Room]')) return true;
  if (normalizeOfficeSessionMessageText(trimmed) === OFFICE_SESSION_NEW_COMMAND) return true;
  return false;
}

function extractUserTurnText(msg: RawMsg): string {
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const b = block as Record<string, unknown>;
        if (typeof b.text === 'string') return b.text;
        if (typeof b.content === 'string') return b.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.message === 'string') return msg.message;
  return '';
}

function normalizeUserTurnText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function userTurnIsNewCommand(msg: RawMsg): boolean {
  const text = normalizeUserTurnText(extractUserTurnText(msg));
  return text === OFFICE_SESSION_NEW_COMMAND;
}

function messageTimestampMs(msg: RawMsg): number {
  const raw = msg.timestamp ?? msg.createdAt ?? msg.ts;
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

export function historyShowsNewCommandAfter(
  messages: RawMsg[],
  sendStartedAtMs: number,
): boolean {
  for (const msg of messages) {
    if (!msg || !isRealUserMessage(msg)) continue;
    if (!userTurnIsNewCommand(msg)) continue;
    const ts = messageTimestampMs(msg);
    if (ts > 0 && ts >= sendStartedAtMs - 2_000) return true;
  }
  return false;
}

export function sessionNewLog(
  tag: string,
  detail: Record<string, string | boolean | number | undefined>,
): void {
  const tail = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.info(`[office] session-new:${tag}${tail ? ` ${tail}` : ''}`);
}

async function waitForSessionNewCommandRecorded(
  gateway: GatewayManager,
  sessionKey: string,
  sendStartedAtMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + OFFICE_SESSION_NEW_RESET_DEADLINE_MS;
  let pollCount = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    pollCount += 1;
    try {
      const history = await fetchOfficeChatHistoryDirect(gateway, sessionKey, 40);
      if (historyShowsNewCommandAfter(history.messages, sendStartedAtMs)) {
        sessionNewLog('reset-observed', { sessionKey, pollCount });
        return true;
      }
    } catch (e) {
      sessionNewLog('reset-poll-error', {
        sessionKey,
        pollCount,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleepAbortable(OFFICE_SESSION_NEW_RESET_POLL_MS, signal);
  }
  sessionNewLog('reset-timeout', { sessionKey, pollCount });
  return false;
}

async function sendProjectSessionNewOnce(
  gateway: GatewayManager,
  params: EnsureProjectAgentSessionNewParams & { projectId: string },
  callDirect: CallAgentMessageDirect,
): Promise<void> {
  const { projectId, agentId, sessionKey } = params;
  const ledgerEpochAtStart = getProjectAgentNewLedgerEpoch(projectId);
  if (hasProjectSessionNewSent(projectId, sessionKey)) return;

  const sendStartedAtMs = Date.now();
  const idempotencyKey = `office-new-${projectId}-${sendStartedAtMs}`;
  sessionNewLog('send-start', { projectId, agentId, sessionKey });

  try {
    await callDirect(
      gateway,
      sessionKey,
      OFFICE_SESSION_NEW_COMMAND,
      idempotencyKey,
      { agentId },
    );
  } catch (e) {
    console.warn(
      `[office] session-new:send-failed projectId=${projectId} agentId=${agentId} sessionKey=${sessionKey}`,
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  const resetObserved = await waitForSessionNewCommandRecorded(
    gateway,
    sessionKey,
    sendStartedAtMs,
    params.signal,
  );
  if (!resetObserved) {
    console.warn(
      `[office] session-new:reset-not-confirmed projectId=${projectId} agentId=${agentId} sessionKey=${sessionKey}`,
    );
    return;
  }

  if (getProjectAgentNewLedgerEpoch(projectId) !== ledgerEpochAtStart) {
    sessionNewLog('mark-skipped-ledger-cleared', { projectId, agentId, sessionKey });
    return;
  }

  markProjectSessionNewSent(projectId, sessionKey);
  sessionNewLog('marked-sent', { projectId, agentId, sessionKey });
}

export async function ensureProjectAgentSessionNew(
  gateway: GatewayManager,
  params: EnsureProjectAgentSessionNewParams,
  callDirect: CallAgentMessageDirect,
): Promise<void> {
  if (params.skipProjectSessionNew) return;
  if (shouldSkipProjectSessionNewForMessage(params.message)) return;
  if (!isOfficeSessionKey(params.sessionKey)) return;
  if (isOfficeP2PSessionKey(params.sessionKey)) return;

  const agentId = params.agentId.trim();
  if (!agentId) return;

  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) return;

  const projectId = params.projectId?.trim() || parseProjectIdFromOfficeSessionKey(sessionKey);
  if (!projectId) return;

  if (hasProjectSessionNewSent(projectId, sessionKey)) return;

  const existing = getProjectSessionNewInFlight(projectId, sessionKey);
  if (existing) {
    await existing.catch(() => undefined);
    return;
  }

  const work = sendProjectSessionNewOnce(gateway, { ...params, projectId, sessionKey }, callDirect);
  setProjectSessionNewInFlight(projectId, sessionKey, work);
  try {
    await work;
  } finally {
    clearProjectSessionNewInFlight(projectId, sessionKey);
  }
}
