/**
 * Smart 模式 · 群聊点名：监听本轮 session，按「有无【群聊回复】/有无正文」分支轮询并做结构化校验。
 * Workflow 仍使用 {@link waitForSessionReply}（run-completion.ts）。
 */
import type { GatewayManager } from '../../gateway/manager';
import { OFFICE_UNIFIED_POLL_MS } from '../../../shared/office-unified-poll';
import { pickBestSmartMentionStructuredRaw, scoreSmartMentionStructuredCompleteness } from '../../../src/lib/office-mention-structured-score';
import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import { isNonSubstantiveMentionSessionReply } from './room-mention-reply-policy';
import { fetchChatHistory } from './gateway-rpc';
import { normalizeGatewayChatRuntimeEvent } from '../../gateway/chat-runtime-events';
import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';
import type { RoomMentionValidationResult } from './room-mention-structured-reply';
import {
  applyOfficeRunTerminalAssistantMessage,
  extractTextFromOfficeMessage,
  gatewayEventMatchesRun,
  parseGatewayAgentNotificationEvent,
  parseGatewayChatEnvelope,
  payloadMatchesSession,
  resolveMentionAssistantReplyFromHistory,
  resolveMentionSessionAssistantReply,
  type ParsedGatewayChatEvent,
} from './run-completion';
import {
  appendGatewayTerminalErrorDetail,
  classifyOfficeRunTrackerTerminalError,
  joinOfficeRunTerminalAssistantTexts,
  type GatewayRunTerminalErrorKind,
} from './gateway-run-error';
import { enrichMessagesForRoomMirror } from '../../../src/lib/office-session-attachments';
import { extractStructuredReplyFromAssistantMessage } from '../../../src/lib/office-session-final-mirror';
import { mentionDispatchLog } from './mention-dispatch-log';
import {
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  canStartOfficeSessionSettle,
  captureOfficeSettleBaseline,
  createOfficeRunTracker,
  fetchStableSessionReplyText,
  isOfficeRunCompletePhase,
  isOfficeRunProtocolDischarged,
  isOfficeRunTerminalFailurePhase,
  OfficeRuntimeToolTracker,
  tryReconcileOfficeRunSessionIdle,
  OFFICE_SETTLE_CONSISTENCY_DELAY_MS,
  verifyOfficeSessionAllowsSuccessSettle,
  type OfficeRunTracker,
} from './session-run-settle';

/** @deprecated Smart 收稿已统一走终态闸门 + 5s confirm；保留常量供历史测试对照。 */
export const MENTION_NO_ROOM_REPLY_VALIDATE_MS = 30_000;

/** 等待本轮首次非空正文时的轮询间隔（对齐 Office 统一定时器）。 */
export const MENTION_CONTENT_DETECT_POLL_MS = OFFICE_UNIFIED_POLL_MS;

/** Smart 点名 timeoutMs=0 时，自 startedAtMs 起的总等待上限。 */
export const MENTION_RUN_MAX_STRUCTURED_READY_MS = 600_000;

const SMART_ROOM_REPLY_MARK = /【\s*群聊回复\s*】/u;

export type MentionRunSettleReason =
  | 'validated'
  | 'timeout'
  | 'aborted';

export type SmartMentionStructuredValidateFn = (
  raw: string,
) => Promise<RoomMentionValidationResult & { raw: string }>;

export interface WaitForSmartMentionValidatedOptions {
  sessionKey: string;
  startedAtMs: number;
  mentionTurnId?: string;
  timeoutMs?: number;
  runId?: string;
  signal?: AbortSignal;
  validate: SmartMentionStructuredValidateFn;
  onPartialReply?: (text: string) => void;
  /** 本轮 session 首次出现模型活动（流式 partial / 非空正文）时回调一次。 */
  onModelActivity?: () => void | Promise<void>;
}

export interface WaitForSmartMentionValidatedResult {
  validation: RoomMentionValidationResult & { raw: string };
  timedOut: boolean;
  error?: string;
  settleReason: MentionRunSettleReason;
  mentionTurnId?: string;
  gatewayTerminalErrorKind?: GatewayRunTerminalErrorKind;
}

/** @deprecated 使用 {@link waitForSmartMentionValidated} */
export type WaitForMentionRunSettledOptions = WaitForSmartMentionValidatedOptions & {
  pollIntervalMs?: number;
};
/** @deprecated */
export type WaitForMentionRunSettledResult = WaitForSmartMentionValidatedResult & {
  settled: boolean;
  raw: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @internal test export */
export async function waitForNextMentionPoll(
  deadlineMs: number,
  signal?: AbortSignal,
  shouldWake?: () => boolean,
  explicitWaitMs?: number,
): Promise<'ok' | 'deadline' | 'aborted'> {
  if (shouldWake?.()) return 'ok';
  if (signal?.aborted) return 'aborted';
  if (Date.now() >= deadlineMs) return 'deadline';

  if (
    explicitWaitMs != null
    && explicitWaitMs > 0
    && explicitWaitMs < MENTION_CONTENT_DETECT_POLL_MS
  ) {
    return sleepUntil(explicitWaitMs, deadlineMs, signal, shouldWake);
  }

  try {
    const { waitForOfficeUnifiedPollTick } = await import('./office-sync-runtime');
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) return 'deadline';
    await Promise.race([
      waitForOfficeUnifiedPollTick(signal),
      sleep(remainingMs).then(() => {
        throw new Error('deadline');
      }),
    ]);
    if (signal?.aborted) return 'aborted';
    if (Date.now() >= deadlineMs) return 'deadline';
    return 'ok';
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === 'aborted')) {
      return 'aborted';
    }
    if (error instanceof Error && error.message === 'deadline') {
      return 'deadline';
    }
    return sleepUntil(MENTION_CONTENT_DETECT_POLL_MS, deadlineMs, signal, shouldWake);
  }
}

function structuredReadyDeadlineMs(startedAtMs: number, timeoutMs: number, waitStartedMs: number): number {
  if (timeoutMs === 0) {
    return startedAtMs + MENTION_RUN_MAX_STRUCTURED_READY_MS;
  }
  return waitStartedMs + timeoutMs;
}

export function hasSmartMentionRoomReplyMark(raw: string): boolean {
  return SMART_ROOM_REPLY_MARK.test(raw) || isSmartJsonShapeText(raw);
}

/** 本轮 session 是否已有非空实质 assistant 正文（含中间结果）。 */
export function hasSmartMentionTurnContent(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && !isNonSubstantiveMentionSessionReply(t);
}

/** @deprecated 仅表示含【群聊回复】标记；发群以 validate 通过为准。 */
export function isSmartMentionStructuredReady(raw: string): boolean {
  return hasSmartMentionTurnContent(raw) && hasSmartMentionRoomReplyMark(raw);
}

async function resolveMentionHistoryAssistantText(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  historyMessages?: Array<Record<string, unknown>>,
): Promise<string | null> {
  if (historyMessages) {
    return resolveMentionAssistantReplyFromHistory(historyMessages, startedAtMs, {
      requireFreshUserTurn: true,
    });
  }
  return resolveMentionSessionAssistantReply(gateway, sessionKey, startedAtMs, {
    requireFreshUserTurn: true,
  });
}

/** 从 session history 取点名校验用 raw（pickBest 合并 thinking）。 */
export async function resolveMentionPickBestRaw(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  historyMessages?: Array<Record<string, unknown>>,
  extraCandidates: Array<string | null | undefined> = [],
  fromHistory?: string | null,
): Promise<string> {
  const historyText =
    fromHistory
    ?? (await resolveMentionHistoryAssistantText(
      gateway,
      sessionKey,
      startedAtMs,
      historyMessages,
    ));
  const raw = pickBestSmartMentionStructuredRaw(historyText, ...extraCandidates).trim();
  if (!raw || isNonSubstantiveMentionSessionReply(raw)) return '';
  return raw;
}

/**
 * 传输失败兜底：先按本轮 user turn 收紧拉取；若无结果则放宽 fresh-user 限制，
 * 避免 Gateway history 滞后或重复 dispatch 时 session 已有 JSON 却 salvage 为空。
 */
export async function resolveMentionSalvageSessionRaw(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  extraCandidates: Array<string | null | undefined> = [],
): Promise<string> {
  const primary = await resolveMentionPickBestRaw(
    gateway,
    sessionKey,
    startedAtMs,
    undefined,
    extraCandidates,
  );
  if (primary.trim()) return primary;

  const relaxedHistory = await resolveMentionSessionAssistantReply(
    gateway,
    sessionKey,
    startedAtMs,
    { requireFreshUserTurn: false, allowUndatedFallback: true },
  );
  const relaxed = pickBestSmartMentionStructuredRaw(
    relaxedHistory ?? '',
    ...extraCandidates,
  ).trim();
  if (relaxed && !isNonSubstantiveMentionSessionReply(relaxed)) return relaxed;

  try {
    const history = await fetchChatHistory(gateway, sessionKey, 80, { urgent: true });
    const latestJson = findLatestSmartJsonInSessionHistory(history.messages);
    if (latestJson) return latestJson;
  } catch (e) {
    mentionDispatchLog('salvage-latest-json-fetch-error', {
      sessionKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return '';
}

function findLatestSmartJsonInSessionHistory(
  historyMessages: Array<Record<string, unknown>>,
): string {
  const enriched = enrichMessagesForRoomMirror(historyMessages);
  let best = '';
  let bestScore = 0;
  for (const msg of enriched) {
    if (msg.role !== 'assistant') continue;
    const raw = extractStructuredReplyFromAssistantMessage(msg);
    if (!raw || !isSmartJsonShapeText(raw)) continue;
    const score = scoreSmartMentionStructuredCompleteness(raw);
    if (score > bestScore) {
      bestScore = score;
      best = raw;
    }
  }
  return best.trim();
}

/** 拉取本轮对话当前最佳正文（结构化优先，否则最近 assistant）。 */
export async function resolveMentionTurnSessionRaw(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  historyMessages?: Array<Record<string, unknown>>,
  extraCandidates: Array<string | null | undefined> = [],
): Promise<string> {
  const fromHistory = await resolveMentionHistoryAssistantText(
    gateway,
    sessionKey,
    startedAtMs,
    historyMessages,
  );
  const pickBest = await resolveMentionPickBestRaw(
    gateway,
    sessionKey,
    startedAtMs,
    historyMessages,
    extraCandidates,
    fromHistory,
  );
  if (pickBest) return pickBest;
  const raw = (fromHistory ?? '').trim();
  if (!raw || isNonSubstantiveMentionSessionReply(raw)) return '';
  return raw;
}

async function sleepUntil(
  ms: number,
  deadlineMs: number,
  signal?: AbortSignal,
  shouldWake?: () => boolean,
): Promise<'ok' | 'deadline' | 'aborted'> {
  const end = Math.min(Date.now() + ms, deadlineMs);
  while (Date.now() < end) {
    if (signal?.aborted) return 'aborted';
    if (shouldWake?.()) return 'ok';
    const slice = Math.min(250, end - Date.now());
    if (slice <= 0) break;
    await sleep(slice);
  }
  if (signal?.aborted) return 'aborted';
  if (Date.now() >= deadlineMs) return 'deadline';
  return 'ok';
}

async function fetchAndNotify(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  historyMessages?: Array<Record<string, unknown>>,
  onPartialReply?: (text: string) => void,
): Promise<string> {
  const raw = await resolveMentionTurnSessionRaw(gateway, sessionKey, startedAtMs, historyMessages);
  if (raw) onPartialReply?.(raw);
  return raw;
}

async function canStartSmartMentionSettle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
  runtimeToolTracker: OfficeRuntimeToolTracker,
  historyMessages?: Array<Record<string, unknown>>,
): Promise<boolean> {
  try {
    const messages = historyMessages
      ?? (await fetchChatHistory(gateway, sessionKey, 80, { urgent: true })).messages;
    return canStartOfficeSessionSettle(
      tracker,
      messages,
      startedAtMs,
      runtimeToolTracker.snapshot(),
    );
  } catch {
    return false;
  }
}

/** 终态闸门已开 → 5s 单次一致性拉取 → JSON 结构化校验（Smart）。 */
async function validateWithRoomReplyMark(
  gateway: GatewayManager,
  options: {
    sessionKey: string;
    startedAtMs: number;
    deadlineMs: number;
    signal?: AbortSignal;
    tracker: OfficeRunTracker;
    runtimeToolTracker: OfficeRuntimeToolTracker;
    validate: SmartMentionStructuredValidateFn;
    onPartialReply?: (text: string) => void;
  },
): Promise<RoomMentionValidationResult & { raw: string }> {
  const {
    sessionKey,
    startedAtMs,
    deadlineMs,
    signal,
    tracker,
    runtimeToolTracker,
    validate,
    onPartialReply,
  } = options;

  const failEmpty: RoomMentionValidationResult & { raw: string } = {
    ok: false,
    issues: ['empty'],
    detail: '未收到模型正文',
    raw: '',
  };

  if (signal?.aborted || Date.now() >= deadlineMs) return failEmpty;
  if (tracker.terminalErrorEnded) return failEmpty;
  if (tracker.settleConsistencyAttempted) return failEmpty;

  const pollLatest = async (historyMessages?: Array<Record<string, unknown>>): Promise<string> =>
    fetchAndNotify(gateway, sessionKey, startedAtMs, historyMessages, onPartialReply);

  try {
    if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker))) {
      return failEmpty;
    }
    const captured = await captureOfficeSettleBaseline(gateway, {
      sessionKey,
      startedAtMs,
      tracker,
      pollText: pollLatest,
      onPartialReply,
      runtimeToolSnapshot: runtimeToolTracker.snapshot(),
    });
    if (!captured) return failEmpty;

    const settled = await fetchStableSessionReplyText(gateway, {
      sessionKey,
      startedAtMs,
      signal,
      tracker,
      pollText: pollLatest,
    });
    const raw = settled?.text?.trim() ?? '';
    if (!raw) return failEmpty;
    const validation = await validate(raw);
    if (validation.ok) {
      tracker.settleConsistencyAttempted = true;
    }
    return validation;
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
      return failEmpty;
    }
    mentionDispatchLog('smart-wait-room-mark-stable-error', {
      sessionKey,
      elapsedMs: Date.now() - startedAtMs,
      error: e instanceof Error ? e.message : String(e),
    });
    return failEmpty;
  }
}

function registerSmartMentionChatListeners(
  gateway: GatewayManager,
  sessionKey: string,
  runId: string | undefined,
  tracker: OfficeRunTracker,
  runtimeToolTracker: OfficeRuntimeToolTracker,
  hooks: {
    onWakePoll: () => void;
    onPartial: (text: string) => void;
    onRunActivity?: () => void;
    onRunEnded?: () => void;
  },
): () => void {
  const handleRuntimeEnded = (event: ChatRuntimeEvent) => {
    if (tracker.terminalErrorEnded) {
      hooks.onWakePoll();
      return;
    }
    if (tracker.runComplete) {
      hooks.onWakePoll();
      hooks.onRunActivity?.();
      hooks.onRunEnded?.();
      return;
    }
    if (event.type === 'run.ended' && event.status === 'completed') {
      hooks.onWakePoll();
    }
  };

  const onRuntimeEvent = (event: ChatRuntimeEvent) => {
    if (!gatewayEventMatchesRun(runId, event.runId)) return;
    if (event.sessionKey && event.sessionKey !== sessionKey) return;
    applyOfficeRunRuntimeEvent(tracker, event);
    runtimeToolTracker.applyRuntimeEvent(event);
    if (event.type === 'run.ended') handleRuntimeEnded(event);
  };

  const onPartialFromEvent = (parsed: ParsedGatewayChatEvent) => {
    const matchesRun = gatewayEventMatchesRun(runId, parsed.runId);
    const matchesSession = Boolean(parsed.sessionKey && parsed.sessionKey === sessionKey);
    if (!matchesRun && !matchesSession) return;

    applyOfficeRunGatewayEvent(tracker, parsed);
    if (!matchesRun) return;

    const state = parsed.state ?? '';
    const partial = parsed.message;
    if (matchesSession && (state === 'delta' || state === 'started')) {
      if (partial?.role === 'assistant') {
        const t = extractTextFromOfficeMessage(partial);
        if (t) hooks.onPartial(t);
      }
      return;
    }
    if (matchesSession && state === 'error') {
      applyOfficeRunTerminalAssistantMessage(tracker, partial);
      if (tracker.terminalErrorEnded) hooks.onWakePoll();
      return;
    }
    if (matchesSession && partial?.role === 'assistant') {
      const t = extractTextFromOfficeMessage(partial);
      if (t && !state) hooks.onPartial(t);
    }
    if (matchesSession && (state === 'final' || !state)) {
      applyOfficeRunTerminalAssistantMessage(tracker, partial);
    }
    if (tracker.terminalErrorEnded) {
      hooks.onWakePoll();
    } else if (isOfficeRunCompletePhase(parsed.phase) || isOfficeRunTerminalFailurePhase(parsed.phase)) {
      hooks.onWakePoll();
      hooks.onRunActivity?.();
    }
  };

  const onChat = (data: { message?: unknown }) => {
    onPartialFromEvent(parseGatewayChatEnvelope(data));
  };

  const onNotification = (data: { method?: string; params?: unknown }) => {
    const method = data?.method ?? '';
    const params = data?.params;
    const matchesSession = payloadMatchesSession(params, sessionKey);
    if (!matchesSession && method !== 'chat') return;
    if (method !== 'agent' && method !== 'chat') return;
    const runtime = normalizeGatewayChatRuntimeEvent(params);
    if (runtime) onRuntimeEvent(runtime);
    onPartialFromEvent(parseGatewayAgentNotificationEvent(params, sessionKey));
  };

  gateway.on('chat:message', onChat);
  gateway.on('notification', onNotification);
  gateway.on('chat:runtime-event', onRuntimeEvent);
  return () => {
    gateway.off('chat:message', onChat);
    gateway.off('notification', onNotification);
    gateway.off('chat:runtime-event', onRuntimeEvent);
  };
}

function buildValidatedResult(
  validation: RoomMentionValidationResult & { raw: string },
  deadlineMs: number,
  mentionTurnId?: string,
): WaitForSmartMentionValidatedResult {
  return {
    validation,
    timedOut: !validation.ok && Date.now() >= deadlineMs,
    settleReason: validation.ok ? 'validated' : 'timeout',
    mentionTurnId,
  };
}

/**
 * Smart 点名：监听本轮 session，按分支做结构化校验直至通过或总超时。
 */
export async function waitForSmartMentionValidated(
  gateway: GatewayManager,
  options: WaitForSmartMentionValidatedOptions,
): Promise<WaitForSmartMentionValidatedResult> {
  const {
    sessionKey,
    startedAtMs,
    mentionTurnId,
    runId,
    signal,
    validate,
    onPartialReply,
    onModelActivity,
  } = options;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const deadlineMs = structuredReadyDeadlineMs(startedAtMs, timeoutMs, Date.now());

  let wakePoll = false;
  let modelActivityNotified = false;
  let pollErrorCount = 0;
  const notifyModelActivity = () => {
    if (modelActivityNotified || !onModelActivity) return;
    modelActivityNotified = true;
    void Promise.resolve(onModelActivity()).catch(() => undefined);
  };
  const tracker = createOfficeRunTracker(runId);
  const runtimeToolTracker = new OfficeRuntimeToolTracker();
  const cleanupListeners = registerSmartMentionChatListeners(
    gateway,
    sessionKey,
    runId,
    tracker,
    runtimeToolTracker,
    {
      onWakePoll: () => {
        wakePoll = true;
      },
      onPartial: (t) => {
        onPartialReply?.(t);
        if (t.trim()) notifyModelActivity();
      },
      onRunActivity: notifyModelActivity,
    },
  );

  const roomMarkValidateOpts = {
    sessionKey,
    startedAtMs,
    deadlineMs,
    signal,
    tracker,
    runtimeToolTracker,
    validate,
    onPartialReply,
  };

  const tryStructuredValidationWhenReady = async (
    raw: string,
    historyMessages?: Array<Record<string, unknown>>,
  ): Promise<WaitForSmartMentionValidatedResult | null> => {
    if (tracker.terminalErrorEnded) return null;
    const structuredReady =
      hasSmartMentionRoomReplyMark(raw) || isSmartJsonShapeText(raw);
    if (!structuredReady) return null;
    if (!(await canStartSmartMentionSettle(
      gateway,
      sessionKey,
      startedAtMs,
      tracker,
      runtimeToolTracker,
      historyMessages,
    ))) return null;
    const validation = await validateWithRoomReplyMark(gateway, {
      ...roomMarkValidateOpts,
    });
    if (!validation.raw.trim() && !validation.ok) {
      return null;
    }
    return buildValidatedResult(validation, deadlineMs, mentionTurnId);
  };

  const failEmpty = (): RoomMentionValidationResult & { raw: string } => ({
    ok: false,
    issues: ['empty'],
    detail: '未收到模型正文',
    raw: '',
  });

  const validateTerminalError = async (): Promise<WaitForSmartMentionValidatedResult> => {
    let raw = joinOfficeRunTerminalAssistantTexts(tracker.terminalAssistantTexts);
    if (!raw.trim()) {
      raw = await fetchAndNotify(gateway, sessionKey, startedAtMs, undefined, onPartialReply);
    }
    const classified = classifyOfficeRunTrackerTerminalError(tracker);
    const validation = await validate(raw);
    const detail = tracker.terminalError?.trim();
    const mergedValidation =
      validation.ok || !detail
        ? validation
        : {
            ...validation,
            detail: appendGatewayTerminalErrorDetail(validation.detail, detail),
          };
    return {
      validation: mergedValidation,
      timedOut: false,
      settleReason: 'validated',
      mentionTurnId,
      gatewayTerminalErrorKind: classified.kind,
    };
  };

  let smartJsonWithoutMarkReadySinceMs = 0;

  try {
    while (!signal?.aborted && Date.now() < deadlineMs) {
      if (tracker.terminalErrorEnded) {
        return validateTerminalError();
      }
      let raw = '';
      let historyMessages: Array<Record<string, unknown>> | undefined;
      try {
        const history = await fetchChatHistory(gateway, sessionKey, 80, { urgent: true });
        historyMessages = history.messages;
        raw = await fetchAndNotify(gateway, sessionKey, startedAtMs, historyMessages, onPartialReply);
        pollErrorCount = 0;
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
          return {
            validation: failEmpty(),
            timedOut: true,
            error: 'aborted',
            settleReason: 'aborted',
            mentionTurnId,
          };
        }
        pollErrorCount += 1;
        mentionDispatchLog('smart-wait-poll-error', {
          sessionKey,
          runId,
          mentionTurnId,
          pollErrorCount,
          elapsedMs: Date.now() - startedAtMs,
          error: e instanceof Error ? e.message : String(e),
        });
        // Transport failures must not honor wakePoll — run.ended can set wakePoll=true
        // while Gateway is disconnected, which would tight-loop without unified poll backoff.
        wakePoll = false;
        const slept = await waitForNextMentionPoll(deadlineMs, signal);
        if (slept === 'aborted') {
          return {
            validation: failEmpty(),
            timedOut: true,
            error: 'aborted',
            settleReason: 'aborted',
            mentionTurnId,
          };
        }
        continue;
      }

      if (hasSmartMentionTurnContent(raw)) {
        notifyModelActivity();
      }

      if (tracker.terminalErrorEnded) {
        return validateTerminalError();
      }

      await tryReconcileOfficeRunSessionIdle(gateway, sessionKey, startedAtMs, tracker);

      if (!hasSmartMentionTurnContent(raw)) {
        if (wakePoll) {
          wakePoll = false;
          continue;
        }
        const polled = await waitForNextMentionPoll(deadlineMs, signal, () => wakePoll);
        if (polled === 'aborted') {
          return {
            validation: failEmpty(),
            timedOut: true,
            error: 'aborted',
            settleReason: 'aborted',
            mentionTurnId,
          };
        }
        continue;
      }

      const readyResult = await tryStructuredValidationWhenReady(raw, historyMessages);
      if (readyResult) return readyResult;

      if (
        isOfficeRunProtocolDischarged(tracker)
        && isSmartJsonShapeText(raw)
        && !hasSmartMentionRoomReplyMark(raw)
      ) {
        if (smartJsonWithoutMarkReadySinceMs === 0) {
          smartJsonWithoutMarkReadySinceMs = Date.now();
        } else if (
          !tracker.settleConsistencyAttempted
          && Date.now() - smartJsonWithoutMarkReadySinceMs >= OFFICE_SETTLE_CONSISTENCY_DELAY_MS
          && await canStartSmartMentionSettle(
            gateway,
            sessionKey,
            startedAtMs,
            tracker,
            runtimeToolTracker,
            historyMessages,
          )
        ) {
          const lateValidation = await validateWithRoomReplyMark(gateway, {
            ...roomMarkValidateOpts,
          });
          if (lateValidation.raw.trim() || lateValidation.ok) {
            return buildValidatedResult(lateValidation, deadlineMs, mentionTurnId);
          }
          smartJsonWithoutMarkReadySinceMs = Date.now();
        }
      } else {
        smartJsonWithoutMarkReadySinceMs = 0;
      }

      if (wakePoll) {
        wakePoll = false;
        continue;
      }
      const polled = await waitForNextMentionPoll(deadlineMs, signal, () => wakePoll);
      if (polled === 'aborted') {
        return {
          validation: failEmpty(),
          timedOut: true,
          error: 'aborted',
          settleReason: 'aborted',
          mentionTurnId,
        };
      }
      continue;
    }

    return {
      validation: failEmpty(),
      timedOut: true,
      settleReason: 'timeout',
      mentionTurnId,
    };
  } finally {
    cleanupListeners();
  }
}

/** @deprecated 请使用 {@link waitForSmartMentionValidated} */
export async function waitForMentionRunSettled(
  gateway: GatewayManager,
  options: WaitForMentionRunSettledOptions,
): Promise<WaitForMentionRunSettledResult> {
  const result = await waitForSmartMentionValidated(gateway, options);
  return {
    ...result,
    settled: true,
    raw: result.validation.raw,
  };
}
