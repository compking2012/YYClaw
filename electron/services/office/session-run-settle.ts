import { createHash } from 'crypto';
import type { GatewayManager } from '../../gateway/manager';
import {
  enrichMessagesForRoomMirror,
  sanitizeChatHistoryMessages,
} from '../../../src/lib/office-session-attachments';
import { isRealUserMessage } from '../../../src/lib/office-session-final-mirror';
import { fetchGatewaySessionListRow, invalidateGatewaySessionListRowCache, type GatewaySessionListRow } from './gateway-rpc';
import { fetchWorkflowSettleChatHistory } from './office-session-transcript';
import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';
import {
  canStartSessionTurnSettle,
  isTurnStillInProgressEvidence,
  OfficeRuntimeToolTracker,
  slicePostDispatchSegment,
  type OfficeRuntimeToolSnapshot,
  type TurnEvidenceMessage,
} from '../../../shared/session-turn-evidence';
import {
  gatewayEventMatchesRun,
  normalizeOfficeTimestampMs,
  type ParsedGatewayChatEvent,
} from './run-completion';
import { extractWorkflowStructuredFromAssistantMessage } from '../../../src/lib/office-session-final-mirror';
import { parseWorkflowJsonOutputDetailed, parseWorkflowJsonOutput } from '../../../src/lib/office-workflow-json-schema';
import { isWorkflowJsonCompletionEvidence } from '../../../src/lib/office-workflow-room-json-heal';
import { officeWorkflowLog } from './office-workflow-log';
import {
  logOfficeGatewaySettle,
  officeSessionListRowDetail,
  officeSettleGateStateDetail,
  logOfficeGatewayLifecycleRunIdMismatch,
} from './office-settle-gate-log';

export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type RawMsg = Record<string, unknown>;

/**
 * Run 级成功终态（Gateway lifecycle `phase=completed|done|finished|ended`）。
 * `phase=end` 为轮次边界，见 {@link OFFICE_RUN_ROUND_END_PHASES}。
 */
export const OFFICE_RUN_LEVEL_TERMINAL_PHASES = new Set(['completed', 'done', 'finished', 'ended']);

/** Gateway 每 tool 轮次可能发的非 run 级 `phase=end`（Harness: 不得单独卸协议约）。 */
export const OFFICE_RUN_ROUND_END_PHASES = new Set(['end']);

/**
 * @deprecated Use {@link OFFICE_RUN_LEVEL_TERMINAL_PHASES} for protocol discharge.
 * Still includes `end` for callers that mean "lifecycle success hint" broadly.
 */
export const OFFICE_RUN_COMPLETE_PHASES = new Set([
  ...OFFICE_RUN_LEVEL_TERMINAL_PHASES,
  ...OFFICE_RUN_ROUND_END_PHASES,
]);

/** Run 中间 lifecycle phase，不得单独触发 workflow/smart 收稿。 */
export const OFFICE_RUN_INTERMEDIATE_PHASES = new Set(['finishing', 'started']);

/** Run 失败终态（lifecycle `phase=error|failed` → run.ended status=error）。 */
export const OFFICE_RUN_TERMINAL_ERROR_PHASES = new Set(['error', 'failed']);

/** Run 中止终态（lifecycle `phase=aborted|cancelled` → run.ended status=aborted）。 */
export const OFFICE_RUN_TERMINAL_ABORT_PHASES = new Set(['aborted', 'cancelled']);

const RETRY_PHASE_HINT_RE =
  /retry|fallback|switch|next account|idle.?timeout|timed out|trying next/i;

/**
 * 收稿闸门打开后等待 5s，再拉取一次 session 做一致性校验（Smart + Workflow 统一）。
 * 对齐 agent session 终态模型：lifecycle / sessions.list idle 开门 → 延迟 → 单次对账 → JSON 校验。
 */
export const OFFICE_SETTLE_CONSISTENCY_DELAY_MS = 5_000;

/**
 * Workflow success settle ALWAYS performs the 5s consistency re-pull (aligned with the
 * required data-flow: success terminal → 5s re-pull + validate → JSON validation). The
 * previous 0ms fast-path skipped the re-pull for already-parseable JSON, which could accept
 * a body that later mutated within the settle window — kept as an alias to the consistency
 * delay so callers/log parity are unchanged.
 */
export const OFFICE_WORKFLOW_SETTLE_FAST_PATH_DELAY_MS = OFFICE_SETTLE_CONSISTENCY_DELAY_MS;

/** @deprecated Use {@link OFFICE_SETTLE_CONSISTENCY_DELAY_MS} */
export const SESSION_STABILITY_INITIAL_DELAY_MS = OFFICE_SETTLE_CONSISTENCY_DELAY_MS;

export {
  OFFICE_WORKFLOW_SETTLE_CHAT_HISTORY_LIMIT,
  fetchWorkflowSettleChatHistory,
} from './office-session-transcript';

/** @deprecated Removed multi-poll stable loop; kept for test migration only. */
export const SESSION_STABILITY_POLL_GAP_MS = OFFICE_SETTLE_CONSISTENCY_DELAY_MS;

/** @deprecated Single baseline+confirm hash compare replaces multi-poll matches. */
export const SESSION_STABILITY_REQUIRED_MATCHES = 1;

export interface OfficeRunTracker {
  runId?: string;
  /**
   * Authoritative lifecycle terminal (`phase=completed|done|finished|ended|error|aborted`).
   * `phase=end` alone does not set this — see {@link isRunLevelProtocolDischargeFromEndedEvent}.
   */
  runComplete: boolean;
  /**
   * Fallback when lifecycle WS frame was dropped: `sessions.list` reports session idle
   * (same reconcile model as Chat `session-actions.ts`).
   */
  sessionIdleReconciled: boolean;
  pendingRetry: boolean;
  terminalErrorEnded: boolean;
  terminalError?: string;
  terminalAssistantTexts: string[];
  /** 本 run 已执行过 5s 单次一致性收稿，避免 poll 重复触发。 */
  settleConsistencyAttempted: boolean;
  /** 终态闸门打开瞬间的 session 正文 hash（5s 后再拉一次与之对账）。 */
  settleBaselineHash?: string;
  /** baseline 正文（hash 不一致时完整度对账）。仅保留截断预览以控内存。 */
  settleBaselineText?: string;
  /**
   * 本 run 首次 baseline 正文（质量锚点）。HASH_MISMATCH 拒收后 baseline 会重置，
   * 但锚点保留，防止 session 永久退化后 hash 一致仍收下弱稿。
   */
  settleQualityAnchorText?: string;
  /** 本 run hash 不一致拒收次数（连续达上限则不再用 confirm 替换）。 */
  settleHashMismatchCount?: number;
  /**
   * Protocol gate opened via {@link tryReconcileOfficeRunFromWorkflowHistory} (syntax-only).
   * Relaxes sessions.list `hasActiveRun` for settle preconditions until verify hard-fails.
   */
  workflowHistoryReconciled?: boolean;
}

export function createOfficeRunTracker(runId?: string): OfficeRunTracker {
  return {
    runId,
    runComplete: false,
    sessionIdleReconciled: false,
    pendingRetry: false,
    terminalErrorEnded: false,
    terminalAssistantTexts: [],
    settleConsistencyAttempted: false,
    settleBaselineHash: undefined,
    settleBaselineText: undefined,
    settleQualityAnchorText: undefined,
    settleHashMismatchCount: undefined,
    workflowHistoryReconciled: false,
  };
}

export function resetOfficeSettleCaptureState(tracker: OfficeRunTracker): void {
  tracker.settleBaselineHash = undefined;
  tracker.settleBaselineText = undefined;
  tracker.settleConsistencyAttempted = false;
}

/** 新 run / 新 settle 周期：清空 baseline 与质量锚点。 */
export function beginOfficeSettleRunCycle(tracker: OfficeRunTracker): void {
  resetOfficeSettleCaptureState(tracker);
  tracker.settleQualityAnchorText = undefined;
  tracker.settleHashMismatchCount = undefined;
}

/** confirm 是否不低于本 run 首次 baseline 锚点（长度 + 完整度）。 */
export function confirmMeetsSettleQualityAnchor(
  tracker: OfficeRunTracker,
  confirmText: string,
): boolean {
  const anchor = tracker.settleQualityAnchorText?.trim();
  if (!anchor) return true;
  const anchorScore = scoreOfficeSettleReplyCompleteness(anchor);
  const confirmScore = scoreOfficeSettleReplyCompleteness(confirmText);
  if (confirmScore < anchorScore) return false;
  if (confirmText.trim().length < anchor.length) return false;
  return true;
}

/** 连续 hash 不一致拒收上限（超过则不再接受 confirm 替换）。 */
export const OFFICE_SETTLE_MAX_HASH_MISMATCH_RETRIES = 2;

/** 收稿正文「完整度」启发式分（workflow JSON 字段 + 长度）。 */
export function scoreOfficeSettleReplyCompleteness(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let score = trimmed.length;
  for (const field of [
    '"role"',
    '"step"',
    '"inputValidation"',
    '"execution"',
    '"outputValidation"',
    '"deliverable"',
    '"rollback"',
    '【群聊回复】',
  ]) {
    if (trimmed.includes(field)) score += 50;
  }
  return score;
}

export type OfficeSettleHashMismatchDecision = 'accept' | 'reject_retry' | 'reject_exhausted';

export function decideOfficeSettleHashMismatch(
  baselineText: string,
  confirmText: string,
  mismatchCount: number,
): {
  decision: OfficeSettleHashMismatchDecision;
  baselineScore: number;
  confirmScore: number;
} {
  const baselineScore = scoreOfficeSettleReplyCompleteness(baselineText);
  const confirmScore = scoreOfficeSettleReplyCompleteness(confirmText);
  const baselineLen = baselineText.trim().length;
  const confirmLen = confirmText.trim().length;

  if (hashSessionReplyText(baselineText) === hashSessionReplyText(confirmText)) {
    return { decision: 'accept', baselineScore, confirmScore };
  }

  if (mismatchCount >= OFFICE_SETTLE_MAX_HASH_MISMATCH_RETRIES) {
    return { decision: 'reject_exhausted', baselineScore, confirmScore };
  }

  if (confirmLen > baselineLen || confirmScore > baselineScore) {
    return { decision: 'accept', baselineScore, confirmScore };
  }

  return { decision: 'reject_retry', baselineScore, confirmScore };
}

export function isOfficeRunCompletePhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return OFFICE_RUN_LEVEL_TERMINAL_PHASES.has(phase.trim().toLowerCase());
}

export function isOfficeRunRoundEndPhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return OFFICE_RUN_ROUND_END_PHASES.has(phase.trim().toLowerCase());
}

/** Gateway `livenessState` indicates the session run is still executing. */
export function livenessStateIndicatesRunStillActive(livenessState: string | undefined): boolean {
  const normalized = (livenessState ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /^(active|running|live|busy|pending|executing|tool)/.test(normalized);
}

/** Gateway `livenessState` explicitly reports run/session idle. */
export function livenessStateIndicatesRunIdle(livenessState: string | undefined): boolean {
  const normalized = (livenessState ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'idle'
    || normalized === 'done'
    || normalized === 'completed'
    || normalized === 'finished'
    || normalized === 'inactive'
    || normalized === 'stopped';
}

/** Run-level terminal stop (not an intermediate tool round). */
export function isConclusiveRunStopReason(stopReason: string | undefined): boolean {
  const normalized = (stopReason ?? '').trim().toLowerCase();
  if (!normalized || isPendingToolUseStopReason(normalized)) return false;
  return normalized === 'end_turn'
    || normalized === 'endturn'
    || normalized === 'stop'
    || normalized === 'stop_sequence'
    || normalized === 'max_tokens'
    || normalized === 'length';
}

/**
 * Failure-like stop reasons Gateway may attach to `status=completed`
 * (e.g. LLM idle timeout → surface_error → completed + stopReason=aborted|timeout).
 * Must never open a success settle gate.
 */
export function isFailureLikeRunStopReason(stopReason: string | undefined): boolean {
  const normalized = (stopReason ?? '').trim().toLowerCase();
  return normalized === 'aborted'
    || normalized === 'cancelled'
    || normalized === 'canceled'
    || normalized === 'timeout'
    || normalized === 'timed_out'
    || normalized === 'killed'
    || normalized === 'error'
    || normalized === 'failed';
}

/** @deprecated Use {@link isFailureLikeRunStopReason}. */
export function isAbortLikeStopReason(stopReason: string | undefined): boolean {
  return isFailureLikeRunStopReason(stopReason);
}

type RunEndedEvent = Extract<ChatRuntimeEvent, { type: 'run.ended' }>;

/** Run-level completed phases that may carry a failure stopReason. */
function isRunLevelCompletedLifecyclePhase(phase: string): boolean {
  if (!phase) return true; // legacy frames omit phase
  if (phase === 'end') return true;
  return OFFICE_RUN_LEVEL_TERMINAL_PHASES.has(phase);
}

/**
 * Gateway may surface fatal failures as `run.ended status=completed` + failure stopReason
 * (not `status=error|aborted`). Treat as terminal failure — never success discharge.
 * Only run-level phases (`end` / completed|done|… / empty); intermediate phases wait
 * for a later terminal frame or sessions.list failure.
 */
export function isCompletedRunEndedAsTerminalFailure(event: RunEndedEvent): boolean {
  if (event.status !== 'completed') return false;
  if (!isFailureLikeRunStopReason(event.stopReason)) return false;
  const phase = (event.lifecyclePhase ?? '').trim().toLowerCase();
  if (OFFICE_RUN_INTERMEDIATE_PHASES.has(phase)) return false;
  return isRunLevelCompletedLifecyclePhase(phase);
}

/** @deprecated Use {@link isCompletedRunEndedAsTerminalFailure}. */
export function isCompletedRunEndedAsTerminalAbort(event: RunEndedEvent): boolean {
  return isCompletedRunEndedAsTerminalFailure(event);
}

/**
 * 协议层卸约：仅 run 级 lifecycle 终态。
 * `phase=end` + `stopReason=tool_use` / active liveness → 轮次结束，不卸约（对齐 Harness + Chat）。
 * `status=completed` + failure-like stopReason → 不走成功卸约（见 {@link isCompletedRunEndedAsTerminalFailure}）。
 */
export function isRunLevelProtocolDischargeFromEndedEvent(event: RunEndedEvent): boolean {
  if (event.status === 'error' || event.status === 'aborted') {
    return true;
  }
  if (event.status !== 'completed') return false;
  if (isCompletedRunEndedAsTerminalFailure(event)) return false;

  const phase = (event.lifecyclePhase ?? '').trim().toLowerCase();

  if (OFFICE_RUN_LEVEL_TERMINAL_PHASES.has(phase)) {
    return true;
  }

  if (phase === 'end') {
    if (isPendingToolUseStopReason(event.stopReason)) return false;
    if (livenessStateIndicatesRunStillActive(event.livenessState)) return false;
    if (livenessStateIndicatesRunIdle(event.livenessState)) return true;
    if (isConclusiveRunStopReason(event.stopReason)) return true;
    return false;
  }

  // Legacy / unknown phase: require conclusive stop and no active liveness.
  if (!phase) {
    if (isPendingToolUseStopReason(event.stopReason)) return false;
    if (livenessStateIndicatesRunStillActive(event.livenessState)) return false;
    return isConclusiveRunStopReason(event.stopReason);
  }

  return false;
}

export function isOfficeRunIntermediatePhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return OFFICE_RUN_INTERMEDIATE_PHASES.has(phase.trim().toLowerCase());
}

export function isOfficeRunTerminalErrorPhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return OFFICE_RUN_TERMINAL_ERROR_PHASES.has(phase.trim().toLowerCase());
}

export function isOfficeRunTerminalAbortPhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return OFFICE_RUN_TERMINAL_ABORT_PHASES.has(phase.trim().toLowerCase());
}

export function isOfficeRunTerminalFailurePhase(phase: string | undefined): boolean {
  return isOfficeRunTerminalErrorPhase(phase) || isOfficeRunTerminalAbortPhase(phase);
}

function resolveParsedTerminalError(
  parsed: Pick<ParsedGatewayChatEvent, 'terminalError' | 'runError'>,
): string | undefined {
  return parsed.terminalError?.trim() || parsed.runError?.trim() || undefined;
}

function markOfficeRunTerminalErrorEnded(
  tracker: OfficeRunTracker,
  parsed: Pick<ParsedGatewayChatEvent, 'terminalError' | 'runError' | 'assistantTexts'>,
  source?: string,
): void {
  tracker.runComplete = true;
  tracker.pendingRetry = false;
  // Failure terminal must not keep a prior success-idle / history-reconcile marker.
  tracker.sessionIdleReconciled = false;
  tracker.workflowHistoryReconciled = false;
  tracker.terminalErrorEnded = true;
  tracker.terminalError = resolveParsedTerminalError(parsed);
  tracker.terminalAssistantTexts = parsed.assistantTexts ?? [];
  logOfficeGatewaySettle('warn', 'terminal error ended — gate closed for success settle', {
    source,
    terminalError: tracker.terminalError,
    ...officeSettleGateStateDetail(tracker),
  });
}

export function isGatewayRunTerminalState(state: string | undefined): boolean {
  return (state ?? '').trim().toLowerCase() === 'final';
}

/** Gateway lifecycle phase 是否表示 run 级终态（workflow/smart runner 收稿闸门）。 */
export function isGatewayRunPhaseSettleSignal(parsed: { phase?: string }): boolean {
  const phase = (parsed.phase ?? '').trim().toLowerCase();
  return isOfficeRunCompletePhase(phase) || isOfficeRunTerminalFailurePhase(phase);
}

/** Gateway 事件是否表示本轮 run 已到终态（legacy 无 runId 路径：phase 完成 或 state=final）。 */
export function isGatewayRunTerminalSignal(parsed: {
  state?: string;
  phase?: string;
}): boolean {
  if (isGatewayRunPhaseSettleSignal(parsed)) return true;

  if (!isGatewayRunTerminalState(parsed.state)) return false;
  const phase = (parsed.phase ?? '').trim().toLowerCase();
  if (phase === 'started' || isOfficeRunIntermediatePhase(phase)) return false;
  if (phase && RETRY_PHASE_HINT_RE.test(phase)) return false;
  return true;
}

function readAssistantStopReason(message: RawMsg | undefined): string {
  if (!message) return '';
  return String(message.stopReason ?? message.stop_reason ?? '').trim().toLowerCase();
}

/** Mirrors Chat `hasPendingToolUse`: intermediate tool round, not run terminal. */
export function hasPendingToolUseInAssistantMessage(message: RawMsg | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  const reason = readAssistantStopReason(message);
  if (reason === 'tool_use' || reason === 'tooluse') return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_use' || b.type === 'toolCall') return true;
    }
  }

  const toolCalls = message.tool_calls ?? message.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/** Aligns with Chat `helpers.ts` `hasPendingToolUse` stop_reason checks. */
export function isPendingToolUseStopReason(stopReason: string | undefined): boolean {
  const normalized = (stopReason ?? '').trim().toLowerCase();
  return normalized === 'tool_use' || normalized === 'tooluse';
}

/** sessions.list row indicates successful run completion (not failure terminal). */
export function sessionListRowIndicatesSuccessIdle(
  session: GatewaySessionListRow | null | undefined,
): boolean {
  if (!session) return false;
  if (sessionListRowIndicatesFailureTerminal(session)) return false;
  if (session.hasActiveRun === false) return true;
  const status = (session.status ?? '').trim().toLowerCase();
  return status === 'done' || status === 'completed' || status === 'finished';
}

/**
 * sessions.list row reports a terminal failure.
 * Aligns with Chat/Harness terminal aliases (`timeout` / `killed` / …) so
 * `hasActiveRun=false` cannot fall through {@link sessionListRowIndicatesSuccessIdle}.
 */
export function sessionListRowIndicatesFailureTerminal(
  session: GatewaySessionListRow | null | undefined,
): boolean {
  if (!session) return false;
  const status = (session.status ?? '').trim().toLowerCase();
  return status === 'failed'
    || status === 'error'
    || status === 'aborted'
    || status === 'cancelled'
    || status === 'canceled'
    || status === 'timeout'
    || status === 'timed_out'
    || status === 'killed';
}

/** Aligns with Chat `session-actions.ts` `sessionIndicatesIdle` (sessions.list send gate). */
export function sessionIndicatesIdleFromListRow(session: GatewaySessionListRow | null | undefined): boolean {
  if (!session) return false;
  if (session.hasActiveRun === false) return true;
  const status = (session.status ?? '').trim().toLowerCase();
  return status === 'done'
    || status === 'completed'
    || status === 'finished'
    || status === 'failed'
    || status === 'error'
    || status === 'aborted'
    || status === 'cancelled'
    || status === 'canceled'
    || status === 'timeout'
    || status === 'timed_out'
    || status === 'killed';
}

function sessionListRowFreshForDispatch(
  row: GatewaySessionListRow | null | undefined,
  startedAtMs: number,
): boolean {
  if (
    typeof row?.updatedAt === 'number'
    && row.updatedAt > 0
    && row.updatedAt < startedAtMs
  ) {
    return false;
  }
  return true;
}

/**
 * Success settle only: sessions.list must show successful idle (not error/failed) and no active run.
 */
export function sessionListRowAllowsSuccessSettle(
  row: GatewaySessionListRow | null | undefined,
  startedAtMs: number,
): boolean {
  if (!sessionListRowFreshForDispatch(row, startedAtMs)) return false;
  if (row?.hasActiveRun === true) return false;
  if (sessionListRowIndicatesFailureTerminal(row)) return false;
  return sessionListRowIndicatesSuccessIdle(row);
}

/**
 * After workflow history reconcile: allow settle while Gateway still reports `hasActiveRun`
 * (common when `run.ended` was dropped but transcript already has final workflow JSON).
 */
export function sessionListRowAllowsWorkflowHistorySettle(
  row: GatewaySessionListRow | null | undefined,
  startedAtMs: number,
): boolean {
  if (!sessionListRowFreshForDispatch(row, startedAtMs)) return false;
  if (sessionListRowIndicatesFailureTerminal(row)) return false;
  return true;
}

/**
 * Chat 式 sessions.list：session 须 idle 且 row.updatedAt 不早于本轮 dispatch。
 * Success 收稿专用：排除 error/failed 态（见 {@link sessionListRowAllowsSuccessSettle}）。
 */
export async function verifyOfficeSessionAllowsSuccessSettle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
): Promise<boolean> {
  invalidateGatewaySessionListRowCache(sessionKey);
  const row = await fetchGatewaySessionListRow(gateway, sessionKey);
  // Post-open re-verify, tiered by how the gate was opened so it stays CONSISTENT with the
  // open decision (otherwise a lenient open + strict verify churns → node stuck):
  //  - runComplete (lifecycle terminal) / workflowHistoryReconciled (settled transcript JSON):
  //    strongest evidence → tolerate any non-failure row (Gateway may lag `hasActiveRun=true`).
  //  - sessionIdleReconciled only (opened from sessions.list idle): re-confirm the SAME
  //    success-idle signal used to open (status done/completed/finished OR hasActiveRun=false).
  //    A lagging `hasActiveRun=true` with status=done still settles; a genuinely running row
  //    (status=running / re-activated) is rejected so an intermediate turn is not settled.
  //  - none (defensive / pre-open): strict success-idle with no active run.
  let ok: boolean;
  if (tracker.workflowHistoryReconciled || tracker.runComplete) {
    ok = sessionListRowAllowsWorkflowHistorySettle(row, startedAtMs);
  } else if (tracker.sessionIdleReconciled) {
    ok = sessionListRowFreshForDispatch(row, startedAtMs) && sessionListRowIndicatesSuccessIdle(row);
  } else {
    ok = sessionListRowAllowsSuccessSettle(row, startedAtMs);
  }
  if (!ok) {
    const gateBeforeReset = officeSettleGateStateDetail(tracker);
    const verifyTier = tracker.workflowHistoryReconciled || tracker.runComplete
      ? 'history_or_lifecycle'
      : tracker.sessionIdleReconciled
        ? 'session_idle'
        : 'strict';
    if (tracker.sessionIdleReconciled) {
      tracker.sessionIdleReconciled = false;
      tracker.workflowHistoryReconciled = false;
      resetOfficeSettleCaptureState(tracker);
    }
    logOfficeGatewaySettle('warn', 'sessions.list verify rejected — gate reset (re-activation or row drift)', {
      sessionKey,
      startedAtMs,
      verifyTier,
      ...officeSessionListRowDetail(row),
      ...gateBeforeReset,
    });
    return false;
  }
  return true;
}

/**
 * @deprecated Use {@link verifyOfficeSessionAllowsSuccessSettle} for success settle paths.
 */
export async function verifyOfficeSessionAllowsSettle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
): Promise<boolean> {
  return verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker);
}

/**
 * When lifecycle `phase=end` was dropped, reconcile from `sessions.list` idle metadata
 * (same guard as Chat: row updatedAt must be at/after dispatch startedAtMs).
 */
/**
 * Chat parity: a fresh success-idle `sessions.list` row clears a stray `pendingRetry`
 * without re-opening an already-reconciled gate (avoids sessionIdleReconciled + pendingRetry deadlock).
 */
export function refreshOfficeRunPendingRetryFromSessionIdleRow(
  tracker: OfficeRunTracker,
  sessionRow: GatewaySessionListRow | null | undefined,
  startedAtMs: number,
): void {
  if (tracker.workflowHistoryReconciled) return;
  if (!tracker.sessionIdleReconciled && !tracker.runComplete) return;
  if (!sessionListRowFreshForDispatch(sessionRow, startedAtMs)) return;
  if (sessionListRowIndicatesFailureTerminal(sessionRow)) return;
  if (!sessionListRowIndicatesSuccessIdle(sessionRow)) return;
  tracker.pendingRetry = false;
}

export function reconcileOfficeRunSessionIdle(
  tracker: OfficeRunTracker,
  sessionRow: GatewaySessionListRow | null | undefined,
  startedAtMs: number,
): boolean {
  if (tracker.sessionIdleReconciled || tracker.runComplete) {
    refreshOfficeRunPendingRetryFromSessionIdleRow(tracker, sessionRow, startedAtMs);
    return tracker.sessionIdleReconciled || tracker.runComplete;
  }
  if (!sessionListRowFreshForDispatch(sessionRow, startedAtMs)) return false;

  // A fresh terminal `sessions.list` row is authoritative even when a transient
  // `state=error` retry hint set `pendingRetry` and the final lifecycle frame was
  // dropped (Chat parity: `reconcileCurrentSessionIdleFromBackend` clears `sending`
  // on a fresh idle row regardless of prior retry state). hasActiveRun still guards
  // against false positives while the gateway is genuinely re-running.
  if (sessionListRowIndicatesFailureTerminal(sessionRow)) {
    markOfficeRunTerminalErrorEnded(tracker, {
      terminalError: sessionRow?.status,
      runError: sessionRow?.status,
      assistantTexts: [],
    }, 'sessions.list.failure');
    return false;
  }

  if (!sessionListRowIndicatesSuccessIdle(sessionRow)) {
    logOfficeGatewaySettle('debug', 'sessions.list not success-idle — gate stays closed', {
      startedAtMs,
      ...officeSessionListRowDetail(sessionRow),
      ...officeSettleGateStateDetail(tracker),
    });
    return false;
  }
  tracker.pendingRetry = false;
  tracker.sessionIdleReconciled = true;
  beginOfficeSettleRunCycle(tracker);
  logOfficeGatewaySettle('info', 'sessions.list success-idle — gate opened (sessionIdleReconciled)', {
    startedAtMs,
    ...officeSessionListRowDetail(sessionRow),
    ...officeSettleGateStateDetail(tracker),
  });
  return true;
}

export async function tryReconcileOfficeRunSessionIdle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
): Promise<boolean> {
  invalidateGatewaySessionListRowCache(sessionKey);
  const row = await fetchGatewaySessionListRow(gateway, sessionKey);
  if (tracker.sessionIdleReconciled || tracker.runComplete) {
    refreshOfficeRunPendingRetryFromSessionIdleRow(tracker, row, startedAtMs);
    return tracker.sessionIdleReconciled || tracker.runComplete;
  }

  // Failure rows are authoritative: mark terminalErrorEnded. If transcript already has
  // completion JSON, wait finish will poll it and may still validate ok — do not
  // ignore-and-wait (third state with neither terminal nor success gate).
  return reconcileOfficeRunSessionIdle(tracker, row, startedAtMs);
}

/** Post-dispatch transcript already has parseable workflow JSON with completion semantics. */
export function sessionTranscriptHasCompletionWorkflowJson(
  messages: RawMsg[],
  startedAtMs: number,
): boolean {
  const resolved = findLatestParseableWorkflowReplyInRunSegment(messages, startedAtMs);
  if (resolved.kind !== 'ok') return false;
  const json = parseWorkflowJsonOutput(resolved.raw);
  if (!json) return false;
  return isWorkflowJsonCompletionEvidence(json);
}

/** Last assistant in the run segment with a conclusive stop (stop / end_turn). */
export function findLastConclusiveAssistantInRunSegment(
  messages: RawMsg[],
  startedAtMs: number,
): RawMsg | null {
  const enriched = enrichMessagesForRoomMirror(messages);
  const anchorIdx = findTriggerUserAnchorIndex(enriched, startedAtMs);
  if (anchorIdx < 0) return null;
  for (let i = enriched.length - 1; i > anchorIdx; i--) {
    const msg = enriched[i];
    if (!msg || msg.role !== 'assistant') continue;
    const stop = readAssistantStopReason(msg);
    if (!isConclusiveRunStopReason(stop)) continue;
    if (hasPendingToolUseInAssistantMessage(msg)) continue;
    return msg;
  }
  return null;
}

function findLatestNonToolPendingAssistantInRunSegment(
  messages: RawMsg[],
  anchorIdx: number,
): RawMsg | null {
  for (let i = messages.length - 1; i > anchorIdx; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    if (hasPendingToolUseInAssistantMessage(msg)) return null;
    return msg;
  }
  return null;
}

function assistantVisibleText(message: RawMsg): string {
  const structured = extractWorkflowStructuredFromAssistantMessage(message).trim();
  if (structured) return structured;
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    let out = '';
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const row = block as Record<string, unknown>;
      if (row.type === 'text' && typeof row.text === 'string') out += row.text;
    }
    return out.trim();
  }
  return typeof message.text === 'string' ? message.text.trim() : '';
}

function looksLikeWorkflowJsonPayload(text: string): boolean {
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

function workflowReplyCandidateTexts(latest: RawMsg, replyText?: string | null): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };
  push(extractWorkflowStructuredFromAssistantMessage(latest));
  push(assistantVisibleText(latest));
  if (replyText?.trim()) push(replyText.trim());
  return out;
}

type ResolveParseableWorkflowReplyResult =
  | { ok: true; raw: string; repaired: boolean }
  | { ok: false; raw: string; issues: string[]; detail: string };

/**
 * Try parse (with syntax repair) on latest assistant / poll candidates.
 * Returns explicit parse failure when text looks like workflow JSON but still cannot parse.
 */
function resolveParseableWorkflowJsonFromLatestAssistant(
  latest: RawMsg,
  replyText?: string | null,
): ResolveParseableWorkflowReplyResult | null {
  const latestTexts = workflowReplyCandidateTexts(latest, null);
  let lastParseFailure: { raw: string; issues: string[]; detail: string } | null = null;

  for (const text of latestTexts) {
    const parsed = parseWorkflowJsonOutputDetailed(text);
    if (parsed.ok) {
      return { ok: true, raw: text, repaired: parsed.repaired };
    }
    if (looksLikeWorkflowJsonPayload(text)) {
      lastParseFailure = {
        raw: text,
        issues: parsed.issues,
        detail: parsed.detail,
      };
    }
  }

  const latestVisible = assistantVisibleText(latest);
  if (latestVisible) {
    return lastParseFailure ? { ok: false, ...lastParseFailure } : null;
  }

  const polled = replyText?.trim();
  if (!polled) return null;

  const parsedPoll = parseWorkflowJsonOutputDetailed(polled);
  if (parsedPoll.ok) {
    return { ok: true, raw: polled, repaired: parsedPoll.repaired };
  }
  if (looksLikeWorkflowJsonPayload(polled)) {
    return {
      ok: false,
      raw: polled,
      issues: parsedPoll.issues,
      detail: parsedPoll.detail,
    };
  }
  return null;
}

export type FindLatestParseableWorkflowReplyResult =
  | { kind: 'pending' }
  | { kind: 'ok'; raw: string; message: RawMsg; repaired: boolean }
  | {
      kind: 'parse_failed';
      raw: string;
      message: RawMsg;
      issues: string[];
      detail: string;
    };

/**
 * Latest parseable workflow JSON on the **latest** non-tool-pending assistant (syntax repair only).
 * Does not scan older assistants (avoids stale JSON after newer narration).
 *
 * - `pending`: transcript/runtime not ready (in-flight tool, no anchor, no workflow-shaped text).
 * - `ok` / `parse_failed`: latest assistant has workflow-shaped body; parse attempt finished (no spin).
 */
export function findLatestParseableWorkflowReplyInRunSegment(
  messages: RawMsg[],
  startedAtMs: number,
  replyText?: string | null,
  runtime?: OfficeRuntimeToolSnapshot | null,
): FindLatestParseableWorkflowReplyResult {
  if (sessionHasInFlightToolWork(messages, startedAtMs)) return { kind: 'pending' };

  const enriched = enrichMessagesForRoomMirror(messages);
  const anchorIdx = findTriggerUserAnchorIndex(enriched, startedAtMs);
  if (anchorIdx < 0) return { kind: 'pending' };

  const segment = slicePostDispatchSegment(enriched as TurnEvidenceMessage[], startedAtMs);
  if (runtime !== undefined && isTurnStillInProgressEvidence(segment, runtime)) {
    return { kind: 'pending' };
  }

  const latest = findLatestNonToolPendingAssistantInRunSegment(enriched, anchorIdx);
  if (!latest) return { kind: 'pending' };

  const resolved = resolveParseableWorkflowJsonFromLatestAssistant(latest, replyText);
  if (!resolved) return { kind: 'pending' };
  if (resolved.ok) {
    return { kind: 'ok', raw: resolved.raw, message: latest, repaired: resolved.repaired };
  }
  return {
    kind: 'parse_failed',
    raw: resolved.raw,
    message: latest,
    issues: resolved.issues,
    detail: resolved.detail,
  };
}

export function shouldUseWorkflowSettleFastPath(
  messages: RawMsg[],
  startedAtMs: number,
  replyText: string,
  runtime?: OfficeRuntimeToolSnapshot | null,
): boolean {
  const kind = findLatestParseableWorkflowReplyInRunSegment(messages, startedAtMs, replyText, runtime).kind;
  // `parse_failed`: transport stable but syntax repair exhausted — skip settle delay and hand off to validation retry.
  return kind === 'ok' || kind === 'parse_failed';
}

/**
 * Settle 层 JSON 解析（含 repair）仍失败时：返回 raw 供 wait 结束并交给
 * `validateWorkflowAgentStructuredReply` + `fetchWorkflowAgentReplyWithRetry` 做 format-retry。
 */
export function tryHandoffWorkflowSettleSyntaxParseFailure(
  messages: RawMsg[],
  startedAtMs: number,
  replyText?: string | null,
  runtime?: OfficeRuntimeToolSnapshot | null,
): string | null {
  const resolved = findLatestParseableWorkflowReplyInRunSegment(
    messages,
    startedAtMs,
    replyText,
    runtime,
  );
  if (resolved.kind !== 'parse_failed') return null;
  officeWorkflowLog(
    'warn',
    '[office][workflow-settle] syntax parse failed after repair — finish wait for validation retry',
    {
      syntaxDetail: resolved.detail,
      issues: resolved.issues.join(','),
      visibleChars: resolved.raw.length,
    },
  );
  return resolved.raw;
}

/**
 * Model B (Chat parity): transcript workflow-JSON NEVER opens the protocol gate on its own.
 * A gateway terminal signal must open the gate first — `run.ended` lifecycle (`runComplete`)
 * or `sessions.list` idle reconcile (`sessionIdleReconciled`). Once open, a parseable final
 * workflow reply only PROMOTES {@link OfficeRunTracker.workflowHistoryReconciled} so settle
 * verify can relax `sessions.list` `hasActiveRun` (dropped-lifecycle flap). Disk/schema
 * validation still runs after settle.
 */
export function tryReconcileOfficeRunFromWorkflowHistory(
  tracker: OfficeRunTracker,
  messages: RawMsg[],
  startedAtMs: number,
  options?: {
    replyText?: string | null;
    runtimeToolSnapshot?: OfficeRuntimeToolSnapshot | null;
  },
): boolean {
  if (tracker.terminalErrorEnded) return false;

  // Gate must already be open via an authoritative gateway terminal signal.
  const gateOpen = tracker.runComplete || tracker.sessionIdleReconciled;
  if (!gateOpen) return false;
  if (tracker.workflowHistoryReconciled) return true;

  const resolved = findLatestParseableWorkflowReplyInRunSegment(
    messages,
    startedAtMs,
    options?.replyText,
    options?.runtimeToolSnapshot,
  );
  if (resolved.kind === 'pending') {
    // Gate is open, but transcript syntax not ready yet — do not promote.
    return true;
  }
  if (resolved.kind === 'parse_failed') {
    officeWorkflowLog(
      'warn',
      '[office][workflow-session] history reconcile syntax parse failed (repair exhausted) — promoting settle for validation retry',
      {
        runId: tracker.runId,
        syntaxDetail: resolved.detail,
        issues: resolved.issues.join(','),
        visibleChars: resolved.raw.length,
      },
    );
    tracker.workflowHistoryReconciled = true;
    return true;
  }

  tracker.workflowHistoryReconciled = true;
  officeWorkflowLog('info', '[office][workflow-session] history reconcile promoted workflowHistoryReconciled', {
    runId: tracker.runId,
    replyChars: resolved.raw.length,
    syntaxRepaired: resolved.repaired,
    syntaxOnly: true,
  });
  return true;
}

/** Run 收稿协议层是否已卸约（≈ Chat `!store.sending`：run.ended / sessions.list idle）。 */
export function isOfficeRunProtocolDischarged(tracker: OfficeRunTracker): boolean {
  return isOfficeRunSettleGateOpen(tracker);
}

/** Gateway terminal signal already opened the settle gate (lifecycle or sessions.list). */
function officeRunAuthoritativeTerminalOpen(tracker: OfficeRunTracker): boolean {
  return tracker.workflowHistoryReconciled
    || tracker.runComplete
    || tracker.sessionIdleReconciled;
}

/** @deprecated Use {@link isOfficeRunProtocolDischarged} — name kept for call-site migration. */
export function isOfficeRunSettleGateOpen(tracker: OfficeRunTracker): boolean {
  // Authoritative terminal (run.ended / sessions.list idle / settled transcript) must not be
  // re-closed by a transient retry hint (`state=error`, retry-phase). Otherwise
  // `runComplete|sessionIdleReconciled + pendingRetry` deadlock the gate before history promote.
  // Genuine re-activation (`run.started` / `state=started`) clears these markers.
  if (officeRunAuthoritativeTerminalOpen(tracker)) return true;
  if (tracker.pendingRetry) return false;
  return false;
}

export function evaluateOfficeTurnStillInProgress(
  messages: RawMsg[],
  startedAtMs: number,
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  const segment = slicePostDispatchSegment(messages as TurnEvidenceMessage[], startedAtMs);
  return isTurnStillInProgressEvidence(segment, runtime);
}

/**
 * 开始收稿（第二层释放，不含 5s/hash/JSON）≈ Chat 可发下一条：`!sending && !inputRunActive`。
 */
export function canStartOfficeSessionSettle(
  tracker: OfficeRunTracker,
  messages: RawMsg[],
  startedAtMs: number,
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  if (tracker.terminalErrorEnded) return false;
  const segment = slicePostDispatchSegment(messages as TurnEvidenceMessage[], startedAtMs);
  return canStartSessionTurnSettle(isOfficeRunProtocolDischarged(tracker), segment, runtime);
}

export { OfficeRuntimeToolTracker };

/**
 * Apply Chat-normalized `run.started` / `run.ended` (same layer as `chat-runtime-events.ts`).
 * Protocol discharge only on run-level lifecycle terminal — not per-tool `phase=end`.
 */
export function applyOfficeRunRuntimeEvent(
  tracker: OfficeRunTracker,
  event: ChatRuntimeEvent,
  context?: { sessionKey?: string },
): void {
  if (!gatewayEventMatchesRun(tracker.runId, event.runId)) {
    logOfficeGatewayLifecycleRunIdMismatch(tracker.runId, event.runId, event.type, context?.sessionKey);
    return;
  }

  if (event.type === 'run.started') {
    const reactivated = tracker.runComplete || tracker.sessionIdleReconciled;
    if (reactivated) {
      logOfficeGatewaySettle('info', 'lifecycle run.started — gate reset (re-activation)', {
        sessionKey: context?.sessionKey,
        eventRunId: event.runId,
        ...officeSettleGateStateDetail(tracker),
      });
      tracker.runComplete = false;
      tracker.sessionIdleReconciled = false;
      tracker.workflowHistoryReconciled = false;
      tracker.pendingRetry = true;
    } else {
      logOfficeGatewaySettle('debug', 'lifecycle run.started — non-terminal (gate unchanged)', {
        sessionKey: context?.sessionKey,
        eventRunId: event.runId,
        ...officeSettleGateStateDetail(tracker),
      });
    }
    beginOfficeSettleRunCycle(tracker);
    tracker.terminalErrorEnded = false;
    tracker.terminalError = undefined;
    tracker.terminalAssistantTexts = [];
    return;
  }

  if (event.type !== 'run.ended') return;

  if (event.status === 'completed') {
    if (isCompletedRunEndedAsTerminalFailure(event)) {
      markOfficeRunTerminalErrorEnded(tracker, {
        terminalError: event.error ?? `stopReason=${event.stopReason}`,
        runError: event.error,
        assistantTexts: [],
      }, 'lifecycle.run.ended.completed_failure_stop');
      return;
    }
    if (!isRunLevelProtocolDischargeFromEndedEvent(event)) {
      logOfficeGatewaySettle('debug', 'lifecycle run.ended completed ignored — non-run-level phase', {
        sessionKey: context?.sessionKey,
        eventRunId: event.runId,
        lifecyclePhase: event.lifecyclePhase,
        stopReason: event.stopReason,
      });
      return;
    }
    tracker.runComplete = true;
    tracker.sessionIdleReconciled = false;
    tracker.workflowHistoryReconciled = false;
    tracker.pendingRetry = false;
    beginOfficeSettleRunCycle(tracker);
    logOfficeGatewaySettle('info', 'lifecycle run.ended completed — gate opened (runComplete)', {
      sessionKey: context?.sessionKey,
      eventRunId: event.runId,
      lifecyclePhase: event.lifecyclePhase,
      ...officeSettleGateStateDetail(tracker),
    });
    return;
  }

  markOfficeRunTerminalErrorEnded(tracker, {
    terminalError: event.error,
    runError: event.error,
    assistantTexts: [],
  }, `lifecycle.run.ended.${event.status}`);
}

export function applyOfficeRunGatewayEvent(
  tracker: OfficeRunTracker,
  parsed: Pick<
    ParsedGatewayChatEvent,
    | 'state'
    | 'phase'
    | 'runId'
    | 'status'
    | 'finalStatus'
    | 'terminalError'
    | 'runError'
    | 'assistantTexts'
    | 'message'
  >,
): void {
  if (!gatewayEventMatchesRun(tracker.runId, parsed.runId)) return;

  const state = (parsed.state ?? '').trim().toLowerCase();
  const phase = (parsed.phase ?? '').trim().toLowerCase();

  if (phase && RETRY_PHASE_HINT_RE.test(phase)) {
    if (officeRunAuthoritativeTerminalOpen(tracker)) {
      logOfficeGatewaySettle('debug', 'gateway retry-phase hint ignored — authoritative terminal open', {
        phase,
        runId: tracker.runId,
        ...officeSettleGateStateDetail(tracker),
      });
    } else {
      tracker.pendingRetry = true;
      logOfficeGatewaySettle('debug', 'gateway retry-phase hint — pendingRetry set', {
        phase,
        runId: tracker.runId,
      });
    }
  }
  if (state === 'error') {
    if (officeRunAuthoritativeTerminalOpen(tracker)) {
      logOfficeGatewaySettle('debug', 'gateway state=error hint ignored — authoritative terminal open (non-terminal)', {
        runId: tracker.runId,
        ...officeSettleGateStateDetail(tracker),
      });
    } else {
      tracker.pendingRetry = true;
      logOfficeGatewaySettle('debug', 'gateway state=error hint — pendingRetry set (non-terminal)', {
        runId: tracker.runId,
      });
    }
  }
  if (state === 'started' || phase === 'started') {
    if (tracker.runComplete || tracker.sessionIdleReconciled) {
      logOfficeGatewaySettle('info', 'gateway started after gate open — re-activation', {
        runId: tracker.runId,
        state,
        phase,
        ...officeSettleGateStateDetail(tracker),
      });
      tracker.runComplete = false;
      tracker.sessionIdleReconciled = false;
      tracker.pendingRetry = true;
    }
    // Genuine re-activation: drop any settled-transcript marker so the gate truly reopens
    // (mirrors applyOfficeRunRuntimeEvent run.started).
    tracker.workflowHistoryReconciled = false;
    beginOfficeSettleRunCycle(tracker);
    tracker.terminalErrorEnded = false;
    tracker.terminalError = undefined;
    tracker.terminalAssistantTexts = [];
  }
  // lifecycle success/error terminals are applied only via applyOfficeRunRuntimeEvent (run.ended).

  // chat `state=final` is NOT authoritative for run terminal (Gateway emits final on
  // intermediate tool rounds too). Do not set runComplete here — only track for partial UI.
  if (isGatewayRunTerminalState(state) && !tracker.pendingRetry) {
    if (
      phase !== 'started'
      && !isOfficeRunIntermediatePhase(phase)
      && !(phase && RETRY_PHASE_HINT_RE.test(phase))
      && !hasPendingToolUseInAssistantMessage(parsed.message)
    ) {
      // Intentionally no runComplete / sessionIdleReconciled — settle waits for lifecycle or sessions.list.
    }
  }
}

function isToolResultRole(role: unknown): boolean {
  const normalized = String(role ?? '').toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function collectToolCallIdsFromMessage(msg: RawMsg): string[] {
  const ids: string[] = [];
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_use' && b.type !== 'toolCall') continue;
      const id = b.id ?? b.name;
      if (id != null && String(id).trim()) ids.push(String(id));
    }
  }
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (!tc || typeof tc !== 'object') continue;
      const row = tc as Record<string, unknown>;
      const id = row.id ?? row.name;
      if (id != null && String(id).trim()) ids.push(String(id));
    }
  }
  return ids;
}

function findTriggerUserAnchorIndex(messages: RawMsg[], startedAtMs: number): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    const ts = normalizeOfficeTimestampMs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    return i;
  }
  return -1;
}

/** 本轮 user 触发之后是否存在未闭合的 tool 调用。 */
export function sessionHasInFlightToolWork(
  messages: RawMsg[],
  startedAtMs: number,
): boolean {
  const enriched = enrichMessagesForRoomMirror(messages);
  const anchorIdx = findTriggerUserAnchorIndex(enriched, startedAtMs);
  if (anchorIdx < 0) return false;

  const pending = new Set<string>();
  for (let i = anchorIdx + 1; i < enriched.length; i++) {
    const msg = enriched[i]!;
    if (isRealUserMessage(msg)) break;

    if (msg.role === 'assistant') {
      for (const id of collectToolCallIdsFromMessage(msg)) {
        pending.add(id);
      }
    }
    if (isToolResultRole(msg.role)) {
      const toolCallId = msg.toolCallId ?? msg.tool_call_id;
      if (toolCallId != null) pending.delete(String(toolCallId));
      else pending.clear();
    }
  }

  if (pending.size > 0) return true;

  const last = enriched[enriched.length - 1];
  return Boolean(last && isToolResultRole(last.role));
}

export function hashSessionReplyText(text: string | null | undefined): string {
  return createHash('sha256').update((text ?? '').trim()).digest('hex');
}

export function canAcceptStableSessionReply(tracker: OfficeRunTracker): boolean {
  return isOfficeRunSettleGateOpen(tracker) && !tracker.terminalErrorEnded;
}

export interface FetchStableSessionReplyOptions {
  sessionKey: string;
  startedAtMs: number;
  signal?: AbortSignal;
  tracker: OfficeRunTracker;
  pollText: (historyMessages?: RawMsg[]) => Promise<string | null>;
  consistencyDelayMs?: number;
  /** Skip 5s consistency delay when workflow history already has stable structured JSON. */
  workflowFastPath?: boolean;
  onPartialReply?: (text: string) => void;
}

export type StableSessionReplySnapshot = {
  text: string | null;
  /** Confirm-fetch `chat.history` messages (passed to downstream accept / JSON validation). */
  lastHistoryMessages?: RawMsg[];
  /** True when confirm text hash differed from baseline but was accepted (confirm longer/more complete). */
  hashMismatch?: boolean;
  /** Mismatch was evaluated but confirm was rejected (caller may retry settle). */
  hashMismatchRejected?: boolean;
};

async function loadSessionHistoryForSettle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
): Promise<RawMsg[] | null> {
  try {
    const history = await fetchWorkflowSettleChatHistory(gateway, sessionKey, {
      urgent: true,
      startedAtMs,
    });
    return sanitizeChatHistoryMessages(history.messages) as RawMsg[];
  } catch {
    return null;
  }
}

async function loadOfficeSettlePreconditionHistory(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
): Promise<RawMsg[] | null> {
  if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker))) {
    return null;
  }

  let messages = await loadSessionHistoryForSettle(gateway, sessionKey, startedAtMs);
  if (!messages || sessionHasInFlightToolWork(messages, startedAtMs)) return null;

  invalidateGatewaySessionListRowCache(sessionKey);
  if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, sessionKey, startedAtMs, tracker))) {
    return null;
  }

  messages = await loadSessionHistoryForSettle(gateway, sessionKey, startedAtMs);
  if (!messages || sessionHasInFlightToolWork(messages, startedAtMs)) return null;

  return messages;
}

/**
 * 终态闸门刚打开时抓取 baseline（判断可收稿瞬间的 session 快照）。
 * 双检 success-idle + 无 in-flight tool；失败时不标记 settleConsistencyAttempted。
 */
export async function captureOfficeSettleBaseline(
  gateway: GatewayManager,
  options: {
    sessionKey: string;
    startedAtMs: number;
    tracker: OfficeRunTracker;
    pollText: (historyMessages?: RawMsg[]) => Promise<string | null>;
    onPartialReply?: (text: string) => void;
    /** Chat-aligned evidence gate — checked on the same history load as baseline capture. */
    runtimeToolSnapshot?: OfficeRuntimeToolSnapshot | null;
  },
): Promise<boolean> {
  const { sessionKey, startedAtMs, tracker, pollText, onPartialReply, runtimeToolSnapshot } = options;
  if (!canAcceptStableSessionReply(tracker)) return false;
  if (tracker.settleBaselineHash) return true;

  const messages = await loadOfficeSettlePreconditionHistory(
    gateway,
    sessionKey,
    startedAtMs,
    tracker,
  );
  if (!messages) return false;

  if (runtimeToolSnapshot !== undefined) {
    const segment = slicePostDispatchSegment(messages as TurnEvidenceMessage[], startedAtMs);
    if (!canStartSessionTurnSettle(
      isOfficeRunProtocolDischarged(tracker),
      segment,
      runtimeToolSnapshot,
    )) {
      return false;
    }
  }

  const text = (await pollText(messages))?.trim() || '';
  const hash = hashSessionReplyText(text);
  if (!hash) return false;

  tracker.settleBaselineHash = hash;
  tracker.settleBaselineText = text;
  if (!tracker.settleQualityAnchorText?.trim()) {
    tracker.settleQualityAnchorText = text;
  }
  tracker.settleHashMismatchCount = tracker.settleHashMismatchCount ?? 0;
  if (onPartialReply) onPartialReply(text);
  return true;
}

/** @deprecated Use {@link verifyOfficeSessionAllowsSettle} */
export async function verifyOfficeSettleSessionStillIdle(
  gateway: GatewayManager,
  sessionKey: string,
  startedAtMs: number,
  tracker: OfficeRunTracker,
): Promise<boolean> {
  return verifyOfficeSessionAllowsSettle(gateway, sessionKey, startedAtMs, tracker);
}

/**
 * 前提：{@link captureOfficeSettleBaseline} 已成功。
 * 等 5s → 双检 success-idle + 无 tool → 第 2 次拉取正文。
 * hash 一致直接收稿；不一致时 confirm 更长/更完整则收稿并 warn，否则拒收并重置 baseline 允许重试。
 */
export async function fetchStableSessionReplyText(
  gateway: GatewayManager,
  options: FetchStableSessionReplyOptions,
): Promise<StableSessionReplySnapshot | null> {
  const {
    sessionKey,
    startedAtMs,
    signal,
    tracker,
    pollText,
    consistencyDelayMs = options.workflowFastPath
      ? OFFICE_WORKFLOW_SETTLE_FAST_PATH_DELAY_MS
      : OFFICE_SETTLE_CONSISTENCY_DELAY_MS,
    onPartialReply,
  } = options;

  if (!canAcceptStableSessionReply(tracker)) return null;
  const baselineHash = tracker.settleBaselineHash;
  const baselineText = tracker.settleBaselineText ?? '';
  if (!baselineHash) return null;

  if (consistencyDelayMs > 0) {
    await sleepAbortable(consistencyDelayMs, signal);
  }

  if (!canAcceptStableSessionReply(tracker)) return null;

  const confirmMessages = await loadOfficeSettlePreconditionHistory(
    gateway,
    sessionKey,
    startedAtMs,
    tracker,
  );
  if (!confirmMessages) return null;

  const confirmText = (await pollText(confirmMessages))?.trim() || '';
  if (!confirmText) return null;
  if (onPartialReply) onPartialReply(confirmText);

  const confirmHash = hashSessionReplyText(confirmText);
  const hashMismatch = confirmHash !== baselineHash;

  const rejectSettleConsistency = (
    reason: 'HASH_MISMATCH_REJECT' | 'ANCHOR_QUALITY_REJECT',
    extra: Record<string, unknown> = {},
  ): StableSessionReplySnapshot => {
    const mismatchCount = tracker.settleHashMismatchCount ?? 0;
    tracker.settleHashMismatchCount = mismatchCount + 1;
    officeWorkflowLog('warn', `[office][settle-consistency] ${reason}`, {
      sessionKey,
      runId: tracker.runId,
      startedAtMs,
      mismatchCount: tracker.settleHashMismatchCount,
      baselineHash: baselineHash.slice(0, 16),
      confirmHash: confirmHash.slice(0, 16),
      anchorScore: tracker.settleQualityAnchorText
        ? scoreOfficeSettleReplyCompleteness(tracker.settleQualityAnchorText)
        : undefined,
      confirmScore: scoreOfficeSettleReplyCompleteness(confirmText),
      baselineLen: baselineText.trim().length,
      confirmLen: confirmText.trim().length,
      ...extra,
    });
    resetOfficeSettleCaptureState(tracker);
    return {
      text: null,
      hashMismatchRejected: true,
    };
  };

  if (!hashMismatch) {
    if (!confirmMeetsSettleQualityAnchor(tracker, confirmText)) {
      return rejectSettleConsistency('ANCHOR_QUALITY_REJECT', { hashMatched: true });
    }
    tracker.settleHashMismatchCount = 0;
    return {
      text: confirmText,
      lastHistoryMessages: confirmMessages,
      hashMismatch: false,
    };
  }

  const mismatchCount = tracker.settleHashMismatchCount ?? 0;
  const verdict = decideOfficeSettleHashMismatch(baselineText, confirmText, mismatchCount);

  if (verdict.decision === 'reject_exhausted') {
    const baselineJson = parseWorkflowJsonOutput(baselineText);
    if (
      baselineJson
      && confirmMeetsSettleQualityAnchor(tracker, baselineText)
      && isWorkflowJsonCompletionEvidence(baselineJson)
    ) {
      officeWorkflowLog(
        'warn',
        '[office][settle-consistency] HASH_MISMATCH_EXHAUSTED_ACCEPT — keeping baseline with completion evidence',
        {
          sessionKey,
          runId: tracker.runId,
          startedAtMs,
          baselineLen: baselineText.trim().length,
          confirmLen: confirmText.trim().length,
        },
      );
      tracker.settleHashMismatchCount = 0;
      return {
        text: baselineText,
        lastHistoryMessages: confirmMessages,
        hashMismatch: true,
      };
    }
  }

  if (verdict.decision === 'reject_retry' || verdict.decision === 'reject_exhausted') {
    return rejectSettleConsistency('HASH_MISMATCH_REJECT', {
      decision: verdict.decision,
      baselineScore: verdict.baselineScore,
      confirmScore: verdict.confirmScore,
    });
  }

  if (!confirmMeetsSettleQualityAnchor(tracker, confirmText)) {
    return rejectSettleConsistency('ANCHOR_QUALITY_REJECT', {
      decision: 'growth_below_anchor',
      baselineScore: verdict.baselineScore,
      confirmScore: verdict.confirmScore,
    });
  }

  officeWorkflowLog(
    'warn',
    '[office][settle-consistency] HASH_MISMATCH_ACCEPT — confirm (2nd) fetch is longer/more complete',
    {
      sessionKey,
      runId: tracker.runId,
      startedAtMs,
      baselineHash: baselineHash.slice(0, 16),
      confirmHash: confirmHash.slice(0, 16),
      baselineScore: verdict.baselineScore,
      confirmScore: verdict.confirmScore,
      baselineLen: baselineText.trim().length,
      confirmLen: confirmText.trim().length,
    },
  );
  tracker.settleHashMismatchCount = 0;
  return {
    text: confirmText,
    lastHistoryMessages: confirmMessages,
    hashMismatch: true,
  };
}
