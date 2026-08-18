import { mentionDispatchLog } from './mention-dispatch-log';
import type { GatewayManager } from '../../gateway/manager';
import {
  enrichMessagesForRoomMirror,
  sanitizeChatHistoryMessages,
} from '../../../src/lib/office-session-attachments';
import {
  collectFinalRoomMirrorText,
  extractDeliverableStatusFromThinking,
  extractFinalAssistantRoomMirror,
  extractStructuredReplyFromAssistantMessage,
  findLatestMentionStructuredRaw,
  extractWorkflowStructuredFromAssistantMessage,
  isRealUserMessage,
} from '../../../src/lib/office-session-final-mirror';
import { fetchChatHistory } from './gateway-rpc';
import { fetchWorkflowSettleChatHistory } from './office-session-transcript';
import { normalizeGatewayChatRuntimeEvent } from '../../gateway/chat-runtime-events';
import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';
import type { OfficeRuntimeToolSnapshot } from '../../../shared/session-turn-evidence';
import { isUnmirroredRoomSnippet } from './room-mention-reply-policy';
import {
  officeWorkflowBareRunTail,
  officeWorkflowNodeScopeSuffix,
} from '../../../src/lib/office-workflow-dispatch-run';
import {
  classifyOfficeRunTrackerTerminalError,
  joinOfficeRunTerminalAssistantTexts,
} from './gateway-run-error';
import {
  SESSION_STABILITY_INITIAL_DELAY_MS,
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  canAcceptStableSessionReply,
  captureOfficeSettleBaseline,
  createOfficeRunTracker,
  evaluateOfficeTurnStillInProgress,
  fetchStableSessionReplyText,
  isGatewayRunTerminalSignal,
  isOfficeRunProtocolDischarged,
  isOfficeRunSettleGateOpen,
  OfficeRuntimeToolTracker,
  sleepAbortable,
  tryReconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunFromWorkflowHistory,
  tryHandoffWorkflowSettleSyntaxParseFailure,
  shouldUseWorkflowSettleFastPath,
  verifyOfficeSessionAllowsSuccessSettle,
  resetOfficeSettleCaptureState,
  type OfficeRunTracker,
} from './session-run-settle';
import {
  getOrCreateOfficeSettleTracker,
  releaseOfficeSettleTracker,
} from './office-settle-tracker-registry';
import {
  logOfficeGatewaySettle,
  logOfficeGatewayLifecycleRunIdMismatch,
  officeSettleGateStateDetail,
} from './office-settle-gate-log';

export { OFFICE_SETTLE_CONSISTENCY_DELAY_MS as SESSION_POST_FINAL_FETCH_DELAY_MS } from './session-run-settle';
export { sleepAbortable } from './session-run-settle';

export interface WaitForSessionReplyOptions {
  sessionKey: string;
  startedAtMs: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  runId?: string;
  /** When history rows lack timestamps, use the latest assistant line (room @mention mirror). */
  allowUndatedFallback?: boolean;
  /** Require a user turn at/after `startedAtMs` before accepting assistant text (room @mention). */
  requireFreshUserTurn?: boolean;
  /** Minimum ms after `startedAtMs` before accepting assistant text when `requireFreshUserTurn`. */
  minWaitBeforeAcceptMs?: number;
  /** Called with latest assistant text while the run is in progress (streaming / polling). */
  onPartialReply?: (text: string) => void;
  /** Workflow node: wait for 【任务理解】+【交付产物】，忽略目录探查等中间 narration。 */
  requireWorkflowStructuredReply?: boolean;
  /** When true, abort wait early (e.g. room heal claimed the node). */
  shouldAbortWait?: () => boolean;
  /**
   * Reuse one {@link OfficeRunTracker} across wait + recovery for the same dispatch.
   * When omitted, a fresh tracker is created per wait.
   */
  settleTrackerKey?: string;
}

export interface WaitForSessionReplyResult {
  completed: boolean;
  assistantText?: string;
  timedOut?: boolean;
  error?: string;
  peerClaimed?: boolean;
  terminalErrorEnded?: boolean;
  terminalError?: string;
  gatewayTerminalErrorKind?: import('./gateway-run-error').GatewayRunTerminalErrorKind;
}

type RawMsg = Record<string, unknown>;

/** OpenClaw may use Unix seconds or milliseconds. */
export function normalizeOfficeTimestampMs(raw: unknown): number {
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

/** @deprecated Use {@link extractDeliverableStatusFromThinking} */
export const extractPublicReplyFromThinking = extractDeliverableStatusFromThinking;

/** Final visible assistant outcome for one history row (no thinking / tool steps). */
export function extractRoomMirrorTextFromAssistantMessage(msg: RawMsg): string {
  return extractFinalAssistantRoomMirror(msg);
}

export function extractTextFromOfficeMessage(msg: RawMsg): string {
  return extractRoomMirrorTextFromAssistantMessage(msg);
}

/** Final outcomes per run segment after the triggering user message. */
export function collectAssistantRoomMirrorText(
  messages: RawMsg[],
  startedAtMs: number,
): string {
  return collectFinalRoomMirrorText(messages, startedAtMs, normalizeOfficeTimestampMs);
}

function isInternalAssistantText(text: string): boolean {
  return /^(HEARTBEAT_OK|NO_REPLY)\s*$/i.test(text.trim());
}

function messageTimestamp(msg: RawMsg): number {
  return normalizeOfficeTimestampMs(msg.timestamp ?? msg.createdAt ?? msg.ts);
}

function normalizeUserTurnText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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

function userTurnMatchesExpectedMessage(msg: RawMsg, expectedMessage?: string): boolean {
  const expected = normalizeUserTurnText(expectedMessage ?? '');
  if (!expected) return true;
  const actual = normalizeUserTurnText(extractUserTurnText(msg));
  if (!actual) return false;
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}

/**
 * When history rows lack timestamps, take the assistant reply after the latest user
 * turn that belongs to this run (avoids picking stale assistant lines).
 */
export function findAssistantAfterCurrentUserTurn(
  messages: RawMsg[],
  startedAtMs: number,
): string | null {
  const combined = collectAssistantRoomMirrorText(messages, startedAtMs);
  return combined || null;
}

export function findLatestAssistantAfter(
  messages: RawMsg[],
  startedAtMs: number,
  opts?: { allowUndatedFallback?: boolean },
): string | null {
  const safe = sanitizeChatHistoryMessages(messages);
  const combined = collectAssistantRoomMirrorText(safe, startedAtMs);
  if (combined) return combined;

  let best = '';
  let bestTs = 0;
  for (const msg of safe) {
    if (msg.role !== 'assistant') continue;
    const ts = messageTimestamp(msg);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    if (ts === 0) continue;
    const text = extractFinalAssistantRoomMirror(msg);
    if (!text || isInternalAssistantText(text)) continue;
    if (ts >= bestTs) {
      bestTs = ts;
      best = text;
    }
  }
  if (best) return best;

  if (!opts?.allowUndatedFallback) return null;

  return findAssistantAfterCurrentUserTurn(safe, startedAtMs);
}

export type ParsedGatewayChatEvent = {
  sessionKey?: string;
  state?: string;
  runId?: string;
  phase?: string;
  status?: string;
  finalStatus?: string;
  terminalError?: string;
  /** lifecycle `data.error` / run.ended error message */
  runError?: string;
  assistantTexts?: string[];
  message?: RawMsg;
};

function readStringField(...values: unknown[]): string | undefined {
  const found = values.find((v) => typeof v === 'string' && v.trim());
  return found == null ? undefined : String(found);
}

function readStringArrayField(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const out = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    if (out.length > 0) return out;
  }
  return undefined;
}

/** Unwrap `{ message: { sessionKey, state, message } }` from gateway chat / agent events. */
export function parseGatewayChatEnvelope(data: { message?: unknown }): ParsedGatewayChatEvent {
  const outer = data?.message;
  if (!outer || typeof outer !== 'object') return {};
  const o = outer as Record<string, unknown>;

  const nestedMessage = o.message;
  const hasEnvelope =
    typeof o.sessionKey === 'string' ||
    typeof o.state === 'string' ||
    o.phase != null ||
    (nestedMessage && typeof nestedMessage === 'object');

  if (hasEnvelope && nestedMessage && typeof nestedMessage === 'object') {
    const dataObj =
      o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {};
    return {
      sessionKey:
        typeof o.sessionKey === 'string'
          ? o.sessionKey
          : typeof dataObj.sessionKey === 'string'
            ? dataObj.sessionKey
            : undefined,
      state: typeof o.state === 'string' ? o.state : typeof dataObj.state === 'string' ? dataObj.state : undefined,
      runId: o.runId != null ? String(o.runId) : dataObj.runId != null ? String(dataObj.runId) : undefined,
      phase:
        typeof o.phase === 'string'
          ? o.phase
          : typeof dataObj.phase === 'string'
            ? dataObj.phase
            : undefined,
      status: readStringField(o.status, dataObj.status),
      finalStatus: readStringField(o.finalStatus, dataObj.finalStatus),
      terminalError: readStringField(o.terminalError, dataObj.terminalError, o.error, dataObj.error),
      runError: readStringField(o.error, dataObj.error),
      assistantTexts: readStringArrayField(o.assistantTexts, dataObj.assistantTexts),
      message: nestedMessage as RawMsg,
    };
  }

  if (o.role) {
    return { message: o as RawMsg };
  }

  return { message: o as RawMsg };
}

function readGatewayAgentNotificationAssistantTexts(
  p: Record<string, unknown>,
  dataObj: Record<string, unknown>,
): string[] | undefined {
  const fromField = readStringArrayField(p.assistantTexts, dataObj.assistantTexts);
  if (fromField) return fromField;
  return undefined;
}

/** 从 agent/chat notification params 解析 Office run 事件字段。 */
export function parseGatewayAgentNotificationEvent(
  params: unknown,
  _sessionKey: string,
): ParsedGatewayChatEvent {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const dataObj =
    p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const phaseRaw = p.phase ?? dataObj.phase;
  const phase =
    typeof phaseRaw === 'string'
      ? phaseRaw
      : extractAgentPhase(params);
  return {
    sessionKey: extractSessionKeyFromPayload(params),
    state: String(p.state ?? dataObj.state ?? ''),
    phase: typeof phase === 'string' ? phase : undefined,
    runId: p.runId ?? dataObj.runId != null ? String(p.runId ?? dataObj.runId) : undefined,
    status: readStringField(p.status, dataObj.status),
    finalStatus: readStringField(p.finalStatus, dataObj.finalStatus),
    terminalError: readStringField(p.terminalError, dataObj.terminalError, p.error, dataObj.error),
    runError: readStringField(p.error, dataObj.error),
    assistantTexts: readGatewayAgentNotificationAssistantTexts(p, dataObj),
    message: (p.message ?? dataObj.message) as RawMsg | undefined,
  };
}

export function applyOfficeRunTerminalAssistantMessage(
  tracker: OfficeRunTracker,
  message: RawMsg | undefined,
): void {
  if (!message || message.role !== 'assistant') return;
  const stopReason = String(message.stopReason ?? message.stop_reason ?? '').trim().toLowerCase();
  if (stopReason !== 'error') return;

  const errorMessage = readStringField(message.errorMessage, message.error_message);
  const text = extractTextFromOfficeMessage(message).trim();
  tracker.runComplete = true;
  tracker.pendingRetry = false;
  tracker.terminalErrorEnded = true;
  tracker.terminalError = errorMessage;
  tracker.terminalAssistantTexts = text ? [text] : [];
}

function finishOfficeRunTerminalErrorWithText(
  tracker: OfficeRunTracker,
  assistantText: string,
  finish: (result: WaitForSessionReplyResult) => void,
): void {
  const classified = classifyOfficeRunTrackerTerminalError(tracker);
  finish({
    completed: true,
    assistantText,
    terminalErrorEnded: true,
    terminalError: tracker.terminalError,
    gatewayTerminalErrorKind: classified.kind,
  });
}

/** 终态错误收稿：优先 tracker.assistantTexts，空则回退 session 拉取一次。 */
function scheduleFinishOfficeRunTerminalError(
  tracker: OfficeRunTracker,
  finish: (result: WaitForSessionReplyResult) => void,
  pollOnce: () => Promise<{ text: string | null; messages: RawMsg[] } | null>,
): void {
  void (async () => {
    let text = joinOfficeRunTerminalAssistantTexts(tracker.terminalAssistantTexts);
    if (!text.trim()) {
      try {
        const snapshot = await pollOnce();
        text = snapshot?.text?.trim() || text;
      } catch {
        // lifecycle 错误事件可能无 assistantTexts，尽力从 session 补一次正文。
      }
    }
    finishOfficeRunTerminalErrorWithText(tracker, text, finish);
  })();
}

function extractSessionKeyFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const data = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const candidates = [
    p.sessionKey,
    data.sessionKey,
    p.key,
    data.key,
    (p.session as Record<string, unknown> | undefined)?.key,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? String(found) : undefined;
}

export function payloadMatchesSession(payload: unknown, sessionKey: string): boolean {
  const key = extractSessionKeyFromPayload(payload);
  return key === sessionKey;
}

export function gatewayEventMatchesRun(runId: string | undefined, eventRunId: unknown): boolean {
  if (!runId) return true;
  if (eventRunId == null || eventRunId === '') return false;
  const expected = String(runId).trim();
  const actual = String(eventRunId).trim();
  if (expected === actual) return true;

  const expectedBare = officeWorkflowBareRunTail(expected);
  const actualBare = officeWorkflowBareRunTail(actual);
  if (!expectedBare || !actualBare || expectedBare !== actualBare) return false;

  const expectedScope = officeWorkflowNodeScopeSuffix(expected);
  const actualScope = officeWorkflowNodeScopeSuffix(actual);
  if (expectedScope && actualScope) return expectedScope === actualScope;
  // Scoped settle + bare Gateway lifecycle (PPT-style run.ended).
  if (expectedScope && !actualScope) return true;
  // Bare settle must not accept scoped lifecycle from another node.
  if (!expectedScope && actualScope) return false;

  return true;
}

/** Agent/chat notification belongs to this wait when sessionKey or runId matches. */
export function agentNotificationMatchesOfficeSession(
  params: unknown,
  sessionKey: string,
  runId: string | undefined,
): boolean {
  if (payloadMatchesSession(params, sessionKey)) return true;
  const parsed = parseGatewayAgentNotificationEvent(params, sessionKey);
  return gatewayEventMatchesRun(runId, parsed.runId);
}

/** Latest user turn belongs to this dispatch (avoids finishing on pre-send assistant lines). */
export function hasTriggeringUserTurnAfter(
  messages: RawMsg[],
  startedAtMs: number,
  options?: { expectedMessage?: string; earliestAcceptedUserTurnAtMs?: number },
): boolean {
  return findTriggeringUserTurnAfter(messages, startedAtMs, options).opened;
}

export type FreshUserTurnProbe = {
  opened: boolean;
  userTurnTs?: number;
  acceptedBy?: 'current_attempt' | 'send_group' | 'undated_match';
};

export function findTriggeringUserTurnAfter(
  messages: RawMsg[],
  startedAtMs: number,
  options?: { expectedMessage?: string; earliestAcceptedUserTurnAtMs?: number },
): FreshUserTurnProbe {
  const enriched = enrichMessagesForRoomMirror(messages);
  const threshold = options?.earliestAcceptedUserTurnAtMs ?? startedAtMs;
  for (let i = enriched.length - 1; i >= 0; i--) {
    const msg = enriched[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    if (!userTurnMatchesExpectedMessage(msg, options?.expectedMessage)) continue;
    const ts = messageTimestamp(msg);
    if (ts === 0) {
      return {
        opened: true,
        acceptedBy: 'undated_match',
      };
    }
    if (ts >= startedAtMs) {
      return {
        opened: true,
        userTurnTs: ts,
        acceptedBy: 'current_attempt',
      };
    }
    if (ts >= threshold) {
      return {
        opened: true,
        userTurnTs: ts,
        acceptedBy: 'send_group',
      };
    }
    return { opened: false, userTurnTs: ts };
  }
  return { opened: false };
}

/** turn-gate 失败诊断：history 里最近一条 user 相对 sendStartedAtMs 的状态。 */
export function probeLatestUserTurnForSend(
  messages: RawMsg[],
  sendStartedAtMs: number,
  options?: { expectedMessage?: string; earliestAcceptedUserTurnAtMs?: number },
): {
  historyLen: number;
  lastUserTs?: number;
  lastUserAgeBeforeSendMs?: number;
  wouldOpenTurn: boolean;
  lastUserTsMissing: boolean;
  matchedExpectedMessage: boolean;
  acceptedBy?: string;
} {
  const enriched = enrichMessagesForRoomMirror(messages);
  for (let i = enriched.length - 1; i >= 0; i--) {
    const msg = enriched[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    const ts = messageTimestamp(msg);
    const matchedExpectedMessage = userTurnMatchesExpectedMessage(msg, options?.expectedMessage);
    return {
      historyLen: messages.length,
      lastUserTs: ts || undefined,
      lastUserAgeBeforeSendMs: ts > 0 ? sendStartedAtMs - ts : undefined,
      wouldOpenTurn: hasTriggeringUserTurnAfter(messages, sendStartedAtMs, options),
      lastUserTsMissing: ts === 0,
      matchedExpectedMessage,
      acceptedBy: findTriggeringUserTurnAfter(messages, sendStartedAtMs, options).acceptedBy,
    };
  }
  return {
    historyLen: messages.length,
    wouldOpenTurn: false,
    lastUserTsMissing: false,
    matchedExpectedMessage: false,
  };
}

/** 点名 sessionsSend 后轮询 session，确认已写入新的 user turn（开轮），否则无法保证 LLM 会被触发。 */
export const MENTION_SESSION_TURN_OPEN_POLL_MS = 800;
export const MENTION_SESSION_TURN_OPEN_DEADLINE_MS = 60_000;

export type WaitForSessionFreshUserTurnResult = {
  opened: boolean;
  userTurnTs?: number;
  acceptedBy?: 'current_attempt' | 'send_group' | 'undated_match';
};

export async function waitForSessionFreshUserTurn(
  gateway: GatewayManager,
  sessionKey: string,
  sendStartedAtMs: number,
  options?: {
    deadlineMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    expectedMessage?: string;
    earliestAcceptedUserTurnAtMs?: number;
  },
): Promise<WaitForSessionFreshUserTurnResult> {
  const deadlineMs = options?.deadlineMs ?? MENTION_SESSION_TURN_OPEN_DEADLINE_MS;
  const pollMs = options?.pollMs ?? MENTION_SESSION_TURN_OPEN_POLL_MS;
  const deadline = Date.now() + deadlineMs;
  const waitStartedAt = Date.now();
  let pollCount = 0;
  mentionDispatchLog('turn-gate-wait-start', {
    sessionKey,
    sendStartedAtMs,
    deadlineMs,
    pollMs,
    expectedMessageProvided: Boolean(options?.expectedMessage),
    expectedMessageLen: options?.expectedMessage?.length,
  });

  while (Date.now() < deadline) {
    if (options?.signal?.aborted) {
      mentionDispatchLog('turn-gate-wait-aborted', {
        sessionKey,
        sendStartedAtMs,
        pollCount,
        elapsedMs: Date.now() - waitStartedAt,
      });
      return { opened: false };
    }
    pollCount += 1;
    try {
      // Only the first poll is urgent; subsequent polls align to the 1s batch tick.
      const history = await fetchChatHistory(gateway, sessionKey, 80, {
        urgent: pollCount === 1,
      });
      const opened = findTriggeringUserTurnAfter(history.messages, sendStartedAtMs, {
          expectedMessage: options?.expectedMessage,
          earliestAcceptedUserTurnAtMs: options?.earliestAcceptedUserTurnAtMs,
        });
      if (opened.opened) {
        mentionDispatchLog('turn-gate-wait-opened', {
          sessionKey,
          sendStartedAtMs,
          earliestAcceptedUserTurnAtMs: options?.earliestAcceptedUserTurnAtMs,
          pollCount,
          elapsedMs: Date.now() - waitStartedAt,
          messageCount: history.messages.length,
          expectedMessageMatched: Boolean(options?.expectedMessage),
          userTurnTs: opened.userTurnTs,
          acceptedBy: opened.acceptedBy,
        });
        return opened;
      }
      if (pollCount === 1 || pollCount % 5 === 0) {
        const probe = probeLatestUserTurnForSend(history.messages, sendStartedAtMs, {
          expectedMessage: options?.expectedMessage,
          earliestAcceptedUserTurnAtMs: options?.earliestAcceptedUserTurnAtMs,
        });
        mentionDispatchLog('turn-gate-wait-no-turn', {
          sessionKey,
          sendStartedAtMs,
          pollCount,
          elapsedMs: Date.now() - waitStartedAt,
          historyLen: probe.historyLen,
          lastUserTs: probe.lastUserTs,
          lastUserAgeBeforeSendMs: probe.lastUserAgeBeforeSendMs,
          lastUserTsMissing: probe.lastUserTsMissing,
          matchedExpectedMessage: probe.matchedExpectedMessage,
          acceptedBy: probe.acceptedBy,
          expectedMessageProvided: Boolean(options?.expectedMessage),
        });
      }
    } catch (e) {
      mentionDispatchLog('turn-gate-wait-poll-error', {
        sessionKey,
        sendStartedAtMs,
        pollCount,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleepAbortable(pollMs, options?.signal);
  }
  mentionDispatchLog('turn-gate-wait-timeout', {
    sessionKey,
    sendStartedAtMs,
    pollCount,
    elapsedMs: Date.now() - waitStartedAt,
    deadlineMs,
    ...(await (async () => {
      try {
        const history = await fetchChatHistory(gateway, sessionKey, 80);
        const probe = probeLatestUserTurnForSend(history.messages, sendStartedAtMs, {
          expectedMessage: options?.expectedMessage,
          earliestAcceptedUserTurnAtMs: options?.earliestAcceptedUserTurnAtMs,
        });
        return {
          historyLen: probe.historyLen,
          lastUserTs: probe.lastUserTs,
          lastUserAgeBeforeSendMs: probe.lastUserAgeBeforeSendMs,
          lastUserTsMissing: probe.lastUserTsMissing,
          wouldOpenTurn: probe.wouldOpenTurn,
          matchedExpectedMessage: probe.matchedExpectedMessage,
          acceptedBy: probe.acceptedBy,
          expectedMessageProvided: Boolean(options?.expectedMessage),
          earliestAcceptedUserTurnAtMs: options?.earliestAcceptedUserTurnAtMs,
        };
      } catch (e) {
        return { historyFetchError: e instanceof Error ? e.message : String(e) };
      }
    })()),
  });
  return { opened: false };
}

function canAcceptAssistantReply(
  text: string | null | undefined,
  messages: RawMsg[],
  startedAtMs: number,
  opts: {
    requireFreshUserTurn?: boolean;
    minWaitBeforeAcceptMs?: number;
    requireWorkflowStructuredReply?: boolean;
  },
): boolean {
  if (!text?.trim() || isUnmirroredRoomSnippet(text)) return false;
  if (opts.requireWorkflowStructuredReply && !isWorkflowJsonOutput(text)) {
    return false;
  }
  if (opts.requireFreshUserTurn) {
    if (Date.now() < startedAtMs + (opts.minWaitBeforeAcceptMs ?? 3_000)) return false;
    if (!hasTriggeringUserTurnAfter(messages, startedAtMs)) return false;
  }
  return true;
}

function isWorkflowJsonOutput(text: string | null | undefined): boolean {
  const trimmed = text?.trim();
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
  // 收稿阶段仅判定“像 workflow JSON 输出”即可，避免因字符串转义瑕疵卡住 runner；
  // 结构/字段正确性由后续 validateWorkflowAgentStructuredReply 严格兜底并触发重试。
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

export function findLatestWorkflowReplyRaw(messages: RawMsg[], startedAtMs: number): string | null {
  const latest = findLatestAssistantAfter(messages, startedAtMs, { allowUndatedFallback: false });
  if (isWorkflowJsonOutput(latest)) return latest;
  return null;
}

/**
 * 拉取 session 最新历史并提取本 run 的工作流结构化 assistant 正文（先拉取再校验）。
 */
export async function fetchLatestWorkflowStructuredSessionReply(
  gateway: GatewayManager,
  options: {
    sessionKey: string;
    startedAtMs: number;
    requireFreshUserTurn?: boolean;
    minWaitBeforeAcceptMs?: number;
  },
): Promise<{ raw: string; acceptable: boolean }> {
  try {
    const history = await fetchWorkflowSettleChatHistory(gateway, options.sessionKey, {
      urgent: true,
      startedAtMs: options.startedAtMs,
    });
    const enriched = enrichMessagesForRoomMirror(history.messages);
    const text = findLatestWorkflowReplyRaw(enriched, options.startedAtMs);
    if (!text?.trim()) {
      return { raw: '', acceptable: false };
    }
    const acceptable = canAcceptAssistantReply(text, enriched, options.startedAtMs, {
      requireFreshUserTurn: options.requireFreshUserTurn ?? true,
      minWaitBeforeAcceptMs: options.minWaitBeforeAcceptMs ?? 0,
      requireWorkflowStructuredReply: true,
    });
    return { raw: text.trim(), acceptable };
  } catch {
    return { raw: '', acceptable: false };
  }
}

/** Resolve the assistant line for this @mention run (avoids stale pre-run replies in room mirror). */
export async function resolveMentionSessionAssistantReply(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  opts?: { requireFreshUserTurn?: boolean; allowUndatedFallback?: boolean },
): Promise<string | null> {
  try {
    const history = await fetchChatHistory(gateway, sessionKey, 80);
    return resolveMentionAssistantReplyFromHistory(history.messages, startedAtMs, opts);
  } catch {
    return null;
  }
}

export function resolveMentionAssistantReplyFromHistory(
  historyMessages: RawMsg[],
  startedAtMs: number,
  opts?: { requireFreshUserTurn?: boolean; allowUndatedFallback?: boolean },
): string | null {
  const enriched = enrichMessagesForRoomMirror(historyMessages);
  if (opts?.requireFreshUserTurn && !hasTriggeringUserTurnAfter(enriched, startedAtMs)) {
    return null;
  }
  return (
    findLatestMentionStructuredRaw(enriched, startedAtMs, normalizeOfficeTimestampMs)
    ?? findLatestAssistantAfter(enriched, startedAtMs, {
      allowUndatedFallback: opts?.allowUndatedFallback ?? false,
    })
  );
}

function extractAgentPhase(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const data = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const phase = data.phase ?? p.phase;
  return typeof phase === 'string' ? phase : undefined;
}

function tryFinishFromAssistantMessage(
  msg: RawMsg | undefined,
  state: string | undefined,
  finish: (result: WaitForSessionReplyResult) => void,
  deferAccept?: () => void,
  preferStructuredMention?: boolean,
  requireWorkflowStructuredReply?: boolean,
): boolean {
  if (!msg || msg.role !== 'assistant') return false;
  let text = extractTextFromOfficeMessage(msg);
  if (preferStructuredMention) {
    const structured = extractStructuredReplyFromAssistantMessage(msg);
    if (/【\s*群聊回复\s*】/u.test(structured)) text = structured;
    else if (!text?.trim()) text = structured;
  }
  if (requireWorkflowStructuredReply) {
    const structured = extractWorkflowStructuredFromAssistantMessage(msg);
    if (!structured.trim()) return false;
    text = structured;
  }
  if (!text || isInternalAssistantText(text) || isUnmirroredRoomSnippet(text)) return false;
  if (state === 'delta' || state === 'started') return false;
  if (deferAccept) {
    deferAccept();
    return true;
  }
  finish({ completed: true, assistantText: text });
  return true;
}

/** `timeoutMs === 0` means wait without a deadline (Smart coordinator dispatch). */
export function shouldArmSessionReplyTimeout(timeoutMs: number): boolean {
  return timeoutMs > 0;
}

/**
 * Wait until a new assistant reply appears in session history, using gateway events + polling.
 */
export async function waitForSessionReply(
  gateway: GatewayManager,
  options: WaitForSessionReplyOptions,
): Promise<WaitForSessionReplyResult> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const unlimited = timeoutMs === 0;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const { sessionKey, startedAtMs, signal, runId, onPartialReply } = options;
  const deadline = unlimited ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;

  const acceptOpts = {
    requireFreshUserTurn: options.requireFreshUserTurn,
    minWaitBeforeAcceptMs: options.minWaitBeforeAcceptMs,
    requireWorkflowStructuredReply: options.requireWorkflowStructuredReply,
  };

  const pollOnce = async (
    historyMessages?: RawMsg[],
  ): Promise<{ text: string | null; messages: RawMsg[] } | null> => {
    try {
      const messages = (
        historyMessages
        ?? (await fetchWorkflowSettleChatHistory(gateway, sessionKey, {
          urgent: true,
          startedAtMs,
        })).messages
      ) as RawMsg[];
      let text: string | null = null;
      if (options.requireWorkflowStructuredReply) {
        text = findLatestWorkflowReplyRaw(
          enrichMessagesForRoomMirror(messages),
          startedAtMs,
        );
      } else if (options.requireFreshUserTurn) {
        text = resolveMentionAssistantReplyFromHistory(messages, startedAtMs, {
          requireFreshUserTurn: true,
          allowUndatedFallback: options.allowUndatedFallback,
        });
      } else {
        text = findLatestAssistantAfter(enrichMessagesForRoomMirror(messages), startedAtMs, {
          allowUndatedFallback: options.allowUndatedFallback,
        });
      }
      return { text, messages };
    } catch {
      return null;
    }
  };

  const reportPartial = (text: string | null | undefined) => {
    if (text && onPartialReply) onPartialReply(text);
  };

  const deferFinishUntilSessionFetch =
    options.requireFreshUserTurn === true || options.requireWorkflowStructuredReply === true;
  const useRunCompleteGate = Boolean(runId);
  const settleTrackerKey = options.settleTrackerKey?.trim() || undefined;
  const tracker = settleTrackerKey
    ? getOrCreateOfficeSettleTracker(settleTrackerKey, runId)
    : createOfficeRunTracker(runId);
  const runtimeToolTracker = new OfficeRuntimeToolTracker();

  /**
   * Pre-discharge: honor live runtime tool events while waiting for gateway terminal.
   * Post-discharge (`runComplete` / `sessionIdleReconciled`): pass `null` — lifecycle or
   * sessions.list idle is authoritative so stale `tool.started` must not block settle, but
   * transcript segment guards (`segmentHasOpenToolRun`, etc.) still run. Must not return
   * `undefined` here: downstream treats `undefined` as "skip all segment/runtime checks".
   */
  const runtimeEvidenceForSettle = (): OfficeRuntimeToolSnapshot | null | undefined => {
    if (!isOfficeRunProtocolDischarged(tracker)) {
      return runtimeToolTracker.snapshot();
    }
    return null;
  };

  /** Clear stale tool.started once when the protocol gate first opens (either path). */
  const clearStaleRuntimeOnFirstProtocolDischarge = (gateWasOpenBefore: boolean): void => {
    if (!gateWasOpenBefore && isOfficeRunProtocolDischarged(tracker)) {
      runtimeToolTracker.reset();
    }
  };

  let stableAcceptInFlight = false;
  let legacyFinalFetchTimer: ReturnType<typeof setTimeout> | null = null;

  const tryAccept = async (
    text: string | null | undefined,
    finish: (result: WaitForSessionReplyResult) => void,
    historyMessages?: RawMsg[],
  ): Promise<boolean> => {
    if (!text?.trim()) return false;
    if (useRunCompleteGate && !canAcceptStableSessionReply(tracker)) return false;
    reportPartial(text);
    try {
      const messages =
        historyMessages
        ?? (await fetchWorkflowSettleChatHistory(gateway, sessionKey, {
          urgent: true,
          startedAtMs,
        })).messages;
      if (
        !canAcceptAssistantReply(
          text,
          enrichMessagesForRoomMirror(messages),
          startedAtMs,
          acceptOpts,
        )
      ) {
        return false;
      }
    } catch {
      return false;
    }
    finish({ completed: true, assistantText: text });
    return true;
  };

  const schedulePoll = (finish: (result: WaitForSessionReplyResult) => void) => {
    void pollOnce().then((snapshot) => {
      if (!snapshot) return;
      void tryAccept(snapshot.text, finish, snapshot.messages);
    });
  };

  const scheduleLegacyFinalFetch = (finish: (result: WaitForSessionReplyResult) => void) => {
    if (legacyFinalFetchTimer) clearTimeout(legacyFinalFetchTimer);
    legacyFinalFetchTimer = setTimeout(() => {
      legacyFinalFetchTimer = null;
      schedulePoll(finish);
    }, SESSION_STABILITY_INITIAL_DELAY_MS);
  };

  // Give-up handoff: terminal discharged + turn settled (no in-flight tool) but the final
  // reply is NOT workflow-JSON-shaped. Returns the raw final text for downstream format-retry,
  // or null when the turn is still in progress / has no final reply / already has JSON.
  const resolveTerminalNonJsonRawHandoff = async (): Promise<string | null> => {
    if (!isOfficeRunProtocolDischarged(tracker)) return null;
    let messages: RawMsg[];
    try {
      messages = (await fetchWorkflowSettleChatHistory(gateway, sessionKey, {
        urgent: true,
        startedAtMs,
      })).messages as RawMsg[];
    } catch {
      return null;
    }
    const enriched = enrichMessagesForRoomMirror(messages);
    // Still executing (in-flight tool / not settled in evidence) → keep waiting, don't give up.
    if (evaluateOfficeTurnStillInProgress(messages, startedAtMs, runtimeEvidenceForSettle())) {
      return null;
    }
    const rawFinal = findLatestAssistantAfter(enriched, startedAtMs, {
      allowUndatedFallback: options.allowUndatedFallback,
    });
    if (!rawFinal?.trim() || isUnmirroredRoomSnippet(rawFinal)) return null;
    // JSON-shaped finals are handled by the normal accept/handoff paths, not here.
    if (isWorkflowJsonOutput(rawFinal)) return null;
    return rawFinal;
  };

  const scheduleStableAccept = (finish: (result: WaitForSessionReplyResult) => void) => {
    if (tracker.terminalErrorEnded) {
      scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
      return;
    }
    if (stableAcceptInFlight || tracker.settleConsistencyAttempted) return;
    stableAcceptInFlight = true;
    void (async () => {
      try {
        if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker))) {
          return;
        }
        const pollText = async (historyMessages?: RawMsg[]) =>
          (await pollOnce(historyMessages))?.text ?? null;
        const captured = await captureOfficeSettleBaseline(gateway, {
          sessionKey,
          startedAtMs,
          tracker,
          pollText,
          onPartialReply,
          runtimeToolSnapshot: runtimeEvidenceForSettle(),
        });
        if (!captured) return;

        const baselineText = tracker.settleBaselineText ?? '';
        let workflowFastPath = false;
        if (options.requireWorkflowStructuredReply && baselineText.trim()) {
          const snap = await pollOnce();
          if (snap) {
            workflowFastPath = shouldUseWorkflowSettleFastPath(
              snap.messages,
              startedAtMs,
              baselineText,
              runtimeEvidenceForSettle(),
            );
          }
        }

        const settled = await fetchStableSessionReplyText(gateway, {
          sessionKey,
          startedAtMs,
          signal,
          tracker,
          pollText,
          onPartialReply,
          workflowFastPath,
        });
        if (tracker.terminalErrorEnded) {
          scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
        } else if (settled?.text) {
          const syntaxHandoff = options.requireWorkflowStructuredReply
            ? tryHandoffWorkflowSettleSyntaxParseFailure(
              settled.lastHistoryMessages ?? [],
              startedAtMs,
              settled.text,
              runtimeEvidenceForSettle(),
            )
            : null;
          if (syntaxHandoff) {
            finish({ completed: true, assistantText: syntaxHandoff });
            tracker.settleConsistencyAttempted = true;
          } else {
            const accepted = await tryAccept(settled.text, finish, settled.lastHistoryMessages);
            if (accepted) {
              tracker.settleConsistencyAttempted = true;
            } else {
              resetOfficeSettleCaptureState(tracker);
            }
          }
        } else if (settled === null && options.requireWorkflowStructuredReply) {
          // `settled === null` (NOT a hashMismatch reject, which returns a truthy object) means
          // the 5s consistency path could not obtain a workflow-JSON reply. If the turn is
          // terminally discharged with a STABLE non-JSON final reply — agent finished without
          // valid JSON, OR emitted trailing narration after the JSON so the latest reply is not
          // JSON-shaped — hand off the raw final text so downstream structural validation can
          // format-retry, instead of spinning to the node timeout. This NEVER accepts stale
          // JSON (acceptance stays in tryAccept); it only unblocks the give-up path.
          const rawHandoff = await resolveTerminalNonJsonRawHandoff();
          if (rawHandoff) {
            finish({ completed: true, assistantText: rawHandoff });
            tracker.settleConsistencyAttempted = true;
          }
        }
        // Note: a hashMismatch/anchor reject (settled truthy, text null) did NOT pass the 5s
        // consistency check — we must NOT hand off; it simply retries settle next poll cycle.
      } catch (e) {
        if (!(signal?.aborted || (e instanceof Error && e.message === 'aborted'))) {
          throw e;
        }
        finish({ completed: false, error: 'aborted' });
      } finally {
        stableAcceptInFlight = false;
      }
    })();
  };

  const scheduleRunSettle = (finish: (result: WaitForSessionReplyResult) => void) => {
    if (tracker.terminalErrorEnded) {
      scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
      return;
    }
    if (useRunCompleteGate) {
      if (!isOfficeRunProtocolDischarged(tracker)) return;
      scheduleStableAccept(finish);
      return;
    }
    if (deferFinishUntilSessionFetch) {
      scheduleLegacyFinalFetch(finish);
      return;
    }
    schedulePoll(finish);
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WaitForSessionReplyResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      const outcome = result.completed
        ? (result.terminalErrorEnded ? 'terminal_error' : 'completed')
        : result.peerClaimed
          ? 'peer_claimed'
          : result.timedOut
            ? 'timed_out'
            : result.error === 'aborted'
              ? 'aborted'
              : 'incomplete';
      logOfficeGatewaySettle(
        result.completed || result.terminalErrorEnded ? 'info' : 'warn',
        `waitForSessionReply finished — ${outcome}`,
        {
          sessionKey,
          startedAtMs,
          runId,
          outcome,
          terminalError: result.terminalError,
          assistantChars: result.assistantText?.length,
          ...officeSettleGateStateDetail(tracker),
        },
      );
      if (
        settleTrackerKey
        && (result.completed || result.terminalErrorEnded)
      ) {
        releaseOfficeSettleTracker(settleTrackerKey);
      }
      resolve(result);
    };

    const handleOfficeRunRuntimeEvent = (
      event: ChatRuntimeEvent,
      finish: (result: WaitForSessionReplyResult) => void,
    ) => {
      if (!gatewayEventMatchesRun(runId, event.runId)) {
        if (event.type === 'run.ended' || event.type === 'run.started') {
          logOfficeGatewayLifecycleRunIdMismatch(runId, event.runId, event.type, sessionKey);
        }
        return;
      }
      if (event.sessionKey && event.sessionKey !== sessionKey) return;

      applyOfficeRunRuntimeEvent(tracker, event, { sessionKey });
      runtimeToolTracker.applyRuntimeEvent(event);

      if (event.type !== 'run.ended') return;

      if (tracker.terminalErrorEnded) {
        scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
        return;
      }
      if (useRunCompleteGate && tracker.runComplete) {
        // run.ended may arrive before the next poll; clear stale browser tool.started
        // immediately so the synchronous scheduleRunSettle path is not blocked.
        runtimeToolTracker.reset();
        scheduleRunSettle(finish);
        return;
      }
      if (useRunCompleteGate && event.status === 'completed') {
        void pollOnce();
      }
    };

    const handleGatewayEvent = (
      parsed: ParsedGatewayChatEvent,
      finish: (result: WaitForSessionReplyResult) => void,
    ) => {
      const matchesRun = gatewayEventMatchesRun(runId, parsed.runId);
      const matchesSession = Boolean(parsed.sessionKey && parsed.sessionKey === sessionKey);
      if (!matchesRun && !matchesSession) return;

      applyOfficeRunGatewayEvent(tracker, parsed);

      const state = parsed.state ?? '';
      if (matchesSession && (state === 'delta' || state === 'started')) {
        const partial = parsed.message;
        if (partial && partial.role === 'assistant') {
          reportPartial(extractTextFromOfficeMessage(partial));
        }
        return;
      }

      if (matchesSession && state === 'error') {
        applyOfficeRunTerminalAssistantMessage(tracker, parsed.message);
        if (tracker.terminalErrorEnded) {
          scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
        }
        return;
      }

      if (matchesSession && (state === 'final' || !state)) {
        applyOfficeRunTerminalAssistantMessage(tracker, parsed.message);
      }

      if (tracker.terminalErrorEnded) {
        scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
        return;
      }

      if (!useRunCompleteGate) {
        if (matchesSession && !deferFinishUntilSessionFetch) {
          if (
            tryFinishFromAssistantMessage(
              parsed.message,
              state,
              finish,
              undefined,
              options.requireFreshUserTurn,
              options.requireWorkflowStructuredReply,
            )
          ) {
            return;
          }
        }

        if (isGatewayRunTerminalSignal(parsed)) {
          scheduleRunSettle(finish);
        }
      }
    };

    const onRuntimeEvent = (event: ChatRuntimeEvent) => {
      handleOfficeRunRuntimeEvent(event, finish);
    };

    const onChat = (data: { message?: unknown }) => {
      handleGatewayEvent(parseGatewayChatEnvelope(data), finish);
    };

    const onNotification = (data: { method?: string; params?: unknown }) => {
      const method = data?.method ?? '';
      const params = data?.params;
      if (method === 'agent' || method === 'chat') {
        if (!agentNotificationMatchesOfficeSession(params, sessionKey, runId)) return;
        const parsed = parseGatewayAgentNotificationEvent(params, sessionKey);
        if (!gatewayEventMatchesRun(runId, parsed.runId)) {
          const runtime = normalizeGatewayChatRuntimeEvent(params);
          if (runtime?.type === 'run.ended' || runtime?.type === 'run.started') {
            logOfficeGatewayLifecycleRunIdMismatch(runId, parsed.runId, runtime.type, sessionKey);
          }
          return;
        }
        const runtime = normalizeGatewayChatRuntimeEvent(params);
        if (runtime) handleOfficeRunRuntimeEvent(runtime, finish);
        handleGatewayEvent(parsed, finish);
        return;
      }

      const matchesSession = payloadMatchesSession(params, sessionKey);
      if (!matchesSession && method !== 'chat') return;

      if (matchesSession && !deferFinishUntilSessionFetch && !options.requireFreshUserTurn) {
        schedulePoll(finish);
      }
    };

    const cleanup = () => {
      clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (legacyFinalFetchTimer) clearTimeout(legacyFinalFetchTimer);
      gateway.off('chat:message', onChat);
      gateway.off('notification', onNotification);
      gateway.off('chat:runtime-event', onRuntimeEvent);
      signal?.removeEventListener('abort', onAbort);
    };

    /** room_heal 成功会 abort 节点 signal；若对端已接管，须记 peer_claimed 而非 aborted。 */
    const finishAsPeerClaimedOrAborted = () => {
      if (options.shouldAbortWait?.()) {
        finish({ completed: false, peerClaimed: true });
        return;
      }
      finish({ completed: false, error: 'aborted' });
    };
    const onAbort = () => finishAsPeerClaimedOrAborted();
    signal?.addEventListener('abort', onAbort, { once: true });

    gateway.on('chat:message', onChat);
    gateway.on('notification', onNotification);
    gateway.on('chat:runtime-event', onRuntimeEvent);

    logOfficeGatewaySettle('info', 'waitForSessionReply started', {
      sessionKey,
      startedAtMs,
      runId,
      useRunCompleteGate,
      requireWorkflowStructuredReply: options.requireWorkflowStructuredReply,
      timeoutMs,
      ...officeSettleGateStateDetail(tracker),
    });

    const waitStartedAt = Date.now();
    let lastGateWaitLogAt = waitStartedAt;
    let gateWasOpen = isOfficeRunProtocolDischarged(tracker);

    const pollTimer = setInterval(() => {
      if (options.shouldAbortWait?.()) {
        finish({ completed: false, peerClaimed: true });
        return;
      }
      if (Date.now() > deadline) {
        finish({ completed: false, timedOut: true });
        return;
      }
      if (useRunCompleteGate) {
        if (tracker.terminalErrorEnded) {
          scheduleFinishOfficeRunTerminalError(tracker, finish, pollOnce);
          return;
        }
        void (async () => {
          const snapshot = await pollOnce();
          // Model B: open the gate from an authoritative gateway signal first
          // (`run.ended` already applied via runtime events → runComplete, or
          // `sessions.list` idle here). Only then does history-JSON promote
          // workflowHistoryReconciled to relax `hasActiveRun` for settle verify.
          await tryReconcileOfficeRunSessionIdle(gateway, sessionKey, startedAtMs, tracker);
          clearStaleRuntimeOnFirstProtocolDischarge(gateWasOpen);
          gateWasOpen = isOfficeRunProtocolDischarged(tracker);
          if (snapshot && options.requireWorkflowStructuredReply) {
            tryReconcileOfficeRunFromWorkflowHistory(
              tracker,
              snapshot.messages,
              startedAtMs,
              {
                replyText: snapshot.text,
                runtimeToolSnapshot: runtimeEvidenceForSettle(),
              },
            );
          }
          if (!isOfficeRunProtocolDischarged(tracker)) {
            const now = Date.now();
            if (useRunCompleteGate && now - lastGateWaitLogAt >= 30_000) {
              lastGateWaitLogAt = now;
              logOfficeGatewaySettle('warn', 'still waiting for gateway terminal — gate not open', {
                sessionKey,
                startedAtMs,
                runId,
                waitingMs: now - waitStartedAt,
                ...officeSettleGateStateDetail(tracker),
              });
            }
            return;
          }
          if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker))) {
            return;
          }
          scheduleRunSettle(finish);
        })();
        return;
      }
      if (deferFinishUntilSessionFetch && !isOfficeRunSettleGateOpen(tracker)) return;
      schedulePoll(finish);
    }, pollIntervalMs);

    const timeoutTimer = shouldArmSessionReplyTimeout(timeoutMs)
      ? setTimeout(() => {
          finish({ completed: false, timedOut: true });
        }, timeoutMs)
      : undefined;

    // Already-aborted signals do not re-emit 'abort'; promote peer claim once timers exist
    // so cleanup() can clear them safely.
    if (signal?.aborted) {
      finishAsPeerClaimedOrAborted();
      return;
    }

    if (!deferFinishUntilSessionFetch) {
      void pollOnce().then((snapshot) => {
        if (!snapshot) return;
        void tryAccept(snapshot.text, finish, snapshot.messages);
      });
      setTimeout(() => schedulePoll(finish), 1_500);
    }
  });
}
